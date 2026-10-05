"""Stories past 24 hours are deleted for good — row, views, reactions and
every file — with nothing to schedule; deleting your own story removes its
files too. Viewers react with one emoji (changeable); the owner is told once
and sees who watched and how they reacted.

    python manage.py test songs.tests.test_story_expiry_reactions --settings=music.settings_test
"""
from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from songs import stories
from songs.models import Notification, Story, StoryReaction, StoryView, User

BASE = 'https://media.test'


def mkstory(user, hours_left=10, **extra):
    return Story.objects.create(
        user=user, media_url=f'{BASE}/s/{user.pk}-{hours_left}.mp4', media_file=f'{BASE}/s/{user.pk}-{hours_left}.mp4',
        thumbnail_url=f'{BASE}/p/{user.pk}-{hours_left}.jpg', content_type='video',
        expires_at=timezone.now() + timedelta(hours=hours_left), **extra,
    )


@override_settings(R2_PUBLIC_BASE=BASE)
class ExpiryTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.me = User.objects.create_user('ex_me', 'ex@x.com', 'pw')
        self.friend = User.objects.create_user('ex_friend', 'exf@x.com', 'pw')
        self.client.force_authenticate(self.me)

    def test_expired_stories_go_for_good_with_every_file(self):
        old = mkstory(self.friend, hours_left=-1)
        live = mkstory(self.friend, hours_left=5)
        StoryView.objects.create(story=old, viewer=self.me)
        StoryReaction.objects.create(story=old, user=self.me, emoji='🔥')
        with mock.patch('songs.r2.delete') as delete:
            n, files = stories.purge_expired()
        self.assertEqual((n, files), (1, 2))       # the video and its poster (media_file == media_url)
        deleted = {c.args[0] for c in delete.call_args_list}
        self.assertEqual(deleted, {old.media_url, old.thumbnail_url})
        self.assertFalse(Story.objects.filter(pk=old.pk).exists())
        self.assertFalse(StoryReaction.objects.exists())
        self.assertFalse(StoryView.objects.filter(story_id=old.pk).exists())
        self.assertTrue(Story.objects.filter(pk=live.pk).exists())

    def test_nothing_to_schedule_the_feed_purges_at_most_every_few_minutes(self):
        mkstory(self.friend, hours_left=-2)
        with mock.patch('songs.r2.delete'):
            self.client.get('/api/stories/feed/')
            self.assertEqual(Story.objects.count(), 0)
            mkstory(self.friend, hours_left=-3)
            self.client.get('/api/stories/feed/')     # within the window: not again yet
            self.assertEqual(Story.objects.count(), 1)

    def test_deleting_your_story_deletes_its_files(self):
        mine = mkstory(self.me)
        with mock.patch('songs.r2.delete') as delete:
            res = self.client.delete(f'/api/stories/{mine.pk}/')
        self.assertEqual(res.status_code, 204)
        self.assertEqual({c.args[0] for c in delete.call_args_list}, {mine.media_url, mine.thumbnail_url})
        self.assertFalse(Story.objects.exists())

    def test_the_cleanup_command_uses_the_same_rule(self):
        from django.core.management import call_command
        mkstory(self.friend, hours_left=-1)
        with mock.patch('songs.r2.delete') as delete:
            call_command('cleanup_expired_stories', stdout=mock.MagicMock())
        self.assertEqual(delete.call_count, 2)
        self.assertEqual(Story.objects.count(), 0)


class ReactionTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user('rx_owner', 'rxo@x.com', 'pw')
        self.fan = User.objects.create_user('rx_fan', 'rxf@x.com', 'pw')
        self.story = mkstory(self.owner)
        self.client.force_authenticate(self.fan)

    def test_react_change_and_take_back_owner_told_once(self):
        url = f'/api/stories/{self.story.pk}/react/'
        self.assertEqual(self.client.post(url, {'emoji': '🔥'}, format='json').json(), {'my_reaction': '🔥'})
        self.assertEqual(self.client.post(url, {'emoji': '❤️'}, format='json').json(), {'my_reaction': '❤️'})
        self.assertEqual(StoryReaction.objects.get().emoji, '❤️')
        self.assertEqual(Notification.objects.filter(recipient=self.owner, notification_type='story_reaction').count(), 1)
        self.assertTrue(StoryView.objects.filter(story=self.story, viewer=self.fan).exists())

        self.owner.followers.add(self.fan)     # the fan follows the owner: the story is in their row
        cache.clear()
        groups = self.client.get('/api/stories/feed/').json()
        owner_group = next(g for g in groups if g['user']['id'] == self.owner.pk)
        self.assertEqual(owner_group['stories'][0]['my_reaction'], '❤️')

        self.assertEqual(self.client.delete(url).json(), {'my_reaction': None})
        self.assertFalse(StoryReaction.objects.exists())

    def test_only_the_story_reactions(self):
        res = self.client.post(f'/api/stories/{self.story.pk}/react/', {'emoji': '<b>'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('allowed', res.json())

    def test_the_owner_sees_who_watched_and_reacted_others_cannot(self):
        StoryView.objects.create(story=self.story, viewer=self.fan)
        StoryReaction.objects.create(story=self.story, user=self.fan, emoji='🙏')
        self.assertEqual(self.client.get(f'/api/stories/{self.story.pk}/viewers/').status_code, 403)
        self.client.force_authenticate(self.owner)
        data = self.client.get(f'/api/stories/{self.story.pk}/viewers/').json()
        self.assertEqual(data['count'], 1)
        self.assertEqual(data['results'][0]['user']['username'], 'rx_fan')
        self.assertEqual(data['results'][0]['reaction'], '🙏')

    def test_your_own_viewing_is_not_a_view(self):
        self.client.force_authenticate(self.owner)
        self.client.post(f'/api/stories/{self.story.pk}/view_story/')
        self.assertFalse(StoryView.objects.filter(viewer=self.owner).exists())
        StoryView.objects.create(story=self.story, viewer=self.fan)
        StoryView.objects.create(story=self.story, viewer=self.owner)   # an old self-view stays uncounted
        groups = self.client.get('/api/stories/feed/').json()
        self.assertEqual(groups[0]['stories'][0]['views_count'], 1)

    def test_watching_someone_elses_story_is_recorded(self):
        res = self.client.post(f'/api/stories/{self.story.pk}/view_story/')
        self.assertEqual(res.status_code, 200, res.content[:200])
        self.assertTrue(StoryView.objects.filter(story=self.story, viewer=self.fan).exists())
        # Still the owner's alone to delete.
        self.assertIn(self.client.delete(f'/api/stories/{self.story.pk}/').status_code, (403, 404))

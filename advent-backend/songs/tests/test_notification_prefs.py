"""Every switch in Settings must gate something real.

    python manage.py test songs.tests.test_notification_prefs
"""
from unittest.mock import patch

from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from songs.bible_books import BOOKS_BY_NAME
from songs.devotion import REFERENCES
from songs.models import (
    BibleVerse, DeviceToken, Group, NotificationPreference, User, VerseSend,
)
from songs.push import NOTIFICATION_CATEGORIES

# Preference fields that exist on the model, and are therefore offered in the
# app's Settings screen.
OFFERED = [
    'likes', 'comments', 'follows', 'messages', 'groups', 'communities',
    'live', 'quiz', 'weather', 'verse',
]


class EverySwitchIsWiredTests(APITestCase):
    """A toggle that gates nothing is worse than no toggle."""

    def test_every_offered_switch_exists_on_the_model(self):
        prefs = NotificationPreference()
        for field in OFFERED:
            self.assertTrue(hasattr(prefs, field), field)

    def test_every_offered_switch_is_reachable_from_the_api(self):
        user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(user)
        body = self.client.get('/api/notification-preferences/').data
        for field in OFFERED:
            self.assertIn(field, body, field)

    def test_every_offered_switch_can_be_turned_off_and_back_on(self):
        user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(user)
        for field in OFFERED:
            off = self.client.patch('/api/notification-preferences/', {field: False}, format='json')
            self.assertFalse(off.data[field], field)
            on = self.client.patch('/api/notification-preferences/', {field: True}, format='json')
            self.assertTrue(on.data[field], field)

    def test_each_switch_has_at_least_one_notification_behind_it(self):
        """Except `communities`, which is named explicitly at its call sites."""
        gated = set(NOTIFICATION_CATEGORIES.values()) | {'communities'}
        for field in OFFERED:
            self.assertIn(field, gated, f'{field} gates nothing')


class CommunityVersusGroupTests(APITestCase):
    """Communities and groups are one model; their switches are two."""

    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user('own', 'o@x.com', 'pw12345!')
        self.member = User.objects.create_user('mem', 'm@x.com', 'pw12345!')
        DeviceToken.objects.create(user=self.member, token='ExponentPushToken[mem]', is_active=True)

    def _push(self, kind):
        from songs.views.groups import _push_category
        group = Group.objects.create(name=f'X{kind}', slug=f'x-{kind}', creator=self.owner, kind=kind)
        return _push_category(group)

    def test_a_community_is_gated_by_the_community_switch(self):
        self.assertEqual(self._push(Group.KIND_COMMUNITY), 'communities')

    def test_a_group_is_gated_by_the_group_switch(self):
        self.assertEqual(self._push(Group.KIND_GROUP), 'groups')

    def test_turning_communities_off_stops_a_community_push(self):
        from songs.push import notify_user
        NotificationPreference.objects.create(user=self.member, communities=False, groups=True)
        with patch('songs.tasks.run_in_background') as sent:
            notify_user(self.member, 'group_added', 'hello', category='communities')
        self.assertFalse(sent.called)

    def test_and_leaves_group_pushes_alone(self):
        from songs.push import notify_user
        NotificationPreference.objects.create(user=self.member, communities=False, groups=True)
        with patch('songs.tasks.run_in_background') as sent:
            notify_user(self.member, 'group_added', 'hello', category='groups')
        self.assertTrue(sent.called)


class VerseOfTheDayPushTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        DeviceToken.objects.create(user=self.user, token='ExponentPushToken[mark]', is_active=True)
        for book, chapter, verse in REFERENCES[:30]:
            BibleVerse.objects.get_or_create(
                book=book, book_number=BOOKS_BY_NAME[book]['number'],
                chapter=chapter, verse=verse,
                defaults={'text': f'The words of {book} {chapter}:{verse}.'},
            )

    def _run(self, **kwargs):
        from django.core.management import call_command
        kwargs.setdefault('force', True)
        call_command('send_verse_of_the_day', verbosity=0, **kwargs)

    def test_it_sends_with_the_reference_as_the_heading(self):
        with patch('songs.management.commands.send_verse_of_the_day.notify_user') as push:
            self._run()
        self.assertTrue(push.called)
        self.assertIn(':', push.call_args.kwargs['title'])       # a reference
        self.assertTrue(push.call_args[0][2])                    # a body
        self.assertTrue(VerseSend.objects.filter(user=self.user).exists())

    def test_running_twice_sends_once(self):
        with patch('songs.management.commands.send_verse_of_the_day.notify_user') as push:
            self._run()
            self._run()
        self.assertEqual(push.call_count, 1)

    def test_opting_out_is_honoured(self):
        NotificationPreference.objects.create(user=self.user, verse=False)
        with patch('songs.management.commands.send_verse_of_the_day.notify_user') as push:
            self._run()
        self.assertFalse(push.called)

    def test_a_person_with_no_device_gets_nothing(self):
        DeviceToken.objects.filter(user=self.user).update(is_active=False)
        with patch('songs.management.commands.send_verse_of_the_day.notify_user') as push:
            self._run()
        self.assertFalse(push.called)

    def test_a_dry_run_sends_nothing(self):
        with patch('songs.management.commands.send_verse_of_the_day.notify_user') as push:
            self._run(dry_run=True)
        self.assertFalse(push.called)
        self.assertFalse(VerseSend.objects.exists())

    def test_a_long_verse_is_cut_at_a_word(self):
        from songs.management.commands.send_verse_of_the_day import MAX_BODY
        long_text = 'word ' * 80
        BibleVerse.objects.all().update(text=long_text)
        with patch('songs.management.commands.send_verse_of_the_day.notify_user') as push:
            self._run()
        body = push.call_args[0][2]
        self.assertLessEqual(len(body), MAX_BODY + 1)
        self.assertTrue(body.endswith('…'))

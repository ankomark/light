"""User.total_likes — the lifetime "likes received" stat on the profile.

Covers the four sources that feed it (social posts, tracks, publications and
live broadcasts), the bookkeeping on like/unlike and on cascade deletes,
exposure through the profile endpoints, and the recount repair command.

    python manage.py test songs.tests.test_total_likes --settings=music.settings_test
"""
from django.core.management import call_command
from rest_framework.test import APITestCase

from songs.models import (
    Like, LiveBroadcast, PostLike, Profile, Publication, PublicationLike,
    SocialPost, Track, User,
)


def total(user):
    """Re-read the counter — signals update it with an UPDATE, not on the instance."""
    return User.objects.get(pk=user.pk).total_likes


class TotalLikesCounterTests(APITestCase):
    def setUp(self):
        self.author = User.objects.create_user('tl_author', 'tlauthor@x.com', 'pw12345!')
        Profile.objects.create(user=self.author)
        self.fan = User.objects.create_user('tl_fan', 'tlfan@x.com', 'pw12345!')

    def test_starts_at_zero(self):
        self.assertEqual(total(self.author), 0)

    def test_post_track_publication_and_live_likes_all_count(self):
        post = SocialPost.objects.create(user=self.author, content_type='image')
        track = Track.objects.create(title='Hymn', artist=self.author, audio_file='audio/x')
        pub = Publication.objects.create(title='Essay', author=self.author)

        PostLike.objects.create(post=post, user=self.fan)
        Like.objects.create(track=track, user=self.fan)
        PublicationLike.objects.create(publication=pub, user=self.fan)

        self.assertEqual(total(self.author), 3)

        # Live hearts arrive as a batched counter bump, not a row per like.
        self.client.force_authenticate(self.fan)
        broadcast = LiveBroadcast.objects.create(
            host=self.author, kind='meet', title='Devotion', room_name='r-mix',
        )
        self.client.post(f'/api/live/broadcasts/{broadcast.id}/react/', {'count': 5}, format='json')
        self.assertEqual(total(self.author), 8)

    def test_unlike_decrements(self):
        post = SocialPost.objects.create(user=self.author, content_type='image')
        like = PostLike.objects.create(post=post, user=self.fan)
        self.assertEqual(total(self.author), 1)

        like.delete()
        self.assertEqual(total(self.author), 0)

    def test_never_goes_negative(self):
        post = SocialPost.objects.create(user=self.author, content_type='image')
        like = PostLike.objects.create(post=post, user=self.fan)
        # Simulate a stale/duplicate delete firing after the counter is at zero.
        User.objects.filter(pk=self.author.pk).update(total_likes=0)
        like.delete()
        self.assertEqual(total(self.author), 0)

    def test_deleting_the_content_removes_its_likes_from_the_total(self):
        post = SocialPost.objects.create(user=self.author, content_type='image')
        other = User.objects.create_user('tl_fan2', 'tlfan2@x.com', 'pw12345!')
        PostLike.objects.create(post=post, user=self.fan)
        PostLike.objects.create(post=post, user=other)
        self.assertEqual(total(self.author), 2)

        post.delete()  # cascades to both PostLike rows
        self.assertEqual(total(self.author), 0)

    def test_likes_are_credited_to_the_author_not_the_liker(self):
        post = SocialPost.objects.create(user=self.author, content_type='image')
        PostLike.objects.create(post=post, user=self.fan)

        self.assertEqual(total(self.author), 1)
        self.assertEqual(total(self.fan), 0)

    def test_post_likes_count_still_tracked(self):
        # The per-post counter must keep working exactly as before.
        post = SocialPost.objects.create(user=self.author, content_type='image')
        PostLike.objects.create(post=post, user=self.fan)
        post.refresh_from_db()
        self.assertEqual(post.likes_count, 1)


class TotalLikesApiTests(APITestCase):
    def setUp(self):
        self.author = User.objects.create_user('tl_api', 'tlapi@x.com', 'pw12345!')
        Profile.objects.create(user=self.author)
        self.fan = User.objects.create_user('tl_apifan', 'tlapifan@x.com', 'pw12345!')

        post = SocialPost.objects.create(user=self.author, content_type='image')
        PostLike.objects.create(post=post, user=self.fan)

    def test_own_profile_endpoint_exposes_total_likes(self):
        # Authenticate with a freshly loaded row: signals bump the counter with
        # an UPDATE, so the setUp instance still holds the pre-like value.
        # A real request re-reads the user during authentication.
        self.client.force_authenticate(User.objects.get(pk=self.author.pk))
        data = self.client.get('/api/profiles/me/').json()
        self.assertEqual(data['total_likes'], 1)

    def test_other_users_profile_exposes_total_likes(self):
        self.client.force_authenticate(self.fan)
        data = self.client.get(f'/api/users/{self.author.id}/').json()
        self.assertEqual(data['total_likes'], 1)

    def test_total_likes_is_read_only_over_the_api(self):
        self.client.force_authenticate(self.author)
        self.client.patch('/api/profiles/update_me/', {'total_likes': 9999}, format='json')
        self.assertEqual(total(self.author), 1)

    def test_like_endpoint_updates_the_total(self):
        post = SocialPost.objects.create(user=self.author, content_type='image')
        self.client.force_authenticate(self.fan)

        self.client.post(f'/api/social-posts/{post.id}/like/')
        self.assertEqual(total(self.author), 2)

        self.client.post(f'/api/social-posts/{post.id}/like/')  # toggles off
        self.assertEqual(total(self.author), 1)


class LiveLikeTests(APITestCase):
    """Live ❤️ reactions have no per-like row, so the view credits the host
    directly instead of going through a signal."""

    def setUp(self):
        self.host = User.objects.create_user('tl_host', 'tlhost@x.com', 'pw12345!')
        self.viewer = User.objects.create_user('tl_viewer', 'tlviewer@x.com', 'pw12345!')
        self.broadcast = LiveBroadcast.objects.create(
            host=self.host, kind='meet', title='Evening Prayer', room_name='room-tl',
        )
        self.client.force_authenticate(self.viewer)

    def _react(self, count=None):
        payload = {} if count is None else {'count': count}
        return self.client.post(
            f'/api/live/broadcasts/{self.broadcast.id}/react/', payload, format='json',
        )

    def test_batched_reactions_credit_the_host(self):
        self._react(3)
        self._react(2)
        self.assertEqual(total(self.host), 5)

    def test_credits_the_host_not_the_viewer(self):
        self._react(4)
        self.assertEqual(total(self.host), 4)
        self.assertEqual(total(self.viewer), 0)

    def test_reactions_to_an_ended_broadcast_do_not_count(self):
        self._react(3)
        LiveBroadcast.objects.filter(pk=self.broadcast.pk).update(status='ended')

        self._react(50)
        # The broadcast tally is unchanged, and so is the profile stat.
        self.broadcast.refresh_from_db()
        self.assertEqual(self.broadcast.like_count, 3)
        self.assertEqual(total(self.host), 3)

    def test_deleting_a_broadcast_takes_its_hearts_with_it(self):
        self._react(6)
        self.assertEqual(total(self.host), 6)

        # Deliberately NOT refreshed: `react` moves like_count with an UPDATE,
        # so this instance still reads 0. The handler must hand back the stored
        # tally, not whatever the caller happens to be holding.
        self.assertEqual(self.broadcast.like_count, 0)
        self.broadcast.delete()
        self.assertEqual(total(self.host), 0)

    def test_per_call_clamp_still_applies(self):
        # The endpoint caps one flush at 100; the profile stat must agree.
        self._react(500)
        self.assertEqual(total(self.host), 100)


class RecountCommandTests(APITestCase):
    def test_recount_repairs_a_drifted_counter(self):
        author = User.objects.create_user('tl_drift', 'tldrift@x.com', 'pw12345!')
        fan = User.objects.create_user('tl_driftfan', 'tldriftfan@x.com', 'pw12345!')
        post = SocialPost.objects.create(user=author, content_type='image')
        track = Track.objects.create(title='T', artist=author, audio_file='audio/x')
        PostLike.objects.create(post=post, user=fan)
        Like.objects.create(track=track, user=fan)
        LiveBroadcast.objects.create(
            host=author, kind='meet', title='Vespers', room_name='room-drift', like_count=10,
        )

        # Drift, as a raw-SQL import or a signal-bypassing bulk write would cause.
        User.objects.filter(pk=author.pk).update(total_likes=99)

        call_command('recount_total_likes', verbosity=0)
        self.assertEqual(total(author), 12)

    def test_recount_does_not_multiply_across_sources(self):
        """Several broadcasts alongside post/track likes: the SUM must not be
        inflated by the like joins (the classic mixed-aggregate trap)."""
        author = User.objects.create_user('tl_multi', 'tlmulti@x.com', 'pw12345!')
        fan = User.objects.create_user('tl_multifan', 'tlmultifan@x.com', 'pw12345!')
        other = User.objects.create_user('tl_multi2', 'tlmulti2@x.com', 'pw12345!')

        post = SocialPost.objects.create(user=author, content_type='image')
        PostLike.objects.create(post=post, user=fan)
        PostLike.objects.create(post=post, user=other)
        track = Track.objects.create(title='T', artist=author, audio_file='audio/x')
        Like.objects.create(track=track, user=fan)
        for i in range(3):
            LiveBroadcast.objects.create(
                host=author, kind='meet', title=f'B{i}', room_name=f'room-m{i}', like_count=4,
            )

        User.objects.filter(pk=author.pk).update(total_likes=0)
        call_command('recount_total_likes', verbosity=0)
        self.assertEqual(total(author), 2 + 1 + 12)

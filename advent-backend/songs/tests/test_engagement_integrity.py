"""One person, one like — and one view per viewer per window.

The strict rules for the social feed: pressing like twice can never leave two
likes on the same post, and scrolling the same video past twice is one view.
Both are enforced server-side, because both numbers are public.

Live broadcast ❤️ reactions are the deliberate exception: while a room is live a
viewer may send as many as they like, TikTok-style. The tests at the bottom pin
that difference down so nobody "fixes" it later.

    python manage.py test songs.tests.test_engagement_integrity --settings=music.settings_test
"""
from unittest import mock

from django.core.cache import cache
from rest_framework.test import APITestCase

from songs.models import (
    Like, LiveBroadcast, PostLike, Profile, Publication, PublicationLike,
    SocialPost, Track, User,
)


def views(post):
    return SocialPost.objects.get(pk=post.pk).view_count


def total(user):
    return User.objects.get(pk=user.pk).total_likes


# A concurrent double-tap: two requests both read "not liked" before either
# commits. Forcing the view's existence check to miss reproduces the loser of
# that race deterministically, without threads.
def stale_read_miss():
    return mock.patch('django.db.models.query.QuerySet.exists', return_value=False)


class PostLikeIntegrityTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.author = User.objects.create_user('ei_author', 'eia@x.com', 'pw12345!')
        Profile.objects.create(user=self.author)
        self.fan = User.objects.create_user('ei_fan', 'eif@x.com', 'pw12345!')
        self.post = SocialPost.objects.create(user=self.author, content_type='image')
        self.client.force_authenticate(self.fan)

    def _like(self):
        return self.client.post(f'/api/social-posts/{self.post.id}/like/')

    def _rows(self):
        return PostLike.objects.filter(post=self.post, user=self.fan).count()

    def test_one_row_per_user_however_many_times_they_press(self):
        for _ in range(6):
            self._like()
            self.assertLessEqual(self._rows(), 1)  # never two

    def test_pressing_twice_is_like_then_unlike(self):
        first = self._like()
        self.assertTrue(first.data['is_liked'])
        self.assertEqual(first.data['likes_count'], 1)

        second = self._like()
        self.assertFalse(second.data['is_liked'])
        self.assertEqual(second.data['likes_count'], 0)

    def test_a_racing_double_tap_neither_errors_nor_doubles(self):
        """The loser of the race used to hit the unique constraint and 500."""
        self._like()
        with stale_read_miss():
            res = self._like()
        self.assertEqual(res.status_code, 200)
        self.assertLessEqual(self._rows(), 1)

    def test_the_denormalised_counter_cannot_be_driven_past_one(self):
        self._like()
        with stale_read_miss():
            self._like()
        self.post.refresh_from_db()
        self.assertLessEqual(self.post.likes_count, 1)
        self.assertLessEqual(total(self.author), 1)

    def test_two_different_users_are_two_likes(self):
        self._like()
        other = User.objects.create_user('ei_fan2', 'eif2@x.com', 'pw12345!')
        self.client.force_authenticate(other)
        res = self._like()
        self.assertEqual(res.data['likes_count'], 2)
        self.assertEqual(total(self.author), 2)

    def test_counters_agree_with_the_rows_after_a_burst(self):
        # Like/unlike repeatedly, then assert the stored counters match reality.
        for _ in range(5):
            self._like()
        self.post.refresh_from_db()
        self.assertEqual(self.post.likes_count, PostLike.objects.filter(post=self.post).count())
        self.assertEqual(total(self.author), self.post.likes_count)


class TrackLikeIntegrityTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.artist = User.objects.create_user('ei_artist', 'eiar@x.com', 'pw12345!')
        self.fan = User.objects.create_user('ei_tfan', 'eitf@x.com', 'pw12345!')
        self.track = Track.objects.create(title='Hymn', artist=self.artist, audio_file='audio/x')
        self.client.force_authenticate(self.fan)

    def _rows(self):
        return Like.objects.filter(track=self.track, user=self.fan).count()

    def test_like_endpoint_refuses_a_second_like(self):
        first = self.client.post(f'/api/tracks/{self.track.id}/like/')
        self.assertEqual(first.data['likes_count'], 1)

        second = self.client.post(f'/api/tracks/{self.track.id}/like/')
        self.assertEqual(second.status_code, 400)
        self.assertEqual(self._rows(), 1)

    def test_like_endpoint_survives_a_racing_double_tap(self):
        self.client.post(f'/api/tracks/{self.track.id}/like/')
        with stale_read_miss():
            res = self.client.post(f'/api/tracks/{self.track.id}/like/')
        self.assertEqual(res.status_code, 400)  # not a 500
        self.assertEqual(self._rows(), 1)

    def test_toggle_like_alternates_and_never_stacks(self):
        for expected in (True, False, True, False):
            res = self.client.post(f'/api/tracks/{self.track.id}/toggle-like/')
            self.assertEqual(res.data['is_liked'], expected)
            self.assertLessEqual(self._rows(), 1)

    def test_toggle_like_survives_a_racing_double_tap(self):
        self.client.post(f'/api/tracks/{self.track.id}/toggle-like/')
        # toggle_like reads with .first(); a stale miss there is the same race.
        with mock.patch('django.db.models.query.QuerySet.first', return_value=None):
            res = self.client.post(f'/api/tracks/{self.track.id}/toggle-like/')
        self.assertEqual(res.status_code, 200)
        self.assertLessEqual(self._rows(), 1)
        self.assertLessEqual(total(self.artist), 1)


class PublicationLikeIntegrityTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.author = User.objects.create_user('ei_pauthor', 'eipa@x.com', 'pw12345!')
        self.fan = User.objects.create_user('ei_pfan', 'eipf@x.com', 'pw12345!')
        self.pub = Publication.objects.create(title='Essay', author=self.author, status='published')
        self.client.force_authenticate(self.fan)

    def test_toggles_and_never_stacks(self):
        for expected in (True, False, True):
            res = self.client.post(f'/api/publications/{self.pub.id}/like/')
            self.assertEqual(res.data['is_liked'], expected)
            self.assertLessEqual(
                PublicationLike.objects.filter(publication=self.pub, user=self.fan).count(), 1,
            )

    def test_a_racing_double_tap_does_not_double(self):
        self.client.post(f'/api/publications/{self.pub.id}/like/')
        with stale_read_miss():
            res = self.client.post(f'/api/publications/{self.pub.id}/like/')
        self.assertEqual(res.status_code, 200)
        self.assertLessEqual(
            PublicationLike.objects.filter(publication=self.pub, user=self.fan).count(), 1,
        )


class PostViewIntegrityTests(APITestCase):
    """One viewer moves a post's view_count once per cooldown window."""

    def setUp(self):
        cache.clear()
        self.author = User.objects.create_user('ei_vauthor', 'eiva@x.com', 'pw12345!')
        self.viewer = User.objects.create_user('ei_viewer', 'eivw@x.com', 'pw12345!')
        self.post = SocialPost.objects.create(user=self.author, content_type='video')
        self.client.force_authenticate(self.viewer)

    def _viewed(self):
        return self.client.post(f'/api/social-posts/{self.post.id}/viewed/')

    def _batch(self, ids):
        return self.client.post('/api/social-posts/mark_viewed/', {'post_ids': ids}, format='json')

    def test_watching_twice_is_one_view(self):
        self._viewed()
        self.assertEqual(views(self.post), 1)

        self._viewed()
        self.assertEqual(views(self.post), 1)

    def test_replaying_the_endpoint_in_a_loop_cannot_inflate_the_count(self):
        for _ in range(25):
            self._viewed()
        self.assertEqual(views(self.post), 1)

    def test_a_batch_repeating_the_same_id_counts_once(self):
        res = self._batch([self.post.id] * 10)
        self.assertEqual(res.data['counted'], 1)
        self.assertEqual(views(self.post), 1)

    def test_the_batch_endpoint_shares_the_window_with_the_single_one(self):
        self._viewed()
        self._batch([self.post.id])
        self.assertEqual(views(self.post), 1)

    def test_each_distinct_viewer_counts_once(self):
        self._viewed()
        other = User.objects.create_user('ei_viewer2', 'eivw2@x.com', 'pw12345!')
        self.client.force_authenticate(other)
        self._viewed()
        self.assertEqual(views(self.post), 2)

    def test_authors_cannot_run_up_their_own_view_count(self):
        self.client.force_authenticate(self.author)
        self._viewed()
        self.assertEqual(views(self.post), 0)

    def test_a_removed_post_stops_accruing_views(self):
        SocialPost.objects.filter(pk=self.post.pk).update(is_removed=True)
        self._viewed()
        self.assertEqual(views(self.post), 0)

    def test_a_repeat_view_counts_again_once_the_window_lapses(self):
        self._viewed()
        self.assertEqual(views(self.post), 1)

        cache.clear()  # stands in for the cooldown key expiring
        self._viewed()
        self.assertEqual(views(self.post), 2)

    def test_the_batch_is_capped(self):
        from songs.views.social import VIEW_BATCH_CAP

        posts = [
            SocialPost.objects.create(user=self.author, content_type='image')
            for _ in range(3)
        ]
        res = self._batch([p.id for p in posts] + [999999] * (VIEW_BATCH_CAP + 50))
        # Never more than the real posts in the batch, and no error on overflow.
        self.assertEqual(res.status_code, 200)
        self.assertLessEqual(res.data['counted'], len(posts))


class LiveReactionsAreUncappedTests(APITestCase):
    """The deliberate exception: while a room is live, hearts are unlimited.

    A live ❤️ is a moment, not a verdict on a post — so unlike a feed like it has
    no per-user row and no dedupe. This is intended; the only limits are the
    per-call clamp and the room having to be live.
    """

    def setUp(self):
        cache.clear()
        self.host = User.objects.create_user('ei_host', 'eih@x.com', 'pw12345!')
        self.viewer = User.objects.create_user('ei_lviewer', 'eilv@x.com', 'pw12345!')
        self.broadcast = LiveBroadcast.objects.create(
            host=self.host, kind='meet', title='Praise', room_name='room-ei',
        )
        self.client.force_authenticate(self.viewer)

    def _react(self, count=None):
        payload = {} if count is None else {'count': count}
        return self.client.post(
            f'/api/live/broadcasts/{self.broadcast.id}/react/', payload, format='json',
        )

    def test_one_viewer_may_send_many_hearts(self):
        for _ in range(20):
            self._react(1)
        self.broadcast.refresh_from_db()
        self.assertEqual(self.broadcast.like_count, 20)
        self.assertEqual(total(self.host), 20)

    def test_no_cooldown_applies(self):
        # The same viewer, back to back, with no window in between — every heart
        # lands. This is the opposite of the post-view rule on purpose.
        self._react(5)
        self._react(5)
        self.broadcast.refresh_from_db()
        self.assertEqual(self.broadcast.like_count, 10)

    def test_one_call_is_still_clamped(self):
        self._react(10_000)
        self.broadcast.refresh_from_db()
        self.assertEqual(self.broadcast.like_count, 100)

    def test_hearts_stop_when_the_room_ends(self):
        self._react(4)
        LiveBroadcast.objects.filter(pk=self.broadcast.pk).update(status='ended')
        self._react(50)
        self.broadcast.refresh_from_db()
        self.assertEqual(self.broadcast.like_count, 4)
        self.assertEqual(total(self.host), 4)

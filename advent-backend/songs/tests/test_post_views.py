"""SocialPost.view_count — the play count shown on feed cards and profile grids.

Covers the batched ingest endpoint, the per-viewer cooldown that stops a client
replaying its way to a bigger number, self-view exclusion, and exposure through
the feed / profile-grid serializers.

    python manage.py test songs.tests.test_post_views --settings=music.settings_test
"""
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework import status
from rest_framework.test import APITestCase

from songs.models import Profile, SocialPost, User
from songs.views.social import VIEW_BATCH_CAP


def views_of(post):
    return SocialPost.objects.get(pk=post.pk).view_count


class PostViewCountTests(APITestCase):
    def setUp(self):
        cache.clear()  # the cooldown lives in the cache
        self.author = User.objects.create_user('pv_author', 'pvauthor@x.com', 'pw12345!')
        Profile.objects.create(user=self.author)
        self.viewer = User.objects.create_user('pv_viewer', 'pvviewer@x.com', 'pw12345!')
        self.post = SocialPost.objects.create(user=self.author, content_type='image')
        self.client.force_authenticate(self.viewer)

    def _report(self, ids):
        return self.client.post(
            '/api/social-posts/mark_viewed/', {'post_ids': ids}, format='json',
        )

    def test_starts_at_zero(self):
        self.assertEqual(views_of(self.post), 0)

    def test_batch_counts_each_post_once(self):
        second = SocialPost.objects.create(user=self.author, content_type='video')
        res = self._report([self.post.id, second.id])

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.json()['counted'], 2)
        self.assertEqual(views_of(self.post), 1)
        self.assertEqual(views_of(second), 1)

    def test_repeat_reports_inside_the_cooldown_are_ignored(self):
        self._report([self.post.id])
        self._report([self.post.id])
        self._report([self.post.id])
        self.assertEqual(views_of(self.post), 1)

    def test_duplicate_ids_within_one_batch_count_once(self):
        res = self._report([self.post.id, self.post.id, self.post.id])
        self.assertEqual(res.json()['counted'], 1)
        self.assertEqual(views_of(self.post), 1)

    def test_a_different_viewer_counts_separately(self):
        self._report([self.post.id])
        other = User.objects.create_user('pv_other', 'pvother@x.com', 'pw12345!')
        self.client.force_authenticate(other)
        self._report([self.post.id])
        self.assertEqual(views_of(self.post), 2)

    def test_authors_own_views_do_not_count(self):
        self.client.force_authenticate(self.author)
        res = self._report([self.post.id])
        self.assertEqual(res.json()['counted'], 0)
        self.assertEqual(views_of(self.post), 0)

    def test_unknown_and_malformed_ids_are_skipped(self):
        res = self._report([self.post.id, 999999, 'abc', None])
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.json()['counted'], 1)
        self.assertEqual(views_of(self.post), 1)

    def test_post_ids_must_be_a_list(self):
        res = self.client.post(
            '/api/social-posts/mark_viewed/', {'post_ids': 'nope'}, format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_empty_batch_is_accepted_and_counts_nothing(self):
        res = self._report([])
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.json()['counted'], 0)

    def test_oversized_batch_is_capped(self):
        posts = [
            SocialPost.objects.create(user=self.author, content_type='image')
            for _ in range(5)
        ]
        # Pad past the cap with ids that would otherwise be countable; only the
        # first VIEW_BATCH_CAP entries are read at all.
        padding = list(range(10_000, 10_000 + VIEW_BATCH_CAP))
        res = self._report(padding + [p.id for p in posts])

        self.assertEqual(res.json()['counted'], 0)
        for p in posts:
            self.assertEqual(views_of(p), 0)

    def test_batch_is_one_update_regardless_of_size(self):
        posts = [
            SocialPost.objects.create(user=self.author, content_type='image')
            for _ in range(10)
        ]
        with CaptureQueriesContext(connection) as ctx:
            self._report([p.id for p in posts])
        writes = [q for q in ctx.captured_queries if 'UPDATE' in q['sql'].upper()]
        self.assertEqual(len(writes), 1)

    def test_moderator_takedowns_do_not_accrue_views(self):
        SocialPost.objects.filter(pk=self.post.pk).update(is_removed=True)
        res = self._report([self.post.id])
        self.assertEqual(res.json()['counted'], 0)
        self.assertEqual(views_of(self.post), 0)

    def test_requires_authentication(self):
        self.client.force_authenticate(None)
        res = self._report([self.post.id])
        self.assertIn(res.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))

    def test_single_post_endpoint_shares_the_same_rules(self):
        first = self.client.post(f'/api/social-posts/{self.post.id}/viewed/')
        self.assertEqual(first.json()['counted'], 1)
        # Same viewer again inside the cooldown: no double count.
        self.client.post(f'/api/social-posts/{self.post.id}/viewed/')
        self.assertEqual(views_of(self.post), 1)


class PostViewSerializationTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.author = User.objects.create_user('pvs_author', 'pvsauthor@x.com', 'pw12345!')
        Profile.objects.create(user=self.author)
        self.viewer = User.objects.create_user('pvs_viewer', 'pvsviewer@x.com', 'pw12345!')
        self.post = SocialPost.objects.create(user=self.author, content_type='image')
        SocialPost.objects.filter(pk=self.post.pk).update(view_count=42)
        self.client.force_authenticate(self.viewer)

    def test_feed_exposes_view_count(self):
        rows = self.client.get('/api/social-posts/').json()['results']
        row = next(r for r in rows if r['id'] == self.post.id)
        self.assertEqual(row['view_count'], 42)

    def test_profile_grid_thumbnails_expose_view_count(self):
        data = self.client.get(f'/api/users/{self.author.id}/').json()
        thumb = next(p for p in data['social_posts'] if p['id'] == self.post.id)
        self.assertEqual(thumb['view_count'], 42)

    def test_view_count_is_not_client_writable(self):
        self.client.force_authenticate(self.author)
        self.client.patch(
            f'/api/social-posts/{self.post.id}/', {'view_count': 99999}, format='json',
        )
        self.assertEqual(views_of(self.post), 42)

    def test_insights_reports_the_same_number(self):
        self.client.force_authenticate(self.author)
        data = self.client.get(f'/api/social-posts/{self.post.id}/insights/').json()
        self.assertEqual(data['views'], 42)

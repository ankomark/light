from datetime import timedelta
from unittest.mock import patch

from django.core.cache import cache
from django.core.management import call_command
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase
from django.utils import timezone

from songs.models import Story, StoryView, User

R2_BASE = 'https://pub-test.r2.dev'


@override_settings(R2_PUBLIC_BASE=R2_BASE)
class CleanupExpiredStoriesTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='u', email='u@x.com', password='pw')
        self.viewer = User.objects.create_user(username='v', email='v@x.com', password='pw')

        self.expired = Story.objects.create(
            user=self.user, media_file=f'{R2_BASE}/stories/videos/expired.jpg',
            content_type='image',
            expires_at=timezone.now() - timedelta(hours=1),
        )
        StoryView.objects.create(story=self.expired, viewer=self.viewer)
        self.active = Story.objects.create(
            user=self.user, media_file=f'{R2_BASE}/stories/videos/active.jpg',
            content_type='image',
            expires_at=timezone.now() + timedelta(hours=23),
        )

    @patch('songs.r2.delete')
    def test_deletes_expired_and_keeps_active(self, mock_delete):
        call_command('cleanup_expired_stories')

        self.assertFalse(Story.objects.filter(id=self.expired.id).exists())
        self.assertTrue(Story.objects.filter(id=self.active.id).exists())
        # StoryView of the expired story cascaded away.
        self.assertFalse(StoryView.objects.filter(story_id=self.expired.id).exists())
        # The expired story's R2 asset was deleted; the active one wasn't.
        mock_delete.assert_called_once_with(f'{R2_BASE}/stories/videos/expired.jpg')

    @patch('songs.r2.delete')
    def test_dry_run_changes_nothing(self, mock_delete):
        call_command('cleanup_expired_stories', '--dry-run')

        self.assertTrue(Story.objects.filter(id=self.expired.id).exists())
        mock_delete.assert_not_called()

    @patch('songs.r2.delete')
    def test_legacy_non_r2_refs_are_skipped(self, mock_delete):
        # A stray non-R2 leftover must not be sent to R2 for deletion, but the
        # expired row itself is still removed.
        self.expired.media_file = 'social/legacy_public_id'
        self.expired.save(update_fields=['media_file'])
        call_command('cleanup_expired_stories')
        mock_delete.assert_not_called()
        self.assertFalse(Story.objects.filter(id=self.expired.id).exists())


@override_settings(R2_PUBLIC_BASE=R2_BASE)
class StoryFeedQueryCountTests(APITestCase):
    """The stories bar lives in the home feed's header, so it loads on every
    Home open. It used to cost three queries PER STORY (has_unviewed, is_viewed,
    views_count): `prefetch_related('views')` is defeated by calling `.filter()`
    on the prefetched manager, which re-queries. Those are annotations now, so
    the query count must not grow with the number of stories."""

    def setUp(self):
        cache.clear()
        self.viewer = User.objects.create_user(
            username='viewer', email='viewer@x.com', password='pw')
        self.client.force_authenticate(self.viewer)

    def _make_stories(self, n_authors, per_author, offset=0):
        for a in range(offset, offset + n_authors):
            author = User.objects.create_user(
                username=f'author{a}', email=f'a{a}@x.com', password='pw')
            author.followers.add(self.viewer)   # the viewer follows this author
            for i in range(per_author):
                story = Story.objects.create(
                    user=author, media_file=f'{R2_BASE}/stories/videos/{a}_{i}.jpg',
                    content_type='image',
                    expires_at=timezone.now() + timedelta(hours=20),
                )
                if i == 0:
                    StoryView.objects.create(story=story, viewer=self.viewer)

    def _feed(self):
        with CaptureQueriesContext(connection) as ctx:
            resp = self.client.get('/api/stories/feed/')
        self.assertEqual(resp.status_code, 200)
        return resp, len(ctx.captured_queries)

    def test_query_count_is_flat_as_stories_grow(self):
        self._make_stories(n_authors=2, per_author=2)
        _, small = self._feed()

        self._make_stories(n_authors=6, per_author=3, offset=2)   # 4 -> 22 stories
        resp, large = self._feed()

        total_stories = sum(len(g['stories']) for g in resp.json())
        self.assertEqual(total_stories, 22)
        # Flat: the bar costs the same handful of queries either way. Before the
        # annotations this went from ~14 to ~68.
        self.assertEqual(
            small, large,
            f'story feed N+1: {small} queries for 4 stories, {large} for 22',
        )

    def test_feed_still_reports_viewed_state(self):
        self._make_stories(n_authors=1, per_author=3)
        resp, _ = self._feed()
        group = resp.json()[0]
        # Only the first of the three was viewed, so the ring stays "unviewed".
        self.assertTrue(group['has_unviewed'])
        self.assertEqual(
            sorted(s['is_viewed'] for s in group['stories']),
            [False, False, True],
        )
        self.assertEqual([s['views_count'] for s in group['stories']].count(1), 1)

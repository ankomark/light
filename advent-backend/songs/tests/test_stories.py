from datetime import timedelta
from unittest.mock import patch

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
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

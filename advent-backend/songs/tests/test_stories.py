from datetime import timedelta
from unittest.mock import patch

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from songs.models import Story, StoryView, User


class CleanupExpiredStoriesTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='u', password='pw')
        self.viewer = User.objects.create_user(username='v', password='pw')

        self.expired = Story.objects.create(
            user=self.user, media_file='social/expired_pic', content_type='image',
            expires_at=timezone.now() - timedelta(hours=1),
        )
        StoryView.objects.create(story=self.expired, viewer=self.viewer)
        self.active = Story.objects.create(
            user=self.user, media_file='social/active_pic', content_type='image',
            expires_at=timezone.now() + timedelta(hours=23),
        )

    @patch('songs.management.commands.cleanup_expired_stories.destroy')
    def test_deletes_expired_and_keeps_active(self, mock_destroy):
        call_command('cleanup_expired_stories')

        self.assertFalse(Story.objects.filter(id=self.expired.id).exists())
        self.assertTrue(Story.objects.filter(id=self.active.id).exists())
        # StoryView of the expired story cascaded away.
        self.assertFalse(StoryView.objects.filter(story_id=self.expired.id).exists())
        # The expired story's Cloudinary asset was destroyed; the active one wasn't.
        mock_destroy.assert_called_once_with(
            'social/expired_pic', resource_type='image', invalidate=True
        )

    @patch('songs.management.commands.cleanup_expired_stories.destroy')
    def test_dry_run_changes_nothing(self, mock_destroy):
        call_command('cleanup_expired_stories', '--dry-run')

        self.assertTrue(Story.objects.filter(id=self.expired.id).exists())
        mock_destroy.assert_not_called()

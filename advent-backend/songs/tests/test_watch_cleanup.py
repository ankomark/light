"""Tests for the cleanup_watch_events management command.

    python manage.py test songs.tests.test_watch_cleanup --settings=music.settings_test
"""
from datetime import timedelta

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from songs.models import SocialPost, User, WatchEvent


class CleanupWatchEventsTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('w', 'w@x.com', 'pw')
        self.post = SocialPost.objects.create(user=self.user, content_type='image', caption='p')
        self.old = WatchEvent.objects.create(user=self.user, post=self.post, dwell_ms=4000)
        self.new = WatchEvent.objects.create(user=self.user, post=self.post, dwell_ms=4000)
        # Backdate one event past the retention window (auto_now_add needs an update).
        WatchEvent.objects.filter(id=self.old.id).update(
            created_at=timezone.now() - timedelta(days=120)
        )

    def test_deletes_old_keeps_recent(self):
        call_command('cleanup_watch_events')  # default 90 days
        self.assertFalse(WatchEvent.objects.filter(id=self.old.id).exists())
        self.assertTrue(WatchEvent.objects.filter(id=self.new.id).exists())

    def test_dry_run_changes_nothing(self):
        call_command('cleanup_watch_events', '--dry-run')
        self.assertEqual(WatchEvent.objects.count(), 2)

    def test_custom_days(self):
        # A 200-day window keeps the 120-day-old event.
        call_command('cleanup_watch_events', '--days', '200')
        self.assertTrue(WatchEvent.objects.filter(id=self.old.id).exists())

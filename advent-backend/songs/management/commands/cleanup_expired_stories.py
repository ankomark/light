"""Delete expired stories and their R2 assets.

Stories are filtered out of the feed once `expires_at` passes, but the rows
(and the uploaded media) would otherwise accumulate forever. Run this on a
schedule (e.g. hourly via cron) to reclaim both.

    python manage.py cleanup_expired_stories
    python manage.py cleanup_expired_stories --grace-hours 1 --dry-run
"""
import logging

from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta


logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Delete expired stories and their R2 assets."

    def add_arguments(self, parser):
        parser.add_argument(
            '--grace-hours', type=int, default=0,
            help='Only delete stories that expired more than N hours ago.',
        )
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Report what would be deleted without changing anything.',
        )

    def handle(self, *args, **options):
        # One rule for every path (the endpoints and the worker use it too):
        # the row, its views and reactions, and all its files — poster included.
        from songs import stories
        dry_run = options['dry_run']
        cutoff = timezone.now() - timedelta(hours=options['grace_hours'])
        total_stories = total_files = 0
        while True:
            n, files = stories.purge_expired(now=cutoff, dry_run=dry_run)
            total_stories += n
            total_files += files
            if dry_run or n < stories.PURGE_BATCH:
                break
        if not total_stories:
            self.stdout.write('No expired stories to clean up.')
            return
        verb = 'Would delete' if dry_run else 'Deleted'
        self.stdout.write(self.style.SUCCESS(
            f'{verb} {total_stories} expired stories ({total_files} R2 assets).'
        ))

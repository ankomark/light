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

from songs import r2
from songs.models import Story

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
        dry_run = options['dry_run']
        cutoff = timezone.now() - timedelta(hours=options['grace_hours'])

        expired = list(
            Story.objects.filter(expires_at__lt=cutoff)
            .values('id', 'media_file', 'media_url', 'content_type')
        )
        if not expired:
            self.stdout.write('No expired stories to clean up.')
            return

        assets_removed = 0
        for s in expired:
            ref = s['media_file'] or s['media_url']
            if not ref or not r2.is_r2_url(ref):
                continue
            if dry_run:
                assets_removed += 1
                continue
            r2.delete(ref)  # best-effort, logs its own failures
            assets_removed += 1

        ids = [s['id'] for s in expired]
        if not dry_run:
            Story.objects.filter(id__in=ids).delete()  # cascades to StoryView

        verb = 'Would delete' if dry_run else 'Deleted'
        self.stdout.write(self.style.SUCCESS(
            f'{verb} {len(ids)} expired stories ({assets_removed} R2 assets).'
        ))

"""Delete expired stories and their Cloudinary assets.

Stories are filtered out of the feed once `expires_at` passes, but the rows
(and the uploaded Cloudinary media) would otherwise accumulate forever. Run
this on a schedule (e.g. hourly via cron) to reclaim both.

    python manage.py cleanup_expired_stories
    python manage.py cleanup_expired_stories --grace-hours 1 --dry-run
"""
import logging

from cloudinary.uploader import destroy
from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta

from songs.models import Story

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Delete expired stories and their Cloudinary assets."

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
            .values('id', 'media_file', 'content_type')
        )
        if not expired:
            self.stdout.write('No expired stories to clean up.')
            return

        assets_removed = 0
        for s in expired:
            public_id = s['media_file']
            if not public_id:
                continue
            resource_type = 'video' if s['content_type'] == 'video' else 'image'
            if dry_run:
                assets_removed += 1
                continue
            try:
                destroy(public_id, resource_type=resource_type, invalidate=True)
                assets_removed += 1
            except Exception as e:
                # Don't let one bad asset block the rest of the cleanup.
                logger.warning("Failed to delete Cloudinary asset %s: %s", public_id, e)

        ids = [s['id'] for s in expired]
        if not dry_run:
            Story.objects.filter(id__in=ids).delete()  # cascades to StoryView

        verb = 'Would delete' if dry_run else 'Deleted'
        self.stdout.write(self.style.SUCCESS(
            f'{verb} {len(ids)} expired stories ({assets_removed} Cloudinary assets).'
        ))

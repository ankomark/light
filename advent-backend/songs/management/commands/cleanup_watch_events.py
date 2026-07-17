"""Prune old WatchEvent rows.

WatchEvents are the highest-volume table (one row per meaningful post dwell).
Once they've fed the taste profile they have little value, so age them out on a
schedule to keep the table lean. The taste profile only samples recent events
(FEED_WATCH_SAMPLE_CAP), so pruning old ones doesn't change ranking.

Run on a schedule (e.g. daily) via a Railway cron service or external scheduler:

    python manage.py cleanup_watch_events
    python manage.py cleanup_watch_events --days 30 --dry-run
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from songs.models import WatchEvent

BATCH = 5000  # delete in chunks so a big backlog can't lock the table


class Command(BaseCommand):
    help = "Delete WatchEvent rows older than N days (default 90)."

    def add_arguments(self, parser):
        parser.add_argument(
            '--days', type=int, default=90,
            help='Delete events older than this many days (default 90).',
        )
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Report what would be deleted without changing anything.',
        )

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(days=options['days'])
        stale = WatchEvent.objects.filter(created_at__lt=cutoff)

        if options['dry_run']:
            self.stdout.write(self.style.SUCCESS(
                f'Would delete {stale.count()} watch events older than {options["days"]} days.'
            ))
            return

        deleted = 0
        while True:
            ids = list(stale.values_list('id', flat=True)[:BATCH])
            if not ids:
                break
            deleted += WatchEvent.objects.filter(id__in=ids).delete()[0]

        self.stdout.write(self.style.SUCCESS(
            f'Deleted {deleted} watch events older than {options["days"]} days.'
        ))

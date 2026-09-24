"""Queue the spectrum visualizer's data for songs processed before it existed.

New and re-processed songs get theirs from process_track. This queues a light
`track_spectrum` job (reads the 64 kbps version, no re-encoding) for every
processed song without one; the worker (`run_worker`) does the rest.

    python manage.py backfill_spectrum
    python manage.py backfill_spectrum --limit 50
"""
from django.core.management.base import BaseCommand

from songs.jobs import enqueue
from songs.models import Track


class Command(BaseCommand):
    help = 'Queue spectrum visualizer data for processed songs that have none.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=None)

    def handle(self, *args, limit=None, **options):
        ids = (Track.objects.filter(processing_status=Track.PROCESSING_READY, is_removed=False, spectrum='')
               .exclude(audio_low='').order_by('-views', 'id').values_list('id', flat=True))
        if limit:
            ids = ids[:limit]
        n = 0
        for tid in ids:
            enqueue('track_spectrum', key=f'spectrum:{tid}', track_id=tid)
            n += 1
        self.stdout.write(f'Queued {n} song(s) for the spectrum visualizer.')

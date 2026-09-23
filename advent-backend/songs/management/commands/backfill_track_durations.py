"""Fill in Track.duration_ms for songs uploaded before lengths were stored.

New uploads send their length from the app, and any track's length is learned
from its first play, so this is a one-off for the existing library: it
downloads each file without a length and reads it with mutagen.

    python manage.py backfill_track_durations
    python manage.py backfill_track_durations --limit 50
"""
import io
import logging

import mutagen
from django.core.management.base import BaseCommand

from songs import media
from songs.audio_tags import MAX_AUDIO_BYTES, _fetch
from songs.models import Track

logger = logging.getLogger(__name__)


def read_duration_ms(data):
    """Length of an audio file's bytes in ms, or None when unreadable."""
    try:
        parsed = mutagen.File(io.BytesIO(data))
    except Exception:  # mutagen raises many types on bad input
        return None
    length = getattr(getattr(parsed, 'info', None), 'length', None)
    if not length:
        return None
    ms = int(round(length * 1000))
    return ms if 1000 <= ms <= 4 * 3600 * 1000 else None


class Command(BaseCommand):
    help = 'Read and store the length of tracks that have none.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=None)

    def handle(self, *args, limit=None, **options):
        qs = Track.objects.filter(duration_ms__isnull=True).order_by('-created_at')
        if limit:
            qs = qs[:limit]
        done = failed = 0
        for track in qs.iterator():
            url = media.resolve(track.audio_file)
            ms = None
            if url:
                try:
                    data, _ = _fetch(url, MAX_AUDIO_BYTES)
                    ms = read_duration_ms(data)
                except Exception as exc:
                    logger.warning('duration backfill: track %s: %s', track.pk, exc)
            if ms:
                Track.objects.filter(pk=track.pk, duration_ms__isnull=True).update(duration_ms=ms)
                done += 1
            else:
                failed += 1
        self.stdout.write(f'Stored {done} lengths; {failed} unreadable.')

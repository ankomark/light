"""Stories last 24 hours, then are gone for good — the row, its views and
reactions, and every file it uploaded (the photo or video, and a video's
poster).

Nothing has to be scheduled for that to happen: `maybe_purge_expired()` is
called from the story endpoints (at most once every few minutes for the whole
app), and the background worker sweeps as well. The
`cleanup_expired_stories` command does the same by hand.
"""
import logging

from django.core.cache import cache
from django.utils import timezone

from . import r2
from .models import Story

logger = logging.getLogger(__name__)

PURGE_EVERY_SECONDS = 10 * 60
PURGE_BATCH = 200

# Quick reactions on a story (one per viewer, changeable).
REACTIONS = ('❤️', '😂', '😮', '😢', '🙏', '👏', '🔥', '🙌')


def story_files(row):
    """Every stored file of a story (a values() row or a Story)."""
    get = row.get if isinstance(row, dict) else (lambda k: getattr(row, k, None))
    refs = {get('media_file'), get('media_url'), get('thumbnail_url')}
    return [ref for ref in refs if ref and r2.is_r2_url(ref)]


def delete_files(rows):
    """Best-effort removal of the stories' files from storage. Returns how many."""
    n = 0
    for row in rows:
        for ref in story_files(row):
            r2.delete(ref)   # never raises; logs its own failures
            n += 1
    return n


def purge_expired(now=None, batch=PURGE_BATCH, dry_run=False):
    """Delete expired stories (and their files) for good. Returns (stories, files)."""
    now = now or timezone.now()
    rows = list(Story.objects.filter(expires_at__lte=now)
                .values('id', 'media_file', 'media_url', 'thumbnail_url')[:batch])
    if not rows:
        return 0, 0
    if dry_run:
        return len(rows), sum(len(story_files(r)) for r in rows)
    files = delete_files(rows)
    Story.objects.filter(id__in=[r['id'] for r in rows]).delete()   # views and reactions cascade
    return len(rows), files


def maybe_purge_expired():
    """Purge, at most once per PURGE_EVERY_SECONDS across the app. Never raises."""
    try:
        if not cache.add('stories:purge', 1, PURGE_EVERY_SECONDS):
            return
        purge_expired()
    except Exception:
        logger.exception('[stories] purge failed')

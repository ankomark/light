"""Song rights: takedowns, telling the uploader, and their dispute.

  upload     — every new song needs the uploader's confirmation that they own
               it or have permission to share it (TrackSerializer), plus
               optional credits: licence, composer, producer, owner, ISRC.
  takedown   — a moderator removes a song (from a report, or directly). The
               song records why ('copyright' | 'policy') and the uploader is
               told — in the app, by push and by email — with how to dispute.
  dispute    — the uploader asks for a review (Appeal kind='copyright', a
               counter-notice): what they own and why, confirmed in good
               faith. Moderators see it in the Appeals queue; upheld, the
               song comes back and the uploader is told; rejected, told too.

This is the mechanism, not legal advice: what a valid claim or counter-notice
needs, and how repeat infringers are handled, depends on where the service
operates — get proper legal advice before hosting music publicly at scale.
"""
import re

from django.db import transaction
from django.utils import timezone

from .models import Appeal, Notification, Track

ISRC = re.compile(r'^[A-Z]{2}[A-Z0-9]{3}\d{7}$')
MIN_DISPUTE_CHARS = 30
MIN_COPYRIGHT_REPORT_CHARS = 20


def clean_isrc(value):
    """'ke-a1b-26-00001' → 'KEA1B2600001', or ValueError."""
    code = re.sub(r'[\s-]', '', str(value or '')).upper()
    if code and not ISRC.match(code):
        raise ValueError('An ISRC is 12 characters, like KE-A1B-26-00001.')
    return code


def _tell(user, subject, message, track, kind, actor=None):
    """In-app notification (opens Artist Studio) + push + email."""
    Notification.objects.create(recipient=user, sender=actor or user, message=message,
                                notification_type=kind, track=track)
    from .views.admin import notify_moderation   # push + email, best-effort
    notify_moderation(user, subject, message)


def track_removed(track_ids, reason='policy', note='', actor=None):
    """Record why songs were taken down, and tell each uploader once."""
    reason = 'copyright' if reason == 'copyright' else 'policy'
    now = timezone.now()
    for track in Track.objects.filter(id__in=track_ids).select_related('artist'):
        Track.objects.filter(pk=track.pk).update(removed_reason=reason, removed_at=now,
                                                 removal_note=(note or '')[:500])
        why = ('after a copyright claim' if reason == 'copyright'
               else "because it doesn't follow our community guidelines")
        msg = (f'Your song "{track.title}" was removed {why}.'
               + (f' Note: {note}' if note else '')
               + ' If you own it or have permission to share it, you can dispute this in Artist Studio.')
        _tell(track.artist, 'A song of yours was removed', msg, track, 'takedown', actor)


def track_restored(track_ids, actor=None, notify=True):
    """Clear a takedown; tell the uploader their song is back."""
    for track in Track.objects.filter(id__in=track_ids).select_related('artist'):
        Track.objects.filter(pk=track.pk).update(removed_reason='', removed_at=None, removal_note='')
        if notify:
            _tell(track.artist, 'Your song is back',
                  f'Your song "{track.title}" has been restored.', track, 'restored', actor)


def current_dispute(track):
    """The dispute of the song's latest takedown, or None. One per takedown:
    a song restored and removed again can be disputed again."""
    qs = Appeal.objects.filter(kind=Appeal.KIND_COPYRIGHT, track=track)
    if track.removed_at:
        qs = qs.filter(created_at__gte=track.removed_at)
    return qs.order_by('-created_at').first()


def open_dispute(user, track, message, good_faith):
    """The uploader disputes their song's takedown. Returns (appeal, error)."""
    if track.artist_id != user.id:
        return None, 'You can only dispute your own songs.'
    if not track.is_removed:
        return None, "This song hasn't been removed."
    if not good_faith:
        return None, 'Please confirm the statement to send a dispute.'
    message = (message or '').strip()
    if len(message) < MIN_DISPUTE_CHARS:
        return None, f'Tell us why (at least {MIN_DISPUTE_CHARS} characters).'
    with transaction.atomic():
        existing = current_dispute(track)
        if existing and existing.status == 'pending':
            return None, 'This song already has a dispute waiting for review.'
        if existing:
            return None, 'This takedown was already reviewed.'
        return Appeal.objects.create(user=user, kind=Appeal.KIND_COPYRIGHT, track=track,
                                     message=message[:4000]), None


def removed_songs(user):
    """The uploader's removed songs, with why and where their dispute stands."""
    from . import media
    tracks = list(Track.objects.filter(artist=user, is_removed=True).order_by('-removed_at', '-created_at'))
    out = []
    for t in tracks:
        a = current_dispute(t)
        out.append({
            'id': t.id, 'title': t.title,
            'cover': media.resolve(t.cover_small or t.cover_image) if (t.cover_small or t.cover_image) else None,
            'reason': t.removed_reason or 'policy',
            'removed_at': t.removed_at,
            'note': t.removal_note,
            'dispute': {'status': a.status, 'notes': a.review_notes, 'created_at': a.created_at} if a else None,
            'can_dispute': a is None,
        })
    return out

"""Artists: what their profile shows, their Studio numbers, and the
"your song reached 1,000 plays" moments.

Everything is counted from listens (PlayEvent). A "stream" is a counted
listen (30s+, not the artist's own — see PlayEvent / TrackViewSet.plays), a
"listener" a distinct person who streamed.
"""
from datetime import timedelta

from django.db.models import Avg, Count, Q
from django.db.models.functions import TruncDate
from django.utils import timezone

from . import media
from .models import Like, Notification, PlayEvent, Track
from .push import notify_user

MILESTONES = (100, 1_000, 10_000, 100_000, 1_000_000)
STUDIO_PERIODS = (7, 28, 90)


def monthly_listeners(artist):
    """People who streamed any of the artist's songs in the last 28 days."""
    since = timezone.now() - timedelta(days=28)
    return (PlayEvent.objects.filter(track__artist=artist, counted=True, started_at__gte=since)
            .values('user_id').distinct().count())


def notify_milestones(track_id, milestones):
    """Tell the artist their song reached each of `milestones` plays (in the
    app and by push). The plays endpoint works out which were crossed."""
    row = Track.objects.filter(pk=track_id).values('artist_id', 'title').first()
    if not row:
        return
    artist = None
    for m in milestones:
        msg = f'"{row["title"]}" reached {m:,} plays'
        Notification.objects.create(recipient_id=row['artist_id'], sender_id=row['artist_id'], message=msg,
                                    notification_type='milestone', track_id=track_id)
        artist = artist or Track.objects.select_related('artist').get(pk=track_id).artist
        notify_user(artist, 'milestone', msg)


def check_play_milestone(track_id):
    """Whether the song's play count sits exactly on a milestone now (and if
    so, tell its artist). Kept for callers counting one play at a time."""
    row = Track.objects.filter(pk=track_id).values('views').first()
    if not row or row['views'] not in MILESTONES:
        return False
    notify_milestones(track_id, [row['views']])
    return True


def _change(now_value, before):
    """Percent change on the previous period; None when there was nothing before."""
    if not before:
        return None
    return round((now_value - before) * 100.0 / before, 1)


STUDIO_TTL = 300


def studio(artist, days=28, now=None):
    """The Studio overview for the last `days` days — cached 5 minutes per
    artist and period (18 queries over the listening history; artists open
    it often and it needn't be to the second)."""
    days = days if days in STUDIO_PERIODS else 28
    if now is None:
        from django.core.cache import cache
        key = f'studio:{artist.pk}:{days}'
        data = cache.get(key)
        if data is None:
            data = _studio(artist, days, timezone.now())
            cache.set(key, data, STUDIO_TTL)
        return data
    return _studio(artist, days, now)


def _studio(artist, days, now):
    now = now or timezone.now()
    since = now - timedelta(days=days)
    before = since - timedelta(days=days)

    others = PlayEvent.objects.filter(track__artist=artist).exclude(user=artist)
    period = others.filter(started_at__gte=since)
    prev = others.filter(started_at__gte=before, started_at__lt=since)
    streams_q = period.filter(counted=True)

    streams = streams_q.count()
    listeners = streams_q.values('user_id').distinct().count()
    starts = period.count()
    completed = period.filter(completed=True).count()
    skipped = period.filter(skipped=True).count()
    avg_ms = period.aggregate(a=Avg('ms_played'))['a'] or 0
    likes = Like.objects.filter(track__artist=artist, created_at__gte=since).exclude(user=artist).count()

    prev_streams = prev.filter(counted=True).count()
    prev_listeners = prev.filter(counted=True).values('user_id').distinct().count()
    prev_likes = Like.objects.filter(track__artist=artist, created_at__gte=before,
                                     created_at__lt=since).exclude(user=artist).count()

    by_day = {row['day']: row['n'] for row in
              streams_q.annotate(day=TruncDate('started_at')).values('day').annotate(n=Count('id'))}
    first_day = since.date()
    daily = []
    for i in range(1, days + 1):
        day = first_day + timedelta(days=i)
        daily.append({'date': day.isoformat(), 'streams': by_day.get(day, 0)})

    top = list(
        period.values('track_id').annotate(
            streams=Count('id', filter=Q(counted=True)),
            listeners=Count('user_id', filter=Q(counted=True), distinct=True),
            starts=Count('id'),
            completed=Count('id', filter=Q(completed=True)),
        ).filter(streams__gt=0).order_by('-streams', 'track_id')[:10]
    )
    titles = dict(Track.objects.filter(id__in=[r['track_id'] for r in top]).values_list('id', 'title'))
    covers = {t.id: media.resolve(t.cover_small or t.cover_image)
              for t in Track.objects.filter(id__in=titles).only('id', 'cover_small', 'cover_image')}
    top_tracks = [{
        'id': r['track_id'], 'title': titles.get(r['track_id'], ''), 'cover': covers.get(r['track_id']),
        'streams': r['streams'], 'listeners': r['listeners'],
        'completion': round(r['completed'] * 100.0 / r['starts'], 1) if r['starts'] else 0,
    } for r in top]

    def shares(field):
        rows = list(streams_q.exclude(**{field: ''}).values(field).annotate(n=Count('id')).order_by('-n')[:8])
        return [{'key': r[field], 'streams': r['n'],
                 'share': round(r['n'] * 100.0 / streams, 1) if streams else 0} for r in rows]

    return {
        'days': days,
        'totals': {
            'streams': streams,
            'listeners': listeners,
            'likes': likes,
            'followers': artist.followers.count(),
            'completion': round(completed * 100.0 / starts, 1) if starts else 0,
            'skip_rate': round(skipped * 100.0 / starts, 1) if starts else 0,
            'avg_listen_ms': int(avg_ms),
        },
        'change': {
            'streams': _change(streams, prev_streams),
            'listeners': _change(listeners, prev_listeners),
            'likes': _change(likes, prev_likes),
        },
        'daily': daily,
        'top_tracks': top_tracks,
        'countries': shares('country'),
        'sources': shares('source'),
        'lifetime_streams': sum(Track.objects.filter(artist=artist, is_removed=False).values_list('views', flat=True)),
    }

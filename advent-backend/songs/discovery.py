"""Music discovery: "For you" and "More like this".

Both are built from likes, the one strong signal the app records for music:

  - fans also like: people who liked what you liked (or liked this track)
    also liked these — collaborative filtering by co-like counts;
  - from the artist: more by artists you've liked (or this track's artist);
  - popular: most liked in the last month, so a brand-new listener (or a
    brand-new track) still gets a full list.

Everything returns ordered track ids plus a reason per id; the view turns
them into rows with the usual list serializer. Removed tracks and the
viewer's own uploads are never suggested.
"""
from datetime import timedelta

from django.core.cache import cache
from django.db.models import Count
from django.utils import timezone

from .models import Like, Track

MAX_RESULTS = 30
SEED_LIKES = 200        # the viewer's most recent likes used as the taste seed
NEIGHBOURS = 300        # most-overlapping listeners considered
POPULAR_WINDOW_DAYS = 30
FOR_YOU_TTL = 600


def _popular_ids(exclude, limit):
    since = timezone.now() - timedelta(days=POPULAR_WINDOW_DAYS)
    recent = list(
        Like.objects.filter(created_at__gte=since, track__is_removed=False)
        .exclude(track_id__in=exclude)
        .values('track_id').annotate(n=Count('id')).order_by('-n', '-track_id')
        .values_list('track_id', flat=True)[:limit]
    )
    if len(recent) < limit:
        # A quiet month: top up with the most-played tracks overall.
        more = (Track.objects.filter(is_removed=False).exclude(id__in=set(exclude) | set(recent))
                .order_by('-views', '-created_at').values_list('id', flat=True)[:limit - len(recent)])
        recent.extend(more)
    return recent


def _co_liked(seed_ids, exclude_user_id, exclude, limit):
    """Tracks most liked by the listeners who liked `seed_ids`."""
    if not seed_ids:
        return []
    neighbours = list(
        Like.objects.filter(track_id__in=seed_ids).exclude(user_id=exclude_user_id)
        .values('user_id').annotate(n=Count('id')).order_by('-n')
        .values_list('user_id', flat=True)[:NEIGHBOURS]
    )
    if not neighbours:
        return []
    return list(
        Like.objects.filter(user_id__in=neighbours, track__is_removed=False)
        .exclude(track_id__in=exclude)
        .values('track_id').annotate(n=Count('id')).order_by('-n', '-track_id')
        .values_list('track_id', flat=True)[:limit]
    )


def _by_artists(artist_ids, exclude, limit):
    if not artist_ids:
        return []
    return list(
        Track.objects.filter(artist_id__in=artist_ids, is_removed=False)
        .exclude(id__in=exclude).order_by('-created_at')
        .values_list('id', flat=True)[:limit]
    )


def _merge(*sources):
    """Round-robin the sources (each a (reason, ids) pair) without repeats, so
    the list opens with a mix instead of thirty of one kind."""
    out, reasons, seen = [], {}, set()
    iters = [(reason, iter(ids)) for reason, ids in sources]
    while iters and len(out) < MAX_RESULTS:
        nxt = []
        for reason, it in iters:
            for tid in it:
                if tid not in seen:
                    seen.add(tid)
                    out.append(tid)
                    reasons[tid] = reason
                    nxt.append((reason, it))
                    break
        iters = nxt
    return out[:MAX_RESULTS], reasons


def for_you(user):
    key = f'music:foryou:{user.pk}'
    cached = cache.get(key)
    if cached is not None:
        return cached
    liked = list(Like.objects.filter(user=user).order_by('-created_at')
                 .values_list('track_id', flat=True)[:SEED_LIKES])
    own = set(Track.objects.filter(artist=user).values_list('id', flat=True))
    exclude = set(liked) | own
    artists = set(Track.objects.filter(id__in=liked).exclude(artist=user)
                  .values_list('artist_id', flat=True))
    result = _merge(
        ('fans_also_like', _co_liked(liked, user.pk, exclude, MAX_RESULTS)),
        ('from_artist', _by_artists(artists, exclude, MAX_RESULTS)),
        ('popular', _popular_ids(exclude, MAX_RESULTS)),
    )
    cache.set(key, result, FOR_YOU_TTL)
    return result


def similar(track, user):
    own = set(Track.objects.filter(artist=user).values_list('id', flat=True)) if user.is_authenticated else set()
    exclude = {track.id} | own
    return _merge(
        ('fans_also_like', _co_liked([track.id], None, exclude, MAX_RESULTS)),
        ('from_artist', _by_artists([track.artist_id], exclude, MAX_RESULTS)),
        ('popular', _popular_ids(exclude, MAX_RESULTS)),
    )


def forget_for_you(user_id):
    """A new like changes the taste seed — the next open recomputes."""
    cache.delete(f'music:foryou:{user_id}')

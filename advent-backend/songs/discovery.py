"""Music discovery: "For you" and "More like this".

Built from what people like AND what they actually listen to (PlayEvent):

  - taste: the songs you liked, plus the ones you listened to properly (30s
    or more, or to the end) in the last two months;
  - fans also like: people who liked or listened to what you did also liked
    or listened to these — collaborative filtering by overlap;
  - from the artist: more by artists in your taste (or this track's artist);
  - popular: trending by plays this week, then the most liked, so a new
    listener (or a new song) still gets a full list.

Songs you skipped (and never went back to) aren't suggested, nor are artists
you keep skipping. Everything returns ordered track ids plus a reason per id;
the view turns them into rows with the usual list serializer. Removed tracks
and the viewer's own uploads are never suggested.
"""
from datetime import timedelta

from collections import Counter

from django.core.cache import cache
from django.db.models import Count, Q
from django.utils import timezone

from .models import Like, PlayEvent, Track

MAX_RESULTS = 30
SEED_LIKES = 200        # the viewer's most recent likes used as the taste seed
NEIGHBOURS = 300        # most-overlapping listeners considered
POPULAR_WINDOW_DAYS = 30
FOR_YOU_TTL = 600
LISTEN_WINDOW_DAYS = 60  # listening history that counts as taste
SKIPPED_ARTIST_AFTER = 3  # skips of an artist's songs, never listened to, before they're left out


def _popular_ids(exclude, limit):
    # Trending by plays first (songs people actually listen to), then likes.
    from . import charts
    trending = [tid for tid, _ in charts.read('trending') if tid not in exclude][:limit]
    if len(trending) >= limit:
        return trending
    return trending + [t for t in _liked_popular_ids(set(exclude) | set(trending), limit - len(trending))]


def _liked_popular_ids(exclude, limit):
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


def _listened():
    """Listens that show liking: 30s+ (counted) or played to the end."""
    since = timezone.now() - timedelta(days=LISTEN_WINDOW_DAYS)
    return PlayEvent.objects.filter(started_at__gte=since).filter(Q(counted=True) | Q(completed=True))


def _co_liked(seed_ids, exclude_user_id, exclude, limit):
    """Tracks most liked or listened to by the people who liked or listened
    to `seed_ids`. A like and a listen weigh the same."""
    if not seed_ids:
        return []
    overlap = Counter()
    for qs in (Like.objects.filter(track_id__in=seed_ids),
               _listened().filter(track_id__in=seed_ids).values('user_id', 'track_id').distinct()):
        for row in qs.exclude(user_id=exclude_user_id).values('user_id').annotate(n=Count('id')):
            overlap[row['user_id']] += row['n']
    neighbours = [u for u, _ in overlap.most_common(NEIGHBOURS)]
    if not neighbours:
        return []
    score = Counter()
    liked = (Like.objects.filter(user_id__in=neighbours, track__is_removed=False).exclude(track_id__in=exclude)
             .values('track_id').annotate(n=Count('user_id', distinct=True)))
    heard = (_listened().filter(user_id__in=neighbours, track__is_removed=False).exclude(track_id__in=exclude)
             .values('track_id').annotate(n=Count('user_id', distinct=True)))
    for qs in (liked, heard):
        for row in qs:
            score[row['track_id']] += row['n']
    return [tid for tid, _ in sorted(score.items(), key=lambda kv: (-kv[1], -kv[0]))[:limit]]


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
    mine = _listened().filter(user=user)
    heard = list(mine.values('track_id').annotate(n=Count('id')).order_by('-n')
                 .values_list('track_id', flat=True)[:SEED_LIKES])
    taste = liked + [t for t in heard if t not in set(liked)]
    own = set(Track.objects.filter(artist=user).values_list('id', flat=True))
    # Skipped and never listened to since: not for them.
    since = timezone.now() - timedelta(days=LISTEN_WINDOW_DAYS)
    skips = PlayEvent.objects.filter(user=user, skipped=True, started_at__gte=since)
    skipped = set(skips.values_list('track_id', flat=True)) - set(taste)
    skipped_artists = set(
        skips.exclude(track__artist_id__in=Track.objects.filter(id__in=taste).values('artist_id'))
        .values('track__artist_id').annotate(n=Count('id')).filter(n__gte=SKIPPED_ARTIST_AFTER)
        .values_list('track__artist_id', flat=True))
    exclude = set(liked) | own | skipped | set(
        Track.objects.filter(artist_id__in=skipped_artists).values_list('id', flat=True))
    artists = set(Track.objects.filter(id__in=taste).exclude(artist=user)
                  .values_list('artist_id', flat=True)) - skipped_artists
    result = _merge(
        ('fans_also_like', _co_liked(taste, user.pk, exclude, MAX_RESULTS)),
        ('from_artist', _by_artists(artists, exclude, MAX_RESULTS)),
        ('popular', _popular_ids(exclude, MAX_RESULTS)),
    )
    cache.set(key, result, FOR_YOU_TTL)
    return result


SIMILAR_TTL = 600


def similar(track, user):
    """Cached 10 minutes per song and viewer: it's a dozen queries, and the
    same song page / Now Playing asks again and again."""
    key = f'music:similar:{track.id}:{getattr(user, "pk", 0)}'
    cached = cache.get(key)
    if cached is not None:
        return cached
    result = _similar(track, user)
    cache.set(key, result, SIMILAR_TTL)
    return result


def _similar(track, user):
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

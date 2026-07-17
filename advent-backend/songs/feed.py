"""Ranked "For You" feed — a cheap, GPU-free heuristic ranker.

Design (see also SocialPostViewSet.list): a 3-pool blend —
  1. Following   — recent posts from people you follow
  2. Trending    — hot app-wide, computed once and shared by all users (cached)
  3. Discovery   — posts from followers-of-followers (socially-close fresh faces)
— scored with a time-decayed engagement score, interleaved by a fixed ratio
with author diversity, then snapshotted per user so pagination stays stable and
each scroll is almost free (one build per refresh, cache reads after).

Cost profile on Railway: trending is a handful of queries per refresh window for
the WHOLE app; a user's blend is a few small queries once per refresh, then
cache. No ML, no GPU — just arithmetic over already-denormalised counters.

All knobs are overridable via settings.
"""
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from .models import SocialPost, User, blocked_ids_for


def _cfg(name, default):
    return getattr(settings, name, default)


# ── Tunables ──────────────────────────────────────────────────────────────────
FEED_WINDOW_DAYS = _cfg('FEED_WINDOW_DAYS', 14)          # following/discovery candidates
TRENDING_WINDOW_DAYS = _cfg('FEED_TRENDING_WINDOW_DAYS', 7)
CANDIDATE_CAP = _cfg('FEED_CANDIDATE_CAP', 500)          # max rows scored per pool
SNAPSHOT_SIZE = _cfg('FEED_SNAPSHOT_SIZE', 300)          # ranked ids cached per user
TRENDING_SIZE = _cfg('FEED_TRENDING_SIZE', 200)
DISCOVERY_AUTHOR_CAP = _cfg('FEED_DISCOVERY_AUTHOR_CAP', 200)
GRAVITY = _cfg('FEED_GRAVITY', 1.5)                      # recency decay strength
PAGE_SIZE = _cfg('FEED_PAGE_SIZE', 20)
# Interleave weights (following : trending : discovery) ≈ 60/25/15.
BLEND_WEIGHTS = _cfg('FEED_BLEND_WEIGHTS', (6, 2, 1))
# Min gap between two posts from the same author. 1 = never back-to-back, which
# is the guarantee that always degrades gracefully (higher values can't be
# honored when one author dominates a short feed, causing worse clumping).
DIVERSITY_WINDOW = _cfg('FEED_DIVERSITY_WINDOW', 1)

TRENDING_TTL = _cfg('FEED_TRENDING_TTL', 20 * 60)
DISCOVERY_TTL = _cfg('FEED_DISCOVERY_TTL', 24 * 60 * 60)
SNAPSHOT_TTL = _cfg('FEED_SNAPSHOT_TTL', 15 * 60)


def _score(row, now):
    """Time-decayed engagement score for a candidate row (a .values() dict)."""
    age_h = max(0.0, (now - row['created_at']).total_seconds() / 3600.0)
    freshness = 1.0 / ((age_h + 2) ** GRAVITY)
    engagement = (
        2 * (row.get('comments_count') or 0)
        + (row.get('likes_count') or 0)
        + 0.1 * (row.get('view_count') or 0)
    )
    return (engagement + 1) * freshness


# ── Trending (global, cached, lazily refreshed) ───────────────────────────────
def compute_trending():
    """Rank recent posts app-wide and cache [{'id', 'a'(author)}]. Called lazily
    when the cache is cold, or by the `refresh_trending` command from a cron."""
    now = timezone.now()
    rows = list(
        SocialPost.objects
        .filter(is_removed=False, created_at__gte=now - timedelta(days=TRENDING_WINDOW_DAYS))
        .exclude(user__is_deactivated=True)
        .values('id', 'user_id', 'likes_count', 'comments_count', 'view_count', 'created_at')
        [:CANDIDATE_CAP * 2]
    )
    rows.sort(key=lambda r: _score(r, now), reverse=True)
    trending = [{'id': r['id'], 'a': r['user_id']} for r in rows[:TRENDING_SIZE]]
    cache.set('feed:trending', trending, TRENDING_TTL)
    return trending


def get_trending():
    return cache.get('feed:trending') or compute_trending()


# ── Discovery authors (followers-of-followers, cached per user) ────────────────
def get_discovery_authors(user, followee_ids):
    """Authors followed by the people `user` follows (2nd-degree network),
    excluding self and already-followed. Capped + cached — it changes slowly."""
    key = f'feed:disc:{user.id}'
    cached = cache.get(key)
    if cached is not None:
        return cached
    if not followee_ids:
        cache.set(key, [], DISCOVERY_TTL)
        return []
    ids = list(
        User.objects
        .filter(followers__id__in=followee_ids)   # people followed by my followees
        .exclude(pk=user.id)
        .exclude(pk__in=followee_ids)
        .values_list('id', flat=True)
        .distinct()[:DISCOVERY_AUTHOR_CAP]
    )
    cache.set(key, ids, DISCOVERY_TTL)
    return ids


# ── Blend assembly ────────────────────────────────────────────────────────────
def _weighted_interleave(pools, weights):
    """Round-robin merge of ordered `pools` by integer `weights`, dropping
    duplicates. Order only — diversity is applied afterwards."""
    idx = [0] * len(pools)
    out, seen = [], set()
    progressed = True
    while progressed:
        progressed = False
        for pi, pool in enumerate(pools):
            for _ in range(weights[pi]):
                if idx[pi] >= len(pool):
                    break
                pid = pool[idx[pi]]
                idx[pi] += 1
                progressed = True
                if pid not in seen:
                    seen.add(pid)
                    out.append(pid)
    return out


def _diversify(ordered, authors, window, cap):
    """Reorder so the same author is spaced `window` slots apart whenever the
    distribution allows (heap + cooldown, the classic "reorganize" algorithm).

    Each step emits a post from the author with the most remaining posts that is
    not on cooldown; the just-used author sits out `window` turns before it can
    be picked again. When only one author's posts remain, spacing relaxes (there
    is no alternative) — but separators are never wasted the way a naive greedy
    front-load would waste them."""
    import heapq
    from collections import OrderedDict, deque

    groups = OrderedDict()
    for pid in ordered:
        groups.setdefault(authors.get(pid), deque()).append(pid)

    rank = {a: i for i, a in enumerate(groups)}          # stable tie-break
    heap = [(-len(q), rank[a], a) for a, q in groups.items()]
    heapq.heapify(heap)

    out, cooldown = [], deque()
    while (heap or cooldown) and len(out) < cap:
        if not heap:
            # Everyone left is cooling down — release the oldest that still has
            # posts (relax the spacing); drop exhausted authors as they age out.
            while cooldown and cooldown[0][0] == 0:
                cooldown.popleft()
            if not cooldown:
                break
            heapq.heappush(heap, cooldown.popleft())
        neg, r, a = heapq.heappop(heap)
        out.append(groups[a].popleft())
        neg += 1                                          # one fewer remaining
        cooldown.append((neg, r, a))
        if len(cooldown) > window:
            item = cooldown.popleft()
            if item[0] < 0:                               # still has posts left
                heapq.heappush(heap, item)
    return out


def build_ranked_feed(user):
    """Assemble the user's ranked post-id snapshot. Empty list means "no ranked
    candidates" — the caller should fall back to the chronological feed."""
    now = timezone.now()
    blocked = blocked_ids_for(user)
    followee_ids = set(user.followed_by.values_list('id', flat=True))
    discovery_ids = set(get_discovery_authors(user, list(followee_ids)))

    authors = {}   # post_id -> author_id, for diversity + dedup

    def _pool(author_ids):
        if not author_ids:
            return []
        qs = (
            SocialPost.objects
            .filter(is_removed=False,
                    created_at__gte=now - timedelta(days=FEED_WINDOW_DAYS),
                    user_id__in=author_ids)
            .exclude(user_id=user.id)
            .exclude(user__is_deactivated=True)
        )
        if blocked:
            qs = qs.exclude(user_id__in=blocked)
        rows = list(qs.values('id', 'user_id', 'likes_count', 'comments_count',
                              'view_count', 'created_at')[:CANDIDATE_CAP])
        rows.sort(key=lambda r: _score(r, now), reverse=True)
        for r in rows:
            authors[r['id']] = r['user_id']
        return [r['id'] for r in rows]

    following_pool = _pool(followee_ids)
    discovery_pool = _pool(discovery_ids)

    trending_pool = []
    for t in get_trending():
        if t['a'] == user.id or t['a'] in blocked:
            continue
        authors.setdefault(t['id'], t['a'])
        trending_pool.append(t['id'])

    merged = _weighted_interleave(
        [following_pool, trending_pool, discovery_pool], BLEND_WEIGHTS,
    )
    return _diversify(merged, authors, DIVERSITY_WINDOW, SNAPSHOT_SIZE)


def get_snapshot(user, *, fresh=False):
    key = f'feed:rank:{user.id}'
    if not fresh:
        cached = cache.get(key)
        if cached is not None:
            return cached
    snapshot = build_ranked_feed(user)
    cache.set(key, snapshot, SNAPSHOT_TTL)
    return snapshot

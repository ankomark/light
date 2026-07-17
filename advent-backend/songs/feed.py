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

from .models import NotInterested, PostLike, SocialPost, User, blocked_ids_for


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

# Phase 2 — "seen" demotion + taste profile.
SEEN_CAP = _cfg('FEED_SEEN_CAP', 500)                    # recent served ids remembered
SEEN_TTL = _cfg('FEED_SEEN_TTL', 3 * 24 * 60 * 60)
TASTE_TTL = _cfg('FEED_TASTE_TTL', 12 * 60 * 60)
TASTE_LIKES_CAP = _cfg('FEED_TASTE_LIKES_CAP', 200)      # recent likes sampled
TASTE_MAX_AUTHORS = _cfg('FEED_TASTE_MAX_AUTHORS', 15)
TASTE_MAX_TAGS = _cfg('FEED_TASTE_MAX_TAGS', 15)
TASTE_AUTHOR_BONUS = _cfg('FEED_TASTE_AUTHOR_BONUS', 4.0)
TASTE_TAG_BONUS = _cfg('FEED_TASTE_TAG_BONUS', 3.0)
# Negative signal ("not interested"): how hard to demote matching author/tag.
NEG_AUTHOR_PENALTY = _cfg('FEED_NEG_AUTHOR_PENALTY', 6.0)
NEG_TAG_PENALTY = _cfg('FEED_NEG_TAG_PENALTY', 4.0)
NEG_TTL = _cfg('FEED_NEG_TTL', 12 * 60 * 60)
NEG_SAMPLE_CAP = _cfg('FEED_NEG_SAMPLE_CAP', 200)


def _score(row, now, taste=None, neg=None):
    """Time-decayed engagement score for a candidate row (a .values() dict):
    engagement × recency, plus an affinity bonus for taste-matching content and
    a penalty for content matching the viewer's "not interested" signals."""
    age_h = max(0.0, (now - row['created_at']).total_seconds() / 3600.0)
    freshness = 1.0 / ((age_h + 2) ** GRAVITY)
    engagement = (
        2 * (row.get('comments_count') or 0)
        + (row.get('likes_count') or 0)
        + 0.1 * (row.get('view_count') or 0)
    )
    post_tags = (row.get('tags') or '').lower().split()
    modifier = 0.0
    if taste:
        if row.get('user_id') in taste['authors']:
            modifier += TASTE_AUTHOR_BONUS
        if post_tags and taste['tags'].intersection(post_tags):
            modifier += TASTE_TAG_BONUS
    if neg:
        if row.get('user_id') in neg['authors']:
            modifier -= NEG_AUTHOR_PENALTY
        if post_tags and neg['tags'].intersection(post_tags):
            modifier -= NEG_TAG_PENALTY
    # Keep the base positive so recency still orders near-zero-signal posts.
    return max(0.05, engagement + modifier + 1) * freshness


# ── "Seen" set (cache-only, best-effort — no per-impression DB write) ──────────
def get_seen(user_id):
    return cache.get(f'feed:seen:{user_id}') or []


def mark_seen(user_id, ids):
    """Record served post ids so later refreshes demote them. Most-recent-first,
    capped — pure cache, so it costs nothing on the database."""
    ids = [i for i in ids if i is not None]
    if not ids:
        return
    key = f'feed:seen:{user_id}'
    prev = cache.get(key) or []
    fresh_set = set(ids)
    merged = ids + [i for i in prev if i not in fresh_set]
    cache.set(key, merged[:SEEN_CAP], SEEN_TTL)


# ── Taste profile (authors/tags the viewer engages with; cached per user) ──────
def taste_profile(user):
    key = f'feed:taste:{user.id}'
    cached = cache.get(key)
    if cached is not None:
        return cached
    rows = (
        PostLike.objects.filter(user=user)
        .order_by('-id')
        .values_list('post__user_id', 'post__tags')[:TASTE_LIKES_CAP]
    )
    author_counts, tag_counts = {}, {}
    for author_id, tags in rows:
        if author_id is not None:
            author_counts[author_id] = author_counts.get(author_id, 0) + 1
        for t in (tags or '').lower().split():
            tag_counts[t] = tag_counts.get(t, 0) + 1
    profile = {
        'authors': set(sorted(author_counts, key=author_counts.get, reverse=True)[:TASTE_MAX_AUTHORS]),
        'tags': set(sorted(tag_counts, key=tag_counts.get, reverse=True)[:TASTE_MAX_TAGS]),
    }
    cache.set(key, profile, TASTE_TTL)
    return profile


# ── "Not interested" — hidden posts + negative taste (cached per user) ─────────
def not_interested_ids(user_id):
    key = f'feed:ni:{user_id}'
    cached = cache.get(key)
    if cached is not None:
        return cached
    ids = set(
        NotInterested.objects.filter(user_id=user_id).values_list('post_id', flat=True)
    )
    cache.set(key, ids, NEG_TTL)
    return ids


def negative_taste(user):
    """Authors/tags the viewer has marked "not interested", to demote similar
    content. Cached; invalidated when a new not-interested is recorded."""
    key = f'feed:neg:{user.id}'
    cached = cache.get(key)
    if cached is not None:
        return cached
    rows = (
        NotInterested.objects.filter(user=user)
        .order_by('-id')
        .values_list('post__user_id', 'post__tags')[:NEG_SAMPLE_CAP]
    )
    authors, tags = set(), set()
    for author_id, post_tags in rows:
        if author_id is not None:
            authors.add(author_id)
        tags.update((post_tags or '').lower().split())
    profile = {'authors': authors, 'tags': tags}
    cache.set(key, profile, NEG_TTL)
    return profile


def invalidate_user(user_id):
    """Drop this user's ranking caches after a signal that should change their
    feed immediately (e.g. a new "not interested")."""
    cache.delete_many([
        f'feed:rank:{user_id}', f'feed:reason:{user_id}',
        f'feed:ni:{user_id}', f'feed:neg:{user_id}',
    ])


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
    seen = set(get_seen(user.id))       # demote (not exclude) already-served posts
    taste = taste_profile(user)         # boost authors/tags the viewer engages with
    neg = negative_taste(user)          # demote "not interested" authors/tags
    hidden = not_interested_ids(user.id)  # hide "not interested" posts outright

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
        if hidden:
            qs = qs.exclude(id__in=hidden)
        rows = list(qs.values('id', 'user_id', 'likes_count', 'comments_count',
                              'view_count', 'created_at', 'tags')[:CANDIDATE_CAP])
        rows.sort(key=lambda r: _score(r, now, taste, neg), reverse=True)
        for r in rows:
            authors[r['id']] = r['user_id']
        return [r['id'] for r in rows]

    following_pool = _pool(followee_ids)
    discovery_pool = _pool(discovery_ids)

    trending_pool = []
    for t in get_trending():
        if t['a'] == user.id or t['a'] in blocked or t['id'] in hidden:
            continue
        authors.setdefault(t['id'], t['a'])
        trending_pool.append(t['id'])

    # Why a post is shown (drives the client's "reason chip"). A post can be in
    # several pools; label it by the most personal one it qualifies for.
    reasons = {}
    for pid in following_pool:
        reasons.setdefault(pid, 'following')
    for pid in discovery_pool:
        reasons.setdefault(pid, 'discovery')
    for pid in trending_pool:
        reasons.setdefault(pid, 'trending')
    cache.set(f'feed:reason:{user.id}', reasons, SNAPSHOT_TTL)

    merged = _weighted_interleave(
        [following_pool, trending_pool, discovery_pool], BLEND_WEIGHTS,
    )
    # Global seen-demotion: all unseen (diversified) first, then seen as a tail
    # (also diversified) — so nothing repeats until the unseen run out, and the
    # demotion holds ACROSS pools, not just within one.
    unseen = [i for i in merged if i not in seen]
    seen_tail = [i for i in merged if i in seen]
    ranked = (
        _diversify(unseen, authors, DIVERSITY_WINDOW, SNAPSHOT_SIZE)
        + _diversify(seen_tail, authors, DIVERSITY_WINDOW, SNAPSHOT_SIZE)
    )
    return ranked[:SNAPSHOT_SIZE]


def get_reasons(user_id):
    """Map of post_id -> reason for the user's current snapshot (cached beside
    it by build_ranked_feed). Empty when there's no ranked snapshot."""
    return cache.get(f'feed:reason:{user_id}') or {}


def get_snapshot(user, *, fresh=False):
    key = f'feed:rank:{user.id}'
    if not fresh:
        cached = cache.get(key)
        if cached is not None:
            return cached
    snapshot = build_ranked_feed(user)
    cache.set(key, snapshot, SNAPSHOT_TTL)
    return snapshot

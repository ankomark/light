from .common import *  # noqa: F401,F403
import base64
import os
from django.http import HttpResponse, Http404, HttpResponseNotFound
from django.db.models import Exists, OuterRef, Q, Subquery, IntegerField, FloatField, F, Case, When, Value, Sum
from django.db.models.functions import Coalesce
from ..models import (
    ChapterRevision, BookHighlight, BookReview, ChapterComment, ReadingActivity, PublicationCollaborator,
    PublicationExport,
)
from .. import writer_studio, author_studio, book_ai
from ..models import BookClub
from ..publishing import collaborating
from ..serializers.publications import ChaptersChangedElsewhere
from django.db.models import Avg, Max
from .. import book_community
from ..publishing import (
    visible_chapters_q, reader_chapters, record_reading, revision_list, diff_paragraphs,
    visible_publications, book_percent, reading_stats, apply_highlight_ops,
)
from datetime import datetime
from django.db import IntegrityError, transaction
import re
from ..post_links import sync_post_links
from ..comments import create_post_comment, set_reaction, reaction_summaries
from django.conf import settings
from django.core.cache import cache

# Branded fallback image for share cards (a post with no still of its own).
# Bundled in the repo and served by share_brand_image, so shared links get a
# non-blank preview with zero extra hosting/config.
_BRAND_OG_PATH = os.path.join(os.path.dirname(__file__), '..', 'assets', 'share-og.png')
_brand_og_bytes = None


def share_brand_image(request):
    """Serve the bundled branded OG image (used as the share-card fallback)."""
    global _brand_og_bytes
    if _brand_og_bytes is None:
        try:
            with open(_BRAND_OG_PATH, 'rb') as f:
                _brand_og_bytes = f.read()
        except OSError:
            return HttpResponseNotFound('not found')
    resp = HttpResponse(_brand_og_bytes, content_type='image/png')
    resp['Cache-Control'] = 'public, max-age=86400'
    return resp


# ── Post view counting ───────────────────────────────────────────────────────
# How many post ids one batched report may carry.
VIEW_BATCH_CAP = 200
# A given viewer only moves a post's counter once per this window. Scrolling a
# post past twice in a session is one view, and a client replaying the endpoint
# in a loop can't inflate a number that's shown publicly. Repeat views still
# count once the window lapses, as they do on other feeds.
#
# The dedupe is only as wide as the cache is shared: with REDIS_URL set every
# worker consults the same keys, but on the LocMemCache fallback the window is
# per-process, so a repeat view landing on another worker counts again. Keep
# REDIS_URL configured in production.
VIEW_COOLDOWN_SECONDS = 30 * 60


def _count_views(user, post_ids):
    """Increment view_count for `post_ids` on behalf of `user`.

    Returns how many posts were actually counted. A viewer's own posts are
    skipped so authors can't run up their own numbers by rewatching, moderator
    takedowns are skipped because a post hidden from every public surface should
    not keep accruing views, and the per-viewer cooldown above filters replays.
    Whatever survives all three is applied as a single bulk UPDATE.
    """
    clean = set()
    for pid in post_ids:
        try:
            clean.add(int(pid))
        except (TypeError, ValueError):
            continue
    if not clean:
        return 0

    # cache.add is atomic and only succeeds when the key is absent, so two
    # concurrent reports of the same view can't both get through.
    fresh = {
        pid for pid in clean
        if cache.add(f'postview:{user.id}:{pid}', 1, VIEW_COOLDOWN_SECONDS)
    }
    if not fresh:
        return 0

    updated = (
        SocialPost.objects.filter(id__in=fresh, is_removed=False)
        .exclude(user=user)
        .update(view_count=F('view_count') + 1)
    )
    return updated


def feed_post_queryset(user):
    """SocialPost queryset with all per-post data the serializer needs resolved
    in the main query (author + profile + song via select_related; follower
    count, liked/saved/following via annotations). Reused by the feed, Explore
    trending, and search so none of them N+1 over the serializer's fields."""
    author_followers = (
        User.objects.filter(pk=OuterRef('user_id'))
        .annotate(n=Count('followers')).values('n')[:1]
    )
    qs = (
        SocialPost.objects
        .filter(is_removed=False)  # hide moderator takedowns from all public surfaces
        # Each post's own "who can see this" (everyone / followers / only me).
        .filter(visible_posts_q(user))
        .select_related('user__profile', 'song', 'song__artist', 'song__artist__profile',
                        'publication', 'publication__author', 'publication__organization', 'book_chapter')
        .annotate(author_followers_count=Subquery(author_followers, output_field=IntegerField()))
    )
    if getattr(user, 'is_authenticated', False):
        qs = qs.annotate(
            liked_by_me=Exists(PostLike.objects.filter(post=OuterRef('pk'), user=user)),
            saved_by_me=Exists(PostSave.objects.filter(post=OuterRef('pk'), user=user)),
            author_is_following=Exists(User.objects.filter(pk=OuterRef('user_id'), followers=user)),
        )
    return qs


def _feed_version(user_id):
    """Per-user cache version; bumping it invalidates that user's feed cache
    keys without needing wildcard deletes (works on Redis and LocMem)."""
    return cache.get(f'feedver:{user_id}', 1)


def _bump_feed_version(user_id):
    try:
        cache.incr(f'feedver:{user_id}')
    except ValueError:
        cache.set(f'feedver:{user_id}', 2, None)


class SocialPostViewSet(viewsets.ModelViewSet):
    # Actions that fetch a post in order to act on it and never serialize it
    # back. These skip the feed's presentation annotations (see get_queryset);
    # everything that returns a rendered post must NOT be listed here, or its
    # serializer would fall back to a per-field query.
    LEAN_ACTIONS = {'like', 'save_post', 'viewed', 'comment', 'not_interested'}

    pagination_class = StandardPagination
    queryset = SocialPost.objects.all()
    serializer_class = SocialPostSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly, IsNotSuspended]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_queryset(self):
        """Feed query with all per-post data resolved in a single round trip.

        - The post's user is prefetched WITH its profile and a followers_count
          annotation (avatar + follower count, no per-row query).
        - likes/comments counts and the current user's liked/saved state are
          annotated (no N+1).
        - ?feed=following limits to people the user follows (+ their own posts).
        - ?search= matches caption / username / location / tags.
        """
        user = self.request.user
        # Shared annotated queryset (no N+1 in the serializer); likes_count /
        # comments_count are denormalised columns, so no DISTINCT COUNT joins.
        #
        # ...except for the actions that only ACT on a post and never serialize
        # it. A like used to load the row through the full feed query: a join
        # across author + profile + song + song artist + that artist's profile,
        # a correlated subquery for the author's follower count, and three
        # EXISTS for liked/saved/following — every bit of it thrown away, since
        # the response is `{likes_count, is_liked}`. They get a plain row.
        #
        # The FILTERS below are not skipped, deliberately. They are not
        # presentation: they are what stops someone liking a post belonging to
        # an account that blocked them, or to a private account they cannot
        # see. Dropping them here would turn an invisible post into an
        # actionable one, so only the annotations go.
        if self.action in self.LEAN_ACTIONS:
            qs = SocialPost.objects.filter(is_removed=False).filter(visible_posts_q(user))
        else:
            qs = feed_post_queryset(user).order_by('-created_at')

        # Hide posts from anyone the user has blocked (or who blocked them),
        # plus private accounts they haven't been approved to follow.
        hidden_ids = blocked_ids_for(user) | hidden_private_author_ids(user)
        if hidden_ids:
            qs = qs.exclude(user_id__in=hidden_ids)

        # Hide posts from self-deactivated accounts.
        qs = qs.exclude(user__is_deactivated=True)

        # Hide posts the user marked "not interested" (both feeds honor it).
        if user.is_authenticated:
            from .. import feed as feedrank
            ni = feedrank.not_interested_ids(user.id)
            if ni:
                qs = qs.exclude(id__in=ni)

        tag = (self.request.query_params.get('tag') or '').strip().lstrip('#').lower()
        if tag:
            # Exact hashtag first. The substring match on the legacy `tags`
            # string used to make #love also return #loveliness; it stays
            # only for posts that predate hashtag rows.
            # Both branches are EXISTS, never a join: joining hashtags would
            # repeat a post once per tag it carries.
            links = SocialPost.hashtags.through.objects
            tagged = links.filter(socialpost_id=OuterRef('pk'), hashtag__name=tag)
            untagged = ~Exists(links.filter(socialpost_id=OuterRef('pk')))
            legacy = Q(tags__iregex=rf'(^|\s)#?{re.escape(tag)}(\s|$)')
            qs = qs.filter(Q(Exists(tagged)) | (Q(untagged) & legacy))

        # Media-type filter powers the dedicated Videos page (?content_type=video).
        ctype = self.request.query_params.get('content_type')
        if ctype in ('video', 'image'):
            qs = qs.filter(content_type=ctype)

        # Personalised home feed: posts from people you follow (+ your own).
        # Falls back to the global feed when you follow no one yet, so new
        # users never see an empty timeline.
        if self.request.query_params.get('feed') == 'following' and user.is_authenticated:
            followed_ids = list(user.followed_by.values_list('id', flat=True))
            if followed_ids:
                qs = qs.filter(Q(user_id__in=followed_ids) | Q(user=user))

        search = self.request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(
                Q(caption__icontains=search)
                | Q(user__username__icontains=search)
                | Q(location__icontains=search)
                | Q(tags__icontains=search)
            )

        return qs
    # Add this to ensure request context is available in serializers
    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context
    

    def create(self, request, *args, **kwargs):
        # The background uploader retries a failed upload — and resumes one the
        # OS killed — with the same client_id. If the first attempt reached the
        # server, hand back that post instead of creating it twice.
        client_id = (request.data.get('client_id') or '').strip()[:64] or None
        if client_id and request.user.is_authenticated:
            existing = SocialPost.objects.filter(user=request.user, client_id=client_id).first()
            if existing:
                return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)
        try:
            return super().create(request, *args, **kwargs)
        except IntegrityError:
            # Two retries raced past the check above; the unique constraint
            # let exactly one through — return it.
            existing = SocialPost.objects.filter(user=request.user, client_id=client_id).first()
            if client_id and existing:
                return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)
            raise

    def perform_create(self, serializer):
        try:
            # Create the post with the authenticated user
            logger.info(f"Creating post with data: {serializer.validated_data}")
            with transaction.atomic():
                post = serializer.save(user=self.request.user)
            sync_post_links(post)
            if post.media_file:
                logger.info(f"Created post ID {post.id} with media_file: {post.media_file}")
                logger.info(f"Media type: {post.content_type}, Size: {post.width}x{post.height}")
            # Invalidate the author's cached feed so their new post shows at once.
            _bump_feed_version(self.request.user.id)
            return post

        except ValidationError as ve:
            logger.warning(f"Validation error: {ve}")
            raise
        except IntegrityError:
            # A duplicate client_id — create() turns it into the existing post.
            raise
        except Exception as e:
            logger.exception("Post creation failed with exception:")
            logger.error(f"Post creation failed: {str(e)}", exc_info=True)
            # Log the serializer data that caused the error
            logger.error(f"Error data: {serializer.validated_data}")
            
            # Also log the request data
            logger.error(f"Request data: {self.request.data}")
            raise ValidationError({
                "non_field_errors": [f"Failed to create post: {str(e)}"]
            })
    
    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def viewed(self, request, pk=None):
        """Count one view of this post. Fire-and-forget; prefer the batched
        `mark_viewed` below when reporting a scroll session."""
        counted = _count_views(request.user, [pk])
        return Response({'status': 'ok', 'counted': counted})

    @action(detail=False, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def mark_viewed(self, request):
        """Ingest a batch of viewed post ids: {"post_ids": [1, 2, 3]}.

        Batched the same way dwell events are, so a fast scroll costs one
        request rather than one per post.
        """
        ids = request.data.get('post_ids') or []
        if not isinstance(ids, list):
            return Response({'error': 'post_ids must be a list'}, status=status.HTTP_400_BAD_REQUEST)
        counted = _count_views(request.user, ids[:VIEW_BATCH_CAP])
        return Response({'counted': counted}, status=status.HTTP_200_OK)

    @action(detail=True, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def insights(self, request, pk=None):
        post = self.get_object()
        if post.user != request.user:
            return Response({'error': 'Insights only available for your own posts'}, status=status.HTTP_403_FORBIDDEN)
        return Response({
            'likes': post.likes.count(),
            'comments': post.comments.count(),
            'saves': post.saves.count(),
            'views': post.view_count,
        })

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        
        if instance.user != request.user:
            return Response(
                {"error": "You can only edit your own posts."},
                status=status.HTTP_403_FORBIDDEN
            )
        
        # Only allow updating certain fields for existing posts
        allowed_fields = ['caption', 'tags', 'location', 'visibility', 'comments_enabled']
        filtered_data = {k: v for k, v in request.data.items() if k in allowed_fields}

        serializer = self.get_serializer(instance, data=filtered_data, partial=True)
        serializer.is_valid(raise_exception=True)
        post = serializer.save()
        if 'caption' in filtered_data or 'visibility' in filtered_data:
            sync_post_links(post)
        _bump_feed_version(request.user.id)

        return Response(serializer.data)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        
        if instance.user != request.user:
            return Response(
                {"error": "You can only delete your own posts."},
                status=status.HTTP_403_FORBIDDEN
            )
        
        # Best-effort R2 asset cleanup (never blocks the DB delete). Gallery
        # items too — each carries its own uploaded object.
        if instance.media_file:
            r2.delete(str(instance.media_file))
        if instance.thumbnail:
            r2.delete(str(instance.thumbnail))
        gallery = instance.gallery if isinstance(instance.gallery, list) else []
        for it in gallery:
            if isinstance(it, dict):
                r2.delete(str(it.get('url') or it.get('public_id') or ''))
        
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    # Keep all your existing methods but add this optimization:
    def list(self, request, *args, **kwargs):
        user = request.user
        params = request.query_params
        search = (params.get('search') or '').strip()
        feed = params.get('feed', '')
        tag = params.get('tag', '')
        ctype = params.get('content_type', '')
        first_page = not params.get('cursor')
        bypass = params.get('fresh') in ('1', 'true', 'True')
        ttl = getattr(settings, 'FEED_CACHE_SECONDS', 0)

        # Ranked "For You" feed (opt-in via ?rank=1). Only for the plain home
        # feed — search / tag / content-type filters keep the chronological path.
        if (params.get('rank') in ('1', 'true', 'True') and user.is_authenticated
                and not search and not tag and not ctype and feed != 'following'):
            ranked = self._ranked_list(request)
            if ranked is not None:
                return ranked
            # else: no ranked candidates yet — fall through to chronological.

        # Short-lived per-user cache of the feed's first page — the part hit on
        # every cold app/screen open. Searches and deeper (cursor) pages aren't
        # cached, and pull-to-refresh sends ?fresh=1 to bypass the read so it's
        # always live. (Per-user like/save state can be up to TTL seconds stale
        # on a non-refresh reload; the client updates those optimistically.)
        cache_key = None
        if ttl and user.is_authenticated and first_page and not search:
            cache_key = f'feed:v1:{user.id}:{_feed_version(user.id)}:{feed}:{tag}:{ctype}'
            if not bypass:
                cached = cache.get(cache_key)
                if cached is not None:
                    return Response(cached)

        paginator = FeedCursorPagination()
        qs = self.get_queryset()
        page = paginator.paginate_queryset(qs, request, view=self)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            resp = paginator.get_paginated_response(serializer.data)
            if cache_key is not None:
                cache.set(cache_key, resp.data, ttl)
            return resp

        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)

    def _ranked_list(self, request):
        """Serve a page of the ranked snapshot (stable page-number pagination
        over a cached id list). Returns None when there are no ranked candidates
        so list() can fall back to the chronological feed."""
        from django.db.models import Case, When
        from .. import feed as feedrank

        user = request.user
        fresh = request.query_params.get('fresh') in ('1', 'true', 'True')
        try:
            page = max(1, int(request.query_params.get('page', 1)))
        except (TypeError, ValueError):
            page = 1

        snapshot = feedrank.get_snapshot(user, fresh=(fresh and page == 1))
        if not snapshot:
            return None

        size = feedrank.PAGE_SIZE
        start = (page - 1) * size
        page_ids = snapshot[start:start + size]
        if not page_ids and page > 1:
            page_ids = []  # past the end — empty page with no `next`

        order = Case(*[When(id=pid, then=pos) for pos, pid in enumerate(page_ids)])
        posts = list(
            feed_post_queryset(user).filter(id__in=page_ids).order_by(order)
        ) if page_ids else []
        data = self.get_serializer(posts, many=True).data

        # Attach the "why you're seeing this" reason for the client's chip.
        reasons = feedrank.get_reasons(user.id)
        for row in data:
            reason = reasons.get(row.get('id'))
            if reason:
                row['feed_reason'] = reason

        # Remember what we served so later refreshes demote it (cache-only).
        feedrank.mark_seen(user.id, page_ids)

        has_next = start + size < len(snapshot)
        base = request.build_absolute_uri(request.path)

        def _page_url(p):
            q = request.query_params.copy()
            q['page'] = p
            q.pop('fresh', None)  # only the first request refreshes the snapshot
            return f"{base}?{q.urlencode()}"

        return Response({
            'count': len(snapshot),
            'next': _page_url(page + 1) if has_next else None,
            'previous': _page_url(page - 1) if page > 1 else None,
            'results': data,
        })

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def like(self, request, pk=None):
        post = self.get_object()
        user = request.user

        # One like per (post, user), enforced by the unique_together on PostLike.
        # get_or_create rather than exists()-then-create: a double-tap sends two
        # requests that can both read "not liked" before either commits, and the
        # loser of that race used to hit the constraint and 500. get_or_create
        # absorbs it and reports the row that won, so the second tap reads as the
        # toggle-off it looks like to the user.
        like, created = PostLike.objects.get_or_create(post=post, user=user)

        if not created:
            # Unlike the post
            like.delete()
            liked = False
        else:
            liked = True

            # Create notification only when liking (not unliking)
            if user != post.user:  # Don't notify self
                msg = f"{user.username} liked your post"
                Notification.objects.create(
                    recipient=post.user,
                    sender=user,
                    message=msg,
                    notification_type='like',
                    post=post
                )
                notify_user(post.user, 'like', msg)
        
        # Read back the denormalised counter rather than COUNT()ing the likes
        # table. The signal on PostLike has already applied the delta, so this
        # is a single-row primary-key read instead of an aggregate that gets
        # slower the more popular the post is — exactly backwards from what you
        # want on the posts people actually like.
        post.refresh_from_db(fields=['likes_count'])
        likes_count = post.likes_count

        return Response({
            'status': 'success',
            'likes_count': likes_count,
            'is_liked': liked
        }, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated])
    def comment(self, request, pk=None):
        post = self.get_object()
        if not post.comments_enabled:
            return Response({'error': 'Comments are turned off for this post.'},
                            status=status.HTTP_403_FORBIDDEN)
        serializer = PostCommentSerializer(data=request.data, context={'request': request})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        parent = resolve_comment_parent(post, request.data.get('parent'))
        comment = create_post_comment(request.user, post, serializer.validated_data['content'], parent)
        return Response(PostCommentSerializer(comment, context={'request': request}).data,
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def save_post(self, request, pk=None):
        post = self.get_object()
        user = request.user
        
        save_obj, created = PostSave.objects.get_or_create(user=user, post=post)
        
        if created:
            return Response(
                {"status": "Post saved", "is_saved": True},
                status=status.HTTP_201_CREATED
            )
        else:
            # Toggle save - remove if already saved
            save_obj.delete()
            return Response(
                {"status": "Post unsaved", "is_saved": False},
                status=status.HTTP_200_OK
            )

    @action(detail=False, methods=['get'], permission_classes=[permissions.IsAuthenticatedOrReadOnly])
    def latest(self, request):
        """Cheapest possible "is there anything newer?" check for the poll: the
        newest visible post id, no serialization. Honors the same visibility
        filters as the feed so the client's "new posts" pill isn't a false alarm."""
        from .. import feed as feedrank
        user = request.user
        qs = (SocialPost.objects.filter(is_removed=False).filter(visible_posts_q(user))
              .exclude(user__is_deactivated=True))
        # Private accounts are hidden from anonymous viewers too, so this runs
        # outside the is_authenticated branch.
        private_hidden = hidden_private_author_ids(user)
        if private_hidden:
            qs = qs.exclude(user_id__in=private_hidden)
        if user.is_authenticated:
            blocked = blocked_ids_for(user)
            if blocked:
                qs = qs.exclude(user_id__in=blocked)
            ni = feedrank.not_interested_ids(user.id)
            if ni:
                qs = qs.exclude(id__in=ni)
            if request.query_params.get('feed') == 'following':
                followed = list(user.followed_by.values_list('id', flat=True))
                if followed:
                    qs = qs.filter(Q(user_id__in=followed) | Q(user=user))
        latest_id = qs.order_by('-id').values_list('id', flat=True).first()
        return Response({'latest_id': latest_id})

    @action(detail=False, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def watch(self, request):
        """Ingest a batch of dwell events: {"events": [{"post_id", "dwell_ms"}]}.
        Batched + capped + bulk-inserted so the write cost stays low. Only
        meaningful dwells are stored (noise/outliers are clamped out)."""
        from ..models import WatchEvent
        MIN_MS, MAX_MS, MAX_EVENTS = 500, 120000, 200
        events = request.data.get('events') or []
        if not isinstance(events, list):
            return Response({'error': 'events must be a list'}, status=status.HTTP_400_BAD_REQUEST)

        cleaned = {}
        for e in events[:MAX_EVENTS]:
            try:
                pid, ms = int(e['post_id']), int(e['dwell_ms'])
            except (KeyError, TypeError, ValueError):
                continue
            if ms < MIN_MS:
                continue
            ms = min(ms, MAX_MS)
            cleaned[pid] = max(cleaned.get(pid, 0), ms)  # keep the longest per post

        if not cleaned:
            return Response({'stored': 0})
        valid_ids = set(SocialPost.objects.filter(id__in=cleaned).values_list('id', flat=True))
        rows = [WatchEvent(user=request.user, post_id=pid, dwell_ms=cleaned[pid])
                for pid in valid_ids]
        WatchEvent.objects.bulk_create(rows, batch_size=200)
        return Response({'stored': len(rows)}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def not_interested(self, request, pk=None):
        """Record a private "not interested" signal: hide this post from the
        user's feeds and demote its author/tags in the ranked blend."""
        from ..models import NotInterested
        from .. import feed as feedrank
        post = self.get_object()
        NotInterested.objects.get_or_create(user=request.user, post=post)
        feedrank.invalidate_user(request.user.id)   # drop ni/neg/snapshot caches
        _bump_feed_version(request.user.id)          # and the chronological cache
        return Response({'status': 'ok', 'not_interested': True},
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'])
    def share(self, request, pk=None):
        post = self.get_object()
        share_url = request.build_absolute_uri(f'/posts/{post.id}/')
        return Response(
            {"share_url": share_url},
            status=status.HTTP_200_OK
        )

    @action(detail=True, methods=['get'])
    def download(self, request, pk=None):
        post = self.get_object()
        if not post.media_file:
            return Response(
                {'error': 'Media file not found'}, 
                status=status.HTTP_404_NOT_FOUND
            )
            
        return Response({
            'public_id': str(post.media_file),
            'content_type': post.content_type,
            'media_url': media.resolve(
                post.media_file,
                resource_type='video' if post.content_type == 'video' else 'image',
            ),
        }, status=status.HTTP_200_OK)



class SocialPostUploadView(APIView):
    """Alternative view for handling file uploads directly to Cloudinary"""
    parser_classes = [MultiPartParser]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = SocialPostUploadSerializer(data=request.data)
        if serializer.is_valid():
            try:
                # Determine content type from file
                media_file = serializer.validated_data['media_file']
                content_type = 'video' if media_file.content_type.startswith('video/') else 'image'

                # Straight to R2; the stored reference is the public URL.
                # (Dimensions came from Cloudinary before — clients that need
                # them send width/height explicitly on the main create path.)
                folder = 'social_media/videos' if content_type == 'video' else 'social_media/images'
                url = r2.upload_file(media_file, folder)

                post_data = {
                    'content_type': content_type,
                    'media_file': url,
                    'caption': serializer.validated_data.get('caption', ''),
                    'tags': serializer.validated_data.get('tags', ''),
                    'location': serializer.validated_data.get('location', ''),
                    'duration': serializer.validated_data.get('duration', None),
                }
                
                post_serializer = SocialPostSerializer(data=post_data, context={'request': request})
                if post_serializer.is_valid():
                    post = post_serializer.save(user=request.user)
                    return Response(post_serializer.data, status=status.HTTP_201_CREATED)
                return Response(post_serializer.errors, status=status.HTTP_400_BAD_REQUEST)
                
            except Exception as e:
                logger.error(f"Post media upload to R2 failed: {e}", exc_info=True)
                return Response(
                    {'error': 'Upload failed. Please try again.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)



class PostLikeViewSet(viewsets.ModelViewSet):
    queryset = PostLike.objects.all()
    serializer_class = PostLikeSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return self.queryset.filter(user=self.request.user)



def resolve_comment_parent(post, parent_id):
    """The comment a reply answers — it must be a live comment on the same
    post. None when this isn't a reply."""
    if parent_id in (None, '', 0, '0'):
        return None
    try:
        pid = int(parent_id)
    except (TypeError, ValueError):
        raise ValidationError({'parent': 'Invalid comment id.'})
    parent = (PostComment.objects.select_related('user', 'parent')
              .filter(pk=pid, post=post, is_removed=False).first())
    if parent is None:
        raise ValidationError({'parent': 'That comment no longer exists.'})
    return parent


class PostCommentViewSet(viewsets.ModelViewSet):
    queryset = PostComment.objects.all()
    serializer_class = PostCommentSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly, IsNotSuspended]
    pagination_class = StandardPagination

    def get_queryset(self):
        # select_related pulls each comment's author (+ profile for the avatar)
        # and who it replies to in the same query.
        user = self.request.user
        qs = (PostComment.objects.select_related('user', 'user__profile', 'reply_to', 'reply_to__profile')
              .filter(is_removed=False))
        post_id = self.kwargs.get('post_pk')
        if post_id:
            qs = qs.filter(post__id=post_id)
        # A post you can't see has no readable comments either.
        qs = qs.filter(visible_posts_q(user, prefix='post__'))
        # Nor do you see comments from people you've blocked, or who blocked you.
        blocked = blocked_ids_for(user)
        if blocked:
            qs = qs.exclude(user_id__in=blocked)
        if self.action == 'list':
            # The sheet shows top-level comments; replies load per thread.
            # Most-reacted first, then newest — TikTok's "top comments".
            qs = qs.filter(parent__isnull=True).order_by('-reactions_count', '-created_at', '-id')
        return qs

    def _page_response(self, queryset):
        page = self.paginate_queryset(queryset)
        rows = list(page if page is not None else queryset)
        ctx = self.get_serializer_context()
        # Every row's reaction summary in two queries, not two per row.
        ctx['reaction_summaries'] = reaction_summaries([c.id for c in rows], self.request.user)
        data = PostCommentSerializer(rows, many=True, context=ctx).data
        return self.get_paginated_response(data) if page is not None else Response(data)

    def list(self, request, *args, **kwargs):
        return self._page_response(self.filter_queryset(self.get_queryset()))

    @action(detail=True, methods=['get'])
    def replies(self, request, pk=None, post_pk=None):
        """A comment's thread, oldest first (it reads as a conversation)."""
        parent = self.get_object()
        blocked = blocked_ids_for(request.user)
        qs = (parent.replies.filter(is_removed=False)
              .select_related('user', 'user__profile', 'reply_to', 'reply_to__profile')
              .order_by('created_at', 'id'))
        if blocked:
            qs = qs.exclude(user_id__in=blocked)
        return self._page_response(qs)

    @action(detail=True, methods=['post', 'delete'],
            permission_classes=[permissions.IsAuthenticated, IsNotSuspended])
    def react(self, request, pk=None, post_pk=None):
        """POST {"emoji": "😂"} sets your reaction (the same one again removes
        it); DELETE removes it. Omitting emoji means the heart."""
        comment = self.get_object()
        if request.method == 'DELETE':
            emoji = None
        else:
            emoji = request.data.get('emoji') or CommentReaction.LIKE
            if emoji not in CommentReaction.REACTIONS:
                return Response({'error': 'Unsupported reaction.'}, status=status.HTTP_400_BAD_REQUEST)
        mine = set_reaction(request.user, comment, emoji)
        summary = reaction_summaries([comment.id], request.user)[comment.id]
        return Response({'reactions': summary, 'mine': mine})

    def create(self, request, *args, **kwargs):
        # The post comes from the nested route (/social-posts/<post_pk>/comments/).
        # On the flat /post-comments/ route there is no post_pk at all, so say
        # what is actually wrong instead of blaming the post.
        post_id = self.kwargs.get('post_pk')
        if post_id is None:
            raise ValidationError({
                'error': 'Post a comment to /api/social-posts/<post_id>/comments/ '
                         '— this route cannot tell which post you mean.'
            })
        post = (SocialPost.objects.filter(id=post_id, is_removed=False)
                .filter(visible_posts_q(request.user)).first())
        if post is None:
            raise ValidationError({"error": "Post not found"})
        if not post.comments_enabled:
            raise PermissionDenied('Comments are turned off for this post.')
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        parent = resolve_comment_parent(post, request.data.get('parent'))
        comment = create_post_comment(request.user, post, serializer.validated_data['content'], parent)
        return Response(self.get_serializer(comment).data, status=status.HTTP_201_CREATED)



class PostSaveViewSet(viewsets.ModelViewSet):
    queryset = PostSave.objects.all()
    serializer_class = PostSaveSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return self.queryset.filter(user=self.request.user).filter(
            visible_posts_q(self.request.user, prefix='post__'))



def story_queryset(user):
    """Live stories with the viewer's per-story state resolved in the main query.

    `prefetch_related('views')` does NOT help here: `obj.views.filter(...)` on a
    prefetched manager re-queries the database, so the old bar cost three
    queries per story (has_unviewed, is_viewed, views_count). Annotating costs
    none — StorySerializer reads viewed_by_me / views_total when present.
    """
    return (
        Story.objects
        .filter(expires_at__gt=timezone.now(), is_removed=False)
        .select_related('user__profile')
        .annotate(
            viewed_by_me=Exists(
                StoryView.objects.filter(story=OuterRef('pk'), viewer=user)
            ),
            views_total=Count('views', distinct=True),
        )
    )


class StoryViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated, IsOwnerOrReadOnly]
    serializer_class = StorySerializer
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    def get_queryset(self):
        return story_queryset(self.request.user)

    def perform_create(self, serializer):
        serializer.save(
            user=self.request.user,
            expires_at=timezone.now() + timedelta(hours=24),
        )

    def destroy(self, request, *args, **kwargs):
        story = self.get_object()
        if story.user != request.user:
            return Response({'error': 'Not your story'}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=['get'])
    def feed(self, request):
        """Stories from followed users, grouped by user. Own stories first."""
        following_ids = list(request.user.followed_by.values_list('id', flat=True))
        following_ids.append(request.user.id)

        # One query for the whole bar: viewed_by_me / views_total arrive as
        # annotations, so neither the grouping below nor the serializer touches
        # the database again.
        stories = story_queryset(request.user).filter(
            user_id__in=following_ids,
        ).order_by('user_id', '-created_at')

        # Group by user
        grouped = {}
        for story in stories:
            uid = story.user_id
            if uid not in grouped:
                grouped[uid] = {'user': story.user, 'stories': [], 'has_unviewed': False}
            grouped[uid]['stories'].append(story)
            if not story.viewed_by_me:
                grouped[uid]['has_unviewed'] = True

        # Own stories first, then following
        result = []
        own = grouped.pop(request.user.id, None)
        if own:
            result.append(own)
        result.extend(grouped.values())

        output = [
            {
                'user': SimpleUserSerializer(g['user'], context={'request': request}).data,
                'stories': StorySerializer(g['stories'], many=True, context={'request': request}).data,
                'has_unviewed': g['has_unviewed'],
            }
            for g in result
        ]
        return Response(output)

    @action(detail=True, methods=['post'])
    def view_story(self, request, pk=None):
        story = self.get_object()
        StoryView.objects.get_or_create(story=story, viewer=request.user)
        return Response({'status': 'viewed'})



class ReportViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]
    # Rate-limit report submissions (abuse guard) via the global ScopedRateThrottle.
    throttle_scope = 'reports'

    def create(self, request):
        content_type = request.data.get('content_type', '').lower()
        object_id = request.data.get('object_id')
        reason = request.data.get('reason', '')
        description = request.data.get('description', '')

        # Every moderatable content type (mirrors _CONTENT_MODELS) plus 'user'.
        # Admins can act on all of these from the reports screen.
        valid_types = {
            'post', 'comment', 'track', 'trackcomment', 'group', 'story', 'user',
            'publication', 'chapter', 'bookreview', 'chaptercomment', 'product', 'productreview', 'grouppost',
            'videostudio', 'mediastation', 'servicereview',
        }
        if content_type not in valid_types:
            return Response({'error': f'content_type must be one of {list(valid_types)}'}, status=status.HTTP_400_BAD_REQUEST)
        if not object_id:
            return Response({'error': 'object_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        if not reason:
            return Response({'error': 'reason is required'}, status=status.HTTP_400_BAD_REQUEST)
        # A copyright claim has to say what's being copied (a moderator can't
        # judge "copyright" alone).
        from ..rights import MIN_COPYRIGHT_REPORT_CHARS
        if reason == 'copyright' and len((description or '').strip()) < MIN_COPYRIGHT_REPORT_CHARS:
            return Response({'error': 'Describe the work that is being copied and who owns it.',
                             'code': 'copyright_details'}, status=status.HTTP_400_BAD_REQUEST)

        _, created = Report.objects.get_or_create(
            reporter=request.user,
            content_type=content_type,
            object_id=object_id,
            defaults={'reason': reason, 'description': description},
        )
        if not created:
            return Response({'message': 'Already reported'})
        return Response({'message': 'Content reported successfully'}, status=status.HTTP_201_CREATED)



EXPLORE_PAGE = 30
EXPLORE_RANKED = 150          # ranked candidates kept in the shared cache
EXPLORE_TTL = 300


def explore_hidden_authors(user):
    """Accounts Explore must never show `user`: blocked either way, and private
    accounts they don't follow."""
    return blocked_ids_for(user) | hidden_private_author_ids(user)


def _trending_ids():
    """The global Explore ranking: public posts from the last week (the last
    month on a quiet week), scored by likes, comments and views. Shared by
    everyone and cached, so a busy Explore costs one ranking query per
    TTL, not one per viewer. Only public posts on public accounts: Explore is
    discovery, and anything narrower is filtered per viewer anyway."""
    ids = cache.get('explore:trending_ids')
    if ids is not None:
        return ids
    private_accounts = Profile.objects.filter(is_public=False).values('user_id')
    base = (SocialPost.objects
            .filter(is_removed=False, visibility=SocialPost.VISIBILITY_PUBLIC)
            .exclude(user__is_deactivated=True)
            .exclude(user_id__in=private_accounts)
            .annotate(trend_score=F('likes_count') * 10 + F('comments_count') * 6 + F('view_count'))
            .order_by('-trend_score', '-created_at'))
    now = timezone.now()
    ids = list(base.filter(created_at__gte=now - timedelta(days=7))
               .values_list('id', flat=True)[:EXPLORE_RANKED])
    if len(ids) < EXPLORE_PAGE:
        ids = list(base.filter(created_at__gte=now - timedelta(days=30))
                   .values_list('id', flat=True)[:EXPLORE_RANKED])
    cache.set('explore:trending_ids', ids, EXPLORE_TTL)
    return ids


def _popular_user_ids():
    """Most-followed active accounts, cached globally — the fallback for "people
    to follow". Counting followers across every user on each request (per
    viewer) was the old way."""
    rows = cache.get('explore:popular_users')
    if rows is not None:
        return rows
    rows = list(
        User.objects.filter(is_deactivated=False)
        .annotate(n=Count('followers', distinct=True))
        .filter(n__gt=0).order_by('-n').values_list('id', flat=True)[:80]
    )
    cache.set('explore:popular_users', rows, 600)
    return rows


class ExploreViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=['get'])
    def trending_posts(self, request):
        """Trending posts for the Explore grid, ?page=N (30 per page). Built from
        the shared ranking, minus what this viewer mustn't see (blocked,
        private accounts they don't follow, "not interested")."""
        from .. import feed as feedrank
        try:
            page = max(1, int(request.query_params.get('page', 1)))
        except (TypeError, ValueError):
            page = 1
        hidden_authors = explore_hidden_authors(request.user)
        not_interested = feedrank.not_interested_ids(request.user.id)
        ranked = _trending_ids()
        # The ranking is cached: what was taken down (or whose book was pulled)
        # since is dropped here, with every post's own visibility.
        candidates = (SocialPost.objects.filter(id__in=ranked, is_removed=False).filter(visible_posts_q(request.user))
                      .exclude(user_id__in=hidden_authors).exclude(id__in=not_interested)
                      .values_list('id', flat=True))
        allowed = set(candidates)
        ordered = [pid for pid in ranked if pid in allowed]
        page_ids = ordered[(page - 1) * EXPLORE_PAGE: page * EXPLORE_PAGE]
        by_id = {p.id: p for p in SocialPost.objects.filter(id__in=page_ids)}
        rows = [by_id[i] for i in page_ids if i in by_id]
        return Response(ExplorePostSerializer(rows, many=True, context={'request': request}).data)

    @action(detail=False, methods=['get'])
    def suggested_users(self, request):
        """People to follow: first those followed by people you follow (ranked by
        how many of them do), then popular accounts. Never yourself, people you
        already follow, blocked accounts or deactivated ones."""
        me = request.user
        cache_key = f'explore:suggested:{me.id}'
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        following = set(me.followed_by.values_list('id', flat=True))
        exclude = following | blocked_ids_for(me) | {me.id}
        mutual = {}
        if following:
            for uid, n in (User.objects.filter(followers__in=following, is_deactivated=False)
                           .exclude(id__in=exclude)
                           .annotate(n=Count('followers', filter=Q(followers__in=following), distinct=True))
                           .order_by('-n').values_list('id', 'n')[:12]):
                mutual[uid] = n
        ids = list(mutual)
        for uid in _popular_user_ids():
            if len(ids) >= 12:
                break
            if uid not in exclude and uid not in mutual:
                ids.append(uid)

        users = {u.id: u for u in (User.objects.filter(id__in=ids).select_related('profile')
                                   .annotate(followers_count=Count('followers', distinct=True)))}
        data = []
        for uid in ids:
            u = users.get(uid)
            if u is None or u.is_deactivated:
                continue
            row = SimpleUserSerializer(u, context={'request': request}).data
            row['followers_count'] = u.followers_count
            row['mutual_count'] = mutual.get(uid, 0)
            data.append(row)
        cache.set(cache_key, data, 120)
        return Response(data)

    @action(detail=False, methods=['get'])
    def trending_hashtags(self, request):
        """Return the most-used hashtags in the last 7 days."""
        cached = cache.get('explore:trending_hashtags')
        if cached is not None:
            return Response(cached)
        week_ago = timezone.now() - timedelta(days=7)
        # Counted in SQL over hashtag rows. Public posts only: a trending tag
        # must not leak that followers-only or private posts exist.
        top = (
            Hashtag.objects
            .filter(posts__created_at__gte=week_ago, posts__is_removed=False,
                    posts__visibility=SocialPost.VISIBILITY_PUBLIC)
            .annotate(n=Count('posts', distinct=True))
            .order_by('-n', 'name')[:20]
        )
        data = [{'tag': h.name, 'count': h.n} for h in top]
        cache.set('explore:trending_hashtags', data, 300)
        return Response(data)

    @action(detail=False, methods=['get'])
    def hashtag_suggest(self, request):
        """Autocomplete for the caption box: tags starting with ?q=, most
        used first, with how many public posts carry each."""
        q = (request.query_params.get('q') or '').strip().lstrip('#').lower()[:100]
        qs = Hashtag.objects.all()
        if q:
            qs = qs.filter(name__startswith=q)
        rows = (
            qs.annotate(n=Count('posts', filter=Q(posts__is_removed=False,
                                                  posts__visibility=SocialPost.VISIBILITY_PUBLIC),
                                distinct=True))
            .order_by('-n', 'name')[:10]
        )
        return Response([{'tag': h.name, 'count': h.n} for h in rows])

    @action(detail=False, methods=['get'])
    def hashtag(self, request):
        """Header for a tag page: the tag and how many posts the caller can
        see under it. The posts themselves come from the list with ?tag=."""
        tag = (request.query_params.get('tag') or '').strip().lstrip('#').lower()
        if not tag:
            return Response({'error': 'tag is required'}, status=status.HTTP_400_BAD_REQUEST)
        hidden = blocked_ids_for(request.user) | hidden_private_author_ids(request.user)
        posts = (SocialPost.objects.filter(hashtags__name=tag, is_removed=False)
                 .filter(visible_posts_q(request.user)).exclude(user__is_deactivated=True))
        if hidden:
            posts = posts.exclude(user_id__in=hidden)
        return Response({'tag': tag, 'posts_count': posts.distinct().count()})

    # Each section's size in the all-in-one answer, and the most a "See all"
    # (?type=) returns.
    SEARCH_SECTION = 8
    SEARCH_TYPED = 50
    SEARCH_TYPES = ('users', 'artists', 'tracks', 'albums', 'playlists', 'groups', 'genres', 'hashtags', 'posts',
                    'books', 'services')

    @action(detail=False, methods=['get'])
    def search(self, request):
        """Search everything, forgiving typos and ranked by relevance
        (songs/search.py): people, artists, songs, albums, public playlists,
        groups, genres, hashtags and posts, plus the single best `top` result
        among songs / artists / albums / playlists.

        ?type=<section> answers just that section, with more rows (the "See
        all" and the Music screen's own search)."""
        from .. import search as fz
        from django.db.models.functions import Coalesce
        from ..models import Album, Category, Playlist, PlaylistTrack
        from ..serializers import AlbumSerializer, PlaylistListSerializer
        from .music import albums_with_counts, annotated_tracks, with_playlist_counts

        query = request.query_params.get('q', '').strip()
        only = request.query_params.get('type')
        only = only if only in self.SEARCH_TYPES else None
        want = (lambda k: only is None or only == k)
        n = self.SEARCH_TYPED if only else self.SEARCH_SECTION
        empty = {k: [] for k in self.SEARCH_TYPES}
        if len(query) < 2:
            return Response({**empty, 'top': None})
        me = request.user
        ctx = {'request': request}
        hidden = explore_hidden_authors(me)
        blocked = blocked_ids_for(me)
        out = dict(empty)
        best = []   # (score, kind, payload) for the top result

        # Two phases per section, so a search stays fast however many rows a
        # short piece of the query matches: score light rows (id, the text,
        # popularity — counts by per-row index lookups, never joins), then load
        # full rows only for the few that win.
        Follow = User.followers.through
        follower_n = Coalesce(Subquery(
            Follow.objects.filter(from_user=OuterRef('pk')).order_by().values('from_user')
            .annotate(n=Count('*')).values('n')[:1], output_field=IntegerField()), 0)
        live_song_n = Coalesce(Subquery(
            Track.objects.filter(artist=OuterRef('pk'), is_removed=False).order_by().values('artist')
            .annotate(n=Count('*')).values('n')[:1], output_field=IntegerField()), 0)
        has_live_song = Exists(Track.objects.filter(album_ref=OuterRef('pk'), is_removed=False))

        # People: usernames first (bio counts less), the more-followed nudged up.
        if want('users') or want('artists'):
            people = list(
                User.objects.filter(fz.candidate_q(['username', 'profile__bio'], query))
                .exclude(id__in=blocked).exclude(is_deactivated=True)
                .annotate(fc=follower_n, tc=live_song_n)
                .order_by('-fc', 'id').values('id', 'username', 'profile__bio', 'fc', 'tc')[:fz.CANDIDATES]
            )
            texts = lambda u: [(u['username'], 1.0), (u['profile__bio'], 0.6)]  # noqa: E731
            pop = lambda u: u['fc']  # noqa: E731
            ranked_people = fz.rank(query, people, texts, pop, n) if want('users') else []
            ranked_artists = (fz.rank(query, [u for u in people if u['tc']], lambda u: [(u['username'], 1.0)], pop, n)
                              if want('artists') else [])
            full = User.objects.select_related('profile').in_bulk(
                [u['id'] for _, u in ranked_people + ranked_artists])

            def user_rows(ranked):
                objs = [full[u['id']] for _, u in ranked if u['id'] in full]
                rows = SimpleUserSerializer(objs, many=True, context=ctx).data
                for row, (_, u) in zip(rows, ranked):
                    row.update(followers_count=u['fc'], tracks_count=u['tc'])
                return rows
            if want('users'):
                out['users'] = user_rows(ranked_people)
            if want('artists'):
                out['artists'] = user_rows(ranked_artists)
                best += [(sc, 'artist', row) for (sc, _), row in zip(ranked_artists, out['artists'])]

        # Songs: title, then album, then the artist's name.
        if want('tracks'):
            cands = list(
                Track.objects.filter(fz.candidate_q(['title', 'album', 'artist__username'], query), is_removed=False)
                .exclude(artist_id__in=blocked).exclude(artist__is_deactivated=True)
                .order_by('-views', '-id').values('id', 'title', 'album', 'artist__username', 'views')[:fz.CANDIDATES]
            )
            ranked = fz.rank(query, cands,
                             lambda t: [(t['title'], 1.0), (t['album'], 0.8), (t['artist__username'], 0.7)],
                             lambda t: t['views'], n)
            by_id = annotated_tracks(me).filter(id__in=[t['id'] for _, t in ranked]).in_bulk()
            winners = [(sc, by_id[t['id']]) for sc, t in ranked if t['id'] in by_id]
            rows = TrackListSerializer([t for _, t in winners], many=True, context=ctx).data
            best += [(sc, 'track', row) for (sc, _), row in zip(winners, rows)]
            out['tracks'] = rows

        # Albums with songs on them.
        if want('albums'):
            cands = list(
                Album.objects.filter(fz.candidate_q(['title', 'artist__username'], query))
                .filter(has_live_song)
                .exclude(artist_id__in=blocked).exclude(artist__is_deactivated=True)
                .order_by('-created_at').values('id', 'title', 'artist__username')[:fz.CANDIDATES]
            )
            ranked = fz.rank(query, cands, lambda a: [(a['title'], 1.0), (a['artist__username'], 0.6)], limit=n)
            by_id = albums_with_counts(Album.objects.filter(id__in=[a['id'] for _, a in ranked])).in_bulk()
            winners = [(sc, by_id[a['id']]) for sc, a in ranked if a['id'] in by_id]
            rows = AlbumSerializer([a for _, a in winners], many=True, context=ctx).data
            best += [(sc, 'album', row) for (sc, _), row in zip(winners, rows)]
            out['albums'] = rows

        # Public playlists with songs (private and unlisted are never searchable).
        if want('playlists'):
            live_item = Exists(PlaylistTrack.objects.filter(playlist=OuterRef('pk'), track__is_removed=False))
            cands = list(
                Playlist.objects.filter(fz.candidate_q(['name', 'description'], query), visibility=Playlist.PUBLIC)
                .filter(live_item)
                .exclude(user_id__in=hidden).exclude(user__is_deactivated=True)
                .order_by('-updated_at').values('id', 'name', 'description')[:fz.CANDIDATES]
            )
            ranked = fz.rank(query, cands, lambda pl: [(pl['name'], 1.0), (pl['description'], 0.6)], limit=n)
            by_id = (with_playlist_counts(Playlist.objects.filter(id__in=[pl['id'] for _, pl in ranked]))
                     .select_related('user').in_bulk())
            winners = [(sc, by_id[pl['id']]) for sc, pl in ranked if pl['id'] in by_id]
            rows = PlaylistListSerializer([pl for _, pl in winners], many=True, context=ctx).data
            for row, (sc, pl) in zip(rows, winners):
                row['owner'] = pl.user.username
                best.append((sc, 'playlist', row))
            out['playlists'] = rows

        # Groups you may see (private ones only to their members).
        if want('groups'):
            mine = Q(is_private=False) | Q(creator=me) | Q(id__in=GroupMember.objects.filter(user=me).values('group_id'))
            cands = list(
                Group.objects.filter(fz.candidate_q(['name', 'description'], query)).filter(mine)
                .filter(is_removed=False).order_by('-created_at').values('id', 'name', 'description')[:fz.CANDIDATES]
            )
            ranked = fz.rank(query, cands, lambda g: [(g['name'], 1.0), (g['description'], 0.5)], limit=n)
            by_id = Group.objects.in_bulk([g['id'] for _, g in ranked])
            out['groups'] = GroupSerializer([by_id[g['id']] for _, g in ranked if g['id'] in by_id],
                                            many=True, context=ctx).data

        # Books (Publishing): published, not taken down, by people you can
        # see — title first, then the author, then the summary.
        if want('books'):
            liked_n = Coalesce(Subquery(
                PublicationLike.objects.filter(publication=OuterRef('pk')).order_by().values('publication')
                .annotate(n=Count('*')).values('n')[:1], output_field=IntegerField()), 0)
            cands = list(
                Publication.objects.filter(fz.candidate_q(['title', 'summary', 'author__username'], query),
                                           status='published', is_removed=False)
                .exclude(author_id__in=blocked).exclude(author__is_deactivated=True)
                .annotate(ln=liked_n)
                .order_by('-ln', '-id').values('id', 'title', 'summary', 'author__username', 'ln')[:fz.CANDIDATES]
            )
            ranked = fz.rank(query, cands,
                             lambda b: [(b['title'], 1.0), (b['author__username'], 0.7), (b['summary'], 0.5)],
                             lambda b: b['ln'], n)
            by_id = (PublicationViewSet._counted(Publication.objects.filter(id__in=[b['id'] for _, b in ranked]), me)
                     .select_related('author', 'author__profile').in_bulk())
            out['books'] = PublicationListSerializer(
                [by_id[b['id']] for _, b in ranked if b['id'] in by_id], many=True, context=ctx).data

        # Services: listed, not taken down, by people you can see — the name
        # first, then the place, then what they say they do. Verified lead a tie.
        if want('services'):
            from ..models import Videostudio
            from ..serializers.directory import VideoStudioListSerializer
            cands = list(
                Videostudio.objects.filter(fz.candidate_q(['name', 'location', 'description'], query), is_removed=False)
                .exclude(created_by_id__in=blocked).exclude(created_by__is_deactivated=True)
                .order_by('-is_verified', '-id').values('id', 'name', 'location', 'description', 'is_verified')[:fz.CANDIDATES]
            )
            ranked = fz.rank(query, cands,
                             lambda s: [(s['name'], 1.0), (s['location'], 0.6), (s['description'] or '', 0.4)],
                             lambda s: 1 if s['is_verified'] else 0, n)
            by_id = (Videostudio.objects.filter(id__in=[s['id'] for _, s in ranked])
                     .select_related('created_by', 'organization').in_bulk())
            out['services'] = VideoStudioListSerializer(
                [by_id[s['id']] for _, s in ranked if s['id'] in by_id], many=True, context=ctx).data

        if want('genres'):
            gs = list(Category.objects.exclude(slug__isnull=True))
            ranked = fz.rank(query, gs, lambda g: [(g.name, 1.0), (g.slug.replace('-', ' '), 1.0)], limit=n)
            out['genres'] = [{'slug': g.slug, 'name': g.name} for _, g in ranked]

        # Hashtags: what you're typing is the start of a tag.
        tag = query.lstrip('#').lower()
        if want('hashtags') and tag:
            hashtags = (
                Hashtag.objects.filter(name__startswith=tag)
                .annotate(n=Count('posts', filter=Q(posts__is_removed=False,
                                                    posts__visibility=SocialPost.VISIBILITY_PUBLIC),
                                  distinct=True))
                .order_by('-n', 'name')[:n]
            )
            out['hashtags'] = [{'tag': h.name, 'count': h.n} for h in hashtags]

        # Posts: what this viewer can open — per-post visibility (the shared
        # queryset) plus account privacy and blocks. Captions are prose, so
        # plain matching on the words typed.
        if want('posts'):
            posts = (feed_post_queryset(me)
                     .filter(Q(caption__icontains=query) | Q(location__icontains=query))
                     .exclude(user_id__in=hidden).exclude(user__is_deactivated=True)
                     .order_by('-created_at')[:21 if not only else self.SEARCH_TYPED])
            # Grid tiles, not full posts (the post page loads the rest).
            out['posts'] = ExplorePostSerializer(posts, many=True, context=ctx).data

        top = max(best, key=lambda b: b[0]) if best else None
        # Only a clear winner is a "top result".
        out['top'] = {'kind': top[1], 'item': top[2]} if top and top[0] >= 0.8 else None
        return Response(out)


class PublicationViewSet(viewsets.ModelViewSet):
    """Long-form articles/books. Published items are public; drafts are visible
    only to their author. Only the author can edit/delete."""
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    pagination_class = StandardPagination

    def get_serializer_class(self):
        if self.action == 'list':
            return PublicationListSerializer
        return PublicationDetailSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        # ?toc=1: the book page — chapters without their bodies.
        ctx['toc'] = self.action == 'retrieve' and self._toc()
        return ctx

    def _toc(self):
        return self.request.query_params.get('toc') in ('1', 'true')

    def _visible(self):
        """What this user may open, nothing more (songs/publishing.py)."""
        return visible_publications(self.request.user)

    @staticmethod
    def _counted(qs, user, all_chapters=False):
        """Counts and the viewer's own marks as subqueries: one query for a
        page, and no chapters × likes join multiplying rows. Chapters counted
        are the ones readers get (not drafts or takedowns) unless
        `all_chapters` — the author's own list."""
        def count(model, **where):
            return Coalesce(Subquery(
                model.objects.filter(publication=OuterRef('pk'), **where).order_by()
                .values('publication').annotate(n=Count('pk')).values('n')[:1],
                output_field=IntegerField()), 0)
        chapter_where = {} if all_chapters else {'status': Chapter.PUBLISHED, 'is_removed': False}
        reviews = BookReview.objects.filter(publication=OuterRef('pk'), is_removed=False).order_by().values('publication')
        qs = qs.annotate(
            chapter_count_anno=count(Chapter, **chapter_where), likes_total=count(PublicationLike),
            rating_avg_anno=Subquery(reviews.annotate(a=Avg('rating')).values('a')[:1], output_field=FloatField()),
            rating_count_anno=Coalesce(Subquery(reviews.annotate(n=Count('pk')).values('n')[:1],
                                                output_field=IntegerField()), 0),
        )
        if user.is_authenticated:
            mine = ReadingProgress.objects.filter(publication=OuterRef('pk'), user=user)
            qs = qs.annotate(
                liked_by_me=Exists(PublicationLike.objects.filter(publication=OuterRef('pk'), user=user)),
                bookmarked_by_me=Exists(PublicationBookmark.objects.filter(publication=OuterRef('pk'), user=user)),
                my_percent=Subquery(mine.values('percent')[:1], output_field=FloatField()),
                my_finished_at=Subquery(mine.values('finished_at')[:1]),
                my_read_at=Subquery(mine.values('updated_at')[:1]),
            )
        return qs

    def get_queryset(self):
        user = self.request.user
        qs = self._visible().select_related('author', 'author__profile', 'organization')
        # Engagement actions only need the row; the list and the page need counts.
        if self.action in ('like', 'bookmark', 'progress', 'chapter', 'reading', 'revisions', 'revision',
                           'reviews', 'discussion', 'delete_comment', 'collaborators', 'collaborator', 'export',
                           'analytics', 'clubs', 'ai', 'ai_write', 'ai_check', 'share_to_feed'):
            return qs
        qs = self._counted(qs, user)
        if self.action == 'retrieve':
            # Readers get published chapters; the author all of theirs (drafts
            # and takedowns marked).
            chapters = Chapter.objects.filter(visible_chapters_q(user)).order_by('order', 'id')
            if self._toc():
                # The contents carry each chapter's discussion size.
                chapters = chapters.defer('body').annotate(comment_count_anno=Coalesce(Subquery(
                    ChapterComment.objects.filter(chapter=OuterRef('pk'), is_removed=False).order_by()
                    .values('chapter').annotate(n=Count('pk')).values('n')[:1],
                    output_field=IntegerField()), 0))
            qs = qs.prefetch_related(Prefetch('chapters', queryset=chapters)).annotate(
                words_total=Coalesce(Subquery(
                    Chapter.objects.filter(visible_chapters_q(user), publication=OuterRef('pk')).order_by()
                    .values('publication').annotate(n=Sum('word_count')).values('n')[:1],
                    output_field=IntegerField()), 0),
            )
            collab = PublicationCollaborator.objects.filter(publication=OuterRef('pk'), accepted_at__isnull=False)
            qs = qs.annotate(collab_count=Coalesce(Subquery(
                collab.order_by().values('publication').annotate(n=Count('pk')).values('n')[:1],
                output_field=IntegerField()), 0))
            if user.is_authenticated:
                follows = User.followers.through.objects.filter(
                    from_user_id=OuterRef('author_id'), to_user_id=user.id)
                mine = ReadingProgress.objects.filter(publication=OuterRef('pk'), user=user)
                qs = qs.annotate(my_collab_role=Subquery(collab.filter(user=user).values('role')[:1]))
                qs = qs.annotate(
                    my_last_chapter=Subquery(mine.values('last_chapter')[:1], output_field=IntegerField()),
                    my_last_position=Subquery(mine.values('position')[:1], output_field=FloatField()),
                    following_author=Exists(follows),
                )
        # Chapters (whose bodies can carry heavy base64 inline images) are
        # never prefetched for the list: megabytes per row never rendered.
        elif self.action not in ('list',):
            qs = qs.prefetch_related('chapters')

        if self.request.query_params.get('mine') and user.is_authenticated:
            qs = qs.filter(author=user)

        if self.request.query_params.get('saved') and user.is_authenticated:
            qs = qs.filter(bookmarks__user=user)

        author_id = self.request.query_params.get('author')
        if author_id:
            qs = qs.filter(author_id=author_id)

        # An organisation's page: the books under its name.
        org = self.request.query_params.get('organization')
        if org:
            qs = qs.filter(organization__slug=org, status='published')

        category = self.request.query_params.get('category')
        if category and category != 'all':
            qs = qs.filter(category=category)

        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(Q(title__icontains=search) | Q(summary__icontains=search))

        # The reader's shelves: books started and not finished (most recently
        # read first), and books finished (most recently finished first).
        shelf = self.request.query_params.get('shelf')
        if shelf in ('reading', 'finished') and user.is_authenticated:
            if shelf == 'reading':
                return qs.filter(progresses__user=user, progresses__finished_at__isnull=True).order_by('-my_read_at', '-id')
            return qs.filter(progresses__user=user, progresses__finished_at__isnull=False).order_by('-my_finished_at', '-id')

        return qs.order_by('-created_at')

    # ── Discover and community (songs/book_community.py) ──

    @action(detail=False, methods=['get'], permission_classes=[permissions.AllowAny])
    def home(self, request):
        """Discover: continue reading, editor's picks, trending, from authors
        you follow, new releases, rising authors. Every book row on the page
        in one query."""
        user = request.user
        sections = book_community.home_sections(user)
        keys = ('continue', 'picks', 'trending', 'following', 'new')
        because = sections.get('because')
        ids = {i for k in keys for i in sections[k]} | set(because['ids'] if because else [])
        rows = (self._counted(Publication.objects.filter(id__in=ids), user)
                .select_related('author', 'author__profile', 'organization').in_bulk())
        ctx = self.get_serializer_context()
        out = {k: PublicationListSerializer([rows[i] for i in sections[k] if i in rows], many=True, context=ctx).data
               for k in keys}
        # "Because you highlighted…": the passage, its book, and books near it.
        out['because'] = None
        if because:
            books = PublicationListSerializer([rows[i] for i in because['ids'] if i in rows], many=True, context=ctx).data
            if books:
                out['because'] = {'quote': because['quote'], 'publication': because['publication'],
                                  'title': because['title'], 'books': books}
        # Publishers: verified organisations with books out, the busiest first.
        from ..models import Organization
        from ..organizations import mini
        # The same for everyone: counted once every few minutes, not per visit.
        publishers = cache.get('books:publishers')
        if publishers is None:
            pubs = (Organization.objects.filter(is_verified=True)
                    .annotate(n=Count('publications', filter=Q(publications__status='published',
                                                               publications__is_removed=False)))
                    .filter(n__gt=0).order_by('-n', 'name')[:12])
            publishers = [{**mini(o), 'books_count': o.n} for o in pubs]
            cache.set('books:publishers', publishers, 10 * 60)
        out['publishers'] = publishers
        people = User.objects.select_related('profile').in_bulk([r['user_id'] for r in sections['rising']])
        out['rising'] = []
        for r in sections['rising']:
            u = people.get(r['user_id'])
            if u:
                row = SimpleUserSerializer(u, context=ctx).data
                row.update(readers=r['readers'], growth=round(r['growth'], 2))
                out['rising'].append(row)
        return Response(out)

    @action(detail=True, methods=['get', 'post', 'delete'])
    def reviews(self, request, pk=None):
        """GET: the summary (average, count, how the stars fall), the reader's
        own review, whether they may review yet, and others' reviews (paged).
        POST {rating, body}: write or change yours — after reading a fifth of
        the book. DELETE: take yours down."""
        pub = self.get_object()
        user = request.user
        mine = pub.reviews.filter(user=user).first() if user.is_authenticated else None
        if request.method == 'DELETE':
            if mine:
                mine.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        if request.method == 'POST':
            may, why = book_community.review_eligibility(user, pub)
            if not may:
                return Response({'error': 'You can review a book once you have read some of it.', 'code': why},
                                status=status.HTTP_403_FORBIDDEN)
            ser = BookReviewSerializer(mine, data=request.data, context={'request': request}, partial=bool(mine))
            ser.is_valid(raise_exception=True)
            review = ser.save(publication=pub, user=user)
            if mine is None:
                from ..push import notify_user
                notify_user(pub.author, 'book_review', f'{user.username} rated “{pub.title}” {review.rating}★',
                            data={'type': 'publication', 'publication_id': pub.id})
            return Response(BookReviewSerializer(review, context={'request': request}).data,
                            status=status.HTTP_201_CREATED if mine is None else status.HTTP_200_OK)

        qs = pub.reviews.filter(is_removed=False).select_related('user', 'user__profile')
        blocked = blocked_ids_for(user)
        if blocked:
            qs = qs.exclude(user_id__in=blocked)
        spread = dict(qs.values('rating').annotate(n=Count('pk')).values_list('rating', 'n'))
        total = sum(spread.values())
        others = qs.exclude(user=user) if user.is_authenticated else qs
        page = self.paginate_queryset(others)
        resp = self.get_paginated_response(BookReviewSerializer(page, many=True, context={'request': request}).data)
        may, why = book_community.review_eligibility(user, pub)
        resp.data.update({
            'summary': {
                'count': total,
                'average': round(sum(r * n for r, n in spread.items()) / total, 1) if total else None,
                'spread': {str(r): spread.get(r, 0) for r in range(1, 6)},
            },
            'mine': BookReviewSerializer(mine, context={'request': request}).data if mine else None,
            'can_review': may,
            'reason': why,
        })
        return resp

    @action(detail=True, methods=['get', 'post'], url_path=r'chapters/(?P<index>\d+)/comments')
    def discussion(self, request, pk=None, index=None):
        """A chapter's discussion. A reader who hasn't reached this chapter
        gets {locked, reached, count} instead of spoilers — ?reveal=1 to read
        it anyway. POST {body, parent?} to comment or reply."""
        from collections import defaultdict
        pub = self.get_object()
        chapters = list(reader_chapters(pub, request.user).values_list('pk', flat=True))
        i = int(index)
        if i >= len(chapters):
            raise Http404('No such chapter.')
        chapter_id = chapters[i]
        user = request.user

        if request.method == 'POST':
            body = str(request.data.get('body') or '').strip()
            if not body or len(body) > 2000:
                return Response({'error': 'A comment is 1 to 2000 characters.'}, status=status.HTTP_400_BAD_REQUEST)
            parent = None
            if request.data.get('parent'):
                parent = ChapterComment.objects.filter(pk=request.data.get('parent'), chapter_id=chapter_id,
                                                       is_removed=False).first()
                if parent is None:
                    return Response({'error': 'That comment is gone.'}, status=status.HTTP_400_BAD_REQUEST)
                parent = parent.parent or parent               # one level of replies
            c = ChapterComment.objects.create(publication=pub, chapter_id=chapter_id, user=user, body=body, parent=parent)
            from ..push import notify_user
            told = set()
            if parent and parent.user_id != user.id and parent.user_id not in blocked_ids_for(user):
                notify_user(parent.user, 'book_discussion', f'{user.username} replied in “{pub.title}”',
                            data={'type': 'chapter_discussion', 'publication_id': pub.id, 'chapter_index': i})
                told.add(parent.user_id)
            if pub.author_id != user.id and pub.author_id not in told:
                notify_user(pub.author, 'book_discussion',
                            f'{user.username} commented on chapter {i + 1} of “{pub.title}”',
                            data={'type': 'chapter_discussion', 'publication_id': pub.id, 'chapter_index': i})
            ctx = {'request': request, 'author_id': pub.author_id}
            return Response(ChapterCommentSerializer(c, context=ctx).data, status=status.HTTP_201_CREATED)

        qs = (ChapterComment.objects.filter(chapter_id=chapter_id, is_removed=False)
              .select_related('user', 'user__profile'))
        blocked = blocked_ids_for(user)
        if blocked:
            qs = qs.exclude(user_id__in=blocked)
        count = qs.count()
        reach = book_community.reader_reach(user, pub)
        if i > reach and request.query_params.get('reveal') not in ('1', 'true'):
            return Response({'locked': True, 'reached': reach, 'count': count, 'results': []})
        rows = list(qs[:500])
        replies = defaultdict(list)
        for c in rows:
            if c.parent_id:
                replies[c.parent_id].append(c)
        top = [c for c in rows if not c.parent_id]
        ctx = {'request': request, 'replies': replies, 'author_id': pub.author_id}
        return Response({'locked': False, 'count': count,
                         'results': ChapterCommentSerializer(top, many=True, context=ctx).data})

    @action(detail=True, methods=['delete'], url_path=r'comments/(?P<cid>\d+)',
            permission_classes=[permissions.IsAuthenticated])
    def delete_comment(self, request, pk=None, cid=None):
        """Its writer, or the book's author (their own discussion), may take
        a comment down."""
        pub = self.get_object()
        c = get_object_or_404(ChapterComment, pk=cid, publication=pub)
        if request.user.id not in (c.user_id, pub.author_id):
            return Response({'error': 'Not yours to remove.'}, status=status.HTTP_403_FORBIDDEN)
        c.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['get'], url_path=r'authors/(?P<uid>\d+)', permission_classes=[permissions.AllowAny])
    def author_page(self, request, uid=None):
        """An author's page: who they are, followers, readers (people who've
        read their books), books finished by readers, and their books."""
        author = get_object_or_404(User.objects.select_related('profile'), pk=uid, is_deactivated=False)
        if author.id in blocked_ids_for(request.user):
            raise Http404('No such author.')
        user = request.user
        books = (self._counted(self._visible().filter(author=author, status='published'), user)
                 .select_related('author', 'author__profile').order_by('-published_at', '-id')[:100])
        ctx = self.get_serializer_context()
        data = SimpleUserSerializer(author, context=ctx).data
        return Response({
            'author': data,
            'followers_count': author.followers.count(),
            'is_following': bool(user.is_authenticated and user.id != author.id
                                 and author.followers.filter(id=user.id).exists()),
            'readers_count': (ReadingActivity.objects.filter(publication__author=author)
                              .exclude(user=author).values('user').distinct().count()),
            'finished_count': ReadingProgress.objects.filter(publication__author=author, finished_at__isnull=False)
                                                     .exclude(user=author).count(),
            'books': PublicationListSerializer(books, many=True, context=ctx).data,
        })

    @action(detail=False, methods=['get'], url_path='reading-stats', permission_classes=[permissions.IsAuthenticated])
    def reading_stats(self, request):
        """Streak, time this week / month, the last 7 days, books finished
        this year. ?today=YYYY-MM-DD is the reader's own date (the server's
        day is UTC)."""
        today = timezone.localdate()
        raw = request.query_params.get('today')
        if raw:
            try:
                d = datetime.strptime(raw, '%Y-%m-%d').date()
                if abs((d - today).days) <= 1:
                    today = d
            except ValueError:
                pass
        return Response(reading_stats(request.user, today))

    def perform_create(self, serializer):
        serializer.save(author=self.request.user)

    @action(detail=True, methods=['get'], permission_classes=[permissions.AllowAny])
    def cover(self, request, pk=None):
        """Stream the stored base64 cover as a real, cacheable image so the list
        doesn't have to ship the blob inline."""
        pub = get_object_or_404(self._visible(), pk=pk)   # not a draft's or a takedown's
        data_uri = pub.cover or ''
        if ',' not in data_uri:
            raise Http404('No cover.')
        header, _, payload = data_uri.partition(',')
        mime = header[5:].split(';')[0] if header.startswith('data:') else ''
        try:
            raw = base64.b64decode(payload)
        except Exception:
            raise Http404('Bad cover data.')
        resp = HttpResponse(raw, content_type=mime or 'image/jpeg')
        resp['Cache-Control'] = 'public, max-age=31536000, immutable'  # version-busted below
        return resp

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def like(self, request, pk=None):
        pub = self.get_object()
        obj, created = PublicationLike.objects.get_or_create(publication=pub, user=request.user)
        if not created:
            obj.delete()
        return Response({'is_liked': created, 'likes_count': pub.likes.count()})

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def bookmark(self, request, pk=None):
        pub = self.get_object()
        obj, created = PublicationBookmark.objects.get_or_create(publication=pub, user=request.user)
        if not created:
            obj.delete()
        return Response({'is_bookmarked': created})

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def progress(self, request, pk=None):
        pub = self.get_object()
        try:
            chapter = int(request.data.get('chapter', 0))
        except (TypeError, ValueError):
            chapter = 0
        chapter = max(0, chapter)
        rp, created = ReadingProgress.objects.get_or_create(
            publication=pub, user=request.user, defaults={'last_chapter': chapter})
        if created or rp.last_chapter != chapter:
            # A different chapter starts at its top: the place kept was in
            # the one before (resuming there would open part-way into this).
            words = [max(1, w) for w in reader_chapters(pub, request.user).values_list('word_count', flat=True)]
            rp.last_chapter, rp.position = chapter, 0
            rp.percent = 1.0 if rp.finished_at else book_percent(words, chapter, 0)
            rp.save()
        return Response({'last_read_chapter': chapter})

    @action(detail=True, methods=['get'], url_path=r'chapters/(?P<index>\d+)')
    def chapter(self, request, pk=None, index=None):
        """One chapter (0-based, in reading order) — the reader loads chapters
        one at a time instead of the whole book with all its images. Counted
        among the chapters this reader may see (drafts are the author's)."""
        pub = self.get_object()
        chapters = list(reader_chapters(pub, request.user).values_list('pk', flat=True))
        i = int(index)
        if i >= len(chapters):
            raise Http404('No such chapter.')
        ch = Chapter.objects.get(pk=chapters[i])
        return Response({
            'index': i, 'count': len(chapters), 'updated_at': pub.updated_at,
            'chapter': ChapterReadSerializer(ch).data,
        })

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def reading(self, request, pk=None):
        """Reading as it happened, in batches (and late, from a phone that was
        offline): {events: [{index, seconds, furthest, position, at}]}."""
        pub = self.get_object()
        events = request.data.get('events')
        if not isinstance(events, list):
            return Response({'error': 'events must be a list'}, status=status.HTTP_400_BAD_REQUEST)
        return Response({'accepted': record_reading(request.user, pub, events)})

    def _own(self, request):
        pub = self.get_object()
        # The book's writers (author, co-authors, editors) see its history.
        if not writer_studio.can_edit(request.user, pub):
            raise Http404('No such publication.')   # someone else's history isn't there to see
        return pub

    @action(detail=True, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def revisions(self, request, pk=None):
        """The author's kept copies: ?chapter=<id> for a chapter's history
        (newest first), or none for the book's deleted chapters."""
        pub = self._own(request)
        ref = request.query_params.get('chapter')
        try:
            ref = int(ref) if ref is not None else None
        except ValueError:
            return Response({'error': 'chapter must be an id'}, status=status.HTTP_400_BAD_REQUEST)
        return Response({'results': revision_list(pub, ref)})

    @action(detail=True, methods=['get'], url_path=r'revisions/(?P<rid>\d+)',
            permission_classes=[permissions.IsAuthenticated])
    def revision(self, request, pk=None, rid=None):
        """One kept copy, with what's changed since (against the chapter as
        it is now, or nothing if it was deleted)."""
        pub = self._own(request)
        rev = get_object_or_404(ChapterRevision, pk=rid, publication=pub)
        current = pub.chapters.filter(pk=rev.chapter_ref).first()
        return Response({
            'id': rev.id, 'chapter_ref': rev.chapter_ref, 'version': rev.version, 'title': rev.title,
            'body': rev.body, 'word_count': rev.word_count, 'reason': rev.reason, 'created_at': rev.created_at,
            'chapter_exists': current is not None,
            'current_version': current.version if current else None,
            'changes': diff_paragraphs(rev.body, current.body) if current else None,
        })

    def update(self, request, *args, **kwargs):
        pub = self.get_object()
        role = writer_studio.role_of(request.user, pub)
        if role not in ('owner', *PublicationCollaborator.EDIT_ROLES):
            return Response({"error": "You can only edit your own publications."},
                            status=status.HTTP_403_FORBIDDEN)
        # Co-authors and editors write; publishing (or taking it down) stays
        # the author's.
        if role != 'owner' and 'status' in request.data and request.data.get('status') != pub.status:
            return Response({"error": "Only the author can publish or unpublish this book.", 'code': 'owner_only'},
                            status=status.HTTP_403_FORBIDDEN)
        try:
            return super().update(request, *args, **kwargs)
        except ChaptersChangedElsewhere as e:
            return Response(e.payload, status=status.HTTP_409_CONFLICT)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.author_id != request.user.id:
            return Response({"error": "You can only delete your own publications."},
                            status=status.HTTP_403_FORBIDDEN)
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def mine(self, request):
        # Counted like the list (it used to count likes and marks row by row).
        # Books shared with you (accepted) are your work too.
        qs = self.filter_queryset(self._counted(
            Publication.objects.filter(Q(author=request.user) | Q(id__in=collaborating(request.user)),
                                       is_removed=False)
            .select_related('author', 'author__profile', 'organization'),
            request.user, all_chapters=True,
        ).order_by('-created_at'))
        page = self.paginate_queryset(qs)
        ser = PublicationListSerializer(page if page is not None else qs, many=True,
                                        context=self.get_serializer_context())
        return self.get_paginated_response(ser.data) if page is not None else Response(ser.data)

    # ── Writer Studio (songs/writer_studio.py) ──

    def _owned(self, request):
        pub = self.get_object()
        if pub.author_id != request.user.id:
            raise PermissionDenied('Only the author can do this.')
        return pub

    @staticmethod
    def _collab_row(c):
        return {'id': c.id, 'user': SimpleUserSerializer(c.user).data, 'role': c.role,
                'accepted': c.accepted_at is not None, 'created_at': c.created_at}

    @action(detail=True, methods=['get', 'post'], permission_classes=[permissions.IsAuthenticated])
    def collaborators(self, request, pk=None):
        """GET: who works on the book (anyone who does may see). POST
        {username, role}: the author invites someone (they're told)."""
        pub = self.get_object()
        role = writer_studio.role_of(request.user, pub)
        if role is None:
            raise PermissionDenied('Not your book.')
        if request.method == 'GET':
            rows = pub.collaborators.select_related('user', 'user__profile')
            return Response({'results': [self._collab_row(c) for c in rows], 'my_role': role})
        if role != 'owner':
            raise PermissionDenied('Only the author invites.')
        who = User.objects.filter(username__iexact=str(request.data.get('username') or '').strip().lstrip('@'),
                                  is_deactivated=False).first()
        new_role = request.data.get('role') or PublicationCollaborator.EDITOR
        if who is None or who.id == pub.author_id or who.id in blocked_ids_for(request.user):
            return Response({'error': 'No one by that name can be invited.', 'code': 'no_user'},
                            status=status.HTTP_400_BAD_REQUEST)
        if new_role not in dict(PublicationCollaborator.ROLES):
            return Response({'error': 'Unknown role.'}, status=status.HTTP_400_BAD_REQUEST)
        c, created = PublicationCollaborator.objects.get_or_create(
            publication=pub, user=who, defaults={'role': new_role, 'invited_by': request.user})
        if not created:
            c.role = new_role
            c.save(update_fields=['role'])
        else:
            from ..push import notify_user
            notify_user(who, 'book_invite', f'{request.user.username} invited you to work on “{pub.title}”',
                        data={'type': 'book_invite', 'publication_id': pub.id})
        return Response(self._collab_row(c), status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    @action(detail=True, methods=['patch', 'delete'], url_path=r'collaborators/(?P<cid>\d+)',
            permission_classes=[permissions.IsAuthenticated])
    def collaborator(self, request, pk=None, cid=None):
        """The author changes a role (PATCH {role}) or removes someone; a
        collaborator may remove themselves (leave)."""
        pub = self.get_object()
        c = get_object_or_404(PublicationCollaborator, pk=cid, publication=pub)
        if request.method == 'DELETE':
            if request.user.id not in (pub.author_id, c.user_id):
                raise PermissionDenied('Not yours to remove.')
            c.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        if pub.author_id != request.user.id:
            raise PermissionDenied('Only the author changes roles.')
        if request.data.get('role') not in dict(PublicationCollaborator.ROLES):
            return Response({'error': 'Unknown role.'}, status=status.HTTP_400_BAD_REQUEST)
        c.role = request.data['role']
        c.save(update_fields=['role'])
        return Response(self._collab_row(c))

    @action(detail=False, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def invitations(self, request):
        """Books you've been invited to work on, not yet answered."""
        rows = (PublicationCollaborator.objects.filter(user=request.user, accepted_at__isnull=True,
                                                       publication__is_removed=False)
                .select_related('publication', 'invited_by'))
        return Response({'results': [{
            'id': c.id, 'role': c.role, 'publication_id': c.publication_id, 'title': c.publication.title,
            'cover': media.resolve(c.publication.cover) or '',
            'invited_by': c.invited_by.username if c.invited_by else '', 'created_at': c.created_at,
        } for c in rows]})

    @action(detail=False, methods=['post'], url_path=r'invitations/(?P<cid>\d+)/(?P<answer>accept|decline)',
            permission_classes=[permissions.IsAuthenticated])
    def answer_invitation(self, request, cid=None, answer=None):
        c = get_object_or_404(PublicationCollaborator, pk=cid, user=request.user, accepted_at__isnull=True)
        if answer == 'decline':
            c.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        c.accepted_at = timezone.now()
        c.save(update_fields=['accepted_at'])
        return Response({'publication_id': c.publication_id, 'role': c.role})

    @action(detail=True, methods=['get', 'post'], permission_classes=[permissions.IsAuthenticated])
    def export(self, request, pk=None):
        """The author's book as an EPUB. POST: make one (the worker does it);
        GET: the latest — {status, url}."""
        pub = self.get_object()
        if not writer_studio.can_edit(request.user, pub):
            raise PermissionDenied('Only the book\'s writers can export it.')
        if request.method == 'POST':
            exp = writer_studio.request_export(pub, request.user, 'epub')
            return Response({'id': exp.id, 'status': exp.status, 'url': ''}, status=status.HTTP_202_ACCEPTED)
        exp = pub.exports.first()
        if exp is None:
            return Response({'status': None, 'url': ''})
        return Response({'id': exp.id, 'status': exp.status, 'url': exp.url, 'error': exp.error,
                         'created_at': exp.created_at, 'finished_at': exp.finished_at})

    # ── Author Studio and book clubs (songs/author_studio.py) ──

    @staticmethod
    def _days(request):
        try:
            return int(request.query_params.get('days', 30))
        except ValueError:
            return 30

    @action(detail=True, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def analytics(self, request, pk=None):
        """How the book is read — totals only. For its writers."""
        pub = self.get_object()
        if not writer_studio.can_edit(request.user, pub):
            raise PermissionDenied('Only the book\'s writers see how it is read.')
        return Response(author_studio.book_analytics(pub, self._days(request)))

    @action(detail=False, methods=['get'], url_path='analytics', permission_classes=[permissions.IsAuthenticated])
    def author_analytics(self, request):
        """All the author's books at a glance."""
        return Response(author_studio.author_overview(request.user, self._days(request)))

    @action(detail=True, methods=['get', 'post'])
    def clubs(self, request, pk=None):
        """GET: clubs reading this book (yours, and public ones). POST {name,
        private?, starts_on?, chapters_per_step?, every_days?}: start one —
        a group with a reading plan, you its admin."""
        pub = self.get_object()
        if request.method == 'GET':
            rows = [author_studio.club_summary(c, request.user) | {'name': c.group.name}
                    for c in author_studio.clubs_for(request.user, pub)[:20]]
            return Response({'results': rows})
        if not request.user.is_authenticated:
            raise PermissionDenied('Sign in to start a book club.')
        if pub.status != 'published':
            return Response({'error': 'A book club reads a published book.'}, status=status.HTTP_400_BAD_REQUEST)
        name = str(request.data.get('name') or f'{pub.title} book club').strip()[:100]
        starts_on = None
        if request.data.get('starts_on'):
            try:
                starts_on = datetime.strptime(str(request.data['starts_on']), '%Y-%m-%d').date()
            except ValueError:
                return Response({'error': 'starts_on is a date: YYYY-MM-DD'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            per = int(request.data.get('chapters_per_step') or 1)
            every = int(request.data.get('every_days') or 7)
        except (TypeError, ValueError):
            return Response({'error': 'The plan needs numbers.'}, status=status.HTTP_400_BAD_REQUEST)
        club = author_studio.create_club(request.user, pub, name,
                                         is_private=str(request.data.get('private', True)).lower() not in ('0', 'false'),
                                         starts_on=starts_on, chapters_per_step=per, every_days=every)
        return Response(author_studio.club_summary(club, request.user) | {'name': club.group.name},
                        status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], url_path=r'clubs/(?P<cid>\d+)')
    def club(self, request, cid=None):
        """One club's page (members, or anyone for a public club)."""
        club = get_object_or_404(BookClub.objects.select_related('group', 'publication'), pk=cid,
                                 group__is_removed=False)
        member = request.user.is_authenticated and GroupMember.objects.filter(group=club.group, user=request.user).exists()
        if club.group.is_private and not member:
            raise Http404('No such club.')
        return Response(author_studio.club_summary(club, request.user) | {'name': club.group.name})

    @action(detail=False, methods=['get'], url_path=r'clubs/by-group/(?P<slug>[-\w]+)')
    def club_of_group(self, request, slug=None):
        """The club a group runs, if any — {club: id|null} (the group page shows it)."""
        club = BookClub.objects.filter(group__slug=slug).values_list('pk', flat=True).first()
        return Response({'club': club})

    # ── AI in books (songs/book_ai.py) ──

    def get_throttles(self):
        if self.action in ('ai', 'ai_write', 'ai_check') and self.request.method == 'POST':
            self.throttle_scope = 'ai'
        elif self.action == 'share_to_feed':
            self.throttle_scope = 'book_share'
        return super().get_throttles()

    @staticmethod
    def _ai_error(e):
        if isinstance(e, book_ai.AiOff):
            return Response({'error': 'AI is not available.', 'code': 'ai_off'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if isinstance(e, book_ai.AiLimit):
            return Response({'error': "You've used today's AI answers.", 'code': 'ai_limit'},
                            status=status.HTTP_429_TOO_MANY_REQUESTS)
        return Response({'error': 'AI could not answer just now.', 'code': 'ai_failed'}, status=status.HTTP_502_BAD_GATEWAY)

    @action(detail=False, methods=['get'], url_path='ai-status')
    def ai_status(self, request):
        """{enabled, used, limit} — whether to offer the AI tools at all."""
        user = request.user
        return Response({'enabled': book_ai.enabled(), 'limit': settings.AI_DAILY_LIMIT,
                         'used': book_ai.used_today(user) if user.is_authenticated else 0})

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def ai(self, request, pk=None):
        """A reader's question about what they're reading: {kind: explain |
        define | summary, chapter: index, passage?, lang?}. Answered from the
        chapter's own text, kept for the next reader who asks."""
        pub = self.get_object()
        kind = str(request.data.get('kind') or '')
        if kind not in book_ai.READER_KINDS:
            return Response({'error': 'kind is explain, define or summary.'}, status=status.HTTP_400_BAD_REQUEST)
        chapters = list(reader_chapters(pub, request.user).values_list('pk', flat=True))
        try:
            i = int(request.data.get('chapter'))
        except (TypeError, ValueError):
            i = -1
        if not 0 <= i < len(chapters):
            raise Http404('No such chapter.')
        chapter = Chapter.objects.get(pk=chapters[i])
        try:
            return Response(book_ai.reader_answer(request.user, pub, chapter, kind,
                                                  str(request.data.get('passage') or ''),
                                                  str(request.data.get('lang') or 'en')))
        except ValueError:
            return Response({'error': 'Choose a passage first.'}, status=status.HTTP_400_BAD_REQUEST)
        except (book_ai.AiOff, book_ai.AiLimit, book_ai.AiFailed) as e:
            return self._ai_error(e)

    @action(detail=True, methods=['post'], url_path='ai/write', permission_classes=[permissions.IsAuthenticated])
    def ai_write(self, request, pk=None):
        """A writer's helper: {kind: improve | shorten | grammar, text} → a
        rewrite; {kind: structure} → advice on the book's shape."""
        pub = self.get_object()
        if not writer_studio.can_edit(request.user, pub):
            raise PermissionDenied("Only the book's writers can use its writing tools.")
        kind = str(request.data.get('kind') or '')
        if kind not in book_ai.WRITER_KINDS:
            return Response({'error': 'kind is improve, shorten, grammar or structure.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            return Response(book_ai.writer_answer(request.user, pub, kind, str(request.data.get('text') or ''),
                                                  str(request.data.get('lang') or 'en')))
        except ValueError:
            return Response({'error': 'There is no text to work on.'}, status=status.HTTP_400_BAD_REQUEST)
        except (book_ai.AiOff, book_ai.AiLimit, book_ai.AiFailed) as e:
            return self._ai_error(e)

    @action(detail=True, methods=['get', 'post'], url_path='ai/check', permission_classes=[permissions.IsAuthenticated])
    def ai_check(self, request, pk=None):
        """The manuscript read for things that disagree between chapters.
        POST: start one (the worker does it); GET: the latest."""
        pub = self.get_object()
        if not writer_studio.can_edit(request.user, pub):
            raise PermissionDenied("Only the book's writers can check it.")
        if request.method == 'POST':
            try:
                check = book_ai.request_check(pub, request.user)
            except (book_ai.AiOff, book_ai.AiLimit) as e:
                return self._ai_error(e)
            return Response(book_ai.check_json(check), status=status.HTTP_202_ACCEPTED)
        return Response(book_ai.check_json(pub.checks.first()))
    # ── A book (or a passage from it) as a post in the social feed ──

    @action(detail=True, methods=['post'], url_path='share-to-feed',
            permission_classes=[permissions.IsAuthenticated, IsNotSuspended])
    def share_to_feed(self, request, pk=None):
        """{caption?, quote?, chapter_id?, block?, visibility?} → the post, drawn
        in the feed as the book's card (with the passage, when one is given)."""
        pub = self.get_object()
        if pub.status != 'published' or pub.is_removed:
            return Response({'error': 'Only a published book can be shared.'}, status=status.HTTP_400_BAD_REQUEST)
        quote = str(request.data.get('quote') or '').strip()[:2000]
        chapter, block = None, None
        if quote and request.data.get('chapter_id'):
            chapter = reader_chapters(pub, request.user).filter(pk=request.data.get('chapter_id')).first()
            try:
                block = max(0, int(request.data.get('block'))) if chapter else None
            except (TypeError, ValueError):
                block = None
        visibility = request.data.get('visibility') or SocialPost.VISIBILITY_PUBLIC
        if visibility not in dict(SocialPost.VISIBILITY_CHOICES):
            visibility = SocialPost.VISIBILITY_PUBLIC
        post = SocialPost.objects.create(
            user=request.user, content_type='book', publication=pub,
            media_file=pub.cover or '', thumbnail=pub.cover or '', width=600, height=900,
            caption=str(request.data.get('caption') or '').strip()[:2200],
            book_quote=quote, book_chapter=chapter, book_block=block, visibility=visibility,
        )
        sync_post_links(post)
        _bump_feed_version(request.user.id)
        row = feed_post_queryset(request.user).get(pk=post.pk)
        return Response(SocialPostSerializer(row, context=self.get_serializer_context()).data,
                        status=status.HTTP_201_CREATED)
    @action(detail=False, methods=['post'], url_path='cover-render', permission_classes=[permissions.IsAuthenticated])
    def cover_render(self, request):
        """Draw a cover from a template: {template, title, subtitle?, author?,
        palette?, image_url? (an upload of ours, for 'photo')} → {url}."""
        title = str(request.data.get('title') or '').strip()
        if not title:
            return Response({'error': 'A cover needs the title.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            url = writer_studio.make_cover(
                request.user, str(request.data.get('template') or 'minimal'), title[:200],
                subtitle=str(request.data.get('subtitle') or '')[:120],
                author=str(request.data.get('author') or request.user.username)[:80],
                palette=str(request.data.get('palette') or 'navy'),
                image_url=str(request.data.get('image_url') or ''),
            )
        except RuntimeError:
            return Response({'error': 'Covers can’t be made right now.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({'url': url}, status=status.HTTP_201_CREATED)


class BookHighlightViewSet(viewsets.GenericViewSet):
    """A reader's own highlights and notes in books.

        GET  /book-highlights/?publication=<id>   one book's (for the reader)
        GET  /book-highlights/?collection=<name>  one of the reader's collections
        GET  /book-highlights/collections/        [{name, count}]
        GET  /book-highlights/                    all, newest first (the library)
             &since=<iso>                         only what changed since, deletions included
        POST /book-highlights/sync/ {ops: [...]}  the phone's changes (songs/publishing.py)
    """
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination
    serializer_class = BookHighlightSerializer

    def get_queryset(self):
        return (BookHighlight.objects.filter(user=self.request.user)
                .filter(publication__in=visible_publications(self.request.user))
                .select_related('publication', 'chapter'))

    def list(self, request):
        qs = self.get_queryset()
        pub = request.query_params.get('publication')
        if pub:
            qs = qs.filter(publication_id=pub)
        coll = request.query_params.get('collection')
        if coll:
            qs = qs.filter(collection=coll)
        since = request.query_params.get('since')
        if since:
            try:
                qs = qs.filter(updated_at__gt=datetime.fromisoformat(since.replace('Z', '+00:00')))
            except ValueError:
                return Response({'error': 'since must be an ISO time'}, status=status.HTTP_400_BAD_REQUEST)
        else:
            qs = qs.filter(deleted=False)
        if pub:            # one book's: all of them, no pages (a book has tens, not thousands)
            return Response({'results': self.get_serializer(qs[:2000], many=True).data})
        page = self.paginate_queryset(qs)
        return self.get_paginated_response(self.get_serializer(page, many=True).data)

    @action(detail=False, methods=['get'])
    def collections(self, request):
        rows = (self.get_queryset().filter(deleted=False).exclude(collection='').values('collection')
                .annotate(n=Count('pk'), last=Max('updated_at')).order_by('-last'))
        return Response({'results': [{'name': r['collection'], 'count': r['n']} for r in rows]})

    @action(detail=False, methods=['post'])
    def sync(self, request):
        ops = request.data.get('ops')
        if not isinstance(ops, list):
            return Response({'error': 'ops must be a list'}, status=status.HTTP_400_BAD_REQUEST)
        return Response({'applied': apply_highlight_ops(request.user, ops)})


# --- Public share / link-preview page -----------------------------------------
import re as _re
from django.conf import settings as _settings
from django.http import HttpResponse, HttpResponseNotFound
from django.shortcuts import get_object_or_404
from django.utils.html import escape as _esc


def _share_image(post, fallback=''):
    """og:image for the link-preview card. Prefers the post's own still — the
    video poster frame the client captures at upload (post.thumbnail), or the
    image itself for photo posts — then falls back to a branded image so the card
    is never blank. Mirrors the serializer's get_thumbnail_url resolution."""
    poster = media.resolve(post.thumbnail) if post.thumbnail else ''
    if poster:
        return poster
    if post.content_type == 'image':
        img = media.resolve(post.media_file) or ''
        if img:
            return img
    return fallback or ''


_SHARE_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
<meta property="og:site_name" content="Adventist Life">
<meta property="og:type" content="__OGTYPE__">
<meta property="og:title" content="__TITLE__">
<meta property="og:description" content="__DESC__">
<meta property="og:image" content="__IMAGE__">
<meta property="og:url" content="__URL__">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="__TITLE__">
<meta name="twitter:description" content="__DESC__">
<meta name="twitter:image" content="__IMAGE__">__VIDEO_TAGS__
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    background:#0A1628; color:#E0E1DD; display:flex; min-height:100vh;
    align-items:center; justify-content:center; padding:20px; }
  .card { width:100%; max-width:420px; background:#102E50; border:1px solid #1E3A5F;
    border-radius:20px; overflow:hidden; box-shadow:0 12px 40px rgba(0,0,0,.5); }
  .media { position:relative; width:100%; aspect-ratio:1200/630; background:#0D2340; }
  .media img { width:100%; height:100%; object-fit:cover; display:block; }
  .play { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; }
  .play span { width:64px; height:64px; border-radius:50%; background:rgba(0,0,0,.45);
    display:flex; align-items:center; justify-content:center; }
  .play svg { width:28px; height:28px; fill:#fff; margin-left:4px; }
  .body { padding:18px 20px 22px; }
  .user { font-weight:700; font-size:17px; margin:0 0 6px; }
  .caption { color:#A9BCD0; font-size:14px; line-height:1.45; margin:0 0 18px; white-space:pre-wrap; }
  .btn { display:block; text-align:center; text-decoration:none; background:#1DA1F2;
    color:#fff; font-weight:700; padding:14px; border-radius:14px; }
  .stores { margin-top:18px; text-align:center; }
  .stores .get { color:#A9BCD0; font-size:13px; margin:0 0 10px; }
  .store-row { display:flex; gap:10px; justify-content:center; flex-wrap:wrap; }
  .store { flex:1 1 0; min-width:130px; display:flex; align-items:center; justify-content:center;
    gap:8px; text-decoration:none; background:#0D2340; border:1px solid #1E3A5F;
    color:#E0E1DD; font-weight:600; font-size:14px; padding:12px; border-radius:12px; }
  .store svg { width:18px; height:18px; fill:#E0E1DD; }
  .brand { text-align:center; color:#6C757D; font-size:12px; margin-top:18px; letter-spacing:1px; }
</style>
</head>
<body>
  <div class="card">
    <div class="media">__IMG_BLOCK____PLAY_BLOCK__</div>
    <div class="body">
      <p class="user">__USER__</p>__CAPTION_BLOCK__
      <a class="btn" href="__DEEP__">Open in Adventist Life</a>__STORE_BLOCK__
      <p class="brand">ADVENTIST LIFE</p>
    </div>
  </div>
  <script>
    // If the app is installed, hand off to it (opens this exact post). Only try
    // on mobile — desktop browsers would just error on the custom scheme — and
    // leave this page (thumbnail, caption, and the store buttons) as the fallback
    // for anyone who doesn't have the app yet.
    (function(){
      var ua = navigator.userAgent || '';
      if (!/Android|iPhone|iPad|iPod/i.test(ua)) return;
      try { window.location.href = "__DEEP__"; } catch (e) {}
    })();
  </script>
</body>
</html>"""


def post_share_page(request, post_id):
    """Public, crawler-friendly preview page for a single post.

    Serves Open Graph/Twitter tags (so shared links render a rich card with a
    thumbnail) and deep-links into the app via the `streams://post/<id>` scheme.
    """
    try:
        # Anyone can fetch this page (crawlers, logged-out friends), so it
        # serves only what everyone may see: public posts that are still up.
        post = get_object_or_404(
            SocialPost.objects.select_related('user').filter(
                is_removed=False, visibility=SocialPost.VISIBILITY_PUBLIC,
                user__is_deactivated=False),
            id=post_id)
    except Exception:
        return HttpResponseNotFound('Post not found')

    username = post.user.username if post.user else 'Someone'
    caption = (post.caption or '').strip()
    title = f"{username} on Adventist Life"
    description = caption or f"See {username}'s post on Adventist Life."
    # Branded fallback: an env override if set, else the bundled image we serve
    # ourselves (absolute URL so crawlers can fetch it).
    fallback = getattr(settings, 'SHARE_FALLBACK_IMAGE', '') or request.build_absolute_uri('/share-og.png')
    image = _share_image(post, fallback)
    deep_link = f"streams://post/{post.id}"
    is_video = post.content_type == 'video'

    video_tags = ''
    if is_video:
        video_url = media.resolve(post.media_file)
        if video_url:
            video_tags = (
                f'\n<meta property="og:video" content="{_esc(video_url)}">'
                f'\n<meta property="og:video:secure_url" content="{_esc(video_url)}">'
                f'\n<meta property="og:video:type" content="video/mp4">'
            )

    img_block = f'<img src="{_esc(image)}" alt="">' if image else ''
    play_block = (
        '<div class="play"><span><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/>'
        '</svg></span></div>' if is_video else ''
    )
    caption_block = f'\n      <p class="caption">{_esc(caption)}</p>' if caption else ''

    # "Don't have the app? Get it here" — shown to anyone whose device didn't
    # hand off to the app. Only the configured stores appear.
    store_links = ''
    play_url = getattr(settings, 'APP_PLAY_STORE_URL', '')
    ios_url = getattr(settings, 'APP_STORE_URL', '')
    if play_url:
        store_links += (
            f'<a class="store" href="{_esc(play_url)}">'
            '<svg viewBox="0 0 24 24"><path d="M3 3.5v17l9.5-8.5L3 3.5zm11.2 7.1l2.6-2.3 3.7 2.1c.9.5.9 1.7 0 2.2l-3.7 2.1-2.6-2.3 0-1.9zM5 2.9l9.1 5.1-2.1 1.9L5 2.9zm0 18.2l7-6.9 2.1 1.9L5 21.1z"/></svg>'
            'Google Play</a>'
        )
    if ios_url:
        store_links += (
            f'<a class="store" href="{_esc(ios_url)}">'
            '<svg viewBox="0 0 24 24"><path d="M16.4 12.9c0-2 1.6-3 1.7-3-.9-1.4-2.4-1.6-2.9-1.6-1.2-.1-2.4.7-3 .7-.6 0-1.6-.7-2.6-.7-1.3 0-2.6.8-3.3 2-1.4 2.4-.4 6 1 8 .7 1 1.4 2.1 2.5 2 1-.1 1.4-.6 2.6-.6 1.2 0 1.6.6 2.6.6 1.1 0 1.8-1 2.5-2 .8-1.1 1.1-2.2 1.1-2.3-.1 0-2.2-.8-2.2-3.2zM14.6 6.5c.5-.7.9-1.6.8-2.5-.8 0-1.8.5-2.4 1.2-.5.6-1 1.5-.8 2.4.9.1 1.8-.4 2.4-1.1z"/></svg>'
            'App Store</a>'
        )
    store_block = (
        '\n      <div class="stores"><p class="get">Don\'t have the app? Get it here:</p>'
        f'<div class="store-row">{store_links}</div></div>'
        if store_links else ''
    )

    html = (
        _SHARE_PAGE
        .replace('__OGTYPE__', 'video.other' if is_video else 'article')
        .replace('__VIDEO_TAGS__', video_tags)
        .replace('__IMG_BLOCK__', img_block)
        .replace('__PLAY_BLOCK__', play_block)
        .replace('__CAPTION_BLOCK__', caption_block)
        .replace('__STORE_BLOCK__', store_block)
        .replace('__USER__', _esc(username))
        .replace('__TITLE__', _esc(title))
        .replace('__DESC__', _esc(description[:200]))
        .replace('__IMAGE__', _esc(image))
        .replace('__URL__', _esc(request.build_absolute_uri()))
        .replace('__DEEP__', _esc(deep_link))
    )

    resp = HttpResponse(html)
    resp['Cache-Control'] = 'public, max-age=300'
    return resp

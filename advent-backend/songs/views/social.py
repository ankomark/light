from .common import *  # noqa: F401,F403
import base64
from django.http import HttpResponse, Http404
from django.db.models import Exists, OuterRef, Q, Subquery, IntegerField, F
from django.conf import settings
from django.core.cache import cache


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
        .select_related('user__profile', 'song', 'song__artist', 'song__artist__profile')
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
        qs = feed_post_queryset(user).order_by('-created_at')

        # Hide posts from anyone the user has blocked (or who blocked them).
        hidden_ids = blocked_ids_for(user)
        if hidden_ids:
            qs = qs.exclude(user_id__in=hidden_ids)

        # Hide posts from self-deactivated accounts.
        qs = qs.exclude(user__is_deactivated=True)

        tag = self.request.query_params.get('tag')
        if tag:
            qs = qs.filter(tags__icontains=tag)

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
    

    def perform_create(self, serializer):
        try:
            # Create the post with the authenticated user
            logger.info(f"Creating post with data: {serializer.validated_data}")
            post = serializer.save(user=self.request.user)
            if post.media_file:
                logger.info(f"Created post ID {post.id} with media_file: {post.media_file}")
                logger.info(f"Media type: {post.content_type}, Size: {post.width}x{post.height}")
            # Invalidate the author's cached feed so their new post shows at once.
            _bump_feed_version(self.request.user.id)
            return post

        except ValidationError as ve:
            logger.warning(f"Validation error: {ve}")
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
        """Increment view count — idempotent, fire-and-forget."""
        SocialPost.objects.filter(pk=pk).update(view_count=models.F('view_count') + 1)
        return Response({'status': 'ok'})

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
        allowed_fields = ['caption', 'tags', 'location']
        filtered_data = {k: v for k, v in request.data.items() if k in allowed_fields}
        
        serializer = self.get_serializer(instance, data=filtered_data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        
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

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def like(self, request, pk=None):
        post = self.get_object()
        user = request.user
        
        # Check if like exists
        like_exists = PostLike.objects.filter(post=post, user=user).exists()
        
        if like_exists:
            # Unlike the post
            PostLike.objects.filter(post=post, user=user).delete()
            liked = False
        else:
            # Like the post
            PostLike.objects.create(post=post, user=user)
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
        
        # Get updated like count
        likes_count = PostLike.objects.filter(post=post).count()
        
        return Response({
            'status': 'success',
            'likes_count': likes_count,
            'is_liked': liked
        }, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated])
    def comment(self, request, pk=None):
        post = self.get_object()
        serializer = PostCommentSerializer(data=request.data, context={'request': request})
        
        if serializer.is_valid():
            comment = serializer.save(user=request.user, post=post)
            
            # Create notification if commenter is not the post owner
            if request.user != post.user:
                msg = f"{request.user.username} commented on your post"
                Notification.objects.create(
                    recipient=post.user,
                    sender=request.user,
                    message=msg,
                    notification_type='comment',
                    post=post
                )
                notify_user(post.user, 'comment', msg)

            return Response(serializer.data, status=status.HTTP_201_CREATED)
        
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

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



class PostCommentViewSet(viewsets.ModelViewSet):
    queryset = PostComment.objects.all()
    serializer_class = PostCommentSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly, IsNotSuspended]
    pagination_class = StandardPagination

    def get_queryset(self):
        # select_related pulls each comment's author (+ profile for the avatar)
        # in the same query, so a page of comments is a couple of queries instead
        # of one-per-row. Ordering/index come from PostComment.Meta.
        qs = PostComment.objects.select_related('user', 'user__profile').filter(is_removed=False)
        post_id = self.kwargs.get('post_pk')
        if post_id:
            qs = qs.filter(post__id=post_id)
        return qs

    def perform_create(self, serializer):
        post_id = self.kwargs.get('post_pk')
        try:
            post = SocialPost.objects.get(id=post_id)
        except SocialPost.DoesNotExist:
            raise ValidationError({"error": "Post not found"})
        comment = serializer.save(user=self.request.user, post=post)
        # Create notification only if comment author is not the post owner
        if comment.user != post.user:
            msg = f"{self.request.user.username} commented on your post"
            Notification.objects.create(
                recipient=post.user,
                sender=self.request.user,
                message=msg,
                notification_type='comment',
                post=post
            )
            notify_user(post.user, 'comment', msg)



class PostSaveViewSet(viewsets.ModelViewSet):
    queryset = PostSave.objects.all()
    serializer_class = PostSaveSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return self.queryset.filter(user=self.request.user)



class StoryViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated, IsOwnerOrReadOnly]
    serializer_class = StorySerializer
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    def get_queryset(self):
        return Story.objects.filter(
            expires_at__gt=timezone.now(), is_removed=False
        ).select_related('user__profile').prefetch_related('views')

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

        stories = Story.objects.filter(
            user_id__in=following_ids,
            expires_at__gt=timezone.now(),
            is_removed=False,
        ).select_related('user__profile').prefetch_related('views').order_by('user_id', '-created_at')

        # Group by user
        grouped = {}
        for story in stories:
            uid = story.user_id
            if uid not in grouped:
                grouped[uid] = {'user': story.user, 'stories': [], 'has_unviewed': False}
            grouped[uid]['stories'].append(story)
            if not story.views.filter(viewer=request.user).exists():
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

        valid_types = {'post', 'user', 'track', 'comment', 'group'}
        if content_type not in valid_types:
            return Response({'error': f'content_type must be one of {list(valid_types)}'}, status=status.HTTP_400_BAD_REQUEST)
        if not object_id:
            return Response({'error': 'object_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        if not reason:
            return Response({'error': 'reason is required'}, status=status.HTTP_400_BAD_REQUEST)

        _, created = Report.objects.get_or_create(
            reporter=request.user,
            content_type=content_type,
            object_id=object_id,
            defaults={'reason': reason, 'description': description},
        )
        if not created:
            return Response({'message': 'Already reported'})
        return Response({'message': 'Content reported successfully'}, status=status.HTTP_201_CREATED)



class ExploreViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=['get'])
    def trending_posts(self, request):
        """Top photos/videos from the last 7 days, ranked by a weighted score of
        likes + comments + views (all denormalised columns — no aggregation, no
        N+1). Cached briefly per user (the ranking is global; the per-user
        liked/saved state rides along and is at most TTL seconds stale)."""
        cache_key = f'explore:trending:{request.user.id}'
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        week_ago = timezone.now() - timedelta(days=7)
        posts = (
            feed_post_queryset(request.user)
            .filter(created_at__gte=week_ago)
            .annotate(trend_score=F('likes_count') * 10 + F('comments_count') * 6 + F('view_count'))
            .order_by('-trend_score', '-created_at')[:30]
        )
        data = SocialPostSerializer(posts, many=True, context={'request': request}).data
        cache.set(cache_key, data, 120)
        return Response(data)

    @action(detail=False, methods=['get'])
    def suggested_users(self, request):
        cache_key = f'explore:suggested:{request.user.id}'
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        following_ids = list(request.user.followed_by.values_list('id', flat=True))
        users = User.objects.exclude(
            id=request.user.id
        ).exclude(
            id__in=following_ids
        ).annotate(
            followers_count=Count('followers', distinct=True)
        ).select_related('profile').order_by('-followers_count')[:12]
        data = SimpleUserSerializer(users, many=True, context={'request': request}).data
        cache.set(cache_key, data, 300)
        return Response(data)

    @action(detail=False, methods=['get'])
    def trending_hashtags(self, request):
        """Return the most-used hashtags in the last 7 days."""
        week_ago = timezone.now() - timedelta(days=7)
        posts_with_tags = SocialPost.objects.filter(
            created_at__gte=week_ago, tags__gt='', is_removed=False
        ).values_list('tags', flat=True)

        counts = {}
        for tag_str in posts_with_tags:
            for tag in tag_str.split():
                tag = tag.strip().lower()
                if tag:
                    counts[tag] = counts.get(tag, 0) + 1

        top = sorted(counts.items(), key=lambda x: x[1], reverse=True)[:20]
        return Response([{'tag': t, 'count': c} for t, c in top])

    @action(detail=False, methods=['get'])
    def search(self, request):
        query = request.query_params.get('q', '').strip()
        if len(query) < 2:
            return Response({'users': [], 'posts': [], 'tracks': [], 'groups': []})
        users = User.objects.filter(
            Q(username__icontains=query) | Q(profile__bio__icontains=query)
        ).select_related('profile').distinct()[:10]
        posts = feed_post_queryset(request.user).filter(
            Q(caption__icontains=query) | Q(location__icontains=query)
        ).order_by('-created_at')[:20]
        tracks = Track.objects.filter(
            Q(title__icontains=query) | Q(album__icontains=query), is_removed=False
        ).select_related('artist').order_by('-created_at')[:10]
        # Never surface private groups the caller isn't part of — their very
        # existence must stay hidden from non-members.
        groups = Group.objects.filter(
            Q(name__icontains=query) | Q(description__icontains=query)
        ).filter(
            Q(is_private=False) | Q(creator=request.user) | Q(members__user=request.user)
        ).filter(is_removed=False).distinct().order_by('-created_at')[:10]
        return Response({
            'users': SimpleUserSerializer(users, many=True, context={'request': request}).data,
            'posts': SocialPostSerializer(posts, many=True, context={'request': request}).data,
            'tracks': TrackSerializer(tracks, many=True, context={'request': request}).data,
            'groups': GroupSerializer(groups, many=True, context={'request': request}).data,
        })


class PublicationViewSet(viewsets.ModelViewSet):
    """Long-form articles/books. Published items are public; drafts are visible
    only to their author. Only the author can edit/delete."""
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    pagination_class = StandardPagination

    def get_serializer_class(self):
        if self.action == 'list':
            return PublicationListSerializer
        return PublicationDetailSerializer

    def get_queryset(self):
        user = self.request.user
        qs = (
            Publication.objects
            .select_related('author', 'author__profile')
            .prefetch_related('chapters')
            .annotate(
                chapter_count_anno=Count('chapters', distinct=True),
                likes_total=Count('likes', distinct=True),
            )
        )
        if user.is_authenticated:
            qs = qs.annotate(
                liked_by_me=Exists(PublicationLike.objects.filter(publication=OuterRef('pk'), user=user)),
                bookmarked_by_me=Exists(PublicationBookmark.objects.filter(publication=OuterRef('pk'), user=user)),
            )

        if self.request.query_params.get('mine') and user.is_authenticated:
            qs = qs.filter(author=user)
        elif user.is_authenticated:
            # Everyone sees published; authors also see their own drafts.
            qs = qs.filter(Q(status='published') | Q(author=user))
        else:
            qs = qs.filter(status='published')

        if self.request.query_params.get('saved') and user.is_authenticated:
            qs = qs.filter(bookmarks__user=user)

        author_id = self.request.query_params.get('author')
        if author_id:
            qs = qs.filter(author_id=author_id)

        category = self.request.query_params.get('category')
        if category and category != 'all':
            qs = qs.filter(category=category)

        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(Q(title__icontains=search) | Q(summary__icontains=search))

        return qs.order_by('-created_at')

    def perform_create(self, serializer):
        serializer.save(author=self.request.user)

    @action(detail=True, methods=['get'], permission_classes=[permissions.AllowAny])
    def cover(self, request, pk=None):
        """Stream the stored base64 cover as a real, cacheable image so the list
        doesn't have to ship the blob inline."""
        pub = get_object_or_404(Publication, pk=pk)
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
        ReadingProgress.objects.update_or_create(
            publication=pub, user=request.user, defaults={'last_chapter': max(0, chapter)}
        )
        return Response({'last_read_chapter': max(0, chapter)})

    def update(self, request, *args, **kwargs):
        if self.get_object().author_id != request.user.id:
            return Response({"error": "You can only edit your own publications."},
                            status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.author_id != request.user.id:
            return Response({"error": "You can only delete your own publications."},
                            status=status.HTTP_403_FORBIDDEN)
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['get'])
    def mine(self, request):
        qs = self.filter_queryset(
            Publication.objects.filter(author=request.user)
            .select_related('author', 'author__profile')
            .annotate(chapter_count_anno=Count('chapters', distinct=True))
            .order_by('-created_at')
        )
        page = self.paginate_queryset(qs)
        ser = PublicationListSerializer(page if page is not None else qs, many=True,
                                        context=self.get_serializer_context())
        return self.get_paginated_response(ser.data) if page is not None else Response(ser.data)


# --- Public share / link-preview page -----------------------------------------
import re as _re
from django.conf import settings as _settings
from django.http import HttpResponse, HttpResponseNotFound
from django.shortcuts import get_object_or_404
from django.utils.html import escape as _esc


def _share_image(post):
    """og:image for the link-preview card. Images use the stored URL directly.
    Videos have no server-side thumbnail yet (R2 stores bytes verbatim) —
    they'll get a poster once client-side thumbnails land."""
    if post.content_type == 'image':
        return media.resolve(post.media_file) or ''
    return ''


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
  .brand { text-align:center; color:#6C757D; font-size:12px; margin-top:14px; letter-spacing:1px; }
</style>
</head>
<body>
  <div class="card">
    <div class="media">__IMG_BLOCK____PLAY_BLOCK__</div>
    <div class="body">
      <p class="user">__USER__</p>__CAPTION_BLOCK__
      <a class="btn" href="__DEEP__">Open in Adventist Life</a>
      <p class="brand">ADVENTIST LIFE</p>
    </div>
  </div>
  <script>
    // Hand off to the app immediately; if it isn't installed, this page (with
    // its thumbnail + button) stays as the fallback.
    (function(){ try { window.location.href = "__DEEP__"; } catch (e) {} })();
  </script>
</body>
</html>"""


def post_share_page(request, post_id):
    """Public, crawler-friendly preview page for a single post.

    Serves Open Graph/Twitter tags (so shared links render a rich card with a
    thumbnail) and deep-links into the app via the `streams://post/<id>` scheme.
    """
    try:
        post = get_object_or_404(SocialPost.objects.select_related('user'), id=post_id)
    except Exception:
        return HttpResponseNotFound('Post not found')

    username = post.user.username if post.user else 'Someone'
    caption = (post.caption or '').strip()
    title = f"{username} on Adventist Life"
    description = caption or f"See {username}'s post on Adventist Life."
    image = _share_image(post)
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

    html = (
        _SHARE_PAGE
        .replace('__OGTYPE__', 'video.other' if is_video else 'article')
        .replace('__VIDEO_TAGS__', video_tags)
        .replace('__IMG_BLOCK__', img_block)
        .replace('__PLAY_BLOCK__', play_block)
        .replace('__CAPTION_BLOCK__', caption_block)
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

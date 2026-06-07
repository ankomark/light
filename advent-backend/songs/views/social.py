from .common import *  # noqa: F401,F403
from django.db.models import Exists, OuterRef, Q, Subquery, IntegerField


class SocialPostViewSet(viewsets.ModelViewSet):
    pagination_class = StandardPagination
    queryset = SocialPost.objects.all()
    serializer_class = SocialPostSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly]
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

        # Author follower count as a correlated subquery (computed in the main
        # query — no per-post COUNT). Injected into the user payload by
        # SocialPostSerializer.to_representation.
        author_followers = (
            User.objects.filter(pk=OuterRef('user_id'))
            .annotate(n=Count('followers'))
            .values('n')[:1]
        )
        qs = (
            SocialPost.objects
            .select_related('user__profile', 'song', 'song__artist', 'song__artist__profile')
            .annotate(
                likes_total=Count('likes', distinct=True),
                comments_total=Count('comments', distinct=True),
                author_followers_count=Subquery(author_followers, output_field=IntegerField()),
            )
            .order_by('-created_at')
        )

        if user.is_authenticated:
            qs = qs.annotate(
                liked_by_me=Exists(PostLike.objects.filter(post=OuterRef('pk'), user=user)),
                saved_by_me=Exists(PostSave.objects.filter(post=OuterRef('pk'), user=user)),
            )

        tag = self.request.query_params.get('tag')
        if tag:
            qs = qs.filter(tags__icontains=tag)

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
        
        try:
            # Delete from Cloudinary if media exists
            if instance.media_file:
                # Get public_id from either CloudinaryResource or string
                public_id = (
                    instance.media_file.public_id 
                    if hasattr(instance.media_file, 'public_id') 
                    else str(instance.media_file))
                
                # If it's a URL, extract just the public_id
                if 'res.cloudinary.com' in public_id:
                    path = urlparse(public_id).path
                    parts = path.split('/')
                    try:
                        upload_index = parts.index('upload') + 1
                        public_id = '/'.join(parts[upload_index:])
                        public_id = public_id.split('.')[0]  # Remove extension
                    except ValueError:
                        pass
                
                # Determine resource type from content_type
                resource_type = 'video' if instance.content_type == 'video' else 'image'
                
                try:
                    destroy(public_id, resource_type=resource_type)
                    logger.info(f"Deleted Cloudinary {resource_type}: {public_id}")
                except Exception as e:
                    logger.error(f"Cloudinary deletion failed: {str(e)}")
                    # Continue with DB deletion even if Cloudinary fails
        
        except Exception as e:
            logger.error(f"Error during post deletion: {str(e)}", exc_info=True)
        
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    # Keep all your existing methods but add this optimization:
    def list(self, request, *args, **kwargs):
        # Add pagination and field selection
        page = self.paginate_queryset(self.get_queryset())
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        
        serializer = self.get_serializer(self.get_queryset(), many=True)
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
            'media_url': post.media_file.url if hasattr(post.media_file, 'url') else str(post.media_file)
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
                
                # Upload to Cloudinary
                result = upload(
                    media_file,
                    folder='social_media',
                    resource_type='auto',
                    # transformation=[
                    #     {'quality': 'auto'},
                    #     {'fetch_format': 'auto'}
                    # ]
                )
                
                # Create post with Cloudinary public_id
                post_data = {
                    'content_type': content_type,
                    'media_file': result['public_id'],
                    'caption': serializer.validated_data.get('caption', ''),
                    'tags': serializer.validated_data.get('tags', ''),
                    'location': serializer.validated_data.get('location', ''),
                    'duration': serializer.validated_data.get('duration', None),
                    'width': result.get('width'),
                    'height': result.get('height'),
                }
                
                post_serializer = SocialPostSerializer(data=post_data, context={'request': request})
                if post_serializer.is_valid():
                    post = post_serializer.save(user=request.user)
                    return Response(post_serializer.data, status=status.HTTP_201_CREATED)
                return Response(post_serializer.errors, status=status.HTTP_400_BAD_REQUEST)
                
            except CloudinaryError as e:
                return Response(
                    {'error': str(e)},
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
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly]
    pagination_class = StandardPagination

    def get_queryset(self):
        post_id = self.kwargs.get('post_pk')
        if post_id:
            return PostComment.objects.filter(post__id=post_id)
        return super().get_queryset()

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
            expires_at__gt=timezone.now()
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
        week_ago = timezone.now() - timedelta(days=7)
        posts = SocialPost.objects.annotate(
            engagement=Count('likes', distinct=True) + Count('comments', distinct=True)
        ).filter(
            created_at__gte=week_ago
        ).select_related('user').order_by('-engagement')[:30]
        serializer = SocialPostSerializer(posts, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def suggested_users(self, request):
        following_ids = list(request.user.followed_by.values_list('id', flat=True))
        users = User.objects.exclude(
            id=request.user.id
        ).exclude(
            id__in=following_ids
        ).annotate(
            followers_count=Count('followers', distinct=True)
        ).select_related('profile').order_by('-followers_count')[:12]
        serializer = SimpleUserSerializer(users, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def trending_hashtags(self, request):
        """Return the most-used hashtags in the last 7 days."""
        week_ago = timezone.now() - timedelta(days=7)
        posts_with_tags = SocialPost.objects.filter(
            created_at__gte=week_ago, tags__gt=''
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
        posts = SocialPost.objects.filter(
            Q(caption__icontains=query) | Q(location__icontains=query)
        ).select_related('user').order_by('-created_at')[:20]
        tracks = Track.objects.filter(
            Q(title__icontains=query) | Q(album__icontains=query)
        ).select_related('artist').order_by('-created_at')[:10]
        groups = Group.objects.filter(
            Q(name__icontains=query) | Q(description__icontains=query)
        ).order_by('-created_at')[:10]
        return Response({
            'users': SimpleUserSerializer(users, many=True, context={'request': request}).data,
            'posts': SocialPostSerializer(posts, many=True, context={'request': request}).data,
            'tracks': TrackSerializer(tracks, many=True, context={'request': request}).data,
            'groups': GroupSerializer(groups, many=True, context={'request': request}).data,
        })


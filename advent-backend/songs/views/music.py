from .common import *  # noqa: F401,F403


class CloudinarySignView(APIView):
    permission_classes = [IsAuthenticated]

    FOLDER_MAP = {
        'audio': 'audio_uploads',
        'image': 'social_media/images',
        'video': 'social_media/videos',
        'profile': 'profile_images',
        'cover': 'cover_images',
        'avatar': 'avatars',
    }

    def post(self, request):
        upload_type = request.data.get('type', 'image')
        folder = self.FOLDER_MAP.get(upload_type, 'uploads')
        timestamp = int(time_module.time())
        params_to_sign = {'timestamp': timestamp, 'folder': folder}
        api_secret = cloudinary.config().api_secret
        if not api_secret:
            return Response({'error': 'Cloudinary not configured'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        signature = cloudinary_sign_request(params_to_sign, api_secret)
        return Response({
            'signature': signature,
            'timestamp': timestamp,
            'api_key': cloudinary.config().api_key,
            'cloud_name': cloudinary.config().cloud_name,
            'folder': folder,
        })



class AvatarUploadView(APIView):
    parser_classes = [MultiPartParser]
    permission_classes = [permissions.IsAuthenticated]

    def put(self, request):
        """Alternative endpoint for avatar uploads"""
        if not hasattr(request.user, 'profile'):
            return Response(
                {'error': 'Profile does not exist'},
                status=status.HTTP_400_BAD_REQUEST
            )
            
        serializer = AvatarUploadSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        try:
            result = upload(
                serializer.validated_data['avatar'],
                folder='profile_pictures',
                resource_type='image',
                transformation=[
                    {'width': 300, 'height': 300, 'crop': 'thumb', 'gravity': 'face'},
                    {'quality': 'auto'}
                ]
            )
            
            # Update profile with new picture data
            profile = request.user.profile
            profile.picture = {
                'public_id': result['public_id'],
                'secure_url': result['secure_url']
            }
            profile.save()
            
            return Response(
                ProfileSerializer(profile, context={'request': request}).data,
                status=status.HTTP_200_OK
            )
        except Exception as e:
            logger.error(f"Avatar upload failed: {str(e)}")
            return Response(
                {'error': 'Failed to process image upload'},
                status=status.HTTP_400_BAD_REQUEST
            )



class TrackUploadView(APIView):
    parser_classes = [MultiPartParser]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = TrackUploadSerializer(data=request.data)
        if serializer.is_valid():
            try:
                # Upload audio file
                audio_result = upload(
                    serializer.validated_data['audio_file'],
                    folder='audio',
                    resource_type='video',
                    format='mp3'
                )
                
                # Upload cover image if provided
                cover_result = None
                if 'cover_image' in serializer.validated_data:
                    cover_result = upload(
                        serializer.validated_data['cover_image'],
                        folder='covers',
                        resource_type='image'
                    )
                
                # Create track
                track_data = {
                    'title': request.data.get('title', 'Untitled Track'),
                    'artist': request.user.id,
                    'audio_file': audio_result['public_id'],
                    'cover_image': cover_result['public_id'] if cover_result else None,
                    'album': request.data.get('album', ''),
                    'lyrics': request.data.get('lyrics', '')
                }
                
                track_serializer = TrackSerializer(data=track_data, context={'request': request})
                if track_serializer.is_valid():
                    track = track_serializer.save()
                    return Response(track_serializer.data, status=status.HTTP_201_CREATED)
                return Response(track_serializer.errors, status=status.HTTP_400_BAD_REQUEST)
                
            except CloudinaryError as e:
                return Response(
                    {'error': str(e)},
                    status=status.HTTP_400_BAD_REQUEST
                )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)



class TrackViewSet(viewsets.ModelViewSet):
    queryset = Track.objects.all().order_by('-created_at')
    serializer_class = TrackSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination


    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.artist != request.user:
            return Response(
                {"error": "You can only edit your own tracks"},
                status=status.HTTP_403_FORBIDDEN
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.artist != request.user:
            return Response(
                {"error": "You can only delete your own tracks"},
                status=status.HTTP_403_FORBIDDEN
            )
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def perform_create(self, serializer):
        title = serializer.validated_data.get('title')
        slug = slugify(title)
        base_slug = slug
        counter = 1
        while Track.objects.filter(slug=slug).exists():
            slug = f"{base_slug}-{counter}"
            counter += 1
        serializer.save(artist=self.request.user, slug=slug)

    @action(detail=False, methods=['post'], url_path='upload')
    def upload_track(self, request):
        serializer = self.get_serializer(data=request.data)
        if serializer.is_valid():
            serializer.save(artist=request.user)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)




    
    @action(detail=True, methods=['post'])
    def like(self, request, pk=None):
        track = self.get_object()
        user = request.user
        # Check if the user has already liked the track
        if Like.objects.filter(user=user, track=track).exists():
          return Response({"error": "You have already liked this track."}, status=400)

        Like.objects.create(user=user, track=track)
    # Return the updated like count
        likes_count = Like.objects.filter(track=track).count()
        return Response({"status": "Track liked", "likes_count": likes_count})



    @action(detail=True, methods=['post'], url_path='toggle-like')
    def toggle_like(self, request, pk=None):
        track = self.get_object()
        user = request.user

        existing_like = Like.objects.filter(user=user, track=track).first()
        if existing_like:
            existing_like.delete()
            likes_count = track.likes.count()
            return Response({
                "status": "Track unliked",
                "likes_count": likes_count,
                "is_liked": False
            })
        Like.objects.create(user=user, track=track)
        likes_count = track.likes.count()
        msg = f"{user.username} liked your track {track.title}"
        Notification.objects.create(
            recipient=track.artist,
            sender=user,
            message=msg,
            notification_type='like',
            track=track
        )
        notify_user(track.artist, 'like', msg)
        return Response({
            "status": "Track liked",
            "likes_count": likes_count,
            "is_liked": True
        })
    
  
    @action(detail=True, methods=['get'])
    def download(self, request, pk=None):
        track = self.get_object()
        if not track.audio_file:
            return Response({'error': 'Audio file not found'}, status=404)
        return Response({
            'download_url': CloudinaryFieldSerializer().to_representation(track.audio_file)
        })
    @action(detail=True, methods=['post'])
    def favorites(self, request):
   
        user = request.user
        if not user.is_authenticated:
            return Response({'detail': 'Authentication required'}, status=401)

        favorite_tracks = user.favorite_tracks.all()
        serializer = self.get_serializer(favorite_tracks, many=True)
        return Response(serializer.data)
    @action(detail=True, methods=['post'], url_path='toggle-favorite')
    def toggle_favorite(self, request, pk=None):
        track = self.get_object()
        user = request.user

        existing_like = Like.objects.filter(user=user, track=track).first()
        if existing_like:
            existing_like.delete()
            return Response({"status": "Track unfavorited"}, status=status.HTTP_200_OK)
        
        Like.objects.create(user=user, track=track)
        return Response({"status": "Track favorited"}, status=status.HTTP_200_OK)


    @action(detail=False, methods=['get'], url_path='favorites')
    def get_favorites(self, request):
        user = request.user
        favorites = Track.objects.filter(likes__user=user)
        serializer = TrackSerializer(favorites, many=True, context={"request": request})
        return Response(serializer.data)



class PlaylistViewSet(viewsets.ModelViewSet):
    queryset = Playlist.objects.all()
    serializer_class = PlaylistSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly]

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)



class CommentViewSet(viewsets.ModelViewSet):
    queryset = Comment.objects.all()
    serializer_class = CommentSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly]
    pagination_class = StandardPagination

    def get_queryset(self):
        track_id = self.kwargs.get('track_pk')
        if track_id:
            return Comment.objects.filter(track_id=track_id)
        return Comment.objects.all()

    def perform_create(self, serializer):
        track_id = self.kwargs.get('track_pk')
        track = get_object_or_404(Track, id=track_id)
        serializer.save(user=self.request.user, track=track)
        comment = serializer.save(user=self.request.user, track=track)  # <-- This line was missing

        if comment.user != track.artist:
            msg = f"{self.request.user.username} commented on your track {track.title}"
            Notification.objects.create(
                recipient=track.artist,
                sender=self.request.user,
                message=msg,
                notification_type='comment',
                track=track
            )
            notify_user(track.artist, 'comment', msg)



class LikeViewSet(viewsets.ModelViewSet):
    queryset = Like.objects.all()
    serializer_class = LikeSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return self.queryset.filter(user=self.request.user)



class CategoryViewSet(viewsets.ModelViewSet):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]



class FavoriteTracksView(APIView):
    permission_classes = [IsAuthenticated]  # Ensure authentication is enforced

    def get(self, request):
        user = request.user
        favorite_tracks = Track.objects.filter(likes__user=user)  # Query for the user's favorites
        serializer = TrackSerializer(favorite_tracks, many=True, context={"request": request})
        return Response(serializer.data, status=200)


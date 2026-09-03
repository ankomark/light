from .common import *  # noqa: F401,F403
import base64
from django.http import HttpResponse
from django.utils import timezone





class MediaStationViewSet(viewsets.ModelViewSet):
    queryset = MediaStation.objects.all()
    serializer_class = MediaStationSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    pagination_class = StandardPagination

    def get_queryset(self):
        qs = MediaStation.objects.filter(is_removed=False)
        station_type = self.request.query_params.get('type')
        if station_type in ('TV', 'Radio', 'Podcast'):
            qs = qs.filter(type=station_type)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.created_by_id != request.user.id:
            return Response(
                {"error": "You can only edit stations you created."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.created_by_id != request.user.id:
            return Response(
                {"error": "You can only delete stations you created."},
                status=status.HTTP_403_FORBIDDEN,
            )
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class NoticeViewSet(viewsets.ModelViewSet):
    """Notice board: anyone signed in can read; only staff/admins can post.
    Admin-role gating is interim (User.is_staff) and will be expanded later."""
    # Pinned notices float to the top, then newest-first — this is what makes the
    # admin "Pin to top" toggle actually reorder the board. select_related the
    # author so the list doesn't fire a query per row for created_by.username.
    queryset = (
        Notice.objects.select_related('created_by')
        .order_by('-is_pinned', '-created_at')
    )
    serializer_class = NoticeSerializer
    pagination_class = StandardPagination

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAdminUser()]
        return [permissions.IsAuthenticated()]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class AdminNoteViewSet(viewsets.ModelViewSet):
    """Private notes from users to admins. Any signed-in user may submit one,
    but only staff/admins can list, read, mark-read (partial_update) or delete.
    Admin gating is interim (User.is_staff) and will be expanded later."""
    serializer_class = AdminNoteSerializer
    pagination_class = StandardPagination

    def get_queryset(self):
        # Newest note first so the admin inbox reads top-to-bottom by recency.
        return AdminNote.objects.select_related('sender').order_by('-created_at')

    def get_permissions(self):
        if self.action == 'create':
            return [permissions.IsAuthenticated()]
        return [permissions.IsAdminUser()]

    def perform_create(self, serializer):
        # Force is_read=False on create so a sender can't submit a pre-read note;
        # only admins flip it later via update/partial_update.
        serializer.save(sender=self.request.user, is_read=False)


class VideoStudioViewSet(viewsets.ModelViewSet):
    # select_related avoids an N+1 on created_by (+ its profile) during listing.
    queryset = Videostudio.objects.filter(is_removed=False).select_related('created_by', 'created_by__profile').order_by('-created_at')
    serializer_class = VideoStudioSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    pagination_class = StandardPagination

    def get_serializer_class(self):
        # The list ships image URLs (small); detail/create/update keep base64.
        if self.action == 'list':
            return VideoStudioListSerializer
        return VideoStudioSerializer

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def get_queryset(self):
        qs = super().get_queryset()
        # ?category=hotel narrows the Services directory to one bucket; omitted
        # returns every category.
        category = self.request.query_params.get('category')
        if category:
            qs = qs.filter(category=category)
        user_id = self.request.query_params.get('user_id')
        if user_id:
            qs = qs.filter(created_by=user_id)
        return qs

    # ── Image serving: stream the stored base64 as a real, cacheable image ────
    def _serve_data_uri(self, data_uri):
        if not data_uri or ',' not in data_uri:
            raise Http404('No image.')
        header, _, payload = data_uri.partition(',')
        mime = header[5:].split(';')[0] if header.startswith('data:') else ''
        try:
            raw = base64.b64decode(payload)
        except Exception:
            raise Http404('Bad image data.')
        resp = HttpResponse(raw, content_type=mime or 'image/jpeg')
        resp['Cache-Control'] = 'public, max-age=31536000, immutable'  # URLs are version-busted
        return resp

    @action(detail=True, methods=['get'], permission_classes=[permissions.AllowAny])
    def logo(self, request, pk=None):
        return self._serve_data_uri(self.get_object().logo)

    @action(detail=True, methods=['get'], permission_classes=[permissions.AllowAny])
    def cover(self, request, pk=None):
        return self._serve_data_uri(self.get_object().cover_image)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.created_by != request.user:
            return Response(
                {"error": "You can only edit video studios you created"},
                status=status.HTTP_403_FORBIDDEN
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.created_by != request.user:
            return Response(
                {"error": "You can only delete video studios you created"},
                status=status.HTTP_403_FORBIDDEN
            )
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['get'])
    def my_videostudios(self, request):
        studios = Videostudio.objects.filter(created_by=request.user)
        serializer = self.get_serializer(studios, many=True)
        return Response(serializer.data)



class LiveEventViewSet(viewsets.ModelViewSet):
    queryset = LiveEvent.objects.all().order_by('-start_time')
    serializer_class = LiveEventSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    
    def get_queryset(self):
        queryset = super().get_queryset()
        
        # Active events filter - MOST IMPORTANT FIX
        if self.request.query_params.get('is_active', '').lower() == 'true':
            twenty_four_hours_ago = timezone.now() - timedelta(hours=24)
            queryset = queryset.filter(
                Q(is_live=True) |
                Q(end_time__gte=twenty_four_hours_ago) |  # Changed from start_time
                Q(end_time__isnull=True, start_time__gte=twenty_four_hours_ago)
            )
        
        return queryset.select_related('user')
    
    def create(self, request, *args, **kwargs):
        """Enhanced create with comprehensive logging"""
        logger.info(f"Creating live event with data: {request.data}")
        
        try:
            # Validate input
            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            
            # Check for existing active events
            active_events = LiveEvent.objects.filter(
                user=request.user,
                is_live=True
            ).count()
            
            logger.info(f"User {request.user.id} has {active_events} active events")
            
            if active_events > 0:
                logger.warning("User already has an active live event")
                return Response(
                    {"error": "You already have an active live event"},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Extract YouTube ID
            youtube_url = serializer.validated_data['youtube_url']
            video_id = LiveEvent.extract_youtube_id(youtube_url)
            
            if not video_id:
                logger.error(f"Invalid YouTube URL: {youtube_url}")
                raise serializers.ValidationError({
                    'youtube_url': 'Invalid YouTube URL format'
                })
            
            # Create the event
            logger.info("Creating new live event")
            self.perform_create(serializer)
            instance = serializer.instance
            
            # Ensure we have the saved instance
            if not instance.id:
                logger.warning("Instance not saved, trying to retrieve")
                instance = LiveEvent.objects.filter(
                    youtube_url=youtube_url,
                    user=request.user
                ).order_by('-start_time').first()
            
            if not instance:
                logger.error("Failed to create or retrieve event")
                return Response(
                    {"error": "Failed to create event"},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )
            
            logger.info(f"Successfully created event ID {instance.id}")
            
            # Return response
            return Response(
                self.get_serializer(instance).data,
                status=status.HTTP_201_CREATED,
                headers=self.get_success_headers(serializer.data)
            )
            
        except Exception as e:
            logger.error(f"Error creating live event: {str(e)}", exc_info=True)
            return Response(
                {"error": str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    def perform_create(self, serializer):
        """Create with automatic thumbnail generation"""
        youtube_url = serializer.validated_data['youtube_url']
        video_id = LiveEvent.extract_youtube_id(youtube_url)
        
        # Generate thumbnail URL
        thumbnail = f"https://img.youtube.com/vi/{video_id}/mqdefault.jpg"
        
        serializer.save(
            user=self.request.user,
            thumbnail=thumbnail,
            is_live=True,
            start_time=timezone.now(),
            viewers_count=0
        )
    
    @action(detail=False, methods=['get'])
    def featured(self, request):
        """Simplified featured events endpoint"""
        try:
            # Get active events (live or recently started)
            featured = self.get_queryset().filter(
                Q(is_live=True) |
                Q(start_time__gte=timezone.now() - timedelta(hours=24))
            ).order_by('-viewers_count')[:6]
            
            logger.info(f"Found {featured.count()} featured events")
            
            serializer = self.get_serializer(featured, many=True)
            return Response(serializer.data)
            
        except Exception as e:
            logger.error(f"Error getting featured events: {str(e)}")
            return Response(
                {"error": "Failed to load featured events"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
    
    def list(self, request, *args, **kwargs):
        """Enhanced list with debugging"""
        logger.info("Listing live events")
        try:
            response = super().list(request, *args, **kwargs)
            logger.info(f"Returning {len(response.data)} events")
            return response
        except Exception as e:
            logger.error(f"Error listing events: {str(e)}")
            raise



class WallpaperViewSet(viewsets.ModelViewSet):
    """App-wide backgrounds. Everyone reads the active set (that is what every
    RotatingBackground renders); only admins holding `manage_wallpapers` may
    upload, reorder, deactivate or delete.

    Read is open — these are decorative images with no user data, and keeping it
    unauthenticated means a cold start never races the token refresh and drops
    back to the bundled fallbacks."""
    serializer_class = WallpaperSerializer

    def get_permissions(self):
        if self.action in ('list', 'retrieve'):
            return [AllowAny()]
        return [Cap('manage_wallpapers')()]

    def _may_manage(self):
        user = self.request.user
        return bool(
            user and user.is_authenticated
            and getattr(user, 'has_capability', None)
            and user.has_capability('manage_wallpapers')
        )

    def get_queryset(self):
        queryset = Wallpaper.objects.select_related('uploaded_by')
        # ?scope=music narrows to one surface; omitted means every scope, which
        # is what the client wants (it groups them itself in one round trip).
        scope = self.request.query_params.get('scope')
        if scope:
            queryset = queryset.filter(scope=scope)

        # ONLY the public list is limited to the active set. Detail actions must
        # see everything, or a deactivated wallpaper would fall out of the
        # queryset and an admin could never switch it back on (it 404s).
        if self.action != 'list':
            return queryset

        # ?all=1 exposes hidden rows for the admin library — capability-gated, so
        # a passer-by can't enumerate wallpapers the admin took out of rotation.
        if self.request.query_params.get('all') and self._may_manage():
            return queryset
        return queryset.filter(is_active=True)

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)

    def perform_destroy(self, instance):
        # Best-effort: drop the R2 object too, so deleting a wallpaper doesn't
        # leave the bytes paying storage forever. r2.delete never raises.
        r2.delete(instance.image)
        instance.delete()

    @action(detail=False, methods=['post'], url_path='reorder')
    def reorder(self, request):
        """Persist a new rotation order in one round trip: [{id, sort_order}]."""
        items = request.data.get('items')
        if not isinstance(items, list):
            return Response({'error': 'items must be a list of {id, sort_order}'},
                            status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            for entry in items:
                if not isinstance(entry, dict) or 'id' not in entry:
                    continue
                try:
                    order = int(entry.get('sort_order', 0))
                except (TypeError, ValueError):
                    continue
                Wallpaper.objects.filter(pk=entry['id']).update(sort_order=order)
        return Response({'status': 'reordered'})

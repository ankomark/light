from .common import *  # noqa: F401,F403
import base64
from django.http import HttpResponse


class MediaStationViewSet(viewsets.ModelViewSet):
    queryset = MediaStation.objects.all()
    serializer_class = MediaStationSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    pagination_class = StandardPagination

    def get_queryset(self):
        qs = MediaStation.objects.all()
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
    queryset = Notice.objects.all()
    serializer_class = NoticeSerializer
    pagination_class = StandardPagination

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAdminUser()]
        return [permissions.IsAuthenticated()]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class ChurchViewSet(viewsets.ModelViewSet):
    # select_related avoids an N+1 on created_by during listing.
    queryset = Church.objects.select_related('created_by', 'created_by__profile').order_by('-created_at')
    serializer_class = ChurchSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    pagination_class = StandardPagination

    def _handle_image_upload(self, church):
        """The serializer's `image` field is read-only, so the uploaded file is
        handled here: push it to Cloudinary and store the resulting public_id."""
        image_file = self.request.FILES.get('image')
        if not image_file:
            return
        result = upload(
            image_file,
            folder='churches',
            resource_type='image',
            transformation=[
                {'width': 1200, 'height': 800, 'crop': 'fill'},
                {'quality': 'auto'},
            ],
        )
        church.image = result['public_id']
        church.save(update_fields=['image', 'updated_at'])

    def perform_create(self, serializer):
        church = serializer.save(created_by=self.request.user)
        self._handle_image_upload(church)
        # The creator runs the community as its admin.
        ChurchMembership.objects.get_or_create(
            church=church, user=self.request.user, defaults={'role': 'admin'},
        )

    def get_permissions(self):
        if self.action in ['update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated()]
        return super().get_permissions()

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.created_by != request.user:
            return Response(
                {"error": "You can only edit churches you created"},
                status=status.HTTP_403_FORBIDDEN
            )
        # Persist a newly uploaded image first; super().update() re-reads the
        # instance and serializes it with the saved image.
        self._handle_image_upload(instance)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.created_by != request.user:
            return Response(
                {"error": "You can only delete churches you created"},
                status=status.HTTP_403_FORBIDDEN
            )
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['get'])
    def my_churches(self, request):
        churches = Church.objects.filter(created_by=request.user)
        serializer = self.get_serializer(churches, many=True)
        return Response(serializer.data)

    # ── Community helpers ────────────────────────────────────────────────────
    def _membership(self, church, user):
        if not user or not user.is_authenticated:
            return None
        return church.memberships.filter(user=user).first()

    def _is_admin(self, church, user):
        if user and user.is_authenticated and church.created_by_id == user.id:
            return True
        m = self._membership(church, user)
        return bool(m and m.role == 'admin')

    # ── Community: membership state ──────────────────────────────────────────
    @action(detail=True, methods=['get'], url_path='community')
    def community(self, request, pk=None):
        """Snapshot the caller needs to render the community: their role, the
        member count, and whether they have a pending request."""
        church = self.get_object()
        m = self._membership(church, request.user)
        pending = church.join_requests.filter(user=request.user, status='pending').exists()
        is_admin = self._is_admin(church, request.user)
        return Response({
            'church_id': church.id,
            'name': church.name,
            'is_admin': is_admin,
            'role': m.role if m else None,
            'is_member': bool(m),
            'has_pending_request': pending,
            'has_requests': is_admin and church.join_requests.filter(status='pending').exists(),
            # Live community size (separate from the congregation `members` field).
            'members_count': church.memberships.count(),
        })

    @action(detail=True, methods=['get'])
    def members(self, request, pk=None):
        """Roster — visible to members of the community."""
        church = self.get_object()
        if not self._membership(church, request.user):
            return Response({'error': 'Members only.'}, status=status.HTTP_403_FORBIDDEN)
        qs = church.memberships.select_related('user__profile').order_by('role', 'joined_at')
        return Response(ChurchMembershipSerializer(qs, many=True).data)

    # ── Community: join requests ─────────────────────────────────────────────
    @action(detail=True, methods=['post'], url_path='request-join')
    def request_join(self, request, pk=None):
        church = self.get_object()
        if self._membership(church, request.user):
            return Response({'error': "You're already in this community."}, status=status.HTTP_400_BAD_REQUEST)
        req, _created = ChurchJoinRequest.objects.get_or_create(
            church=church, user=request.user,
            defaults={'message': (request.data.get('message') or '')[:500]},
        )
        if not _created and req.status in ('rejected',):
            req.status = 'pending'
            req.message = (request.data.get('message') or '')[:500]
            req.save(update_fields=['status', 'message'])
        try:
            notify_user(church.created_by, 'church_request',
                        f"{request.user.username} wants to join {church.name}",
                        {'type': 'church_request', 'church_id': church.id, 'request_id': req.id})
        except Exception:
            logger.exception('church request notify failed')
        return Response(ChurchJoinRequestSerializer(req).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'], url_path='join-requests')
    def join_requests(self, request, pk=None):
        church = self.get_object()
        if not self._is_admin(church, request.user):
            return Response({'error': 'Admin only.'}, status=status.HTTP_403_FORBIDDEN)
        qs = church.join_requests.select_related('user__profile').filter(status='pending')
        return Response(ChurchJoinRequestSerializer(qs, many=True).data)

    @action(detail=True, methods=['post'], url_path='approve-request')
    def approve_request(self, request, pk=None):
        church = self.get_object()
        if not self._is_admin(church, request.user):
            return Response({'error': 'Admin only.'}, status=status.HTTP_403_FORBIDDEN)
        req = get_object_or_404(ChurchJoinRequest, pk=request.data.get('request_id'), church=church)
        req.status = 'approved'
        req.save(update_fields=['status'])
        ChurchMembership.objects.get_or_create(church=church, user=req.user, defaults={'role': 'friend'})
        try:
            notify_user(req.user, 'church_approved', f"You're now in the {church.name} community",
                        {'type': 'church_approved', 'church_id': church.id})
        except Exception:
            logger.exception('church approve notify failed')
        return Response(ChurchJoinRequestSerializer(req).data)

    @action(detail=True, methods=['post'], url_path='reject-request')
    def reject_request(self, request, pk=None):
        church = self.get_object()
        if not self._is_admin(church, request.user):
            return Response({'error': 'Admin only.'}, status=status.HTTP_403_FORBIDDEN)
        req = get_object_or_404(ChurchJoinRequest, pk=request.data.get('request_id'), church=church)
        req.status = 'rejected'
        req.save(update_fields=['status'])
        return Response(ChurchJoinRequestSerializer(req).data)

    # ── Community: moderation ────────────────────────────────────────────────
    @action(detail=True, methods=['post'], url_path='remove-member')
    def remove_member(self, request, pk=None):
        """Admin drops a member or removes a friend. The creator can't be removed."""
        church = self.get_object()
        if not self._is_admin(church, request.user):
            return Response({'error': 'Admin only.'}, status=status.HTTP_403_FORBIDDEN)
        target_id = request.data.get('user_id')
        if str(target_id) == str(church.created_by_id):
            return Response({'error': "The creator can't be removed."}, status=status.HTTP_400_BAD_REQUEST)
        deleted, _ = church.memberships.filter(user_id=target_id).delete()
        church.join_requests.filter(user_id=target_id).delete()  # let them re-request later
        return Response({'status': 'removed', 'removed': deleted})

    @action(detail=True, methods=['post'])
    def leave(self, request, pk=None):
        church = self.get_object()
        if church.created_by_id == request.user.id:
            return Response({'error': 'The creator cannot leave; delete the church instead.'},
                            status=status.HTTP_400_BAD_REQUEST)
        church.memberships.filter(user=request.user).delete()
        return Response({'status': 'left'})

    # ── Community: chat ──────────────────────────────────────────────────────
    @action(detail=True, methods=['get', 'post'])
    def messages(self, request, pk=None):
        church = self.get_object()
        if not self._membership(church, request.user):
            return Response({'error': 'Join this church to see the chat.'}, status=status.HTTP_403_FORBIDDEN)

        if request.method == 'POST':
            mtype = request.data.get('message_type', 'text')
            if mtype not in dict(ChurchMessage.MESSAGE_TYPES) or mtype == 'system':
                return Response({'error': 'Invalid message type.'}, status=status.HTTP_400_BAD_REQUEST)
            content = (request.data.get('content') or '').strip()
            attachment = request.data.get('attachment') or ''
            if not content and not attachment:
                return Response({'error': 'Empty message.'}, status=status.HTTP_400_BAD_REQUEST)
            reply_to = None
            reply_id = request.data.get('reply_to')
            if reply_id:
                reply_to = church.messages.filter(pk=reply_id).first()
            msg = ChurchMessage.objects.create(
                church=church, sender=request.user, content=content[:5000],
                message_type=mtype, attachment=attachment,
                file_name=(request.data.get('file_name') or '')[:255],
                duration=request.data.get('duration') or None, reply_to=reply_to,
            )
            return Response(ChurchMessageSerializer(msg, context={'request': request}).data,
                            status=status.HTTP_201_CREATED)

        # GET — newest first, paginated; the client reverses for display.
        qs = (church.messages
              .select_related('sender__profile', 'reply_to__sender')
              .prefetch_related('reactions')
              .order_by('-created_at'))
        page = self.paginate_queryset(qs)
        data = ChurchMessageSerializer(page if page is not None else qs, many=True,
                                       context={'request': request}).data
        return self.get_paginated_response(data) if page is not None else Response(data)

    @action(detail=True, methods=['post'], url_path='messages/(?P<message_id>[^/.]+)/delete')
    def delete_message(self, request, pk=None, message_id=None):
        """Sender can delete their own message; admin can delete any."""
        church = self.get_object()
        msg = get_object_or_404(ChurchMessage, pk=message_id, church=church)
        if msg.sender_id != request.user.id and not self._is_admin(church, request.user):
            return Response({'error': 'Not allowed.'}, status=status.HTTP_403_FORBIDDEN)
        msg.delete()
        return Response({'status': 'deleted'})

    @action(detail=True, methods=['post'], url_path='messages/(?P<message_id>[^/.]+)/react')
    def react_message(self, request, pk=None, message_id=None):
        """Toggle the caller's emoji reaction on a message (one per user)."""
        church = self.get_object()
        if not self._membership(church, request.user):
            return Response({'error': 'Join this church to react.'}, status=status.HTTP_403_FORBIDDEN)
        msg = get_object_or_404(ChurchMessage, pk=message_id, church=church)
        emoji = (request.data.get('emoji') or '').strip()
        if not emoji or len(emoji) > 16:
            return Response({'error': 'Invalid emoji.'}, status=status.HTTP_400_BAD_REQUEST)
        existing = msg.reactions.filter(user=request.user).first()
        if existing and existing.emoji == emoji:
            existing.delete()  # tapping the same emoji clears it
        elif existing:
            existing.emoji = emoji
            existing.save(update_fields=['emoji'])
        else:
            ChurchMessageReaction.objects.create(message=msg, user=request.user, emoji=emoji)
        return Response(ChurchMessageSerializer(msg, context={'request': request}).data)





from rest_framework.exceptions import PermissionDenied



class VideoStudioViewSet(viewsets.ModelViewSet):
    queryset = Videostudio.objects.all().order_by('-created_at')
    serializer_class = VideoStudioSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    pagination_class = StandardPagination

     
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def get_queryset(self):
        # Add filtering by user if requested
        user_id = self.request.query_params.get('user_id')
        if user_id:
            return Videostudio.objects.filter(created_by=user_id)
        return super().get_queryset()

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



class ChoirViewSet(viewsets.ModelViewSet):
    # select_related avoids an N+1 on created_by (+ its profile) during listing.
    queryset = Choir.objects.select_related('created_by', 'created_by__profile').order_by('-created_at')
    serializer_class = ChoirSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    pagination_class = StandardPagination

    def get_serializer_class(self):
        # The list ships image URLs (small); detail/create/update keep base64.
        if self.action == 'list':
            return ChoirListSerializer
        return ChoirSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context

    def perform_create(self, serializer):
        choir = serializer.save(created_by=self.request.user)
        # The creator runs the community as its admin.
        ChoirMembership.objects.get_or_create(
            choir=choir, user=self.request.user, defaults={'role': 'admin'},
        )

    def get_queryset(self):
        user_id = self.request.query_params.get('user_id')
        if user_id:
            return self.queryset.filter(created_by=user_id)
        return super().get_queryset()

    # ── Image serving: stream the stored base64 as a real, cacheable image ────
    def _serve_data_uri(self, data_uri):
        """Decode a `data:<mime>;base64,<payload>` blob into an image response."""
        if not data_uri or ',' not in data_uri:
            raise Http404('No image.')
        header, _, payload = data_uri.partition(',')
        mime = header[5:].split(';')[0] if header.startswith('data:') else ''
        try:
            raw = base64.b64decode(payload)
        except Exception:
            raise Http404('Bad image data.')
        resp = HttpResponse(raw, content_type=mime or 'image/jpeg')
        # URLs are cache-busted with ?v=updated_at, so they're safe to cache hard.
        resp['Cache-Control'] = 'public, max-age=31536000, immutable'
        return resp

    @action(detail=True, methods=['get'], permission_classes=[permissions.AllowAny])
    def cover(self, request, pk=None):
        return self._serve_data_uri(self.get_object().cover_image)

    @action(detail=True, methods=['get'], permission_classes=[permissions.AllowAny])
    def profile(self, request, pk=None):
        return self._serve_data_uri(self.get_object().profile_image)

    # ── Community helpers ────────────────────────────────────────────────────
    def _membership(self, choir, user):
        if not user or not user.is_authenticated:
            return None
        return choir.memberships.filter(user=user).first()

    def _is_admin(self, choir, user):
        if user and user.is_authenticated and choir.created_by_id == user.id:
            return True
        m = self._membership(choir, user)
        return bool(m and m.role == 'admin')

    def _sync_count(self, choir):
        choir.members_count = choir.memberships.count()
        choir.save(update_fields=['members_count'])

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.created_by != request.user:
            return Response(
                {"error": "You can only edit choirs you created"},
                status=status.HTTP_403_FORBIDDEN
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.created_by != request.user:
            return Response(
                {"error": "You can only delete choirs you created"},
                status=status.HTTP_403_FORBIDDEN
            )
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['get'])
    def my_choirs(self, request):
        choirs = Choir.objects.filter(created_by=request.user)
        serializer = self.get_serializer(choirs, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def add_member(self, request, pk=None):
        choir = self.get_object()
        user_id = request.data.get('user_id')
        
        if not user_id:
            return Response(
                {"error": "User ID is required"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response(
                {"error": "User not found"},
                status=status.HTTP_404_NOT_FOUND
            )
        
        if choir.members.filter(id=user.id).exists():
            return Response(
                {"error": "User is already a member of this choir"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        choir.members.add(user)
        choir.members_count = choir.members.count()
        choir.save()
        
        return Response(
            {"status": "Member added successfully"},
            status=status.HTTP_200_OK
        )
    
    @action(detail=True, methods=['post'])
    def toggle_active(self, request, pk=None):
            choir = self.get_object()
            if choir.created_by != request.user:
                return Response(
                    {"error": "Only the creator can toggle active status"},
                    status=status.HTTP_403_FORBIDDEN
                )
            
            choir.is_active = not choir.is_active
            choir.save()
            return Response(
                {"status": "Active status updated", "is_active": choir.is_active},
                status=status.HTTP_200_OK
            )    
    @action(detail=True, methods=['post'])
    def update_members(self, request, pk=None):
            choir = self.get_object()
            if choir.created_by != request.user:
                return Response(
                    {"error": "Only the creator can update members count"},
                    status=status.HTTP_403_FORBIDDEN
                )
            
            count = request.data.get('count')
            if count is None or not str(count).isdigit() or int(count) < 0:
                return Response(
                    {"error": "Valid count value is required"},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            choir.members_count = int(count)
            choir.save()
            return Response(
                {"status": "Members count updated", "members_count": choir.members_count},
                status=status.HTTP_200_OK
            )

    # ── Community: membership state ──────────────────────────────────────────
    @action(detail=True, methods=['get'], url_path='community')
    def community(self, request, pk=None):
        """Snapshot the caller needs to render the community: their role, the
        member count, and whether they have a pending request."""
        choir = self.get_object()
        m = self._membership(choir, request.user)
        pending = choir.join_requests.filter(user=request.user, status='pending').exists()
        is_admin = self._is_admin(choir, request.user)
        return Response({
            'choir_id': choir.id,
            'name': choir.name,
            'is_admin': is_admin,
            'role': m.role if m else None,
            'is_member': bool(m),
            'has_pending_request': pending,
            # For the admin's "requests waiting" badge.
            'has_requests': is_admin and choir.join_requests.filter(status='pending').exists(),
            'members_count': choir.memberships.count(),
        })

    @action(detail=True, methods=['get'])
    def members(self, request, pk=None):
        """Roster — visible to members of the community."""
        choir = self.get_object()
        if not self._membership(choir, request.user):
            return Response({'error': 'Members only.'}, status=status.HTTP_403_FORBIDDEN)
        qs = choir.memberships.select_related('user__profile').order_by('role', 'joined_at')
        return Response(ChoirMembershipSerializer(qs, many=True).data)

    # ── Community: join requests ─────────────────────────────────────────────
    @action(detail=True, methods=['post'], url_path='request-join')
    def request_join(self, request, pk=None):
        choir = self.get_object()
        if self._membership(choir, request.user):
            return Response({'error': "You're already in this community."}, status=status.HTTP_400_BAD_REQUEST)
        req, _created = ChoirJoinRequest.objects.get_or_create(
            choir=choir, user=request.user,
            defaults={'message': (request.data.get('message') or '')[:500]},
        )
        if not _created and req.status in ('rejected',):
            req.status = 'pending'
            req.message = (request.data.get('message') or '')[:500]
            req.save(update_fields=['status', 'message'])
        try:
            notify_user(choir.created_by, 'choir_request',
                        f"{request.user.username} wants to join {choir.name}",
                        {'type': 'choir_request', 'choir_id': choir.id, 'request_id': req.id})
        except Exception:
            logger.exception('choir request notify failed')
        return Response(ChoirJoinRequestSerializer(req).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'], url_path='join-requests')
    def join_requests(self, request, pk=None):
        choir = self.get_object()
        if not self._is_admin(choir, request.user):
            return Response({'error': 'Admin only.'}, status=status.HTTP_403_FORBIDDEN)
        qs = choir.join_requests.select_related('user__profile').filter(status='pending')
        return Response(ChoirJoinRequestSerializer(qs, many=True).data)

    @action(detail=True, methods=['post'], url_path='approve-request')
    def approve_request(self, request, pk=None):
        choir = self.get_object()
        if not self._is_admin(choir, request.user):
            return Response({'error': 'Admin only.'}, status=status.HTTP_403_FORBIDDEN)
        req = get_object_or_404(ChoirJoinRequest, pk=request.data.get('request_id'), choir=choir)
        req.status = 'approved'
        req.save(update_fields=['status'])
        ChoirMembership.objects.get_or_create(choir=choir, user=req.user, defaults={'role': 'friend'})
        self._sync_count(choir)
        try:
            notify_user(req.user, 'choir_approved', f"You're now a friend of {choir.name}",
                        {'type': 'choir_approved', 'choir_id': choir.id})
        except Exception:
            logger.exception('choir approve notify failed')
        return Response(ChoirJoinRequestSerializer(req).data)

    @action(detail=True, methods=['post'], url_path='reject-request')
    def reject_request(self, request, pk=None):
        choir = self.get_object()
        if not self._is_admin(choir, request.user):
            return Response({'error': 'Admin only.'}, status=status.HTTP_403_FORBIDDEN)
        req = get_object_or_404(ChoirJoinRequest, pk=request.data.get('request_id'), choir=choir)
        req.status = 'rejected'
        req.save(update_fields=['status'])
        return Response(ChoirJoinRequestSerializer(req).data)

    # ── Community: moderation ────────────────────────────────────────────────
    @action(detail=True, methods=['post'], url_path='remove-member')
    def remove_member(self, request, pk=None):
        """Admin drops a member or removes a friend. The creator can't be removed."""
        choir = self.get_object()
        if not self._is_admin(choir, request.user):
            return Response({'error': 'Admin only.'}, status=status.HTTP_403_FORBIDDEN)
        target_id = request.data.get('user_id')
        if str(target_id) == str(choir.created_by_id):
            return Response({'error': "The creator can't be removed."}, status=status.HTTP_400_BAD_REQUEST)
        deleted, _ = choir.memberships.filter(user_id=target_id).delete()
        choir.join_requests.filter(user_id=target_id).delete()  # let them re-request later
        self._sync_count(choir)
        return Response({'status': 'removed', 'removed': deleted})

    @action(detail=True, methods=['post'])
    def leave(self, request, pk=None):
        choir = self.get_object()
        if choir.created_by_id == request.user.id:
            return Response({'error': 'The creator cannot leave; delete the choir instead.'},
                            status=status.HTTP_400_BAD_REQUEST)
        choir.memberships.filter(user=request.user).delete()
        self._sync_count(choir)
        return Response({'status': 'left'})

    # ── Community: chat ──────────────────────────────────────────────────────
    @action(detail=True, methods=['get', 'post'])
    def messages(self, request, pk=None):
        choir = self.get_object()
        if not self._membership(choir, request.user):
            return Response({'error': 'Join this choir to see the chat.'}, status=status.HTTP_403_FORBIDDEN)

        if request.method == 'POST':
            mtype = request.data.get('message_type', 'text')
            if mtype not in dict(ChoirMessage.MESSAGE_TYPES) or mtype == 'system':
                return Response({'error': 'Invalid message type.'}, status=status.HTTP_400_BAD_REQUEST)
            content = (request.data.get('content') or '').strip()
            attachment = request.data.get('attachment') or ''
            if not content and not attachment:
                return Response({'error': 'Empty message.'}, status=status.HTTP_400_BAD_REQUEST)
            reply_to = None
            reply_id = request.data.get('reply_to')
            if reply_id:
                reply_to = choir.messages.filter(pk=reply_id).first()
            msg = ChoirMessage.objects.create(
                choir=choir, sender=request.user, content=content[:5000],
                message_type=mtype, attachment=attachment,
                file_name=(request.data.get('file_name') or '')[:255],
                duration=request.data.get('duration') or None, reply_to=reply_to,
            )
            return Response(ChoirMessageSerializer(msg, context={'request': request}).data,
                            status=status.HTTP_201_CREATED)

        # GET — newest first, paginated; the client reverses for display.
        qs = (choir.messages
              .select_related('sender__profile', 'reply_to__sender')
              .prefetch_related('reactions')
              .order_by('-created_at'))
        page = self.paginate_queryset(qs)
        data = ChoirMessageSerializer(page if page is not None else qs, many=True,
                                      context={'request': request}).data
        return self.get_paginated_response(data) if page is not None else Response(data)

    @action(detail=True, methods=['post'], url_path='messages/(?P<message_id>[^/.]+)/delete')
    def delete_message(self, request, pk=None, message_id=None):
        """Sender can delete their own message; admin can delete any."""
        choir = self.get_object()
        msg = get_object_or_404(ChoirMessage, pk=message_id, choir=choir)
        if msg.sender_id != request.user.id and not self._is_admin(choir, request.user):
            return Response({'error': 'Not allowed.'}, status=status.HTTP_403_FORBIDDEN)
        msg.delete()
        return Response({'status': 'deleted'})

    @action(detail=True, methods=['post'], url_path='messages/(?P<message_id>[^/.]+)/react')
    def react_message(self, request, pk=None, message_id=None):
        """Toggle the caller's emoji reaction on a message (one per user)."""
        choir = self.get_object()
        if not self._membership(choir, request.user):
            return Response({'error': 'Join this choir to react.'}, status=status.HTTP_403_FORBIDDEN)
        msg = get_object_or_404(ChoirMessage, pk=message_id, choir=choir)
        emoji = (request.data.get('emoji') or '').strip()
        if not emoji or len(emoji) > 16:
            return Response({'error': 'Invalid emoji.'}, status=status.HTTP_400_BAD_REQUEST)
        existing = msg.reactions.filter(user=request.user).first()
        if existing and existing.emoji == emoji:
            existing.delete()  # tapping the same emoji clears it
        elif existing:
            existing.emoji = emoji
            existing.save(update_fields=['emoji'])
        else:
            ChoirMessageReaction.objects.create(message=msg, user=request.user, emoji=emoji)
        return Response(ChoirMessageSerializer(msg, context={'request': request}).data)


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


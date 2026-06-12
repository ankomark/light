from .common import *  # noqa: F401,F403


def group_system_message(group, text, actor):
    """Create a 'system' notice in the group chat (e.g. 'X joined')."""
    return GroupPost.objects.create(
        group=group, user=actor, message_type='system', content=text,
    )


@method_decorator(cache_control(no_cache=True, no_store=True, must_revalidate=True), name='dispatch')
class GroupViewSet(viewsets.ModelViewSet):
    queryset = Group.objects.all().order_by('-created_at')
    serializer_class = GroupSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination
    lookup_field = 'slug'
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_queryset(self):
        # For authenticated users
        if self.request.user.is_authenticated:
            return Group.objects.filter(
                Q(is_private=False) |  # Show all public groups
                Q(creator=self.request.user) |  # Show groups user created
                Q(members__user=self.request.user)  # Show groups user is member of
            ).distinct().order_by('-created_at')
        # For unauthenticated users (if needed)
        return Group.objects.filter(is_private=False).order_by('-created_at')

    def get_permissions(self):
        if self.action in ['update', 'partial_update', 'destroy']:
            self.permission_classes = [IsAuthenticated, IsGroupCreator]
        return super().get_permissions()

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context


    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context
    
    

    @transaction.atomic
    def perform_create(self, serializer):
        group = serializer.save(creator=self.request.user)
        GroupMember.objects.create(
            group=group,
            user=self.request.user,
            is_admin=True
        )
        group_system_message(group, f"{self.request.user.username} created the group", self.request.user)
        return group

    @action(detail=True, methods=['post'], url_path='mark-read')
    def mark_read(self, request, slug=None):
        group = self.get_object()
        GroupMember.objects.filter(group=group, user=request.user).update(last_read_at=timezone.now())
        return Response({'status': 'ok'})

    @action(detail=True, methods=['post'], url_path='leave')
    def leave(self, request, slug=None):
        group = self.get_object()
        member = GroupMember.objects.filter(group=group, user=request.user).first()
        if not member:
            return Response({'error': 'You are not a member'}, status=status.HTTP_400_BAD_REQUEST)
        if group.creator_id == request.user.id:
            return Response({'error': 'The creator cannot leave their own group'}, status=status.HTTP_400_BAD_REQUEST)
        member.delete()
        group_system_message(group, f"{request.user.username} left", request.user)
        return Response({'status': 'left'})
    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        response['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response['Pragma'] = 'no-cache'
        response['Expires'] = '0'
        return response

    def perform_destroy(self, instance):
        instance.delete()
        cache.delete('group_list')

    @action(detail=True, methods=['get'], url_path='members')
    def group_members(self, request, slug=None):
        group = self.get_object()
        if not GroupMember.objects.filter(group=group, user=request.user).exists():
            raise PermissionDenied("You are not a member of this group")
        
        members = GroupMember.objects.filter(group=group).select_related('user', 'user__profile')
        serializer = GroupMemberSerializer(members, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='request-join')
    def request_join(self, request, slug=None):
        group = self.get_object()
        
        if GroupMember.objects.filter(group=group, user=request.user).exists():
            return Response(
                {"error": "You are already a member of this group"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        existing_request = GroupJoinRequest.objects.filter(
            group=group, 
            user=request.user,
            status='pending'
        ).first()
        
        if existing_request:
            return Response(
                {"error": "You already have a pending request to join this group"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Allow empty requests
        message = request.data.get('message', '')
        
        # Create join request directly
        join_request = GroupJoinRequest.objects.create(
            group=group,
            user=request.user,
            message=message,
            status='pending'
        )
        
        # Notify group admins
        admins = GroupMember.objects.filter(group=group, is_admin=True)
        msg = f"{request.user.username} requested to join {group.name}"
        for admin in admins:
            Notification.objects.create(
                recipient=admin.user,
                sender=request.user,
                message=msg,
                notification_type='group_join_request',
            )
            notify_user(admin.user, 'group_join_request', msg)
        
        serializer = GroupJoinRequestSerializer(join_request)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


    @action(detail=True, methods=['post'], url_path='remove-member')
    def remove_member(self, request, slug=None):
        group = self.get_object()
        if not GroupMember.objects.filter(group=group, user=request.user, is_admin=True).exists():
            raise PermissionDenied("Only admins can remove members")
        
        user_id = request.data.get('user_id')
        if not user_id:
            return Response({"error": "user_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        removed = GroupMember.objects.filter(group=group, user_id=user_id).select_related('user').first()
        if removed:
            uname = removed.user.username
            removed.delete()
            group_system_message(group, f"{uname} was removed", request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)
    @action(detail=True, methods=['get'], url_path='check-membership')
    def check_membership(self, request, slug=None):
        group = self.get_object()
        is_member = GroupMember.objects.filter(group=group, user=request.user).exists()
        is_admin = GroupMember.objects.filter(
            group=group, 
            user=request.user,
            is_admin=True
        ).exists()
        
        return Response({
            'is_member': is_member,
            'is_admin': is_admin,
            'group_slug': slug  # Include group slug in response for verification
        })
    
    @action(detail=True, methods=['post'], url_path='upload-cover')
    def upload_cover(self, request, slug=None):
        group = self.get_object()
        if group.creator != request.user:
            return Response(
                {"error": "Only the group creator can upload cover images"},
                status=status.HTTP_403_FORBIDDEN
            )
            
        if 'cover_image' not in request.FILES:
            return Response(
                {"error": "No cover image provided"},
                status=status.HTTP_400_BAD_REQUEST
            )
            
        try:
            # Upload to Cloudinary
            result = upload(
                request.FILES['cover_image'],
                folder='group_covers',
                resource_type='image',
                transformation=[
                    {'width': 1200, 'height': 630, 'crop': 'fill'},
                    {'quality': 'auto'}
                ]
            )
            # Save to group
            group.cover_image = result['public_id']
            group.save()
            return Response(
                GroupSerializer(group, context={'request': request}).data,
                status=status.HTTP_200_OK
            )
        except CloudinaryError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )



class GroupPostViewSet(viewsets.ModelViewSet):
    queryset = GroupPost.objects.all()
    serializer_class = GroupPostSerializer
    permission_classes = [IsAuthenticated, IsOwnerOrReadOnly]
    pagination_class = StandardPagination
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_queryset(self):
        group_slug = self.kwargs.get('group_slug')
        group = get_object_or_404(Group, slug=group_slug)
        # Newest first (paginated); the chat reverses for chronological display.
        return (
            GroupPost.objects
            .filter(group=group)
            .select_related('user__profile', 'reply_to__user')
            .prefetch_related('attachments')
            .order_by('-created_at')
        )

    def perform_create(self, serializer):
        group_slug = self.kwargs.get('group_slug')
        group = get_object_or_404(Group, slug=group_slug)

        if not GroupMember.objects.filter(group=group, user=self.request.user).exists():
            raise PermissionDenied("You are not a member of this group")

        # A message needs text or an attachment.
        content = (serializer.validated_data.get('content') or '').strip()
        attachment = serializer.validated_data.get('attachment') or ''
        if not content and not attachment:
            raise ValidationError({'detail': 'Message cannot be empty'})

        post = serializer.save(user=self.request.user, group=group)

        # Legacy multipart attachments (kept for backward compatibility).
        for file in self.request.FILES.getlist('attachments'):
            mime_type, _ = mimetypes.guess_type(file.name)
            file_type = 'document'
            if mime_type:
                if mime_type.startswith('image/'):
                    file_type = 'image'
                elif mime_type.startswith('video/'):
                    file_type = 'video'
                elif mime_type.startswith('audio/'):
                    file_type = 'audio'
            GroupPostAttachment.objects.create(post=post, file=file, file_type=file_type)

        Group.objects.filter(pk=group.pk).update(updated_at=post.created_at)

        # Push notification to other members.
        preview = content[:80] if content else {
            'image': '📷 Photo', 'file': '📎 File', 'audio': '🎤 Voice note',
        }.get(post.message_type, 'New message')
        others = GroupMember.objects.filter(group=group).exclude(user=self.request.user).select_related('user')
        for m in others:
            notify_user(
                m.user, 'message',
                f"{group.name} — {self.request.user.username}: {preview}",
                data={'groupSlug': group.slug},
            )
        return post

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        post = self.perform_create(serializer)
        complete_serializer = self.get_serializer(post)
        headers = self.get_success_headers(complete_serializer.data)
        return Response(complete_serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.user != request.user and not GroupMember.objects.filter(
            group=instance.group, 
            user=request.user,
            is_admin=True
        ).exists():
            return Response(
                {"error": "You don't have permission to delete this post"},
                status=status.HTTP_403_FORBIDDEN
            )
        self.perform_destroy(instance)
        return Response(status=status.HTTP_204_NO_CONTENT)



class GroupJoinRequestViewSet(viewsets.ModelViewSet):
    queryset = GroupJoinRequest.objects.all()
    serializer_class = GroupJoinRequestSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        qs = GroupJoinRequest.objects.filter(
            group__members__user=self.request.user,
            group__members__is_admin=True,
            status='pending'
        ).select_related('user', 'user__profile', 'group').distinct()
        # When reached via /groups/<slug>/join-requests/, scope to that group
        # instead of returning every group the user administers.
        group_slug = self.kwargs.get('group_slug')
        if group_slug:
            qs = qs.filter(group__slug=group_slug)
        return qs

    @action(detail=True, methods=['post'], url_path='approve')
    def approve_request(self, request, pk=None):
        join_request = self.get_object()
        if not GroupMember.objects.filter(
            group=join_request.group, 
            user=request.user,
            is_admin=True
        ).exists():
            raise PermissionDenied("Only group admins can approve requests")
        
        GroupMember.objects.create(
            group=join_request.group,
            user=join_request.user
        )
        join_request.status = 'approved'
        join_request.save()
        group_system_message(join_request.group, f"{join_request.user.username} joined", join_request.user)

        return Response({"status": "Request approved"}, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='reject')
    def reject_request(self, request, pk=None):
        join_request = self.get_object()
        if not GroupMember.objects.filter(
            group=join_request.group, 
            user=request.user,
            is_admin=True
        ).exists():
            raise PermissionDenied("Only group admins can reject requests")
        
        join_request.status = 'rejected'
        join_request.save()
        
        return Response({"status": "Request rejected"}, status=status.HTTP_200_OK)






# Add to existing views.py


import uuid

from .common import *  # noqa: F401,F403

# Group chat attachments are a Cloudinary https URL (current) or a legacy base64
# data URI (older clients). base64 of ~6 MB is ~8 MB of text — allow headroom.
MAX_ATTACHMENT_CHARS = 9 * 1024 * 1024


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
            ).filter(is_removed=False).distinct().order_by('-created_at')
        # For unauthenticated users (if needed)
        return Group.objects.filter(is_private=False, is_removed=False).order_by('-created_at')

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
            if removed.user_id == group.creator_id:
                return Response({"error": "The group creator cannot be removed"}, status=status.HTTP_400_BAD_REQUEST)
            uname = removed.user.username
            removed.delete()
            group_system_message(group, f"{uname} was removed", request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='set-admin')
    def set_admin(self, request, slug=None):
        """Promote a member to admin or dismiss them as admin. Admins only.
        The group creator is always an admin and cannot be demoted."""
        group = self.get_object()
        if not GroupMember.objects.filter(group=group, user=request.user, is_admin=True).exists():
            raise PermissionDenied("Only admins can change roles")

        user_id = request.data.get('user_id')
        make_admin = bool(request.data.get('is_admin', True))
        if not user_id:
            return Response({"error": "user_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        target = GroupMember.objects.filter(group=group, user_id=user_id).select_related('user').first()
        if not target:
            return Response({"error": "That person is not a member"}, status=status.HTTP_404_NOT_FOUND)
        if target.user_id == group.creator_id and not make_admin:
            return Response({"error": "The group creator is always an admin"}, status=status.HTTP_400_BAD_REQUEST)

        if target.is_admin != make_admin:
            target.is_admin = make_admin
            target.save(update_fields=['is_admin'])
            verb = "is now an admin" if make_admin else "is no longer an admin"
            group_system_message(group, f"{target.user.username} {verb}", request.user)
        return Response(GroupMemberSerializer(target, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='posting-policy')
    def set_posting_policy(self, request, slug=None):
        """Toggle the WhatsApp-style 'Only admins can send messages' lock. Admins only."""
        group = self.get_object()
        if not GroupMember.objects.filter(group=group, user=request.user, is_admin=True).exists():
            raise PermissionDenied("Only admins can change this setting")

        only_admins = bool(request.data.get('only_admins_can_post'))
        if group.only_admins_can_post != only_admins:
            group.only_admins_can_post = only_admins
            group.save(update_fields=['only_admins_can_post'])
            msg = "Only admins can send messages now" if only_admins else "Everyone can send messages now"
            group_system_message(group, msg, request.user)
        return Response(GroupSerializer(group, context={'request': request}).data)

    @action(detail=True, methods=['get'], url_path='search-users')
    def search_users(self, request, slug=None):
        """Admin-only: find users by username to add to the group (excludes
        people who are already members)."""
        group = self.get_object()
        if not GroupMember.objects.filter(group=group, user=request.user, is_admin=True).exists():
            raise PermissionDenied("Only admins can add members")
        q = (request.query_params.get('q') or '').strip()
        if len(q) < 2:
            return Response([])
        member_ids = GroupMember.objects.filter(group=group).values_list('user_id', flat=True)
        users = (
            User.objects.filter(username__icontains=q)
            .exclude(id__in=member_ids)
            .select_related('profile')
            .order_by('username')[:20]
        )
        return Response(SimpleUserSerializer(users, many=True, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='add-member')
    def add_member(self, request, slug=None):
        """Admin-only: add a user to the group directly (used to populate private
        groups without a join request)."""
        group = self.get_object()
        if not GroupMember.objects.filter(group=group, user=request.user, is_admin=True).exists():
            raise PermissionDenied("Only admins can add members")
        user_id = request.data.get('user_id')
        if not user_id:
            return Response({"error": "user_id is required"}, status=status.HTTP_400_BAD_REQUEST)
        user = User.objects.filter(id=user_id).first()
        if not user:
            return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)

        member, created = GroupMember.objects.get_or_create(group=group, user=user)
        if created:
            GroupJoinRequest.objects.filter(group=group, user=user, status='pending').update(status='approved')
            group_system_message(group, f"{user.username} was added", request.user)
            msg = f"You were added to {group.name}"
            Notification.objects.create(
                recipient=user, sender=request.user, message=msg, notification_type='group_added',
            )
            notify_user(user, 'group_added', msg, data={'groupSlug': group.slug})
        return Response(
            GroupMemberSerializer(member, context={'request': request}).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    @action(detail=True, methods=['post'], url_path='invite-link')
    def invite_link(self, request, slug=None):
        """Admin-only: return the group's invite code, creating one if needed or
        rotating it when {'regenerate': true} is sent (invalidates old links)."""
        group = self.get_object()
        if not GroupMember.objects.filter(group=group, user=request.user, is_admin=True).exists():
            raise PermissionDenied("Only admins can manage invite links")
        if request.data.get('regenerate') or not group.invite_code:
            group.invite_code = uuid.uuid4()
            group.save(update_fields=['invite_code'])
        return Response({'code': str(group.invite_code), 'group_name': group.name})

    @action(detail=False, methods=['post'], url_path='join-by-code')
    def join_by_code(self, request):
        """Join a group with an invite code — valid for private groups too, since
        possession of the code is itself the authorization."""
        code = (request.data.get('code') or '').strip()
        try:
            code_uuid = uuid.UUID(str(code))
        except (ValueError, TypeError, AttributeError):
            return Response({"error": "This invite link is invalid"}, status=status.HTTP_404_NOT_FOUND)
        group = Group.objects.filter(invite_code=code_uuid, is_removed=False).first()
        if not group:
            return Response({"error": "This invite link is invalid or has expired"}, status=status.HTTP_404_NOT_FOUND)

        member, created = GroupMember.objects.get_or_create(group=group, user=request.user)
        if created:
            group_system_message(group, f"{request.user.username} joined via invite", request.user)
        return Response(GroupSerializer(group, context={'request': request}).data, status=status.HTTP_200_OK)

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
        # Private group messages are members-only. Public group messages stay
        # readable so people can preview a group before joining (mirrors how the
        # group itself is visible). Without this, any authenticated user could
        # read a private group's chat by hitting this endpoint directly.
        if group.is_private and not GroupMember.objects.filter(group=group, user=self.request.user).exists():
            raise PermissionDenied("You are not a member of this group")
        # Newest first (paginated); the chat reverses for chronological display.
        return (
            GroupPost.objects
            .filter(group=group)
            .select_related('user__profile', 'reply_to__user')
            .prefetch_related('attachments', 'reactions')
            .order_by('-created_at')
        )

    def perform_create(self, serializer):
        group_slug = self.kwargs.get('group_slug')
        group = get_object_or_404(Group, slug=group_slug)

        member = GroupMember.objects.filter(group=group, user=self.request.user).first()
        if not member:
            raise PermissionDenied("You are not a member of this group")
        if group.only_admins_can_post and not member.is_admin:
            raise PermissionDenied("Only admins can send messages in this group")

        # A message needs text or an attachment.
        content = (serializer.validated_data.get('content') or '').strip()
        attachment = serializer.validated_data.get('attachment') or ''
        if not content and not attachment:
            raise ValidationError({'detail': 'Message cannot be empty'})

        # Validate the inline attachment: a Cloudinary https URL (media is now
        # uploaded there and only the URL is stored) or a legacy base64 data URI,
        # which is size-capped so it can't bloat the DB.
        if attachment:
            if attachment.startswith('https://'):
                if len(attachment) > 2000:
                    raise ValidationError({'detail': 'Invalid attachment URL'})
            elif attachment.startswith('data:'):
                if len(attachment) > MAX_ATTACHMENT_CHARS:
                    raise ValidationError({'detail': 'Attachment is too large (max ~6 MB).'})
            else:
                raise ValidationError({'detail': 'Invalid attachment'})

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

    @action(detail=True, methods=['post'], url_path='react', permission_classes=[IsAuthenticated])
    def react(self, request, *args, **kwargs):
        """Toggle the caller's emoji reaction on a post (one per user). Any group
        member may react — not just the post's owner — so this action overrides
        the viewset's IsOwnerOrReadOnly and checks membership itself."""
        post = self.get_object()
        if not GroupMember.objects.filter(group=post.group, user=request.user).exists():
            raise PermissionDenied("You are not a member of this group")
        emoji = (request.data.get('emoji') or '').strip()
        if not emoji or len(emoji) > 16:
            return Response({'error': 'Invalid emoji.'}, status=status.HTTP_400_BAD_REQUEST)
        existing = post.reactions.filter(user=request.user).first()
        if existing and existing.emoji == emoji:
            existing.delete()  # tapping the same emoji clears it
        elif existing:
            existing.emoji = emoji
            existing.save(update_fields=['emoji'])
        else:
            GroupPostReaction.objects.create(post=post, user=request.user, emoji=emoji)
        # get_object() prefetched a now-stale `reactions` set; clear the cache so
        # the serializer re-reads the fresh aggregate.
        post._prefetched_objects_cache = {}
        return Response(self.get_serializer(post).data)



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
        
        # get_or_create guards the unique_together(group, user): if the person was
        # already added (e.g. directly by an admin while the request sat pending),
        # approving shouldn't 500 on a duplicate-key error.
        _, created = GroupMember.objects.get_or_create(
            group=join_request.group,
            user=join_request.user,
        )
        join_request.status = 'approved'
        join_request.save()
        if created:
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


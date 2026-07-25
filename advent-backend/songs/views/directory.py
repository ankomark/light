from .common import *  # noqa: F401,F403
import base64
from django.http import HttpResponse
from django.utils import timezone
from ..consumers import (
    broadcast_community_message, broadcast_community_deleted,
    broadcast_community_edited, broadcast_community_pinned,
)
from ..serializers.directory import community_pinned_preview, CommunityAuditLogSerializer

def chat_attachment_error(attachment):
    """Validate a chat attachment string. Attachments must be an uploaded R2
    https URL — inline base64 data URIs are no longer accepted (they bloat the
    DB). Returns (message, status) on a problem, or None when valid / empty.
    Legacy rows that still hold base64 keep rendering on read; this guards writes."""
    if not attachment:
        return None
    if not attachment.startswith('https://'):
        return ('Attachments must be uploaded — inline data is not allowed.',
                status.HTTP_400_BAD_REQUEST)
    if len(attachment) > 2000:
        return ('Invalid attachment URL', status.HTTP_400_BAD_REQUEST)
    return None


def log_community_action(kind, community, actor, action, detail=''):
    """Record an admin/moderator action in a choir/church community's audit trail."""
    CommunityAuditLog.objects.create(
        kind=kind, community_id=community.id, actor=actor,
        action=action, detail=(detail or '')[:300],
    )


# How many messages a single community chat page returns (cursor pagination).
COMMUNITY_CURSOR_LIMIT = 30


def community_cursor_page(base_qs, before, after):
    """Cursor slice for a community chat, mirroring the group message list.

    - no cursor → newest page (newest-first)
    - ?before=<id> → the page immediately older than that message (newest-first)
    - ?after=<id> → the page immediately newer (oldest-first, for forward paging)

    `base_qs` must be unordered/newest-agnostic (this applies its own order_by).
    Returns (rows, has_more). An unknown anchor yields ([], False)."""
    limit = COMMUNITY_CURSOR_LIMIT
    if after:
        anchor = base_qs.filter(pk=after).first()
        if not anchor:
            return [], False
        # (created_at, id) tie-break keeps paging deterministic when several
        # messages share a timestamp (e.g. a burst of sends).
        rows = list(base_qs.filter(
            Q(created_at__gt=anchor.created_at)
            | Q(created_at=anchor.created_at, id__gt=anchor.id)
        ).order_by('created_at', 'id')[:limit + 1])  # oldest-first
    elif before:
        anchor = base_qs.filter(pk=before).first()
        if not anchor:
            return [], False
        rows = list(base_qs.filter(
            Q(created_at__lt=anchor.created_at)
            | Q(created_at=anchor.created_at, id__lt=anchor.id)
        ).order_by('-created_at', '-id')[:limit + 1])  # newest-first
    else:
        rows = list(base_qs.order_by('-created_at', '-id')[:limit + 1])  # newest page
    has_more = len(rows) > limit
    return rows[:limit], has_more


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


class ChurchViewSet(viewsets.ModelViewSet):
    # select_related avoids an N+1 on created_by during listing.
    queryset = Church.objects.filter(is_removed=False).select_related('created_by', 'created_by__profile').order_by('-created_at')
    serializer_class = ChurchSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    pagination_class = StandardPagination

    def _handle_image_upload(self, church):
        """The serializer's `image` field is read-only, so the uploaded file is
        handled here: push it to R2 and store the resulting public URL."""
        image_file = self.request.FILES.get('image')
        if not image_file:
            return
        church.image = r2.upload_file(image_file, 'churches')
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
        # select_related avoids an N+1 on created_by (+ profile) when the
        # serializer resolves created_by_picture.
        churches = (
            Church.objects.filter(created_by=request.user)
            .select_related('created_by', 'created_by__profile')
        )
        serializer = self.get_serializer(churches, many=True)
        return Response(serializer.data)

    # ── Community helpers ────────────────────────────────────────────────────
    def _membership(self, church, user):
        if not user or not user.is_authenticated:
            return None
        return church.memberships.filter(user=user).first()

    def _is_admin(self, church, user):
        # Super admins hold a master key over every community.
        if user and user.is_authenticated and (user.is_super_admin or church.created_by_id == user.id):
            return True
        m = self._membership(church, user)
        return bool(m and m.role == 'admin')

    def _is_mod(self, church, user):
        """Admins AND moderators can moderate content (delete any message, pin)."""
        if self._is_admin(church, user):
            return True
        m = self._membership(church, user)
        return bool(m and m.is_moderator)

    def get_throttles(self):
        # Community chat abuse guards (the global ScopedRateThrottle reads this).
        if self.action == 'messages' and self.request.method == 'POST':
            self.throttle_scope = 'community_post'
        elif self.action == 'react_message':
            self.throttle_scope = 'community_react'
        elif self.action == 'request_join':
            self.throttle_scope = 'community_join'
        return super().get_throttles()

    def _unread_by_id(self):
        """Map {church_id: unread_count} for the caller's memberships — drives the
        unread badge on list rows. Bounded by how many communities they're in."""
        user = self.request.user
        if not user or not user.is_authenticated:
            return {}
        hidden = set() if user.is_super_admin else super_admin_user_ids()
        out = {}
        for cid, last_read in ChurchMembership.objects.filter(user=user).values_list('church_id', 'last_read_at'):
            qs = (ChurchMessage.objects.filter(church_id=cid, is_removed=False)
                  .exclude(sender_id=user.id).exclude(message_type='system')
                  .exclude(sender_id__in=hidden))
            if last_read:
                qs = qs.filter(created_at__gt=last_read)
            out[cid] = qs.count()
        return out

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        if self.action in ('list', 'my_churches'):
            ctx['unread_by_id'] = self._unread_by_id()
        return ctx

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
            'is_moderator': bool(m and m.is_moderator),
            'role': m.role if m else None,
            # A super admin is reported as a member so the chat unlocks for them.
            'is_member': bool(m) or is_admin,
            'has_pending_request': pending,
            'has_requests': is_admin and church.join_requests.filter(status='pending').exists(),
            'only_admins_can_post': church.only_admins_can_post,
            'created_by_id': church.created_by_id,
            # Live community size (separate from the congregation `members` field).
            'members_count': church.memberships.count(),
            'pinned_message': community_pinned_preview(church.pinned_message),
        })

    @action(detail=True, methods=['get'])
    def members(self, request, pk=None):
        """Roster — visible to members of the community."""
        church = self.get_object()
        if not self._membership(church, request.user) and not self._is_admin(church, request.user):
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
        log_community_action('church', church, request.user, 'approve_join', f'Approved {req.user.username}')
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
        log_community_action('church', church, request.user, 'reject_join', f'Declined {req.user.username}')
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
        removed_user = User.objects.filter(id=target_id).first()
        deleted, _ = church.memberships.filter(user_id=target_id).delete()
        church.join_requests.filter(user_id=target_id).delete()  # let them re-request later
        if deleted:
            log_community_action('church', church, request.user, 'remove_member',
                                 f'Removed {removed_user.username if removed_user else target_id}')
        return Response({'status': 'removed', 'removed': deleted})

    @action(detail=True, methods=['get'], url_path='search-users')
    def search_users(self, request, pk=None):
        """Admin-only: find users by username to add, excluding current members."""
        church = self.get_object()
        if not self._is_admin(church, request.user):
            return Response({'error': 'Admin only.'}, status=status.HTTP_403_FORBIDDEN)
        q = (request.query_params.get('q') or '').strip()
        if len(q) < 2:
            return Response([])
        member_ids = church.memberships.values_list('user_id', flat=True)
        users = (User.objects.filter(username__icontains=q)
                 .exclude(id__in=member_ids).select_related('profile')
                 .order_by('username')[:20])
        return Response(SimpleUserSerializer(users, many=True, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='add-member')
    def add_member(self, request, pk=None):
        """Admin-only: add a user to the community directly (as a core 'member')."""
        church = self.get_object()
        if not self._is_admin(church, request.user):
            return Response({'error': 'Admin only.'}, status=status.HTTP_403_FORBIDDEN)
        user = User.objects.filter(id=request.data.get('user_id')).first()
        if not user:
            return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)
        membership, created = ChurchMembership.objects.get_or_create(
            church=church, user=user, defaults={'role': 'member'},
        )
        if created:
            church.join_requests.filter(user=user, status='pending').update(status='approved')
            try:
                notify_user(user, 'church_added', f"You were added to {church.name}",
                            {'type': 'church_added', 'church_id': church.id})
            except Exception:
                logger.exception('church add notify failed')
        return Response(ChurchMembershipSerializer(membership).data,
                        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='set-role')
    def set_role(self, request, pk=None):
        """Admin-only: promote a member to admin, or dismiss an admin back to a
        member. The creator is always an admin and can't be changed."""
        church = self.get_object()
        if not self._is_admin(church, request.user):
            return Response({'error': 'Admin only.'}, status=status.HTTP_403_FORBIDDEN)
        role = request.data.get('role')
        if role not in ('admin', 'member'):
            return Response({'error': 'role must be "admin" or "member".'}, status=status.HTTP_400_BAD_REQUEST)
        target = church.memberships.filter(user_id=request.data.get('user_id')).select_related('user').first()
        if not target:
            return Response({'error': 'That person is not a member.'}, status=status.HTTP_404_NOT_FOUND)
        if target.user_id == church.created_by_id:
            return Response({'error': 'The creator is always an admin.'}, status=status.HTTP_400_BAD_REQUEST)
        if target.role != role:
            target.role = role
            target.save(update_fields=['role'])
            log_community_action('church', church, request.user,
                                 'grant_admin' if role == 'admin' else 'revoke_admin',
                                 f'{target.user.username} → {role}')
        return Response(ChurchMembershipSerializer(target).data)

    @action(detail=True, methods=['post'], url_path='posting-policy')
    def set_posting_policy(self, request, pk=None):
        """Admin-only: toggle the WhatsApp-style 'Only admins can send messages' lock."""
        church = self.get_object()
        if not self._is_admin(church, request.user):
            return Response({'error': 'Admin only.'}, status=status.HTTP_403_FORBIDDEN)
        only_admins = bool(request.data.get('only_admins_can_post'))
        if church.only_admins_can_post != only_admins:
            church.only_admins_can_post = only_admins
            church.save(update_fields=['only_admins_can_post'])
            log_community_action('church', church, request.user, 'posting_policy',
                                 'Only admins can send messages now' if only_admins else 'Everyone can send messages now')
        return Response({'only_admins_can_post': church.only_admins_can_post})

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
        if not self._membership(church, request.user) and not self._is_admin(church, request.user):
            return Response({'error': 'Join this church to see the chat.'}, status=status.HTTP_403_FORBIDDEN)

        if request.method == 'POST':
            if church.only_admins_can_post and not self._is_admin(church, request.user):
                return Response({'error': 'Only admins can send messages in this community.'},
                                status=status.HTTP_403_FORBIDDEN)
            mtype = request.data.get('message_type', 'text')
            if mtype not in dict(ChurchMessage.MESSAGE_TYPES) or mtype == 'system':
                return Response({'error': 'Invalid message type.'}, status=status.HTTP_400_BAD_REQUEST)
            content = (request.data.get('content') or '').strip()
            attachment = request.data.get('attachment') or ''
            if not content and not attachment:
                return Response({'error': 'Empty message.'}, status=status.HTTP_400_BAD_REQUEST)
            att_err = chat_attachment_error(attachment)
            if att_err:
                return Response({'error': att_err[0]}, status=att_err[1])
            reply_to = None
            reply_id = request.data.get('reply_to')
            if reply_id:
                reply_to = church.messages.filter(pk=reply_id).first()
            msg = ChurchMessage.objects.create(
                church=church, sender=request.user, content=content[:5000],
                message_type=mtype, attachment=attachment,
                attachment_blurhash=(request.data.get('attachment_blurhash') or '')[:60],
                file_name=(request.data.get('file_name') or '')[:255],
                duration=request.data.get('duration') or None, reply_to=reply_to,
            )
            data = ChurchMessageSerializer(msg, context={'request': request}).data
            # Realtime fan-out (super-admin messages stay invisible → not broadcast).
            if not request.user.is_super_admin:
                broadcast_community_message('church', church.id, data)
            return Response(data, status=status.HTTP_201_CREATED)

        # GET — cursor-paginated. Default = newest page; ?before/?after page in
        # either direction from an anchor message. Super admins operate invisibly,
        # so regular members never see a message (or reaction) a super admin authored.
        hidden = set() if request.user.is_super_admin else super_admin_user_ids()
        base_qs = (church.messages
                   .filter(is_removed=False)  # hide moderator takedowns
                   .exclude(sender_id__in=hidden)
                   .select_related('sender__profile', 'reply_to__sender')
                   .prefetch_related('reactions'))
        rows, has_more = community_cursor_page(
            base_qs, request.query_params.get('before'), request.query_params.get('after'))
        data = ChurchMessageSerializer(rows, many=True,
                                       context={'request': request, 'hide_super_ids': hidden}).data
        return Response({'results': data, 'has_more': has_more})

    @action(detail=True, methods=['post'], url_path='messages/(?P<message_id>[^/.]+)/delete')
    def delete_message(self, request, pk=None, message_id=None):
        """Sender can delete their own message; admin can delete any."""
        church = self.get_object()
        msg = get_object_or_404(ChurchMessage, pk=message_id, church=church)
        own = msg.sender_id == request.user.id
        if not own and not self._is_mod(church, request.user):
            return Response({'error': 'Not allowed.'}, status=status.HTTP_403_FORBIDDEN)
        mid = msg.id
        author = msg.sender.username
        msg.delete()
        broadcast_community_deleted('church', church.id, mid)
        if not own:  # a moderator/admin removing someone else's message → log it
            log_community_action('church', church, request.user, 'delete_message', f'Deleted a message from {author}')
        return Response({'status': 'deleted'})

    @action(detail=True, methods=['post'], url_path='messages/(?P<message_id>[^/.]+)/react')
    def react_message(self, request, pk=None, message_id=None):
        """Toggle the caller's emoji reaction on a message (one per user)."""
        church = self.get_object()
        if not self._membership(church, request.user) and not self._is_admin(church, request.user):
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
        hidden = set() if request.user.is_super_admin else super_admin_user_ids()
        return Response(ChurchMessageSerializer(msg, context={'request': request, 'hide_super_ids': hidden}).data)

    def _message_qs(self, church, request):
        """The same membership-gated, super-admin-hidden message queryset the chat
        list uses — reused by search / context / media."""
        hidden = set() if request.user.is_super_admin else super_admin_user_ids()
        return (church.messages
                .filter(is_removed=False)
                .exclude(sender_id__in=hidden)
                .select_related('sender__profile', 'reply_to__sender')
                .prefetch_related('reactions'))

    @action(detail=True, methods=['patch'], url_path='messages/(?P<message_id>[^/.]+)/edit')
    def edit_message(self, request, pk=None, message_id=None):
        """Edit a text message you authored; the edit is stamped and fanned out."""
        church = self.get_object()
        msg = get_object_or_404(ChurchMessage, pk=message_id, church=church)
        if msg.sender_id != request.user.id:
            return Response({'error': 'You can only edit your own messages.'}, status=status.HTTP_403_FORBIDDEN)
        if msg.message_type != 'text':
            return Response({'error': 'Only text messages can be edited.'}, status=status.HTTP_400_BAD_REQUEST)
        content = (request.data.get('content') or '').strip()
        if not content:
            return Response({'error': 'Message cannot be empty.'}, status=status.HTTP_400_BAD_REQUEST)
        msg.content = content[:5000]
        msg.edited_at = timezone.now()
        msg.save(update_fields=['content', 'edited_at'])
        hidden = set() if request.user.is_super_admin else super_admin_user_ids()
        data = ChurchMessageSerializer(msg, context={'request': request, 'hide_super_ids': hidden}).data
        if not request.user.is_super_admin:
            broadcast_community_edited('church', church.id, data)
        return Response(data)

    @action(detail=True, methods=['post'], url_path='mark-read')
    def mark_read(self, request, pk=None):
        """Stamp the caller's last_read_at to now (drives unread counts + receipts)."""
        church = self.get_object()
        m = self._membership(church, request.user)
        if m:
            m.last_read_at = timezone.now()
            m.save(update_fields=['last_read_at'])
        return Response({'status': 'ok'})

    @action(detail=True, methods=['get'], url_path='messages/(?P<message_id>[^/.]+)/receipts')
    def receipts(self, request, pk=None, message_id=None):
        """Who has read this message — a member counts once their last_read_at
        reaches the message's timestamp. Author + hidden super-admins excluded."""
        church = self.get_object()
        if not self._membership(church, request.user) and not self._is_admin(church, request.user):
            return Response({'error': 'Members only.'}, status=status.HTTP_403_FORBIDDEN)
        msg = get_object_or_404(ChurchMessage, pk=message_id, church=church)
        hidden = set() if request.user.is_super_admin else super_admin_user_ids()
        readers = (church.memberships
                   .filter(last_read_at__gte=msg.created_at)
                   .exclude(user_id=msg.sender_id)
                   .exclude(user_id__in=hidden)
                   .select_related('user__profile')
                   .order_by('-last_read_at'))
        data = ChurchMembershipSerializer(readers, many=True).data
        return Response({'count': len(data), 'readers': data})

    @action(detail=True, methods=['get'])
    def search(self, request, pk=None):
        """Search a church's text messages (members-only, newest first, min 2 chars)."""
        church = self.get_object()
        if not self._membership(church, request.user) and not self._is_admin(church, request.user):
            return Response({'error': 'Members only.'}, status=status.HTTP_403_FORBIDDEN)
        q = (request.query_params.get('q') or '').strip()
        if len(q) < 2:
            return Response({'results': []})
        hidden = set() if request.user.is_super_admin else super_admin_user_ids()
        qs = (self._message_qs(church, request)
              .filter(message_type='text', content__icontains=q)
              .order_by('-created_at')[:50])
        data = ChurchMessageSerializer(qs, many=True,
                                       context={'request': request, 'hide_super_ids': hidden}).data
        return Response({'results': data})

    @action(detail=True, methods=['get'])
    def context(self, request, pk=None):
        """A window of messages around a given one (for jumping to a search hit).
        Members-only. Returns the window plus flags for older/newer beyond it."""
        church = self.get_object()
        if not self._membership(church, request.user) and not self._is_admin(church, request.user):
            return Response({'error': 'Members only.'}, status=status.HTTP_403_FORBIDDEN)
        message_id = request.query_params.get('message_id')
        radius = 20
        base = self._message_qs(church, request)
        target = base.filter(pk=message_id).first() if message_id else None
        if not target:
            return Response({'results': [], 'has_earlier': False, 'has_newer': False})
        older = list(base.filter(created_at__lte=target.created_at).order_by('-created_at')[:radius + 1])
        newer = list(base.filter(created_at__gt=target.created_at).order_by('created_at')[:radius])
        window = older[::-1] + newer
        has_earlier = base.filter(created_at__lt=target.created_at).count() > radius
        has_newer = base.filter(created_at__gt=target.created_at).count() > radius
        hidden = set() if request.user.is_super_admin else super_admin_user_ids()
        return Response({
            'results': ChurchMessageSerializer(window, many=True,
                                               context={'request': request, 'hide_super_ids': hidden}).data,
            'has_earlier': has_earlier,
            'has_newer': has_newer,
        })

    @action(detail=True, methods=['post'], url_path='messages/(?P<message_id>[^/.]+)/pin')
    def pin_message(self, request, pk=None, message_id=None):
        """Admin/moderator pins one message as a banner atop the chat."""
        church = self.get_object()
        if not self._is_mod(church, request.user):
            return Response({'error': 'Only admins can pin messages.'}, status=status.HTTP_403_FORBIDDEN)
        msg = get_object_or_404(ChurchMessage, pk=message_id, church=church)
        church.pinned_message = msg
        church.save(update_fields=['pinned_message'])
        preview = community_pinned_preview(msg)
        broadcast_community_pinned('church', church.id, preview)
        log_community_action('church', church, request.user, 'pin', 'Pinned a message')
        return Response(preview)

    @action(detail=True, methods=['post'], url_path='unpin')
    def unpin_message(self, request, pk=None):
        church = self.get_object()
        if not self._is_mod(church, request.user):
            return Response({'error': 'Only admins can unpin messages.'}, status=status.HTTP_403_FORBIDDEN)
        church.pinned_message = None
        church.save(update_fields=['pinned_message'])
        broadcast_community_pinned('church', church.id, None)
        log_community_action('church', church, request.user, 'unpin', 'Unpinned the message')
        return Response({'status': 'unpinned'})

    @action(detail=True, methods=['post'], url_path='set-moderator')
    def set_moderator(self, request, pk=None):
        """Promote a member to moderator or dismiss them. Admins only."""
        church = self.get_object()
        if not self._is_admin(church, request.user):
            return Response({'error': 'Only admins can change roles.'}, status=status.HTTP_403_FORBIDDEN)
        user_id = request.data.get('user_id')
        make_mod = bool(request.data.get('is_moderator', True))
        target = church.memberships.filter(user_id=user_id).select_related('user').first()
        if not target:
            return Response({'error': 'That person is not a member.'}, status=status.HTTP_404_NOT_FOUND)
        if target.is_moderator != make_mod:
            target.is_moderator = make_mod
            target.save(update_fields=['is_moderator'])
            verb = 'is now a moderator' if make_mod else 'is no longer a moderator'
            log_community_action('church', church, request.user,
                                 'grant_moderator' if make_mod else 'revoke_moderator',
                                 f'{target.user.username} {verb}')
        return Response(ChurchMembershipSerializer(target).data)

    @action(detail=True, methods=['get'], url_path='audit-log')
    def audit_log(self, request, pk=None):
        """The community's moderation trail. Visible to admins and moderators only."""
        church = self.get_object()
        if not self._is_mod(church, request.user):
            return Response({'error': 'Only admins and moderators can view the log.'}, status=status.HTTP_403_FORBIDDEN)
        qs = (CommunityAuditLog.objects
              .filter(kind='church', community_id=church.id)
              .select_related('actor__profile'))
        page = self.paginate_queryset(qs)
        if page is not None:
            return self.get_paginated_response(CommunityAuditLogSerializer(page, many=True).data)
        return Response(CommunityAuditLogSerializer(qs, many=True).data)

    @action(detail=True, methods=['get'])
    def media(self, request, pk=None):
        """Every image / file / voice note shared in the church, newest first
        (members-only — reuses the same membership gate as the message list)."""
        church = self.get_object()
        if not self._membership(church, request.user) and not self._is_admin(church, request.user):
            return Response({'error': 'Members only.'}, status=status.HTTP_403_FORBIDDEN)
        hidden = set() if request.user.is_super_admin else super_admin_user_ids()
        qs = (self._message_qs(church, request)
              .filter(message_type__in=['image', 'file', 'audio'])
              .order_by('-created_at'))
        page = self.paginate_queryset(qs)
        ctx = {'request': request, 'hide_super_ids': hidden}
        if page is not None:
            return self.get_paginated_response(ChurchMessageSerializer(page, many=True, context=ctx).data)
        return Response(ChurchMessageSerializer(qs, many=True, context=ctx).data)



from rest_framework.exceptions import PermissionDenied



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



class ChoirViewSet(viewsets.ModelViewSet):
    # select_related avoids an N+1 on created_by (+ its profile) during listing.
    queryset = Choir.objects.filter(is_removed=False).select_related('created_by', 'created_by__profile').order_by('-created_at')
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
        if self.action in ('list', 'my_choirs'):
            context['unread_by_id'] = self._unread_by_id()
        return context

    def _unread_by_id(self):
        """Map {choir_id: unread_count} for the caller's memberships — drives the
        unread badge on list rows. Bounded by how many communities they're in."""
        user = self.request.user
        if not user or not user.is_authenticated:
            return {}
        hidden = set() if user.is_super_admin else super_admin_user_ids()
        out = {}
        for cid, last_read in ChoirMembership.objects.filter(user=user).values_list('choir_id', 'last_read_at'):
            qs = (ChoirMessage.objects.filter(choir_id=cid, is_removed=False)
                  .exclude(sender_id=user.id).exclude(message_type='system')
                  .exclude(sender_id__in=hidden))
            if last_read:
                qs = qs.filter(created_at__gt=last_read)
            out[cid] = qs.count()
        return out

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
        # Super admins hold a master key over every community.
        if user and user.is_authenticated and (user.is_super_admin or choir.created_by_id == user.id):
            return True
        m = self._membership(choir, user)
        return bool(m and m.role == 'admin')

    def _is_mod(self, choir, user):
        """Admins AND moderators can moderate content (delete any message, pin)."""
        if self._is_admin(choir, user):
            return True
        m = self._membership(choir, user)
        return bool(m and m.is_moderator)

    def get_throttles(self):
        # Community chat abuse guards (the global ScopedRateThrottle reads this).
        if self.action == 'messages' and self.request.method == 'POST':
            self.throttle_scope = 'community_post'
        elif self.action == 'react_message':
            self.throttle_scope = 'community_react'
        elif self.action == 'request_join':
            self.throttle_scope = 'community_join'
        return super().get_throttles()

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
        # select_related avoids an N+1 on created_by (+ profile) when the
        # list serializer resolves the owner via SimpleUserSerializer.
        choirs = (
            Choir.objects.filter(created_by=request.user)
            .select_related('created_by', 'created_by__profile')
        )
        serializer = self.get_serializer(choirs, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='add-member')
    def add_member(self, request, pk=None):
        """Admin-only: add a user to the community directly (as a core 'member')."""
        choir = self.get_object()
        if not self._is_admin(choir, request.user):
            return Response({'error': 'Admin only.'}, status=status.HTTP_403_FORBIDDEN)
        user = User.objects.filter(id=request.data.get('user_id')).first()
        if not user:
            return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)
        membership, created = ChoirMembership.objects.get_or_create(
            choir=choir, user=user, defaults={'role': 'member'},
        )
        if created:
            choir.join_requests.filter(user=user, status='pending').update(status='approved')
            self._sync_count(choir)
            try:
                notify_user(user, 'choir_added', f"You were added to {choir.name}",
                            {'type': 'choir_added', 'choir_id': choir.id})
            except Exception:
                logger.exception('choir add notify failed')
        return Response(ChoirMembershipSerializer(membership).data,
                        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    @action(detail=True, methods=['get'], url_path='search-users')
    def search_users(self, request, pk=None):
        """Admin-only: find users by username to add, excluding current members."""
        choir = self.get_object()
        if not self._is_admin(choir, request.user):
            return Response({'error': 'Admin only.'}, status=status.HTTP_403_FORBIDDEN)
        q = (request.query_params.get('q') or '').strip()
        if len(q) < 2:
            return Response([])
        member_ids = choir.memberships.values_list('user_id', flat=True)
        users = (User.objects.filter(username__icontains=q)
                 .exclude(id__in=member_ids).select_related('profile')
                 .order_by('username')[:20])
        return Response(SimpleUserSerializer(users, many=True, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='set-role')
    def set_role(self, request, pk=None):
        """Admin-only: promote a member to admin, or dismiss an admin back to a
        member. The creator is always an admin and can't be changed."""
        choir = self.get_object()
        if not self._is_admin(choir, request.user):
            return Response({'error': 'Admin only.'}, status=status.HTTP_403_FORBIDDEN)
        role = request.data.get('role')
        if role not in ('admin', 'member'):
            return Response({'error': 'role must be "admin" or "member".'}, status=status.HTTP_400_BAD_REQUEST)
        target = choir.memberships.filter(user_id=request.data.get('user_id')).select_related('user').first()
        if not target:
            return Response({'error': 'That person is not a member.'}, status=status.HTTP_404_NOT_FOUND)
        if target.user_id == choir.created_by_id:
            return Response({'error': 'The creator is always an admin.'}, status=status.HTTP_400_BAD_REQUEST)
        if target.role != role:
            target.role = role
            target.save(update_fields=['role'])
            log_community_action('choir', choir, request.user,
                                 'grant_admin' if role == 'admin' else 'revoke_admin',
                                 f'{target.user.username} → {role}')
        return Response(ChoirMembershipSerializer(target).data)

    @action(detail=True, methods=['post'], url_path='posting-policy')
    def set_posting_policy(self, request, pk=None):
        """Admin-only: toggle the WhatsApp-style 'Only admins can send messages' lock."""
        choir = self.get_object()
        if not self._is_admin(choir, request.user):
            return Response({'error': 'Admin only.'}, status=status.HTTP_403_FORBIDDEN)
        only_admins = bool(request.data.get('only_admins_can_post'))
        if choir.only_admins_can_post != only_admins:
            choir.only_admins_can_post = only_admins
            choir.save(update_fields=['only_admins_can_post'])
            log_community_action('choir', choir, request.user, 'posting_policy',
                                 'Only admins can send messages now' if only_admins else 'Everyone can send messages now')
        return Response({'only_admins_can_post': choir.only_admins_can_post})

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
            'is_moderator': bool(m and m.is_moderator),
            'role': m.role if m else None,
            # A super admin is reported as a member so the chat unlocks for them.
            'is_member': bool(m) or is_admin,
            'has_pending_request': pending,
            # For the admin's "requests waiting" badge.
            'has_requests': is_admin and choir.join_requests.filter(status='pending').exists(),
            'only_admins_can_post': choir.only_admins_can_post,
            'created_by_id': choir.created_by_id,
            'members_count': choir.memberships.count(),
            'pinned_message': community_pinned_preview(choir.pinned_message),
        })

    @action(detail=True, methods=['get'])
    def members(self, request, pk=None):
        """Roster — visible to members of the community."""
        choir = self.get_object()
        if not self._membership(choir, request.user) and not self._is_admin(choir, request.user):
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
        log_community_action('choir', choir, request.user, 'approve_join', f'Approved {req.user.username}')
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
        log_community_action('choir', choir, request.user, 'reject_join', f'Declined {req.user.username}')
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
        removed_user = User.objects.filter(id=target_id).first()
        deleted, _ = choir.memberships.filter(user_id=target_id).delete()
        choir.join_requests.filter(user_id=target_id).delete()  # let them re-request later
        self._sync_count(choir)
        if deleted:
            log_community_action('choir', choir, request.user, 'remove_member',
                                 f'Removed {removed_user.username if removed_user else target_id}')
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
        if not self._membership(choir, request.user) and not self._is_admin(choir, request.user):
            return Response({'error': 'Join this choir to see the chat.'}, status=status.HTTP_403_FORBIDDEN)

        if request.method == 'POST':
            if choir.only_admins_can_post and not self._is_admin(choir, request.user):
                return Response({'error': 'Only admins can send messages in this community.'},
                                status=status.HTTP_403_FORBIDDEN)
            mtype = request.data.get('message_type', 'text')
            if mtype not in dict(ChoirMessage.MESSAGE_TYPES) or mtype == 'system':
                return Response({'error': 'Invalid message type.'}, status=status.HTTP_400_BAD_REQUEST)
            content = (request.data.get('content') or '').strip()
            attachment = request.data.get('attachment') or ''
            if not content and not attachment:
                return Response({'error': 'Empty message.'}, status=status.HTTP_400_BAD_REQUEST)
            att_err = chat_attachment_error(attachment)
            if att_err:
                return Response({'error': att_err[0]}, status=att_err[1])
            reply_to = None
            reply_id = request.data.get('reply_to')
            if reply_id:
                reply_to = choir.messages.filter(pk=reply_id).first()
            msg = ChoirMessage.objects.create(
                choir=choir, sender=request.user, content=content[:5000],
                message_type=mtype, attachment=attachment,
                attachment_blurhash=(request.data.get('attachment_blurhash') or '')[:60],
                file_name=(request.data.get('file_name') or '')[:255],
                duration=request.data.get('duration') or None, reply_to=reply_to,
            )
            data = ChoirMessageSerializer(msg, context={'request': request}).data
            if not request.user.is_super_admin:
                broadcast_community_message('choir', choir.id, data)
            return Response(data, status=status.HTTP_201_CREATED)

        # GET — cursor-paginated. Default = newest page; ?before/?after page in
        # either direction from an anchor message. Super admins operate invisibly,
        # so regular members never see a message (or reaction) a super admin authored.
        hidden = set() if request.user.is_super_admin else super_admin_user_ids()
        base_qs = (choir.messages
                   .filter(is_removed=False)  # hide moderator takedowns
                   .exclude(sender_id__in=hidden)
                   .select_related('sender__profile', 'reply_to__sender')
                   .prefetch_related('reactions'))
        rows, has_more = community_cursor_page(
            base_qs, request.query_params.get('before'), request.query_params.get('after'))
        data = ChoirMessageSerializer(rows, many=True,
                                      context={'request': request, 'hide_super_ids': hidden}).data
        return Response({'results': data, 'has_more': has_more})

    @action(detail=True, methods=['post'], url_path='messages/(?P<message_id>[^/.]+)/delete')
    def delete_message(self, request, pk=None, message_id=None):
        """Sender can delete their own message; admin/moderator can delete any."""
        choir = self.get_object()
        msg = get_object_or_404(ChoirMessage, pk=message_id, choir=choir)
        own = msg.sender_id == request.user.id
        if not own and not self._is_mod(choir, request.user):
            return Response({'error': 'Not allowed.'}, status=status.HTTP_403_FORBIDDEN)
        mid = msg.id
        author = msg.sender.username
        msg.delete()
        broadcast_community_deleted('choir', choir.id, mid)
        if not own:  # a moderator/admin removing someone else's message → log it
            log_community_action('choir', choir, request.user, 'delete_message', f'Deleted a message from {author}')
        return Response({'status': 'deleted'})

    @action(detail=True, methods=['post'], url_path='messages/(?P<message_id>[^/.]+)/react')
    def react_message(self, request, pk=None, message_id=None):
        """Toggle the caller's emoji reaction on a message (one per user)."""
        choir = self.get_object()
        if not self._membership(choir, request.user) and not self._is_admin(choir, request.user):
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
        hidden = set() if request.user.is_super_admin else super_admin_user_ids()
        return Response(ChoirMessageSerializer(msg, context={'request': request, 'hide_super_ids': hidden}).data)

    def _message_qs(self, choir, request):
        """The same membership-gated, super-admin-hidden message queryset the chat
        list uses — reused by search / context."""
        hidden = set() if request.user.is_super_admin else super_admin_user_ids()
        return (choir.messages
                .filter(is_removed=False)
                .exclude(sender_id__in=hidden)
                .select_related('sender__profile', 'reply_to__sender')
                .prefetch_related('reactions'))

    @action(detail=True, methods=['patch'], url_path='messages/(?P<message_id>[^/.]+)/edit')
    def edit_message(self, request, pk=None, message_id=None):
        """Edit a text message you authored; the edit is stamped and fanned out."""
        choir = self.get_object()
        msg = get_object_or_404(ChoirMessage, pk=message_id, choir=choir)
        if msg.sender_id != request.user.id:
            return Response({'error': 'You can only edit your own messages.'}, status=status.HTTP_403_FORBIDDEN)
        if msg.message_type != 'text':
            return Response({'error': 'Only text messages can be edited.'}, status=status.HTTP_400_BAD_REQUEST)
        content = (request.data.get('content') or '').strip()
        if not content:
            return Response({'error': 'Message cannot be empty.'}, status=status.HTTP_400_BAD_REQUEST)
        msg.content = content[:5000]
        msg.edited_at = timezone.now()
        msg.save(update_fields=['content', 'edited_at'])
        hidden = set() if request.user.is_super_admin else super_admin_user_ids()
        data = ChoirMessageSerializer(msg, context={'request': request, 'hide_super_ids': hidden}).data
        if not request.user.is_super_admin:
            broadcast_community_edited('choir', choir.id, data)
        return Response(data)

    @action(detail=True, methods=['post'], url_path='mark-read')
    def mark_read(self, request, pk=None):
        """Stamp the caller's last_read_at to now (drives unread counts + receipts)."""
        choir = self.get_object()
        m = self._membership(choir, request.user)
        if m:
            m.last_read_at = timezone.now()
            m.save(update_fields=['last_read_at'])
        return Response({'status': 'ok'})

    @action(detail=True, methods=['get'], url_path='messages/(?P<message_id>[^/.]+)/receipts')
    def receipts(self, request, pk=None, message_id=None):
        """Who has read this message — a member counts once their last_read_at
        reaches the message's timestamp. Author + hidden super-admins excluded."""
        choir = self.get_object()
        if not self._membership(choir, request.user) and not self._is_admin(choir, request.user):
            return Response({'error': 'Members only.'}, status=status.HTTP_403_FORBIDDEN)
        msg = get_object_or_404(ChoirMessage, pk=message_id, choir=choir)
        hidden = set() if request.user.is_super_admin else super_admin_user_ids()
        readers = (choir.memberships
                   .filter(last_read_at__gte=msg.created_at)
                   .exclude(user_id=msg.sender_id)
                   .exclude(user_id__in=hidden)
                   .select_related('user__profile')
                   .order_by('-last_read_at'))
        data = ChoirMembershipSerializer(readers, many=True).data
        return Response({'count': len(data), 'readers': data})

    @action(detail=True, methods=['get'])
    def search(self, request, pk=None):
        """Search a choir's text messages (members-only, newest first, min 2 chars)."""
        choir = self.get_object()
        if not self._membership(choir, request.user) and not self._is_admin(choir, request.user):
            return Response({'error': 'Members only.'}, status=status.HTTP_403_FORBIDDEN)
        q = (request.query_params.get('q') or '').strip()
        if len(q) < 2:
            return Response({'results': []})
        hidden = set() if request.user.is_super_admin else super_admin_user_ids()
        qs = (self._message_qs(choir, request)
              .filter(message_type='text', content__icontains=q)
              .order_by('-created_at')[:50])
        data = ChoirMessageSerializer(qs, many=True,
                                      context={'request': request, 'hide_super_ids': hidden}).data
        return Response({'results': data})

    @action(detail=True, methods=['get'])
    def context(self, request, pk=None):
        """A window of messages around a given one (for jumping to a search hit).
        Members-only. Returns the window plus flags for older/newer beyond it."""
        choir = self.get_object()
        if not self._membership(choir, request.user) and not self._is_admin(choir, request.user):
            return Response({'error': 'Members only.'}, status=status.HTTP_403_FORBIDDEN)
        message_id = request.query_params.get('message_id')
        radius = 20
        base = self._message_qs(choir, request)
        target = base.filter(pk=message_id).first() if message_id else None
        if not target:
            return Response({'results': [], 'has_earlier': False, 'has_newer': False})
        older = list(base.filter(created_at__lte=target.created_at).order_by('-created_at')[:radius + 1])
        newer = list(base.filter(created_at__gt=target.created_at).order_by('created_at')[:radius])
        window = older[::-1] + newer
        has_earlier = base.filter(created_at__lt=target.created_at).count() > radius
        has_newer = base.filter(created_at__gt=target.created_at).count() > radius
        hidden = set() if request.user.is_super_admin else super_admin_user_ids()
        return Response({
            'results': ChoirMessageSerializer(window, many=True,
                                              context={'request': request, 'hide_super_ids': hidden}).data,
            'has_earlier': has_earlier,
            'has_newer': has_newer,
        })

    @action(detail=True, methods=['post'], url_path='messages/(?P<message_id>[^/.]+)/pin')
    def pin_message(self, request, pk=None, message_id=None):
        """Admin/moderator pins one message as a banner atop the chat."""
        choir = self.get_object()
        if not self._is_mod(choir, request.user):
            return Response({'error': 'Only admins can pin messages.'}, status=status.HTTP_403_FORBIDDEN)
        msg = get_object_or_404(ChoirMessage, pk=message_id, choir=choir)
        choir.pinned_message = msg
        choir.save(update_fields=['pinned_message'])
        preview = community_pinned_preview(msg)
        broadcast_community_pinned('choir', choir.id, preview)
        log_community_action('choir', choir, request.user, 'pin', 'Pinned a message')
        return Response(preview)

    @action(detail=True, methods=['post'], url_path='unpin')
    def unpin_message(self, request, pk=None):
        choir = self.get_object()
        if not self._is_mod(choir, request.user):
            return Response({'error': 'Only admins can unpin messages.'}, status=status.HTTP_403_FORBIDDEN)
        choir.pinned_message = None
        choir.save(update_fields=['pinned_message'])
        broadcast_community_pinned('choir', choir.id, None)
        log_community_action('choir', choir, request.user, 'unpin', 'Unpinned the message')
        return Response({'status': 'unpinned'})

    @action(detail=True, methods=['post'], url_path='set-moderator')
    def set_moderator(self, request, pk=None):
        """Promote a member to moderator or dismiss them. Admins only."""
        choir = self.get_object()
        if not self._is_admin(choir, request.user):
            return Response({'error': 'Only admins can change roles.'}, status=status.HTTP_403_FORBIDDEN)
        user_id = request.data.get('user_id')
        make_mod = bool(request.data.get('is_moderator', True))
        target = choir.memberships.filter(user_id=user_id).select_related('user').first()
        if not target:
            return Response({'error': 'That person is not a member.'}, status=status.HTTP_404_NOT_FOUND)
        if target.is_moderator != make_mod:
            target.is_moderator = make_mod
            target.save(update_fields=['is_moderator'])
            verb = 'is now a moderator' if make_mod else 'is no longer a moderator'
            log_community_action('choir', choir, request.user,
                                 'grant_moderator' if make_mod else 'revoke_moderator',
                                 f'{target.user.username} {verb}')
        return Response(ChoirMembershipSerializer(target).data)

    @action(detail=True, methods=['get'], url_path='audit-log')
    def audit_log(self, request, pk=None):
        """The community's moderation trail. Visible to admins and moderators only."""
        choir = self.get_object()
        if not self._is_mod(choir, request.user):
            return Response({'error': 'Only admins and moderators can view the log.'}, status=status.HTTP_403_FORBIDDEN)
        qs = (CommunityAuditLog.objects
              .filter(kind='choir', community_id=choir.id)
              .select_related('actor__profile'))
        page = self.paginate_queryset(qs)
        if page is not None:
            return self.get_paginated_response(CommunityAuditLogSerializer(page, many=True).data)
        return Response(CommunityAuditLogSerializer(qs, many=True).data)

    @action(detail=True, methods=['get'])
    def media(self, request, pk=None):
        """Every image / file / voice note shared in the choir, newest first
        (members-only — reuses the same membership gate as the message list)."""
        choir = self.get_object()
        if not self._membership(choir, request.user) and not self._is_admin(choir, request.user):
            return Response({'error': 'Members only.'}, status=status.HTTP_403_FORBIDDEN)
        hidden = set() if request.user.is_super_admin else super_admin_user_ids()
        qs = (self._message_qs(choir, request)
              .filter(message_type__in=['image', 'file', 'audio'])
              .order_by('-created_at'))
        page = self.paginate_queryset(qs)
        ctx = {'request': request, 'hide_super_ids': hidden}
        if page is not None:
            return self.get_paginated_response(ChoirMessageSerializer(page, many=True, context=ctx).data)
        return Response(ChoirMessageSerializer(qs, many=True, context=ctx).data)


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

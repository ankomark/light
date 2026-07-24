import uuid
from datetime import datetime, timedelta, timezone as dt_timezone

from django.db.models import (
    OuterRef, Subquery, Exists, Count, Value, IntegerField, DateTimeField,
)
from django.db.models.functions import Coalesce

from .common import *  # noqa: F401,F403
from ..consumers import (
    broadcast_group_message, broadcast_group_deleted, broadcast_group_pinned, broadcast_group_edited,
)
from ..serializers.groups import pinned_preview, GroupAuditLogSerializer

# Floor for "never read this group" — Coalesced in for a NULL last_read_at so a
# never-opened group counts every message as unread (matches the old behaviour).
EPOCH = datetime(1970, 1, 1, tzinfo=dt_timezone.utc)

# How long after a rejection before someone may request to join again.
REJOIN_COOLDOWN_DAYS = 7


def group_system_message(group, text, actor):
    """Create a 'system' notice in the group chat (e.g. 'X joined')."""
    return GroupPost.objects.create(
        group=group, user=actor, message_type='system', content=text,
    )


def log_group_action(group, actor, action, detail=''):
    """Record an admin/moderator action in the group's audit trail."""
    GroupAuditLog.objects.create(group=group, actor=actor, action=action, detail=(detail or '')[:300])


@method_decorator(cache_control(no_cache=True, no_store=True, must_revalidate=True), name='dispatch')
class GroupViewSet(viewsets.ModelViewSet):
    queryset = Group.objects.all().order_by('-created_at')
    serializer_class = GroupSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination
    lookup_field = 'slug'
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def _hidden_ids(self):
        """Super-admin user ids to hide from this viewer (empty when the viewer
        is themselves a super admin — they see everyone)."""
        u = self.request.user
        return set() if (u.is_authenticated and u.is_super_admin) else super_admin_user_ids()

    def _annotate(self, qs):
        """Fold the per-row serializer lookups (member count, my membership/role,
        pending request, unread count, last message) into the list query as
        subqueries. Without this the group list ran ~6 queries PER row; this
        makes it a fixed handful regardless of page size. The serializer reads
        these annotations when present and falls back to live lookups for the
        un-annotated single-object (detail) responses."""
        user = self.request.user
        if not user.is_authenticated:
            return qs
        hidden = list(self._hidden_ids())

        member_count = (GroupMember.objects.filter(group=OuterRef('pk'))
                        .order_by().values('group').annotate(c=Count('id')).values('c'))
        my_member = GroupMember.objects.filter(group=OuterRef('pk'), user=user)
        pending = GroupJoinRequest.objects.filter(group=OuterRef('pk'), user=user, status='pending')

        # Latest visible post's fields (excludes super-admin-authored posts).
        last = (GroupPost.objects.filter(group=OuterRef('pk'))
                .exclude(user_id__in=hidden).order_by('-created_at'))

        # Unread = my group's posts after my last_read_at, minus my own/system/
        # hidden. The nested subquery resolves my last_read for this same group.
        my_last_read = (GroupMember.objects
                        .filter(group=OuterRef('group'), user=user).values('last_read_at')[:1])
        unread = (GroupPost.objects.filter(group=OuterRef('pk'))
                  .exclude(user=user).exclude(message_type='system').exclude(user_id__in=hidden)
                  .filter(created_at__gt=Coalesce(
                      Subquery(my_last_read, output_field=DateTimeField()),
                      Value(EPOCH, output_field=DateTimeField()),
                  ))
                  .order_by().values('group').annotate(c=Count('id')).values('c'))

        return qs.select_related(
            'creator', 'creator__profile', 'pinned_post', 'pinned_post__user',
        ).annotate(
            anno_member_count=Coalesce(Subquery(member_count, output_field=IntegerField()), 0),
            anno_is_member=Exists(my_member),
            anno_is_admin=Exists(my_member.filter(is_admin=True)),
            anno_is_moderator=Exists(my_member.filter(is_moderator=True)),
            anno_has_pending=Exists(pending),
            anno_unread=Coalesce(Subquery(unread, output_field=IntegerField()), 0),
            anno_last_id=Subquery(last.values('id')[:1]),
            anno_last_content=Subquery(last.values('content')[:1]),
            anno_last_type=Subquery(last.values('message_type')[:1]),
            anno_last_file=Subquery(last.values('file_name')[:1]),
            anno_last_sender=Subquery(last.values('user__username')[:1]),
            anno_last_at=Subquery(last.values('created_at')[:1]),
        )

    def get_queryset(self):
        # For authenticated users
        if self.request.user.is_authenticated:
            # Super admins hold a master key: every group, public or private.
            if self.request.user.is_super_admin:
                base = Group.objects.filter(is_removed=False).order_by('-created_at')
            else:
                base = Group.objects.filter(
                    Q(is_private=False) |  # Show all public groups
                    Q(creator=self.request.user) |  # Show groups user created
                    Q(members__user=self.request.user)  # Show groups user is member of
                ).filter(is_removed=False).distinct().order_by('-created_at')
            return self._annotate(base)
        # For unauthenticated users (if needed)
        return Group.objects.filter(is_private=False, is_removed=False).order_by('-created_at')

    def get_permissions(self):
        if self.action in ['update', 'partial_update', 'destroy']:
            self.permission_classes = [IsAuthenticated, IsGroupCreator]
        return super().get_permissions()

    def get_throttles(self):
        # Cap mass join-request spam (the global ScopedRateThrottle reads this).
        if self.action in ('request_join', 'join_by_code'):
            self.throttle_scope = 'group_join'
        return super().get_throttles()

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        # Hide super-admin-authored posts from a regular viewer's unread count and
        # last-message preview (super admins themselves see everyone).
        context['hide_super_ids'] = self._hidden_ids()
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
        if not (request.user.is_super_admin or GroupMember.objects.filter(group=group, user=request.user).exists()):
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

        message = request.data.get('message', '')
        # One row per (group, user) — reopen the existing one instead of inserting
        # a duplicate (which would hit the unique constraint).
        existing = GroupJoinRequest.objects.filter(group=group, user=request.user).first()
        if existing:
            if existing.status == 'pending':
                return Response(
                    {"error": "You already have a pending request to join this group"},
                    status=status.HTTP_400_BAD_REQUEST
                )
            if existing.status == 'rejected':
                # Cooldown after a rejection before they can ask again.
                cooldown_end = existing.updated_at + timedelta(days=REJOIN_COOLDOWN_DAYS)
                if timezone.now() < cooldown_end:
                    return Response(
                        {"error": f"Your request was declined. You can request again after "
                                  f"{cooldown_end.date().isoformat()}."},
                        status=status.HTTP_400_BAD_REQUEST
                    )
            existing.status = 'pending'
            existing.message = message
            existing.save(update_fields=['status', 'message', 'updated_at'])
            join_request = existing
        else:
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
                group=group,
            )
            notify_user(admin.user, 'group_join_request', msg,
                        data={'groupSlug': group.slug, 'type': 'group_join_request'})
        
        serializer = GroupJoinRequestSerializer(join_request)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


    @action(detail=True, methods=['post'], url_path='remove-member')
    def remove_member(self, request, slug=None):
        group = self.get_object()
        if not (request.user.is_super_admin or GroupMember.objects.filter(group=group, user=request.user, is_admin=True).exists()):
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
            log_group_action(group, request.user, 'remove_member', f"Removed {uname}")
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='set-admin')
    def set_admin(self, request, slug=None):
        """Promote a member to admin or dismiss them as admin. Admins only.
        The group creator is always an admin and cannot be demoted."""
        group = self.get_object()
        if not (request.user.is_super_admin or GroupMember.objects.filter(group=group, user=request.user, is_admin=True).exists()):
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
            log_group_action(group, request.user, 'grant_admin' if make_admin else 'revoke_admin',
                             f"{target.user.username} {verb}")
        return Response(GroupMemberSerializer(target, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='set-moderator')
    def set_moderator(self, request, slug=None):
        """Promote a member to moderator or dismiss them. Admins only. Moderators
        can moderate content but not manage membership or settings."""
        group = self.get_object()
        if not (request.user.is_super_admin or GroupMember.objects.filter(group=group, user=request.user, is_admin=True).exists()):
            raise PermissionDenied("Only admins can change roles")

        user_id = request.data.get('user_id')
        make_mod = bool(request.data.get('is_moderator', True))
        if not user_id:
            return Response({"error": "user_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        target = GroupMember.objects.filter(group=group, user_id=user_id).select_related('user').first()
        if not target:
            return Response({"error": "That person is not a member"}, status=status.HTTP_404_NOT_FOUND)

        if target.is_moderator != make_mod:
            target.is_moderator = make_mod
            target.save(update_fields=['is_moderator'])
            verb = "is now a moderator" if make_mod else "is no longer a moderator"
            group_system_message(group, f"{target.user.username} {verb}", request.user)
            log_group_action(group, request.user, 'grant_moderator' if make_mod else 'revoke_moderator',
                             f"{target.user.username} {verb}")
        return Response(GroupMemberSerializer(target, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='posting-policy')
    def set_posting_policy(self, request, slug=None):
        """Toggle the WhatsApp-style 'Only admins can send messages' lock. Admins only."""
        group = self.get_object()
        if not (request.user.is_super_admin or GroupMember.objects.filter(group=group, user=request.user, is_admin=True).exists()):
            raise PermissionDenied("Only admins can change this setting")

        only_admins = bool(request.data.get('only_admins_can_post'))
        if group.only_admins_can_post != only_admins:
            group.only_admins_can_post = only_admins
            group.save(update_fields=['only_admins_can_post'])
            msg = "Only admins can send messages now" if only_admins else "Everyone can send messages now"
            group_system_message(group, msg, request.user)
            log_group_action(group, request.user, 'posting_policy', msg)
        return Response(GroupSerializer(group, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='join-question')
    def set_join_question(self, request, slug=None):
        """Set (or clear) the prompt shown to people requesting to join. Admins only."""
        group = self.get_object()
        if not (request.user.is_super_admin or GroupMember.objects.filter(group=group, user=request.user, is_admin=True).exists()):
            raise PermissionDenied("Only admins can change this setting")
        group.join_question = (request.data.get('join_question') or '').strip()[:200]
        group.save(update_fields=['join_question'])
        log_group_action(group, request.user, 'join_question',
                         'Set a join question' if group.join_question else 'Removed the join question')
        return Response(GroupSerializer(group, context={'request': request}).data)

    @action(detail=True, methods=['get'], url_path='audit-log')
    def audit_log(self, request, slug=None):
        """The group's moderation trail. Visible to admins and moderators only."""
        group = self.get_object()
        is_staff = request.user.is_super_admin or GroupMember.objects.filter(
            group=group, user=request.user).filter(Q(is_admin=True) | Q(is_moderator=True)).exists()
        if not is_staff:
            raise PermissionDenied("Only admins and moderators can view the log")
        qs = group.audit_logs.select_related('actor', 'actor__profile')
        page = self.paginate_queryset(qs)
        if page is not None:
            return self.get_paginated_response(
                GroupAuditLogSerializer(page, many=True, context={'request': request}).data)
        return Response(GroupAuditLogSerializer(qs, many=True, context={'request': request}).data)

    @action(detail=True, methods=['get'], url_path='search-users')
    def search_users(self, request, slug=None):
        """Admin-only: find users by username to add to the group (excludes
        people who are already members)."""
        group = self.get_object()
        if not (request.user.is_super_admin or GroupMember.objects.filter(group=group, user=request.user, is_admin=True).exists()):
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
        if not (request.user.is_super_admin or GroupMember.objects.filter(group=group, user=request.user, is_admin=True).exists()):
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
        if not (request.user.is_super_admin or GroupMember.objects.filter(group=group, user=request.user, is_admin=True).exists()):
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
        sa = request.user.is_super_admin
        is_member = sa or GroupMember.objects.filter(group=group, user=request.user).exists()
        is_admin = sa or GroupMember.objects.filter(
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
            # Upload to R2; store the public URL as the reference.
            group.cover_image = r2.upload_file(request.FILES['cover_image'], 'group_covers')
            group.save()
            return Response(
                GroupSerializer(group, context={'request': request}).data,
                status=status.HTTP_200_OK
            )
        except Exception as e:
            logger.error(f"Group cover upload to R2 failed: {e}", exc_info=True)
            return Response(
                {"error": "Cover upload failed. Please try again."},
                status=status.HTTP_400_BAD_REQUEST
            )



class GroupPostViewSet(viewsets.ModelViewSet):
    queryset = GroupPost.objects.all()
    serializer_class = GroupPostSerializer
    permission_classes = [IsAuthenticated, IsOwnerOrReadOnly]
    pagination_class = StandardPagination
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_throttles(self):
        # Rate-limit writes only (the global ScopedRateThrottle reads this attr);
        # reads keep the default user/anon throttles. Sending is capped tighter
        # than reacting since a spam message is more disruptive than a spam tap.
        if self.action == 'create':
            self.throttle_scope = 'group_post'
        elif self.action == 'react':
            self.throttle_scope = 'group_react'
        return super().get_throttles()

    def get_permissions(self):
        # Moderation actions (delete/pin/unpin) do their own author-or-moderator
        # check, so drop IsOwnerOrReadOnly — otherwise a mod/admin couldn't act on
        # someone else's message. Editing stays owner-only.
        if self.action in ('destroy', 'pin_message', 'unpin_message'):
            self.permission_classes = [IsAuthenticated]
        return super().get_permissions()

    def _hidden_ids(self):
        """Super-admin user ids to hide from this viewer (empty when the viewer
        is themselves a super admin — they see everyone)."""
        if not hasattr(self, '_hidden_ids_cache'):
            u = self.request.user
            self._hidden_ids_cache = (
                set() if (u.is_authenticated and u.is_super_admin) else super_admin_user_ids()
            )
        return self._hidden_ids_cache

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['hide_super_ids'] = self._hidden_ids()
        return ctx

    def get_queryset(self):
        group_slug = self.kwargs.get('group_slug')
        group = get_object_or_404(Group, slug=group_slug)
        # Group chats are members-only — for public groups too. A non-member must
        # be approved (request-join → admin approval, or an invite) before they can
        # read any messages; the public group is discoverable, its chat is not.
        if (not self.request.user.is_super_admin
                and not GroupMember.objects.filter(group=group, user=self.request.user).exists()):
            raise PermissionDenied("You are not a member of this group")
        # Newest first (paginated); the chat reverses for chronological display.
        # Super admins operate invisibly — regular clients never see a message a
        # super admin authored (an empty exclude set is a no-op for super admins).
        return (
            GroupPost.objects
            .filter(group=group, is_removed=False)  # hide moderator takedowns
            .exclude(user_id__in=self._hidden_ids())
            .select_related('user__profile', 'reply_to__user')
            .prefetch_related('attachments', 'reactions')
            .order_by('-created_at')
        )

    def perform_create(self, serializer):
        group_slug = self.kwargs.get('group_slug')
        group = get_object_or_404(Group, slug=group_slug)

        member = GroupMember.objects.filter(group=group, user=self.request.user).first()
        is_super = self.request.user.is_super_admin
        if not member and not is_super:
            raise PermissionDenied("You are not a member of this group")
        if group.only_admins_can_post and not (is_super or (member and member.is_admin)):
            raise PermissionDenied("Only admins can send messages in this group")

        # A message needs text or an attachment.
        content = (serializer.validated_data.get('content') or '').strip()
        attachment = serializer.validated_data.get('attachment') or ''
        if not content and not attachment:
            raise ValidationError({'detail': 'Message cannot be empty'})

        # Attachments must be an R2 https URL. Media is uploaded straight to R2
        # (presigned PUT) and only the URL is stored — inline base64 data URIs are
        # no longer accepted, so a new message can never bloat the DB. Legacy rows
        # that still hold a data URI keep rendering on read; this guards writes.
        if attachment:
            if not attachment.startswith('https://'):
                raise ValidationError(
                    {'detail': 'Attachments must be uploaded — inline data is not allowed.'}
                )
            if len(attachment) > 2000:
                raise ValidationError({'detail': 'Invalid attachment URL'})

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
            file_url = r2.upload_file(file, 'group_posts', content_type=mime_type)
            GroupPostAttachment.objects.create(post=post, file=file_url, file_type=file_type)

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
        # Realtime fan-out to the group's socket room. Super-admin messages are
        # invisible to regular members, so they are never broadcast (the admin's
        # own optimistic bubble + fallback poll still show them their message).
        if not request.user.is_super_admin:
            broadcast_group_message(post.group.slug, complete_serializer.data)
        headers = self.get_success_headers(complete_serializer.data)
        return Response(complete_serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        # The author, or any moderator/admin, may delete a message.
        if instance.user_id != request.user.id and not self._is_group_mod(instance.group):
            return Response(
                {"error": "You don't have permission to delete this post"},
                status=status.HTTP_403_FORBIDDEN
            )
        group_obj, post_id = instance.group, instance.id
        was_pinned = group_obj.pinned_post_id == instance.id
        author_name = instance.user.username if instance.user_id else '?'
        moderated = instance.user_id != request.user.id
        self.perform_destroy(instance)  # SET_NULL clears pinned_post automatically
        broadcast_group_deleted(group_obj.slug, post_id)
        if was_pinned:
            broadcast_group_pinned(group_obj.slug, None)
        if moderated:  # a mod/admin removing someone else's message — worth logging
            log_group_action(group_obj, request.user, 'delete_message', f"Deleted a message from {author_name}")
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['patch'], url_path='edit')
    def edit_message(self, request, *args, **kwargs):
        """Edit a text message you authored. Only the body changes; the edit is
        stamped and fanned out to the group so everyone sees it update live."""
        post = self.get_object()
        if post.user_id != request.user.id:
            return Response({'error': 'You can only edit your own messages'},
                            status=status.HTTP_403_FORBIDDEN)
        if post.message_type != 'text':
            return Response({'error': 'Only text messages can be edited'},
                            status=status.HTTP_400_BAD_REQUEST)
        content = (request.data.get('content') or '').strip()
        if not content:
            return Response({'error': 'Message cannot be empty'},
                            status=status.HTTP_400_BAD_REQUEST)
        post.content = content
        post.edited_at = timezone.now()
        post.save(update_fields=['content', 'edited_at', 'updated_at'])
        data = self.get_serializer(post).data
        # Update in place for everyone (no scroll). Skip super-admin-authored
        # messages, which are invisible to regular members (mirrors create()).
        if not request.user.is_super_admin:
            broadcast_group_edited(post.group.slug, data)
        return Response(data)

    def _is_group_admin(self, group):
        u = self.request.user
        return u.is_super_admin or GroupMember.objects.filter(
            group=group, user=u, is_admin=True).exists()

    def _is_group_mod(self, group):
        """Admins AND moderators can moderate content (delete any message, pin)."""
        u = self.request.user
        return u.is_super_admin or GroupMember.objects.filter(
            group=group, user=u).filter(Q(is_admin=True) | Q(is_moderator=True)).exists()

    @action(detail=True, methods=['get'], url_path='receipts')
    def receipts(self, request, *args, **kwargs):
        """Who has read this message — a member counts as having read it once their
        last_read_at reaches the message's timestamp. Author + hidden super-admins
        excluded. Members-only (get_object enforces the same gate as the list)."""
        post = self.get_object()
        readers = (
            GroupMember.objects
            .filter(group=post.group, last_read_at__gte=post.created_at)
            .exclude(user_id=post.user_id)
            .exclude(user_id__in=self._hidden_ids())
            .select_related('user', 'user__profile')
            .order_by('-last_read_at')
        )
        data = GroupMemberSerializer(readers, many=True, context=self.get_serializer_context()).data
        return Response({'count': len(data), 'readers': data})

    @action(detail=False, methods=['get'], url_path='search')
    def search(self, request, *args, **kwargs):
        """Full-text-ish search over a group's text messages (members-only,
        newest first). Needs at least 2 chars."""
        q = (request.query_params.get('q') or '').strip()
        if len(q) < 2:
            return Response({'results': []})
        qs = self.get_queryset().filter(message_type='text', content__icontains=q)
        page = self.paginate_queryset(qs)
        if page is not None:
            return self.get_paginated_response(self.get_serializer(page, many=True).data)
        return Response(self.get_serializer(qs, many=True).data)

    @action(detail=False, methods=['get'], url_path='context')
    def context(self, request, *args, **kwargs):
        """A window of messages around a given one (for jumping to a search hit
        that isn't currently loaded). Members-only. Returns the window plus flags
        for whether older/newer messages exist beyond it."""
        message_id = request.query_params.get('message_id')
        radius = 20
        base = self.get_queryset()  # membership-gated, group-scoped
        target = base.filter(pk=message_id).first() if message_id else None
        if not target:
            return Response({'results': [], 'has_earlier': False, 'has_newer': False})
        # `older` = target + up to `radius` older (newest-first); reverse to ascending.
        older = list(base.filter(created_at__lte=target.created_at).order_by('-created_at')[:radius + 1])
        newer = list(base.filter(created_at__gt=target.created_at).order_by('created_at')[:radius])
        window = older[::-1] + newer
        has_earlier = base.filter(created_at__lt=target.created_at).count() > radius
        has_newer = base.filter(created_at__gt=target.created_at).count() > radius
        return Response({
            'results': self.get_serializer(window, many=True).data,
            'has_earlier': has_earlier,
            'has_newer': has_newer,
        })

    @action(detail=False, methods=['get'], url_path='media')
    def media(self, request, *args, **kwargs):
        """Every image / file / voice note shared in the group, newest first
        (members-only — reuses the same membership gate as the message list)."""
        qs = self.get_queryset().filter(message_type__in=['image', 'file', 'audio'])
        page = self.paginate_queryset(qs)
        if page is not None:
            return self.get_paginated_response(self.get_serializer(page, many=True).data)
        return Response(self.get_serializer(qs, many=True).data)

    @action(detail=True, methods=['post'], url_path='pin')
    def pin_message(self, request, *args, **kwargs):
        """Admin pins this message to the top of the chat (one per group)."""
        post = self.get_object()
        if not self._is_group_mod(post.group):
            return Response({'error': 'Only admins can pin messages'},
                            status=status.HTTP_403_FORBIDDEN)
        group = post.group
        group.pinned_post = post
        group.save(update_fields=['pinned_post'])
        preview = pinned_preview(post)
        broadcast_group_pinned(group.slug, preview)
        log_group_action(group, request.user, 'pin', 'Pinned a message')
        return Response(preview)

    @action(detail=True, methods=['post'], url_path='unpin')
    def unpin_message(self, request, *args, **kwargs):
        post = self.get_object()
        if not self._is_group_mod(post.group):
            return Response({'error': 'Only admins can unpin messages'},
                            status=status.HTTP_403_FORBIDDEN)
        group = post.group
        group.pinned_post = None
        group.save(update_fields=['pinned_post'])
        broadcast_group_pinned(group.slug, None)
        log_group_action(group, request.user, 'unpin', 'Unpinned the message')
        return Response({'status': 'unpinned'})

    @action(detail=True, methods=['post'], url_path='react', permission_classes=[IsAuthenticated])
    def react(self, request, *args, **kwargs):
        """Toggle the caller's emoji reaction on a post (one per user). Any group
        member may react — not just the post's owner — so this action overrides
        the viewset's IsOwnerOrReadOnly and checks membership itself."""
        post = self.get_object()
        if not request.user.is_super_admin and not GroupMember.objects.filter(group=post.group, user=request.user).exists():
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

        # Tell the requester they're in — tapping the alert opens the group chat.
        group = join_request.group
        msg = f"Your request to join {group.name} was approved"
        Notification.objects.create(
            recipient=join_request.user,
            sender=request.user,
            message=msg,
            notification_type='group_join_approved',
            group=group,
        )
        notify_user(join_request.user, 'group_join_approved', msg,
                    data={'groupSlug': group.slug, 'type': 'group_join_approved'})
        log_group_action(group, request.user, 'approve_join', f"Approved {join_request.user.username}")

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

        group = join_request.group
        msg = f"Your request to join {group.name} was declined"
        Notification.objects.create(
            recipient=join_request.user,
            sender=request.user,
            message=msg,
            notification_type='group_join_rejected',
            group=group,
        )
        notify_user(join_request.user, 'group_join_rejected', msg,
                    data={'groupSlug': group.slug, 'type': 'group_join_rejected'})
        log_group_action(group, request.user, 'reject_join', f"Declined {join_request.user.username}")

        return Response({"status": "Request rejected"}, status=status.HTTP_200_OK)






# Add to existing views.py


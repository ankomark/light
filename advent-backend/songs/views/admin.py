from .common import *  # noqa: F401,F403  (DRF symbols, models, StandardPagination, Q, timezone, timedelta)
from django.db.models import OuterRef, Subquery
from ..models import AdminActionLog
from ..serializers import (
    AdminUserSerializer,
    AdminReportSerializer,
    AdminActionLogSerializer,
    AdminContentPostSerializer,
    AdminContentTrackSerializer,
    AdminContentCommentSerializer,
    AdminContentTrackCommentSerializer,
    AdminContentGroupSerializer,
    AdminContentStorySerializer,
)

# Strikes at/after which a warning auto-escalates to a temporary suspension.
STRIKE_SUSPEND_THRESHOLD = 3
STRIKE_SUSPEND_DAYS = 7


# ── Permissions ──────────────────────────────────────────────────────────────
class IsModerator(BasePermission):
    """Moderator or Super Admin (or Django superuser)."""
    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and u.is_platform_admin)


class IsSuperAdmin(BasePermission):
    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and u.is_super_admin)


# ── Helpers ──────────────────────────────────────────────────────────────────
# Soft-removable content types (also the targets `remove_target` can act on).
_CONTENT_MODELS = {
    'post': SocialPost,
    'comment': PostComment,       # comments on social posts
    'track': Track,
    'trackcomment': Comment,      # comments on tracks
    'group': Group,
    'story': Story,
}


def log_admin_action(actor, action, target_type='', target_id=None, reason=''):
    try:
        AdminActionLog.objects.create(
            actor=actor, action=action, target_type=target_type or '',
            target_id=target_id, reason=reason or '',
        )
    except Exception:
        logger.exception('Failed to write AdminActionLog')


def notify_moderation(user, subject, message):
    """Tell a user about a moderation action — in-app push + email. Best-effort:
    a failure here must never break the moderator's action."""
    try:
        notify_user(user, 'system', message)
    except Exception:
        logger.exception('Moderation push failed')
    try:
        from django.core.mail import send_mail
        if user.email:
            send_mail(
                subject=f"{getattr(settings, 'SITE_NAME', 'Advent Light')} — {subject}",
                message=f"Hi {user.username},\n\n{message}\n\n— {getattr(settings, 'SITE_NAME', 'Advent Light')} Team",
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[user.email],
                fail_silently=True,
            )
    except Exception:
        logger.exception('Moderation email failed')


def _soft_remove(content_type, object_id, removed=True):
    """Toggle is_removed on a post/comment/track. Returns True on success."""
    Model = _CONTENT_MODELS.get(content_type)
    if not Model or not object_id:
        return False
    obj = Model.objects.filter(id=object_id).first()
    if not obj:
        return False
    obj.is_removed = removed
    obj.save(update_fields=['is_removed'])
    return True


def _paginated(view, qs, serializer_cls):
    page = view.paginate_queryset(qs)
    if page is not None:
        return view.get_paginated_response(serializer_cls(page, many=True).data)
    return Response(serializer_cls(qs, many=True).data)


# ── Dashboard ────────────────────────────────────────────────────────────────
class AdminDashboardView(APIView):
    permission_classes = [IsModerator]

    def get(self, request):
        now = timezone.now()
        day_ago = now - timedelta(days=1)
        week_ago = now - timedelta(days=7)
        recent_reports = Report.objects.select_related('reporter').order_by('-created_at')[:10]
        recent_users = User.objects.order_by('-date_joined')[:10]
        return Response({
            'totals': {
                'users': User.objects.count(),
                'posts': SocialPost.objects.count(),
                'tracks': Track.objects.count(),
                'comments': PostComment.objects.count(),
            },
            'signups': {
                'last_24h': User.objects.filter(date_joined__gte=day_ago).count(),
                'last_7d': User.objects.filter(date_joined__gte=week_ago).count(),
            },
            'reports': {
                'pending': Report.objects.filter(status='pending').count(),
                'total': Report.objects.count(),
            },
            'moderation': {
                'suspended': User.objects.filter(is_suspended=True).count(),
                'banned': User.objects.filter(is_active=False).count(),
                'removed_posts': SocialPost.objects.filter(is_removed=True).count(),
            },
            'recent_reports': AdminReportSerializer(recent_reports, many=True).data,
            'recent_users': AdminUserSerializer(recent_users, many=True).data,
        })


# ── Reports queue ────────────────────────────────────────────────────────────
class AdminReportViewSet(viewsets.GenericViewSet):
    permission_classes = [IsModerator]
    pagination_class = StandardPagination
    serializer_class = AdminReportSerializer

    def get_queryset(self):
        # Annotate how many reports target the same content (the "5 people
        # reported this" badge) with one correlated subquery instead of N+1.
        dup = (
            Report.objects
            .filter(content_type=OuterRef('content_type'), object_id=OuterRef('object_id'))
            .order_by().values('content_type', 'object_id')
            .annotate(c=Count('*')).values('c')[:1]
        )
        qs = (
            Report.objects
            .select_related('reporter', 'assigned_to', 'resolved_by')
            .annotate(dup_count=Subquery(dup))
            .order_by('-created_at')
        )
        status_f = self.request.query_params.get('status')
        if status_f in dict(Report.STATUS_CHOICES):
            qs = qs.filter(status=status_f)
        if self.request.query_params.get('assigned') == 'me':
            qs = qs.filter(assigned_to=self.request.user)
        return qs

    def list(self, request):
        return _paginated(self, self.get_queryset(), AdminReportSerializer)

    def retrieve(self, request, pk=None):
        report = get_object_or_404(Report, pk=pk)
        return Response(self.get_serializer(report).data)

    def _set_status(self, request, pk, new_status, action_name):
        report = get_object_or_404(Report, pk=pk)
        report.status = new_status
        report.resolved_by = request.user
        report.resolved_at = timezone.now()
        report.save(update_fields=['status', 'resolved_by', 'resolved_at'])
        log_admin_action(request.user, action_name, 'report', report.id)
        return Response(self.get_serializer(report).data)

    @action(detail=True, methods=['post'])
    def assign(self, request, pk=None):
        # Toggle assignment to the acting moderator (claim / release).
        report = get_object_or_404(Report, pk=pk)
        report.assigned_to = None if report.assigned_to_id == request.user.id else request.user
        report.save(update_fields=['assigned_to'])
        log_admin_action(request.user, 'assign_report', 'report', report.id,
                         reason='claimed' if report.assigned_to_id else 'released')
        return Response(self.get_serializer(report).data)

    @action(detail=True, methods=['post'])
    def add_note(self, request, pk=None):
        report = get_object_or_404(Report, pk=pk)
        report.moderator_notes = (request.data.get('note') or '')[:2000]
        report.save(update_fields=['moderator_notes'])
        log_admin_action(request.user, 'note_report', 'report', report.id)
        return Response(self.get_serializer(report).data)

    @action(detail=True, methods=['post'])
    def resolve(self, request, pk=None):
        return self._set_status(request, pk, 'resolved', 'resolve_report')

    @action(detail=True, methods=['post'])
    def dismiss(self, request, pk=None):
        return self._set_status(request, pk, 'dismissed', 'dismiss_report')

    @action(detail=True, methods=['post'])
    def remove_target(self, request, pk=None):
        report = get_object_or_404(Report, pk=pk)
        if not _soft_remove(report.content_type, report.object_id, True):
            return Response({'error': 'Target not found or not removable'},
                            status=status.HTTP_400_BAD_REQUEST)
        report.status = 'resolved'
        report.resolved_by = request.user
        report.resolved_at = timezone.now()
        report.save(update_fields=['status', 'resolved_by', 'resolved_at'])
        log_admin_action(request.user, f'remove_{report.content_type}',
                         report.content_type, report.object_id,
                         reason=request.data.get('reason', ''))
        return Response(self.get_serializer(report).data)


# ── User management ──────────────────────────────────────────────────────────
class AdminUserViewSet(viewsets.GenericViewSet):
    permission_classes = [IsModerator]
    pagination_class = StandardPagination
    serializer_class = AdminUserSerializer

    def get_queryset(self):
        qs = User.objects.all().order_by('-date_joined')
        q = self.request.query_params.get('q')
        if q:
            qs = qs.filter(Q(username__icontains=q) | Q(email__icontains=q))
        role = self.request.query_params.get('role')
        if role in ('moderator', 'super_admin'):
            qs = qs.filter(admin_role=role)
        return qs

    def list(self, request):
        return _paginated(self, self.get_queryset(), AdminUserSerializer)

    def retrieve(self, request, pk=None):
        user = get_object_or_404(User, pk=pk)
        return Response(self.get_serializer(user).data)

    @action(detail=True, methods=['post'])
    def suspend(self, request, pk=None):
        user = get_object_or_404(User, pk=pk)
        if user.id == request.user.id:
            return Response({'error': "You can't suspend yourself."}, status=status.HTTP_400_BAD_REQUEST)
        reason = (request.data.get('reason') or '')[:255]
        # Optional ?days=N for a temporary suspension; omitted/0 => indefinite.
        try:
            days = int(request.data.get('days') or 0)
        except (TypeError, ValueError):
            days = 0
        user.is_suspended = True
        user.suspension_reason = reason
        user.suspended_at = timezone.now()
        user.suspended_until = (timezone.now() + timedelta(days=days)) if days > 0 else None
        user.save(update_fields=['is_suspended', 'suspension_reason', 'suspended_at', 'suspended_until'])
        span = f"for {days} day(s)" if days > 0 else "indefinitely"
        notify_moderation(user, 'Account suspended',
                          f"Your account has been suspended {span}." + (f" Reason: {reason}" if reason else ''))
        log_admin_action(request.user, 'suspend_user', 'user', user.id, reason=reason or span)
        return Response(self.get_serializer(user).data)

    @action(detail=True, methods=['post'])
    def unsuspend(self, request, pk=None):
        user = get_object_or_404(User, pk=pk)
        user.is_suspended = False
        user.suspension_reason = ''
        user.suspended_at = None
        user.suspended_until = None
        user.save(update_fields=['is_suspended', 'suspension_reason', 'suspended_at', 'suspended_until'])
        notify_moderation(user, 'Suspension lifted', 'Your account suspension has been lifted. Welcome back!')
        log_admin_action(request.user, 'unsuspend_user', 'user', user.id)
        return Response(self.get_serializer(user).data)

    @action(detail=True, methods=['post'])
    def warn(self, request, pk=None):
        """Issue a warning (strike). Auto-escalates to a temporary suspension at
        the strike threshold."""
        user = get_object_or_404(User, pk=pk)
        if user.id == request.user.id:
            return Response({'error': "You can't warn yourself."}, status=status.HTTP_400_BAD_REQUEST)
        reason = (request.data.get('reason') or '')[:255]
        user.strikes = (user.strikes or 0) + 1
        fields = ['strikes']
        escalated = False
        if user.strikes >= STRIKE_SUSPEND_THRESHOLD and not user.is_currently_suspended:
            user.is_suspended = True
            user.suspension_reason = f'Auto-suspended after {user.strikes} strikes'
            user.suspended_at = timezone.now()
            user.suspended_until = timezone.now() + timedelta(days=STRIKE_SUSPEND_DAYS)
            fields += ['is_suspended', 'suspension_reason', 'suspended_at', 'suspended_until']
            escalated = True
        user.save(update_fields=fields)
        msg = f"You've received a warning (strike {user.strikes})." + (f" Reason: {reason}" if reason else '')
        if escalated:
            msg += f" Your account is now suspended for {STRIKE_SUSPEND_DAYS} days."
        notify_moderation(user, 'Warning', msg)
        log_admin_action(request.user, 'warn_user', 'user', user.id,
                         reason=f'strike {user.strikes}' + (f' — {reason}' if reason else ''))
        return Response(self.get_serializer(user).data)

    @action(detail=True, methods=['post'])
    def ban(self, request, pk=None):
        user = get_object_or_404(User, pk=pk)
        if user.id == request.user.id:
            return Response({'error': "You can't ban yourself."}, status=status.HTTP_400_BAD_REQUEST)
        if user.is_super_admin:
            return Response({'error': "You can't ban a super admin."}, status=status.HTTP_400_BAD_REQUEST)
        user.is_active = False
        user.save(update_fields=['is_active'])
        reason = request.data.get('reason', '')
        notify_moderation(user, 'Account banned',
                          'Your account has been banned and you can no longer sign in.' + (f" Reason: {reason}" if reason else ''))
        log_admin_action(request.user, 'ban_user', 'user', user.id, reason=reason)
        return Response(self.get_serializer(user).data)

    @action(detail=True, methods=['post'])
    def unban(self, request, pk=None):
        user = get_object_or_404(User, pk=pk)
        user.is_active = True
        user.save(update_fields=['is_active'])
        log_admin_action(request.user, 'unban_user', 'user', user.id)
        return Response(self.get_serializer(user).data)

    @action(detail=True, methods=['post'], permission_classes=[IsSuperAdmin])
    def set_role(self, request, pk=None):
        user = get_object_or_404(User, pk=pk)
        role = request.data.get('role', '')
        if role not in ('', 'moderator', 'super_admin'):
            return Response({'error': 'role must be one of "", moderator, super_admin'},
                            status=status.HTTP_400_BAD_REQUEST)
        # Never strip the last super admin.
        if user.is_super_admin and role != 'super_admin':
            others = User.objects.filter(
                Q(admin_role='super_admin') | Q(is_superuser=True)
            ).exclude(id=user.id).count()
            if others == 0:
                return Response({'error': 'Cannot demote the last super admin.'},
                                status=status.HTTP_400_BAD_REQUEST)
        user.admin_role = role
        if role == 'super_admin':
            user.is_superuser = True
            user.is_staff = True
        else:
            # Moderator is in-app only; demotion drops Django superuser access.
            user.is_superuser = False
        user.save(update_fields=['admin_role', 'is_superuser', 'is_staff'])
        log_admin_action(request.user, 'set_role', 'user', user.id, reason=role or 'none')
        return Response(self.get_serializer(user).data)


# ── Content management ───────────────────────────────────────────────────────
class AdminContentViewSet(viewsets.GenericViewSet):
    permission_classes = [IsModerator]
    pagination_class = StandardPagination
    serializer_class = AdminContentPostSerializer

    # type -> (select_related field, serializer, [search lookups])
    _CONFIG = {
        'post':         ('user',   AdminContentPostSerializer,        ['caption__icontains', 'user__username__icontains']),
        'track':        ('artist', AdminContentTrackSerializer,       ['title__icontains', 'album__icontains', 'artist__username__icontains']),
        'comment':      ('user',   AdminContentCommentSerializer,     ['content__icontains', 'user__username__icontains']),
        'trackcomment': ('user',   AdminContentTrackCommentSerializer,['content__icontains', 'user__username__icontains']),
        'group':        ('creator', AdminContentGroupSerializer,      ['name__icontains', 'description__icontains']),
        'story':        ('user',   AdminContentStorySerializer,       ['caption__icontains', 'user__username__icontains']),
    }

    def list(self, request):
        ctype = request.query_params.get('type', 'post')
        cfg = self._CONFIG.get(ctype)
        if not cfg:
            return Response({'error': f'type must be one of {list(self._CONFIG)}'}, status=status.HTTP_400_BAD_REQUEST)
        rel, ser_cls, search_fields = cfg
        qs = _CONTENT_MODELS[ctype].objects.select_related(rel).order_by('-created_at')

        removed = request.query_params.get('removed')
        if removed == 'true':
            qs = qs.filter(is_removed=True)
        elif removed == 'false':
            qs = qs.filter(is_removed=False)

        q = (request.query_params.get('q') or '').strip()
        if q:
            cond = Q()
            for field in search_fields:
                cond |= Q(**{field: q})
            qs = qs.filter(cond)

        return _paginated(self, qs, ser_cls)

    @action(detail=False, methods=['post'])
    def remove(self, request):
        ctype = request.data.get('type')
        oid = request.data.get('id')
        if not _soft_remove(ctype, oid, True):
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        log_admin_action(request.user, f'remove_{ctype}', ctype, oid, reason=request.data.get('reason', ''))
        return Response({'status': 'removed'})

    @action(detail=False, methods=['post'])
    def restore(self, request):
        ctype = request.data.get('type')
        oid = request.data.get('id')
        if not _soft_remove(ctype, oid, False):
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        log_admin_action(request.user, f'restore_{ctype}', ctype, oid)
        return Response({'status': 'restored'})


# ── Audit log viewer ─────────────────────────────────────────────────────────
class AdminLogViewSet(viewsets.GenericViewSet):
    """Read-only audit trail of every moderation action."""
    permission_classes = [IsModerator]
    pagination_class = StandardPagination
    serializer_class = AdminActionLogSerializer

    def get_queryset(self):
        qs = AdminActionLog.objects.select_related('actor').order_by('-created_at')
        action_f = self.request.query_params.get('action')
        if action_f:
            qs = qs.filter(action=action_f)
        return qs

    def list(self, request):
        return _paginated(self, self.get_queryset(), AdminActionLogSerializer)

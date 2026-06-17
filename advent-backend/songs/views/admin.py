from .common import *  # noqa: F401,F403  (DRF symbols, models, StandardPagination, Q, timezone, timedelta)
from ..models import AdminActionLog
from ..serializers import (
    AdminUserSerializer,
    AdminReportSerializer,
    AdminContentPostSerializer,
    AdminContentTrackSerializer,
    AdminContentCommentSerializer,
)


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
_CONTENT_MODELS = {'post': SocialPost, 'comment': PostComment, 'track': Track}


def log_admin_action(actor, action, target_type='', target_id=None, reason=''):
    try:
        AdminActionLog.objects.create(
            actor=actor, action=action, target_type=target_type or '',
            target_id=target_id, reason=reason or '',
        )
    except Exception:
        logger.exception('Failed to write AdminActionLog')


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
        qs = Report.objects.select_related('reporter').order_by('-created_at')
        status_f = self.request.query_params.get('status')
        if status_f in dict(Report.STATUS_CHOICES):
            qs = qs.filter(status=status_f)
        return qs

    def list(self, request):
        return _paginated(self, self.get_queryset(), AdminReportSerializer)

    def retrieve(self, request, pk=None):
        report = get_object_or_404(Report, pk=pk)
        return Response(self.get_serializer(report).data)

    def _set_status(self, request, pk, new_status, action_name):
        report = get_object_or_404(Report, pk=pk)
        report.status = new_status
        report.save(update_fields=['status'])
        log_admin_action(request.user, action_name, 'report', report.id)
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
        report.save(update_fields=['status'])
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
        user.is_suspended = True
        user.suspension_reason = (request.data.get('reason') or '')[:255]
        user.suspended_at = timezone.now()
        user.save(update_fields=['is_suspended', 'suspension_reason', 'suspended_at'])
        log_admin_action(request.user, 'suspend_user', 'user', user.id, reason=user.suspension_reason)
        return Response(self.get_serializer(user).data)

    @action(detail=True, methods=['post'])
    def unsuspend(self, request, pk=None):
        user = get_object_or_404(User, pk=pk)
        user.is_suspended = False
        user.suspension_reason = ''
        user.suspended_at = None
        user.save(update_fields=['is_suspended', 'suspension_reason', 'suspended_at'])
        log_admin_action(request.user, 'unsuspend_user', 'user', user.id)
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
        log_admin_action(request.user, 'ban_user', 'user', user.id, reason=request.data.get('reason', ''))
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

    _CONFIG = {
        'post': ('user', AdminContentPostSerializer),
        'track': ('artist', AdminContentTrackSerializer),
        'comment': ('user', AdminContentCommentSerializer),
    }

    def list(self, request):
        ctype = request.query_params.get('type', 'post')
        cfg = self._CONFIG.get(ctype)
        if not cfg:
            return Response({'error': 'type must be post|track|comment'}, status=status.HTTP_400_BAD_REQUEST)
        rel, ser_cls = cfg
        qs = _CONTENT_MODELS[ctype].objects.select_related(rel).order_by('-created_at')
        removed = request.query_params.get('removed')
        if removed == 'true':
            qs = qs.filter(is_removed=True)
        elif removed == 'false':
            qs = qs.filter(is_removed=False)
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

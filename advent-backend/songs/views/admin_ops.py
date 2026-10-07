"""Admin phase 4: running the app.

- /app-status/                 maintenance and the parts switched off (anyone)
- /admin/app-settings/         set them (manage_app; a fresh code)
- /admin/broadcasts/           a notification to everyone or a group
                               (broadcast; a fresh code; once per half hour)
- /admin/users/<id>/history/   one account, as moderation sees it
- /admin/insights/             activity, sales and games over time; CSV too
"""
import csv
import io
from datetime import timedelta
from zoneinfo import ZoneInfo

from django.db.models import Count, F, Q
from django.db.models.functions import ExtractHour, TruncDate
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .. import app_settings
from ..models import (
    AdminActionLog, Appeal, Broadcast, Order, PostComment, Product, PuzzleProgress, QuizAttempt, Report,
    SellerProfile, SocialPost, Story, Track, User,
)
from .common import Cap, StandardPagination, admin_gate
from .admin import log_admin_action

BROADCAST_GAP_MINUTES = 30


class AppStatusView(APIView):
    """What the app checks when it starts: maintenance, and the parts turned
    off. Public (it is asked before sign-in), cached."""
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        return Response(app_settings.status())


class AdminAppSettingsView(APIView):
    """Read (manage_app) and change (manage_app, a code in the last minutes)
    maintenance mode and the parts of the app that are on."""

    def get_permissions(self):
        return [Cap('manage_app', recent=self.request.method != 'GET')()]

    def get(self, request):
        return Response(app_settings.status())

    def patch(self, request):
        current = app_settings.status()
        maintenance = request.data.get('maintenance')
        features = request.data.get('features')
        messages = request.data.get('messages')
        if messages is not None:
            if not isinstance(messages, dict) or any(k not in app_settings.FEATURES for k in messages):
                return Response({'error': f'messages: any of {list(app_settings.FEATURES)}'},
                                status=status.HTTP_400_BAD_REQUEST)
            kept = {**current.get('messages', {}),
                    **{k: str(v or '').strip()[:app_settings.MESSAGE_MAX] for k, v in messages.items()}}
            app_settings.save('feature_messages', {k: v for k, v in kept.items() if v}, request.user)
            log_admin_action(request.user, 'set_feature_messages', 'app', None,
                             reason=', '.join(sorted(messages))[:255])
        if maintenance is not None:
            if not isinstance(maintenance, dict):
                return Response({'error': 'maintenance: {on, message}'}, status=status.HTTP_400_BAD_REQUEST)
            on = bool(maintenance.get('on', current['maintenance']['on']))
            message = str(maintenance.get('message', current['maintenance']['message']) or '')[:300]
            app_settings.save('maintenance', {'on': on, 'message': message}, request.user)
            log_admin_action(request.user, 'maintenance_on' if on else 'maintenance_off', 'app', None, reason=message)
        if features is not None:
            if not isinstance(features, dict) or any(k not in app_settings.FEATURES for k in features):
                return Response({'error': f'features: any of {list(app_settings.FEATURES)}'},
                                status=status.HTTP_400_BAD_REQUEST)
            merged = {**current['features'], **{k: bool(v) for k, v in features.items()}}
            app_settings.save('features', merged, request.user)
            off = [k for k, v in merged.items() if not v]
            log_admin_action(request.user, 'set_features', 'app', None,
                             reason=('off: ' + ', '.join(off)) if off else 'all on')
        return Response(app_settings.status())


def audience_ids(audience):
    """The accounts a broadcast goes to (active ones only)."""
    users = User.objects.filter(is_active=True, is_deactivated=False)
    if audience == 'active':
        users = users.filter(last_seen_at__gte=timezone.now() - timedelta(days=7))
    elif audience == 'sellers':
        users = users.filter(Q(products_for_sale__isnull=False) | Q(seller_profile__isnull=False))
    elif audience == 'artists':
        users = users.filter(tracks__isnull=False)
    elif audience == 'admins':
        users = users.filter(Q(admin_role__in=('moderator', 'super_admin')) | Q(is_superuser=True) | Q(role__isnull=False))
    return list(users.values_list('pk', flat=True).distinct())


class AdminBroadcastViewSet(viewsets.ViewSet):
    """Broadcasts: the ones sent, how many one would reach, and sending one."""

    def get_permissions(self):
        return [Cap('broadcast', recent=self.action == 'create')()]

    def list(self, request):
        rows = Broadcast.objects.all()[:50]
        return Response([{
            'id': b.id, 'title': b.title, 'message': b.message, 'audience': b.audience,
            'recipients': b.recipients, 'sent_by': b.sent_by_name, 'created_at': b.created_at,
        } for b in rows])

    @action(detail=False, methods=['post'])
    def preview(self, request):
        audience = request.data.get('audience', 'all')
        if audience not in dict(Broadcast.AUDIENCES):
            return Response({'error': 'Unknown audience'}, status=status.HTTP_400_BAD_REQUEST)
        return Response({'audience': audience, 'recipients': len(audience_ids(audience))})

    def create(self, request):
        title = str(request.data.get('title') or '').strip()[:80]
        message = str(request.data.get('message') or '').strip()[:300]
        audience = request.data.get('audience', 'all')
        if audience not in dict(Broadcast.AUDIENCES):
            return Response({'error': 'Unknown audience'}, status=status.HTTP_400_BAD_REQUEST)
        if len(title) < 3 or len(message) < 5:
            return Response({'error': 'A title and a message, please.', 'code': 'too_short'},
                            status=status.HTTP_400_BAD_REQUEST)
        from django.core.cache import cache
        too_soon = Response({'error': f'One broadcast every {BROADCAST_GAP_MINUTES} minutes.', 'code': 'too_soon'},
                            status=status.HTTP_429_TOO_MANY_REQUESTS)
        # Two admins pressing Send at once: one goes, the other is told.
        if not cache.add('admin-broadcast-sending', 1, 120):
            return too_soon
        try:
            since = timezone.now() - timedelta(minutes=BROADCAST_GAP_MINUTES)
            if Broadcast.objects.filter(created_at__gte=since).exists():
                return too_soon
            ids = audience_ids(audience)
            b = Broadcast.objects.create(sent_by=request.user, sent_by_name=request.user.username, title=title,
                                         message=message, audience=audience, recipients=len(ids))
            from ..push import notify_many
            notify_many(ids, 'notice', message, title=title)
        finally:
            cache.delete('admin-broadcast-sending')
        log_admin_action(request.user, 'broadcast', 'broadcast', b.id, reason=f'{audience}, {len(ids)}: {title}')
        return Response({'id': b.id, 'recipients': len(ids)}, status=status.HTTP_201_CREATED)


class AdminUserHistoryView(APIView):
    """One account as moderation sees it: strikes and standing, reports against
    what they posted and reports they made, every admin action on them, and
    how many devices are signed in."""

    def get_permissions(self):
        return [Cap('manage_users', 'ban_users')()]

    def get(self, request, pk):
        from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
        user = get_object_or_404(User, pk=pk)
        from .admin import _AUTHOR_FIELD, _CONTENT_MODELS
        # Reports on the account itself and on everything of every kind they
        # posted — each a subquery, not every id read into memory first.
        theirs = Q(content_type='user', object_id=user.pk)
        content = {}
        for ctype, Model in _CONTENT_MODELS.items():
            field = _AUTHOR_FIELD.get(ctype)
            if not field:
                continue
            mine = Model.objects.filter(**{field: user})
            theirs |= Q(content_type=ctype, object_id__in=mine.values('pk'))
            up, down = mine.filter(is_removed=False).count(), mine.filter(is_removed=True).count()
            if up or down:
                content[ctype] = {'up': up, 'removed': down}
        against = Report.objects.filter(theirs).order_by('-created_at')
        actions = AdminActionLog.objects.filter(target_type='user', target_id=user.pk).order_by('-created_at')[:30]
        devices = OutstandingToken.objects.filter(user=user, expires_at__gt=timezone.now(),
                                                  blacklistedtoken__isnull=True).count()
        return Response({
            'id': user.pk, 'username': user.username, 'joined': user.date_joined, 'last_seen_at': user.last_seen_at,
            'strikes': user.strikes, 'is_active': user.is_active, 'is_suspended': user.is_currently_suspended,
            'suspension_reason': user.suspension_reason,
            'suspended_until': user.suspended_until,
            'ban_reason': user.ban_reason, 'banned_at': user.banned_at, 'banned_until': user.banned_until,
            'content': content,
            'can_restore_all': user.mass_takedowns.filter(restored_at__isnull=True).exists(),
            'posts': SocialPost.objects.filter(user=user).count(),
            'products': Product.objects.filter(seller=user).count(),
            'devices_signed_in': devices,
            'reports_against': {
                'total': against.count(),
                'pending': against.filter(status='pending').count(),
                'recent': [{'id': r.id, 'reason': r.reason, 'content_type': r.content_type, 'status': r.status,
                            'created_at': r.created_at} for r in against[:10]],
            },
            'reports_made': Report.objects.filter(reporter=user).count(),
            'admin_actions': [{'id': a.id, 'action': a.action, 'by': a.actor_name, 'reason': a.reason,
                               'created_at': a.created_at} for a in actions],
        })


class AdminInsightsView(APIView):
    """Activity over time beyond signups: who is active, orders, quiz and
    puzzle play. ?export=csv for the numbers as a file."""

    def get_permissions(self):
        return [Cap('view_analytics')()]

    def get(self, request):
        try:
            days = max(7, min(int(request.query_params.get('days') or 30), 90))
        except (TypeError, ValueError):
            days = 30
        now = timezone.now()
        start = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)

        def series(qs, field):
            rows = (qs.filter(**{f'{field}__gte': start}).annotate(d=TruncDate(field)).values('d')
                    .annotate(c=Count('id')).order_by('d'))
            by = {r['d']: r['c'] for r in rows}
            return [by.get((start + timedelta(days=i)).date(), 0) for i in range(days)]

        dates = [(start + timedelta(days=i)).date().isoformat() for i in range(days)]
        data = {
            'signups': series(User.objects.all(), 'date_joined'),
            'posts': series(SocialPost.objects.all(), 'created_at'),
            'orders': series(Order.objects.all(), 'created_at'),
            'quiz_games': series(QuizAttempt.objects.all(), 'completed_at'),
            'puzzles_done': series(PuzzleProgress.objects.filter(is_complete=True), 'completed_at'),
            'reports': series(Report.objects.all(), 'created_at'),
        }
        if request.query_params.get('export') == 'csv':
            out = io.StringIO()
            writer = csv.writer(out)
            writer.writerow(['date', *data.keys()])
            for i, day in enumerate(dates):
                writer.writerow([day, *(data[k][i] for k in data)])
            response = HttpResponse(out.getvalue(), content_type='text/csv')
            response['Content-Disposition'] = f'attachment; filename="insights-{dates[0]}-{dates[-1]}.csv"'
            log_admin_action(request.user, 'export_insights', 'app', None, reason=f'{days} days')
            return response
        seen = User.objects.filter(is_active=True, last_seen_at__isnull=False)
        return Response({
            'days': days, 'dates': dates, 'series': data,
            'active': {
                'today': seen.filter(last_seen_at__gte=now.replace(hour=0, minute=0, second=0, microsecond=0)).count(),
                'week': seen.filter(last_seen_at__gte=now - timedelta(days=7)).count(),
                'month': seen.filter(last_seen_at__gte=now - timedelta(days=30)).count(),
            },
            'totals': {
                'users': User.objects.filter(is_active=True).count(),
                'sellers': SellerProfile.objects.count(),
                'orders': Order.objects.count(),
            },
        })


# ── Pulse: the dashboard's charts ───────────────────────────────────────────
PULSE_TZ = ZoneInfo('Africa/Nairobi')
PULSE_SECONDS = 60


class AdminPulseView(APIView):
    """Everything the Pulse dashboard draws, in one request: who is here,
    how fast reports and appeals are handled, the trend, why people report,
    the busiest hours, what people share and who is most followed."""

    def get_permissions(self):
        return [Cap('view_analytics')()]

    def get(self, request):
        try:
            days = max(7, min(int(request.query_params.get('days') or 14), 90))
        except (TypeError, ValueError):
            days = 14
        # The same for every admin and fine a minute old: worked out once a
        # minute per period, not per open.
        from django.core.cache import cache
        key = f'admin:pulse:{days}'
        data = cache.get(key)
        if data is None:
            data = self._pulse(days)
            cache.set(key, data, PULSE_SECONDS)
        return Response(data)

    def _pulse(self, days):
        now = timezone.now()
        start = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
        dates = [(start + timedelta(days=i)).date() for i in range(days)]

        def series(qs, field):
            rows = (qs.filter(**{f'{field}__gte': start}).annotate(d=TruncDate(field)).values('d')
                    .annotate(c=Count('id')).order_by('d'))
            by = {r['d']: r['c'] for r in rows}
            return [by.get(d, 0) for d in dates]

        pct = lambda part, whole: round(100 * part / whole) if whole else 0

        handled = Report.objects.filter(resolved_at__gte=start)
        handled_n = handled.count()
        fast_n = handled.filter(resolved_at__lte=F('created_at') + timedelta(hours=24)).count()
        appeals = Appeal.objects.filter(created_at__gte=start)
        appeals_n = appeals.count()
        answered_n = appeals.exclude(status='pending').count()
        admins = User.objects.filter(is_active=True).filter(
            Q(admin_role__in=('moderator', 'super_admin')) | Q(is_superuser=True) | Q(role__isnull=False))
        admins_n = admins.count()
        protected_n = admins.filter(admin_two_factor__confirmed_at__isnull=False).count()
        members_n = User.objects.filter(is_active=True).count()
        active_n = User.objects.filter(is_active=True, last_seen_at__gte=now - timedelta(days=7)).count()

        labels = dict(Report.REASON_CHOICES)
        reasons = [
            {'reason': r['reason'], 'label': labels.get(r['reason'], r['reason']), 'count': r['c']}
            for r in (Report.objects.filter(created_at__gte=start).values('reason')
                      .annotate(c=Count('id')).order_by('-c', 'reason'))
        ]

        by_hour = {r['h']: r['c'] for r in (
            SocialPost.objects.filter(created_at__gte=start)
            .annotate(h=ExtractHour('created_at', tzinfo=PULSE_TZ)).values('h').annotate(c=Count('id')))}

        top = self._top()

        return {
            'days': days,
            'dates': [d.isoformat() for d in dates],
            'online_now': User.objects.filter(is_active=True, last_seen_at__gte=now - timedelta(minutes=5)).count(),
            'rings': {
                'active': {'pct': pct(active_n, members_n), 'value': active_n, 'of': members_n},
                'reports': {'pct': pct(fast_n, handled_n), 'value': handled_n, 'fast': fast_n,
                            'open': Report.objects.filter(status__in=('pending', 'reviewed')).count()},
                'appeals': {'pct': pct(answered_n, appeals_n), 'value': answered_n,
                            'waiting': Appeal.objects.filter(status='pending').count()},
                'two_factor': {'pct': pct(protected_n, admins_n), 'value': protected_n, 'of': admins_n},
            },
            'trend': {
                'signups': series(User.objects.all(), 'date_joined'),
                'reports': series(Report.objects.all(), 'created_at'),
            },
            'reasons': reasons,
            'hours': [by_hour.get(h, 0) for h in range(24)],
            'mix': {
                'posts': SocialPost.objects.filter(created_at__gte=start).count(),
                'tracks': Track.objects.filter(created_at__gte=start).count(),
                'products': Product.objects.filter(created_at__gte=start).count(),
                'stories': Story.objects.filter(created_at__gte=start).count(),
            },
            'top': top,
        }

    @staticmethod
    def _top():
        """The five most followed: counting every account's followers is the
        heaviest part, and it changes slowly, so it is kept ten minutes."""
        from django.core.cache import cache
        top = cache.get('admin:pulse:top')
        if top is None:
            rows = (User.objects.filter(is_active=True).annotate(n=Count('followers', distinct=True))
                    .filter(n__gt=0).order_by('-n', 'id').values('id', 'username', 'first_name', 'last_name', 'n')[:5])
            top = [{'id': u['id'], 'username': u['username'],
                    'name': f"{u['first_name']} {u['last_name']}".strip() or u['username'], 'followers': u['n']}
                   for u in rows]
            cache.set('admin:pulse:top', top, 600)
        return top

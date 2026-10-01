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

from django.db.models import Count, Q
from django.db.models.functions import TruncDate
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
    AdminActionLog, Broadcast, Order, PostComment, Product, PuzzleProgress, QuizAttempt, Report,
    SellerProfile, SocialPost, Track, User,
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
        since = timezone.now() - timedelta(minutes=BROADCAST_GAP_MINUTES)
        if Broadcast.objects.filter(created_at__gte=since).exists():
            return Response({'error': f'One broadcast every {BROADCAST_GAP_MINUTES} minutes.', 'code': 'too_soon'},
                            status=status.HTTP_429_TOO_MANY_REQUESTS)
        ids = audience_ids(audience)
        from ..push import notify_many
        notify_many(ids, 'notice', message, title=title)
        b = Broadcast.objects.create(sent_by=request.user, sent_by_name=request.user.username, title=title,
                                     message=message, audience=audience, recipients=len(ids))
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
        theirs = Q()
        for ctype, ids in (
            ('user', [user.pk]),
            ('post', SocialPost.objects.filter(user=user).values_list('pk', flat=True)),
            ('comment', PostComment.objects.filter(user=user).values_list('pk', flat=True)),
            ('track', Track.objects.filter(artist=user).values_list('pk', flat=True)),
            ('product', Product.objects.filter(seller=user).values_list('pk', flat=True)),
        ):
            theirs |= Q(content_type=ctype, object_id__in=list(ids))
        against = Report.objects.filter(theirs).order_by('-created_at')
        actions = AdminActionLog.objects.filter(target_type='user', target_id=user.pk).order_by('-created_at')[:30]
        devices = OutstandingToken.objects.filter(user=user, expires_at__gt=timezone.now(),
                                                  blacklistedtoken__isnull=True).count()
        return Response({
            'id': user.pk, 'username': user.username, 'joined': user.date_joined, 'last_seen_at': user.last_seen_at,
            'strikes': user.strikes, 'is_active': user.is_active, 'is_suspended': user.is_currently_suspended,
            'suspension_reason': user.suspension_reason,
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

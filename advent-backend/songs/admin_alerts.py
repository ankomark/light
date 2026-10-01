"""Alerts to the super admins when something looks wrong:

- a burst of reports on one thing (5 within the hour),
- one admin banning many people (10 within the hour),
- an admin opening the admin tools from a device and place not seen before.

Each alert goes once per hour per subject (cached), as a push, and is written
in the audit log, so a quiet night is not a phone full of the same alert.
"""
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone

REPORT_BURST = 5
BAN_BURST = 10
QUIET_SECONDS = 60 * 60


def super_admin_ids():
    from django.db.models import Q
    from .models import User
    return list(User.objects.filter(Q(admin_role='super_admin') | Q(is_superuser=True), is_active=True)
                .values_list('pk', flat=True))


def alert(subject, message, exclude=None):
    """Tell the super admins, once per hour for `subject`. True if told."""
    if not cache.add(f'admin-alert:{subject}', 1, QUIET_SECONDS):
        return False
    ids = [i for i in super_admin_ids() if i != getattr(exclude, 'pk', exclude)]
    if ids:
        from .push import notify_many
        try:
            notify_many(ids, 'system', message, title='Admin alert')
        except Exception:  # noqa: BLE001 — an alert never breaks what caused it
            pass
    from .views.admin import log_admin_action
    log_admin_action(None, 'alert', '', None, reason=message[:255])
    return True


def on_report(report):
    """After a report: a burst on the same thing is told."""
    from .models import Report
    hour_ago = timezone.now() - timedelta(hours=1)
    n = Report.objects.filter(content_type=report.content_type, object_id=report.object_id,
                              created_at__gte=hour_ago).count()
    if n >= REPORT_BURST:
        alert(f'reports:{report.content_type}:{report.object_id}',
              f'{n} reports in an hour on {report.content_type} #{report.object_id}.')


def on_ban(actor):
    """After a ban: one admin banning many is told (to the other super admins)."""
    from .models import AdminActionLog
    hour_ago = timezone.now() - timedelta(hours=1)
    n = AdminActionLog.objects.filter(actor=actor, action='ban_user', created_at__gte=hour_ago).count()
    if n >= BAN_BURST:
        alert(f'bans:{actor.pk}', f'@{actor.username} has banned {n} accounts in the last hour.', exclude=actor)


def on_admin_sign_in(user, ip, user_agent):
    """An admin session opened: from a device and place this admin has not
    used before, the super admins are told."""
    from .models import AdminSession
    seen = AdminSession.objects.filter(user=user, ip=ip, user_agent=user_agent).count()
    if seen <= 1:   # the one just opened
        alert(f'device:{user.pk}:{ip}:{hash(user_agent)}',
              f'@{user.username} opened the admin tools from a new device ({ip or "unknown address"}).',
              exclude=user)

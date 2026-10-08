"""What can be reported, what makes a report urgent, and when the community's
reports hide something before a moderator gets to it.

A report names a kind of thing and its id. Every kind here is one moderators
can take down (views/admin.py _CONTENT_MODELS) or an account ('user').

Auto-hide: when enough *independent, established* accounts report the same
thing, it is hidden at once — waiting for a moderator would leave it up for
hours — and marked "under review" in the queue, where an admin restores it or
confirms it. Content by an admin is never auto-hidden, and a new account's
report does not count towards it, so a handful of fresh accounts cannot
take someone down.
"""
from datetime import timedelta

from django.utils import timezone

# Reasons a person can give (the app's ReportModal offers the same).
REASONS = (
    'spam', 'harassment', 'hate', 'violence', 'sexual', 'child_safety', 'self_harm', 'scam',
    'impersonation', 'inappropriate', 'misinformation', 'copyright', 'other',
)
# Seen first in the queue, and hidden after fewer reports.
URGENT = ('child_safety', 'self_harm', 'violence', 'sexual')

KINDS = (
    'post', 'comment', 'track', 'trackcomment', 'group', 'story', 'user',
    'publication', 'chapter', 'bookreview', 'chaptercomment', 'product', 'productreview', 'grouppost',
    'videostudio', 'mediastation', 'servicereview', 'message', 'singlestopic', 'singlesreply',
    'album', 'playlist', 'organization', 'bookclub', 'livebroadcast',
)

DESCRIPTION_MAX = 2000

# Distinct established reporters that hide something pending review.
AUTO_HIDE_AT = 5
AUTO_HIDE_URGENT_AT = 3
# An account must be at least this old for its report to count towards it.
ESTABLISHED_DAYS = 3


def _model(kind):
    from .views.admin import _CONTENT_MODELS
    if kind == 'user':
        from .models import User
        return User
    return _CONTENT_MODELS.get(kind)


def target_exists(kind, object_id):
    """Whether the thing reported is there to be reported (and not already
    taken down): a report on nothing only clutters the queue."""
    model = _model(kind)
    if model is None:
        return False
    qs = model.objects.filter(pk=object_id)
    if kind == 'user':
        return qs.filter(is_active=True).exists()
    if hasattr(model, 'is_removed'):
        qs = qs.filter(is_removed=False)
    return qs.exists()


def maybe_auto_hide(report):
    """After a new report: hide the thing if enough established people have
    reported it. Returns True when it was hidden now."""
    from .models import Report, User
    from .views.admin import _CONTENT_MODELS, _authors, _soft_remove, log_admin_action, notify_moderation
    kind, oid = report.content_type, report.object_id
    if kind not in _CONTENT_MODELS:
        return False   # an account is never auto-hidden: that is a moderator's call
    reports = Report.objects.filter(content_type=kind, object_id=oid, status='pending')
    established = timezone.now() - timedelta(days=ESTABLISHED_DAYS)
    reporters = (reports.filter(reporter__date_joined__lte=established, reporter__is_active=True)
                 .values('reporter').distinct().count())
    urgent = reports.filter(reason__in=URGENT).exists()
    if reporters < (AUTO_HIDE_URGENT_AT if urgent else AUTO_HIDE_AT):
        return False
    author_id = _authors(kind, [oid]).get(oid)
    author = User.objects.filter(pk=author_id).first() if author_id else None
    if author is not None and author.is_platform_admin:
        return False
    if not _soft_remove(kind, oid, True):
        return False
    # The reports stay pending — the queue admins work from — with the
    # thing already hidden; restoring or confirming it is their call.
    log_admin_action(None, f'auto_hide_{kind}'[:40], kind, oid,
                     reason=f'{reporters} reports' + (' (urgent)' if urgent else ''))
    if author is not None:
        notify_moderation(author, 'Hidden while we review it',
                          'Something you posted was reported by several people and is hidden while our '
                          'moderators look at it. If it breaks no rule it comes back.')
    try:
        from .admin_alerts import alert
        alert(f'autohide:{kind}:{oid}', f'Auto-hidden after {reporters} reports: {kind} #{oid}. Review it in Reports.')
    except Exception:  # noqa: BLE001 — telling the admins never undoes the hiding
        pass
    return True

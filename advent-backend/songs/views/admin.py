from .common import *  # noqa: F401,F403  (DRF symbols, models, StandardPagination, Q, timezone, timedelta)
from django.core.cache import cache
from django.db.models import OuterRef, Subquery
from django.db.models.functions import TruncDate
from rest_framework.throttling import ScopedRateThrottle
from ..models import AdminActionLog, Appeal, Role, ADMIN_CAPABILITIES, BookReview, ChapterComment, ServiceReview, Message, SinglesTopic, SinglesReply
from ..models import BookClub, LiveBroadcast, Organization, Album, Playlist
from .. import rights
from ..signals import sync_removal_likes
from ..serializers.admin import build_report_targets
from ..serializers import (
    AdminUserSerializer,
    AdminReportSerializer,
    AdminActionLogSerializer,
    AdminAppealSerializer,
    RoleSerializer,
    AdminContentPostSerializer,
    AdminContentTrackSerializer,
    AdminContentCommentSerializer,
    AdminContentTrackCommentSerializer,
    AdminContentGroupSerializer,
    AdminContentStorySerializer,
    AdminContentPublicationSerializer,
    AdminContentProductSerializer,
    AdminContentProductReviewSerializer,
    AdminContentGroupPostSerializer,
    AdminContentVideostudioSerializer,
    AdminContentMediaStationSerializer,
    AdminContentOrganizationSerializer,
    AdminContentBookClubSerializer,
    AdminContentLiveBroadcastSerializer,
)
from ..serializers.admin import AdminContentAlbumSerializer, AdminContentPlaylistSerializer

# Strikes at/after which a warning auto-escalates to a temporary suspension.
STRIKE_SUSPEND_THRESHOLD = 3
STRIKE_SUSPEND_DAYS = 7


# ── Permissions ──────────────────────────────────────────────────────────────
# All through admin_gate (views/common.py): standing, the power itself read
# fresh, and a two-step admin session (songs/admin_security.py).
class IsModerator(BasePermission):
    """Any staff power (super admin, moderator, a role with capabilities)."""
    def has_permission(self, request, view):
        return admin_gate(request, lambda u: u.is_platform_admin)


class IsSuperAdmin(BasePermission):
    def has_permission(self, request, view):
        return admin_gate(request, lambda u: u.is_super_admin)


class RecentSuperAdmin(BasePermission):
    """A super admin who entered a code in the last few minutes (roles)."""
    def has_permission(self, request, view):
        return admin_gate(request, lambda u: u.is_super_admin, recent=True)


# Cap() now lives in views/common.py so non-admin modules (which import before
# this one) can gate on capabilities too. It still arrives here via the star
# import at the top of this file.


# ── Helpers ──────────────────────────────────────────────────────────────────
# Soft-removable content types (also the targets `remove_target` can act on).
_CONTENT_MODELS = {
    'post': SocialPost,
    'comment': PostComment,       # comments on social posts
    'track': Track,
    'trackcomment': Comment,      # comments on tracks
    'group': Group,
    'story': Story,
    # Extended moderation set — every remaining user-generated content type now
    # carries is_removed and is takedown/restore-able here (and via reports).
    'publication': Publication,   # long-form articles
    'chapter': Chapter,           # one chapter of one (the rest of the book stays)
    'bookreview': BookReview,     # a reader's review of a book
    'chaptercomment': ChapterComment,   # a comment in a chapter's discussion
    'product': Product,           # marketplace listings
    'productreview': ProductReview,
    'grouppost': GroupPost,       # group chat messages
    'videostudio': Videostudio,
    'mediastation': MediaStation,
    'servicereview': ServiceReview,   # a review of a service
    'message': Message,               # a direct message (reported by someone in the chat)
    'singlestopic': SinglesTopic,     # a Single & Searching community question
    'singlesreply': SinglesReply,     # and a reply to one
    'organization': Organization,     # a church, ministry or publisher page
    'bookclub': BookClub,             # a reading club (its group stays)
    'livebroadcast': LiveBroadcast,   # a live room: taking it down also ends it
    'album': Album,                   # an artist's album (its songs stay; each is its own)
    'playlist': Playlist,             # a listener's (public) playlist
}


# Who wrote each kind of content (a chapter: its book's author).
_AUTHOR_FIELD = {
    'post': 'user', 'comment': 'user', 'track': 'artist', 'trackcomment': 'user', 'group': 'creator',
    'story': 'user', 'publication': 'author', 'chapter': 'publication__author', 'bookreview': 'user',
    'chaptercomment': 'user', 'product': 'seller', 'productreview': 'reviewer', 'grouppost': 'user',
    'videostudio': 'created_by', 'mediastation': 'created_by', 'servicereview': 'user', 'message': 'sender',
    'singlestopic': 'author__user', 'singlesreply': 'author__user',
    'organization': 'created_by', 'bookclub': 'created_by', 'livebroadcast': 'host',
    'album': 'artist', 'playlist': 'user',
}
_CONTENT_WORD = {
    'post': 'post', 'comment': 'comment', 'trackcomment': 'comment', 'group': 'group', 'story': 'story',
    'publication': 'publication', 'chapter': 'chapter', 'bookreview': 'review', 'chaptercomment': 'comment',
    'product': 'listing', 'productreview': 'review', 'grouppost': 'group message', 'videostudio': 'studio',
    'mediastation': 'media station', 'servicereview': 'review', 'message': 'message',
    'singlestopic': 'singles question', 'singlesreply': 'singles reply',
    'organization': 'organization page', 'bookclub': 'book club', 'livebroadcast': 'live broadcast',
    'album': 'album', 'playlist': 'playlist',
}


def _authors(ctype, ids):
    """{object id: author id} for content of one kind."""
    Model, field = _CONTENT_MODELS.get(ctype), _AUTHOR_FIELD.get(ctype)
    if not Model or not field:
        return {}
    return {oid: aid for oid, aid in Model.objects.filter(id__in=ids).values_list('id', field) if aid}


def _protected_ids(actor, ctype, ids):
    """The items written by an admin of the actor's rank or above (not the
    actor's own): those an admin may not take down, as with accounts."""
    from ..admin_security import outranks
    by = _authors(ctype, ids)
    authors = {u.pk: u for u in User.objects.filter(pk__in=set(by.values())).select_related('role')}
    return {oid for oid, aid in by.items()
            if aid != actor.pk and aid in authors and not outranks(actor, authors[aid])}


def _tell_authors(ctype, ids, removed, reason='', actor=None):
    """The authors of content taken down (with why) or brought back are told,
    one message each. Songs are told by songs.rights."""
    if ctype == 'track' or not ids:
        return
    counts = {}
    for aid in _authors(ctype, ids).values():
        if not actor or aid != actor.pk:
            counts[aid] = counts.get(aid, 0) + 1
    word = _CONTENT_WORD.get(ctype, 'item')
    for user in User.objects.filter(pk__in=counts):
        n = counts[user.pk]
        what = f'Your {word}' if n == 1 else f'{n} of your {word}s'
        if removed:
            notify_moderation(user, 'Content removed', f'{what} {"was" if n == 1 else "were"} removed by our moderators.'
                              + (f' Reason: {reason}' if reason else ''))
        else:
            notify_moderation(user, 'Content restored', f'{what} {"is" if n == 1 else "are"} back up after review.')


def _rank_refusal():
    return Response({'error': 'That was posted by an admin of your rank or above.', 'code': 'rank'},
                    status=status.HTTP_403_FORBIDDEN)


def log_admin_action(actor, action, target_type='', target_id=None, reason=''):
    """One entry in the tamper-evident trail: who (by name too), what, to
    what, why, from which IP and device, chained to the entry before."""
    import hashlib
    from django.db import transaction
    from ..admin_security import current_request, client_ip
    req = current_request.get()
    try:
        with transaction.atomic():
            last = (AdminActionLog.objects.select_for_update().exclude(entry_hash='')
                    .order_by('-id').values_list('entry_hash', flat=True).first())
            entry = AdminActionLog.objects.create(
                actor=actor if getattr(actor, 'pk', None) else None,
                actor_name=(getattr(actor, 'username', '') or '')[:150],
                action=action[:40], target_type=(target_type or '')[:20],
                target_id=target_id, reason=reason or '',
                ip=client_ip(req) or '',
                user_agent=(req.META.get('HTTP_USER_AGENT', '')[:255] if req else ''),
                prev_hash=last or '',
            )
            entry.entry_hash = hashlib.sha256(entry.chain_text().encode()).hexdigest()
            entry.save(update_fields=['entry_hash'])
    except Exception:
        logger.exception('Failed to write AdminActionLog')


def verify_audit_chain():
    """(ok, first_broken_id, checked): whether every chained entry still says
    what it said when written, and none between has gone."""
    import hashlib
    prev = None
    checked = 0
    for entry in AdminActionLog.objects.exclude(entry_hash='').order_by('id').iterator():
        if prev is not None and entry.prev_hash != prev:
            return False, entry.id, checked
        if hashlib.sha256(entry.chain_text().encode()).hexdigest() != entry.entry_hash:
            return False, entry.id, checked
        prev = entry.entry_hash
        checked += 1
    return True, None, checked


def clean_ids(raw, limit=200):
    """A bulk action's ids: whole numbers only, at most `limit`, else None."""
    if not isinstance(raw, list) or not raw or len(raw) > limit:
        return None
    ids = []
    for value in raw:
        if isinstance(value, bool):
            return None
        try:
            ids.append(int(value))
        except (TypeError, ValueError):
            return None
    return ids


def notify_moderation(user, subject, message):
    """Tell a user about a moderation action — in-app push + email. Best-effort:
    a failure here must never break the moderator's action."""
    try:
        notify_user(user, 'system', message)
    except Exception:
        logger.exception('Moderation push failed')
    if not user.email:
        return
    site = getattr(settings, 'SITE_NAME', 'Adventist Life')

    def _send():
        from django.core.mail import send_mail
        send_mail(
            subject=f"{site} — {subject}",
            message=f"Hi {user.username},\n\n{message}\n\n— {site} Team",
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=True,
        )
    # Off the moderator's request: a bulk takedown told dozens of authors one
    # SMTP round trip at a time, and a slow mail server stalled the admin.
    try:
        from ..tasks import run_in_background
        run_in_background(_send)
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
    # Before the flip: a takedown's likes stop counting toward the author's
    # profile total, and a restore hands them back.
    sync_removal_likes(Model, [obj.pk], removed)
    obj.is_removed = removed
    obj.save(update_fields=['is_removed'])
    if removed and Model is LiveBroadcast:
        _end_live([obj.pk])
    if removed and Model is Group:
        _close_groups([obj.pk])
    if removed and Model is GroupPost:
        _drop_group_posts([obj.pk])
    return True


def _drop_group_posts(ids):
    """Group messages taken down: gone from every open chat now (a chat's
    poll only asks for newer messages, so it stayed until reopened), and
    unpinned if one was pinned."""
    from ..consumers import broadcast_group_deleted, broadcast_group_pinned
    pinned_in = list(Group.objects.filter(pinned_post_id__in=ids).values_list('slug', flat=True))
    Group.objects.filter(pinned_post_id__in=ids).update(pinned_post=None)
    try:
        for pk, slug in GroupPost.objects.filter(pk__in=ids).values_list('pk', 'group__slug'):
            broadcast_group_deleted(slug, pk)
        for slug in pinned_in:
            broadcast_group_pinned(slug, None)
    except Exception:
        # Live is a courtesy: the takedown itself stands either way.
        logger.exception('Group message takedown broadcast failed')


def _close_groups(ids):
    """A group taken down: everyone with its chat open is told, and cut off
    (the socket refuses a removed group only on the next connect)."""
    from .. import group_live
    for slug in Group.objects.filter(pk__in=ids).values_list('slug', flat=True):
        group_live.tell_group(slug, {'type': 'group_deleted'})


def _end_live(ids):
    """A live broadcast taken down ends now: nobody can join or keep watching."""
    LiveBroadcast.objects.filter(pk__in=ids, status='live').update(status='ended', ended_at=timezone.now())


def _paginated(view, qs, serializer_cls):
    ctx = {'request': view.request}
    page = view.paginate_queryset(qs)
    if page is not None:
        return view.get_paginated_response(serializer_cls(page, many=True, context=ctx).data)
    return Response(serializer_cls(qs, many=True, context=ctx).data)


MIN_REASON = 3


def reason_of(request, required=True):
    """The reason given for an action, or a 400 when one is needed and none
    came: the person acted on is told why, and the trail says why."""
    reason = (request.data.get('reason') or '').strip()[:255]
    if required and len(reason) < MIN_REASON:
        return None, Response({'error': 'Give a reason (it is shown to the person and kept in the audit log).',
                               'code': 'reason_required'}, status=status.HTTP_400_BAD_REQUEST)
    return reason, None


# ── Dashboard ────────────────────────────────────────────────────────────────
DASH_COUNTS_KEY = 'admin:dash-counts'
DASH_COUNTS_SECONDS = 30

class AdminDashboardView(APIView):
    permission_classes = [IsModerator]

    def get(self, request):
        now = timezone.now()
        day_ago = now - timedelta(days=1)
        week_ago = now - timedelta(days=7)
        me = request.user
        can = me.has_capability
        # The "N people reported this" count, in the same query (not one each).
        dup = (Report.objects.filter(content_type=OuterRef('content_type'), object_id=OuterRef('object_id'))
               .order_by().values('content_type', 'object_id').annotate(c=Count('*')).values('c')[:1])
        recent_reports = (
            Report.objects
            .select_related('reporter__profile', 'assigned_to__profile', 'resolved_by__profile')
            .annotate(dup_count=Subquery(dup))
            .order_by('-created_at')[:10]
        ) if can('handle_reports') else []
        # The counts are the same for every admin and a few seconds old is
        # fine: worked out at most every DASH_COUNTS_SECONDS, not per open.
        counts = cache.get(DASH_COUNTS_KEY)
        if counts is None:
            counts = {
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
                'appeals': {
                    'pending': Appeal.objects.filter(status='pending').count(),
                },
                'moderation': {
                    'suspended': User.objects.filter(is_suspended=True).count(),
                    'banned': User.objects.filter(is_active=False).count(),
                    'removed_posts': SocialPost.objects.filter(is_removed=True).count(),
                },
            }
            cache.set(DASH_COUNTS_KEY, counts, DASH_COUNTS_SECONDS)
        return Response({
            **counts,
            # A staff member sees the people and reports their role covers.
            'recent_reports': AdminReportSerializer(
                recent_reports, many=True,
                context={'request': request, 'report_targets': build_report_targets(list(recent_reports))},
            ).data,
            # The newest accounts are in Users now; kept empty for older apps.
            'recent_users': [],
            'me': {'capabilities': me.capabilities, 'is_super_admin': me.is_super_admin},
        })


# ── Analytics (time-series) ──────────────────────────────────────────────────
class AdminAnalyticsView(APIView):
    permission_classes = [Cap('view_analytics')]

    def get(self, request):
        try:
            days = int(request.query_params.get('days') or 14)
        except (TypeError, ValueError):
            days = 14
        days = max(7, min(days, 90))
        now = timezone.now()
        start = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)

        def series(qs, field):
            rows = (
                qs.filter(**{f'{field}__gte': start})
                .annotate(d=TruncDate(field)).values('d')
                .annotate(c=Count('id')).order_by('d')
            )
            by = {r['d']: r['c'] for r in rows}
            out = []
            for i in range(days):
                day = (start + timedelta(days=i)).date()
                out.append({'date': day.isoformat(), 'count': by.get(day, 0)})
            return out

        return Response({
            'days': days,
            'signups': series(User.objects.all(), 'date_joined'),
            'posts': series(SocialPost.objects.all(), 'created_at'),
            'reports': series(Report.objects.all(), 'created_at'),
        })


# ── Reports queue ────────────────────────────────────────────────────────────
class AdminReportViewSet(viewsets.GenericViewSet):
    permission_classes = [Cap('handle_reports')]
    pagination_class = StandardPagination
    serializer_class = AdminReportSerializer

    def get_permissions(self):
        # Taking down the reported content needs the content-removal capability.
        if self.action == 'remove_target':
            return [Cap('handle_reports', 'remove_content')()]
        if self.action == 'bulk':
            return [Cap('handle_reports', recent=True)()]
        return super().get_permissions()

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
            # __profile too: the serializer's reporter/assigned/resolved run
            # through SimpleUserSerializer, which reads profile.picture.
            .select_related(
                'reporter__profile', 'assigned_to__profile', 'resolved_by__profile',
            )
            .annotate(dup_count=Subquery(dup))
            .order_by('-created_at')
        )
        status_f = self.request.query_params.get('status')
        if status_f in dict(Report.STATUS_CHOICES):
            qs = qs.filter(status=status_f)
        if self.request.query_params.get('assigned') == 'me':
            qs = qs.filter(assigned_to=self.request.user)
        if self.request.query_params.get('order') == 'priority':
            # Urgent reasons (a child's safety, self-harm, violence, sexual
            # content) first; then the most reported — many people saying the
            # same is the strongest sign something needs seeing.
            from django.db.models import Case, IntegerField, Value, When
            from ..reporting import URGENT
            qs = qs.annotate(urgent=Case(When(reason__in=URGENT, then=Value(1)), default=Value(0),
                                         output_field=IntegerField())
                             ).order_by('-urgent', '-dup_count', '-created_at')
        return qs

    def list(self, request):
        qs = self.get_queryset()
        page = self.paginate_queryset(qs)
        rows = page if page is not None else list(qs)
        # Batch every target on the page into one query per content type.
        ctx = {'request': request, 'report_targets': build_report_targets(rows)}
        data = AdminReportSerializer(rows, many=True, context=ctx).data
        # Repeat offenders: the strikes of whoever posted each reported thing,
        # in one query for the page.
        author_ids = {d['target']['author']['id'] for d in data
                      if isinstance(d.get('target'), dict) and isinstance(d['target'].get('author'), dict)
                      and d['target']['author'].get('id')}
        strikes = dict(User.objects.filter(pk__in=author_ids).values_list('pk', 'strikes')) if author_ids else {}
        for d in data:
            author = (d.get('target') or {}).get('author') if isinstance(d.get('target'), dict) else None
            d['author_strikes'] = strikes.get(author.get('id'), 0) if isinstance(author, dict) else 0
        return self.get_paginated_response(data) if page is not None else Response(data)

    def retrieve(self, request, pk=None):
        report = get_object_or_404(Report, pk=pk)
        ctx = {'request': request, 'report_targets': build_report_targets([report])}
        return Response(AdminReportSerializer(report, context=ctx).data)

    def _set_status(self, request, pk, new_status, action_name):
        report = get_object_or_404(Report, pk=pk)
        if report.status in ('resolved', 'dismissed'):
            return Response({'error': f'This report was already {report.status}.', 'code': 'already_decided'},
                            status=status.HTTP_409_CONFLICT)
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

    def get_throttles(self):
        # Rate-limit only the bulk endpoint (the global ScopedRateThrottle reads
        # this attribute); other actions keep the default user/anon throttles.
        if self.action == 'bulk':
            self.throttle_scope = 'admin_bulk'
        return super().get_throttles()

    @action(detail=False, methods=['post'])
    def bulk(self, request):
        """Resolve or dismiss many reports at once."""
        ids = clean_ids(request.data.get('ids'))
        op = request.data.get('action')
        if ids is None:
            return Response({'error': 'ids: a list of 1 to 200 whole numbers'}, status=status.HTTP_400_BAD_REQUEST)
        if op not in ('resolve', 'dismiss'):
            return Response({'error': "action must be 'resolve' or 'dismiss'"}, status=status.HTTP_400_BAD_REQUEST)
        new_status = 'resolved' if op == 'resolve' else 'dismissed'
        # Only the open ones: a decided report keeps who decided it.
        count = Report.objects.filter(id__in=ids, status__in=('pending', 'reviewed')).update(
            status=new_status, resolved_by=request.user, resolved_at=timezone.now(),
        )
        log_admin_action(request.user, f'bulk_{op}_reports', 'report', None, reason=f'{count} reports')
        return Response({'updated': count})

    @action(detail=True, methods=['post'])
    def resolve(self, request, pk=None):
        return self._set_status(request, pk, 'resolved', 'resolve_report')

    @action(detail=True, methods=['post'])
    def dismiss(self, request, pk=None):
        return self._set_status(request, pk, 'dismissed', 'dismiss_report')

    def _hide_single(self, request, report, reason):
        from ..admin_security import outranks
        from ..models import SinglesProfile
        profile = SinglesProfile.objects.filter(pk=report.object_id).select_related('user').first()
        if profile is None:
            return Response({'error': 'Target not found or not removable'}, status=status.HTTP_400_BAD_REQUEST)
        if profile.user_id != request.user.pk and not outranks(request.user, profile.user):
            return _rank_refusal()
        if profile.status != SinglesProfile.BANNED:
            SinglesProfile.objects.filter(pk=profile.pk).update(
                status=SinglesProfile.PENDING, submitted_at=timezone.now(),
                review_note=f'Reported, sent back for review: {reason}'[:255])
        notify_moderation(profile.user, 'Single & Searching',
                          f'Your Single & Searching profile was hidden and sent back for review. Reason: {reason}')
        report.status, report.resolved_by, report.resolved_at = 'resolved', request.user, timezone.now()
        report.save(update_fields=['status', 'resolved_by', 'resolved_at'])
        log_admin_action(request.user, 'remove_singlesprofile', 'singlesprofile', profile.pk, reason=reason)
        return Response(self.get_serializer(report).data)

    @action(detail=True, methods=['post'])
    def remove_target(self, request, pk=None):
        report = get_object_or_404(Report, pk=pk)
        reason, refused = reason_of(request)
        if refused:
            return refused
        if report.content_type == 'singlesprofile':
            return self._hide_single(request, report, reason)
        if _protected_ids(request.user, report.content_type, [report.object_id]):
            return _rank_refusal()
        if not _soft_remove(report.content_type, report.object_id, True):
            return Response({'error': 'Target not found or not removable'},
                            status=status.HTTP_400_BAD_REQUEST)
        _tell_authors(report.content_type, [report.object_id], True, reason, request.user)
        report.status = 'resolved'
        report.resolved_by = request.user
        report.resolved_at = timezone.now()
        report.save(update_fields=['status', 'resolved_by', 'resolved_at'])
        if report.content_type == 'track':
            # Record why, and tell the uploader how to dispute it.
            rights.track_removed([report.object_id], reason=report.reason,
                                 note=reason, actor=request.user)
        log_admin_action(request.user, f'remove_{report.content_type}',
                         report.content_type, report.object_id, reason=reason)
        return Response(self.get_serializer(report).data)


# ── User management ──────────────────────────────────────────────────────────
class AdminUserViewSet(viewsets.GenericViewSet):
    permission_classes = [IsModerator]
    pagination_class = StandardPagination
    serializer_class = AdminUserSerializer

    def get_permissions(self):
        a = self.action
        if a in ('set_role', 'reset_two_factor'):
            return [RecentSuperAdmin()]
        if a in ('ban', 'unban'):
            return [Cap('ban_users', recent=True)()]
        if a in ('suspend', 'unsuspend', 'warn'):
            return [Cap('manage_users')()]
        # list / retrieve: any user-facing moderation capability can browse users
        return [Cap('manage_users', 'ban_users')()]

    def _target(self, request, pk, verb):
        """The account acted on, or a refusal: never yourself, never an admin
        of your rank or above (a moderator cannot ban a moderator)."""
        from ..admin_security import outranks
        user = get_object_or_404(User, pk=pk)
        if user.id == request.user.id:
            return None, Response({'error': f"You can't {verb} yourself."}, status=status.HTTP_400_BAD_REQUEST)
        if not outranks(request.user, user):
            return None, Response({'error': f"You can't {verb} an admin of your rank or above.", 'code': 'rank'},
                                  status=status.HTTP_403_FORBIDDEN)
        return user, None

    def get_queryset(self):
        # Annotate the per-row counts the serializer shows (posts + followers) so
        # the user list is a couple of queries instead of 2 COUNTs per row.
        qs = (
            User.objects
            .select_related('role', 'profile')
            .annotate(
                anno_posts_count=Count('social_posts', distinct=True),
                anno_followers_count=Count('followers', distinct=True),
            )
            .order_by('-date_joined')
        )
        q = self.request.query_params.get('q')
        if q:
            qs = qs.filter(Q(username__icontains=q) | Q(email__icontains=q))
        role = self.request.query_params.get('role')
        if role in ('moderator', 'super_admin'):
            qs = qs.filter(admin_role=role)
        state = self.request.query_params.get('status')
        if state == 'admins':
            qs = qs.filter(Q(admin_role__in=('moderator', 'super_admin')) | Q(is_superuser=True) | Q(role__isnull=False))
        elif state == 'suspended':
            qs = qs.filter(is_suspended=True).filter(
                Q(suspended_until__isnull=True) | Q(suspended_until__gt=timezone.now()))
        elif state == 'banned':
            qs = qs.filter(is_active=False)
        elif state == 'warned':
            qs = qs.filter(strikes__gt=0)
        return qs.select_related('admin_two_factor')

    def list(self, request):
        return _paginated(self, self.get_queryset(), AdminUserSerializer)

    def retrieve(self, request, pk=None):
        user = get_object_or_404(User, pk=pk)
        return Response(AdminUserSerializer(user, context={'request': request}).data)

    def get_serializer_context(self):
        return {'request': self.request}

    @action(detail=True, methods=['post'])
    def suspend(self, request, pk=None):
        user, refused = self._target(request, pk, 'suspend')
        if refused:
            return refused
        reason, refused = reason_of(request)
        if refused:
            return refused
        # Optional ?days=N for a temporary suspension; omitted/0 => indefinite.
        try:
            days = int(request.data.get('days') or 0)
        except (TypeError, ValueError):
            days = 0
        # Ten years is "for good" in practice; more overflowed the date and failed.
        days = max(0, min(days, 3650))
        user.is_suspended = True
        user.suspension_reason = reason
        user.suspended_at = timezone.now()
        user.suspended_until = (timezone.now() + timedelta(days=days)) if days > 0 else None
        user.save(update_fields=['is_suspended', 'suspension_reason', 'suspended_at', 'suspended_until'])
        if user.is_platform_admin:
            from ..admin_security import cut_off
            cut_off(user, 'suspended')
        span = f"for {days} day(s)" if days > 0 else "indefinitely"
        notify_moderation(user, 'Account suspended',
                          f"Your account has been suspended {span}." + (f" Reason: {reason}" if reason else ''))
        log_admin_action(request.user, 'suspend_user', 'user', user.id, reason=reason or span)
        return Response(self.get_serializer(user).data)

    @action(detail=True, methods=['post'])
    def unsuspend(self, request, pk=None):
        user, refused = self._target(request, pk, 'lift a suspension on')
        if refused:
            return refused
        user.is_suspended = False
        user.suspension_reason = ''
        user.suspended_at = None
        user.suspended_until = None
        user.save(update_fields=['is_suspended', 'suspension_reason', 'suspended_at', 'suspended_until'])
        notify_moderation(user, 'Suspension lifted', 'Your account suspension has been lifted. Welcome back!')
        log_admin_action(request.user, 'unsuspend_user', 'user', user.id)
        return Response(self.get_serializer(user).data)

    @action(detail=True, methods=['post'], url_path='clear-profile')
    def clear_profile(self, request, pk=None):
        """POST {fields: [...], reason} — clear what a profile says: any of
        bio, display_name, website, location, picture (all of them by default).
        For an offensive bio, a scam link or an indecent photo; the account
        itself is untouched. The person is told why."""
        user, refused = self._target(request, pk, 'edit')
        if refused:
            return refused
        reason, refused = reason_of(request)
        if refused:
            return refused
        allowed = ('bio', 'display_name', 'website', 'location', 'picture')
        asked = request.data.get('fields') or list(allowed)
        if not isinstance(asked, list) or not asked or any(f not in allowed for f in asked):
            return Response({'error': f'fields must be some of {list(allowed)}'}, status=status.HTTP_400_BAD_REQUEST)
        prof = getattr(user, 'profile', None)
        if prof is None:
            return Response({'error': 'This account has no profile.'}, status=status.HTTP_400_BAD_REQUEST)
        for f in asked:
            setattr(prof, f, '')
        prof.save(update_fields=asked + ['updated_at'])
        notify_moderation(user, 'Profile edited by a moderator',
                          'Part of your profile was removed for breaking the community rules.'
                          + (f' Reason: {reason}' if reason else ''))
        log_admin_action(request.user, 'clear_profile', 'user', user.id,
                         reason=', '.join(asked) + (f' — {reason}' if reason else ''))
        return Response(self.get_serializer(user).data)

    @action(detail=True, methods=['post'])
    def warn(self, request, pk=None):
        """Issue a warning (strike). Auto-escalates to a temporary suspension at
        the strike threshold."""
        user, refused = self._target(request, pk, 'warn')
        if refused:
            return refused
        reason, refused = reason_of(request)
        if refused:
            return refused
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
        user, refused = self._target(request, pk, 'ban')
        if refused:
            return refused
        reason, refused = reason_of(request)
        if refused:
            return refused
        user.is_active = False
        user.save(update_fields=['is_active'])
        from ..admin_security import cut_off
        cut_off(user, 'banned')
        _after_ban = request.user
        notify_moderation(user, 'Account banned',
                          'Your account has been banned and you can no longer sign in.' + (f" Reason: {reason}" if reason else ''))
        log_admin_action(request.user, 'ban_user', 'user', user.id, reason=reason)
        from ..admin_alerts import on_ban
        on_ban(_after_ban)
        return Response(self.get_serializer(user).data)

    @action(detail=True, methods=['post'])
    def unban(self, request, pk=None):
        user, refused = self._target(request, pk, 'unban')
        if refused:
            return refused
        user.is_active = True
        user.save(update_fields=['is_active'])
        log_admin_action(request.user, 'unban_user', 'user', user.id)
        return Response(self.get_serializer(user).data)

    @action(detail=True, methods=['post'])
    def set_role(self, request, pk=None):
        """Super-admin only. Accepts `super_admin` (bool) and/or `role_id`
        (a Role PK, or null to clear). Super admin and a granular role are
        mutually exclusive."""
        user = get_object_or_404(User, pk=pk)
        data = request.data
        was_admin = user.is_platform_admin
        if user.id == request.user.id and not (user.is_super_admin and data.get('super_admin') is False):
            return Response({'error': "You can't change your own role."}, status=status.HTTP_400_BAD_REQUEST)

        def _other_super_admins():
            return User.objects.filter(
                Q(admin_role='super_admin') | Q(is_superuser=True)
            ).exclude(id=user.id).count()

        if 'super_admin' in data:
            make_super = bool(data.get('super_admin'))
            if not make_super and user.is_super_admin and _other_super_admins() == 0:
                return Response({'error': 'Cannot remove the last super admin.'},
                                status=status.HTTP_400_BAD_REQUEST)
            user.admin_role = 'super_admin' if make_super else ''
            user.is_superuser = make_super
            # Django's staff flag goes with super admin and with nothing else:
            # left behind, it opened staff-only doors after a demotion.
            user.is_staff = make_super
            if make_super:
                user.role = None

        if 'role_id' in data:
            rid = data.get('role_id')
            if rid in (None, '', 0):
                user.role = None
            else:
                role = Role.objects.filter(id=rid).first()
                if not role:
                    return Response({'error': 'Role not found.'}, status=status.HTTP_400_BAD_REQUEST)
                if user.is_super_admin and _other_super_admins() == 0:
                    return Response({'error': 'Cannot demote the last super admin.'},
                                    status=status.HTTP_400_BAD_REQUEST)
                # A granular role supersedes legacy moderator / super-admin flags.
                user.role = role
                user.admin_role = ''
                user.is_superuser = False
                user.is_staff = False

        user.save(update_fields=['admin_role', 'is_superuser', 'is_staff', 'role'])
        user.refresh_from_db()
        if was_admin and not user.is_platform_admin:
            # Removed from the admins: every admin session ended and every
            # device signed out, so no old token is a way back in.
            from ..admin_security import cut_off
            cut_off(user, 'removed from admins')
        log_admin_action(request.user, 'set_role', 'user', user.id,
                         reason=(user.role.name if user.role_id else ('super_admin' if user.is_super_admin else 'none')))
        return Response(self.get_serializer(user).data)


    @action(detail=True, methods=['post'])
    def reset_two_factor(self, request, pk=None):
        """Super admin, for an admin who lost their phone: their authenticator
        is forgotten and their admin sessions end; they set it up again."""
        from ..models import AdminTwoFactor
        from ..admin_security import end_sessions
        user = get_object_or_404(User, pk=pk)
        AdminTwoFactor.objects.filter(user=user).delete()
        end_sessions(user, 'two-step reset')
        log_admin_action(request.user, 'reset_two_factor', 'user', user.id)
        from ..admin_alerts import on_two_factor_reset
        on_two_factor_reset(request.user, user)
        notify_moderation(user, 'Two-step sign-in reset',
                          'Your two-step sign-in for the admin tools was reset. Set it up again the next time '
                          'you open them. If you did not ask for this, tell a super admin at once.')
        return Response({'status': 'reset'})


# ── Content management ───────────────────────────────────────────────────────
class AdminContentViewSet(viewsets.GenericViewSet):
    permission_classes = [Cap('remove_content')]
    pagination_class = StandardPagination
    serializer_class = AdminContentPostSerializer

    def get_permissions(self):
        if self.action == 'bulk':
            return [Cap('remove_content', recent=True)()]
        return super().get_permissions()

    # type -> (select_related field, serializer, [search lookups])
    _CONFIG = {
        'post':         ('user',   AdminContentPostSerializer,        ['caption__icontains', 'user__username__icontains']),
        'track':        ('artist', AdminContentTrackSerializer,       ['title__icontains', 'album__icontains', 'artist__username__icontains']),
        'comment':      ('user',   AdminContentCommentSerializer,     ['content__icontains', 'user__username__icontains']),
        'trackcomment': ('user',   AdminContentTrackCommentSerializer,['content__icontains', 'user__username__icontains']),
        'group':        ('creator', AdminContentGroupSerializer,      ['name__icontains', 'description__icontains']),
        'story':        ('user',   AdminContentStorySerializer,       ['caption__icontains', 'user__username__icontains']),
        'publication':  ('author',  AdminContentPublicationSerializer, ['title__icontains', 'summary__icontains', 'author__username__icontains']),
        'product':      ('seller',  AdminContentProductSerializer,     ['title__icontains', 'seller__username__icontains']),
        'productreview': ('reviewer', AdminContentProductReviewSerializer, ['comment__icontains', 'reviewer__username__icontains']),
        'grouppost':    ('user',   AdminContentGroupPostSerializer,   ['content__icontains', 'user__username__icontains']),
        'videostudio':  ('created_by', AdminContentVideostudioSerializer, ['name__icontains', 'location__icontains']),
        'mediastation': ('created_by', AdminContentMediaStationSerializer, ['name__icontains']),
        'organization': ('created_by', AdminContentOrganizationSerializer, ['name__icontains', 'location__icontains']),
        'bookclub':     ('created_by', AdminContentBookClubSerializer, ['group__name__icontains', 'publication__title__icontains']),
        'livebroadcast': ('host', AdminContentLiveBroadcastSerializer, ['title__icontains', 'host__username__icontains']),
        'album':        ('artist', AdminContentAlbumSerializer,      ['title__icontains', 'artist__username__icontains']),
        'playlist':     ('user',   AdminContentPlaylistSerializer,   ['name__icontains', 'description__icontains', 'user__username__icontains']),
    }

    def list(self, request):
        ctype = request.query_params.get('type', 'post')
        cfg = self._CONFIG.get(ctype)
        if not cfg:
            return Response({'error': f'type must be one of {list(self._CONFIG)}'}, status=status.HTTP_400_BAD_REQUEST)
        rel, ser_cls, search_fields = cfg
        # rel__profile: the author's picture, read with the row (not one query each).
        Model = _CONTENT_MODELS[ctype]
        # Newest first; a live broadcast has no created_at, it started_at.
        newest = '-started_at' if Model is LiveBroadcast else '-created_at'
        qs = Model.objects.select_related(rel, f'{rel}__profile').order_by(newest)

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

    @staticmethod
    def _one(request):
        """(type, id) of the item acted on; id None when it is not a number
        (it reached the database as a string and failed as a 500)."""
        try:
            oid = int(request.data.get('id'))
        except (TypeError, ValueError):
            oid = None
        return request.data.get('type'), oid

    @action(detail=False, methods=['post'])
    def remove(self, request):
        ctype, oid = self._one(request)
        if oid is None or ctype not in _CONTENT_MODELS:
            return Response({'error': 'type and a numeric id'}, status=status.HTTP_400_BAD_REQUEST)
        reason, refused = reason_of(request)
        if refused:
            return refused
        if _protected_ids(request.user, ctype, [oid]):
            return _rank_refusal()
        if not _soft_remove(ctype, oid, True):
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        _tell_authors(ctype, [oid], True, reason, request.user)
        if ctype == 'track':
            # removal_reason: 'copyright' | 'policy' (the default).
            rights.track_removed([oid], reason=request.data.get('removal_reason', 'policy'),
                                 note=reason, actor=request.user)
        log_admin_action(request.user, f'remove_{ctype}', ctype, oid, reason=reason)
        return Response({'status': 'removed'})

    @action(detail=False, methods=['post'])
    def restore(self, request):
        ctype, oid = self._one(request)
        if oid is None or ctype not in _CONTENT_MODELS:
            return Response({'error': 'type and a numeric id'}, status=status.HTTP_400_BAD_REQUEST)
        if _protected_ids(request.user, ctype, [oid]):
            return _rank_refusal()
        if not _soft_remove(ctype, oid, False):
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        _tell_authors(ctype, [oid], False, actor=request.user)
        if ctype == 'track':
            rights.track_restored([oid], actor=request.user)
        log_admin_action(request.user, f'restore_{ctype}', ctype, oid)
        return Response({'status': 'restored'})

    def get_throttles(self):
        if self.action == 'bulk':
            self.throttle_scope = 'admin_bulk'
        return super().get_throttles()

    @action(detail=False, methods=['post'])
    def bulk(self, request):
        """Remove or restore many items of one type at once."""
        ctype = request.data.get('type')
        ids = clean_ids(request.data.get('ids'))
        op = request.data.get('action')
        Model = _CONTENT_MODELS.get(ctype)
        if not Model:
            return Response({'error': f'type must be one of {list(_CONTENT_MODELS)}'}, status=status.HTTP_400_BAD_REQUEST)
        if ids is None:
            return Response({'error': 'ids: a list of 1 to 200 whole numbers'}, status=status.HTTP_400_BAD_REQUEST)
        if op not in ('remove', 'restore'):
            return Response({'error': "action must be 'remove' or 'restore'"}, status=status.HTTP_400_BAD_REQUEST)
        reason, refused = reason_of(request, required=(op == 'remove'))
        if refused:
            return refused
        # Content by an admin of the actor's rank or above is left as it is.
        protected = _protected_ids(request.user, ctype, ids)
        ids = [i for i in ids if i not in protected]
        # .update() fires no signals, so the profile-total adjustment is explicit
        # here as well — and must precede the flip (it selects on the old state).
        sync_removal_likes(Model, ids, op == 'remove')
        changing = list(Model.objects.filter(id__in=ids, is_removed=(op != 'remove')).values_list('id', flat=True))
        count = Model.objects.filter(id__in=changing).update(is_removed=(op == 'remove'))
        if Model is LiveBroadcast and op == 'remove':
            _end_live(changing)
        if Model is Group and op == 'remove':
            _close_groups(changing)
        if Model is GroupPost and op == 'remove':
            _drop_group_posts(changing)
        _tell_authors(ctype, changing, op == 'remove', reason, request.user)
        if ctype == 'track' and changing:
            if op == 'remove':
                rights.track_removed(changing, reason=request.data.get('removal_reason', 'policy'),
                                     note=request.data.get('reason', ''), actor=request.user)
            else:
                rights.track_restored(changing, actor=request.user)
        log_admin_action(request.user, f'bulk_{op}_{ctype}', ctype, None,
                         reason=f'{count} items' + (f' — {reason}' if reason else ''))
        return Response({'updated': count, 'skipped_rank': len(protected)})


# ── Appeals queue ────────────────────────────────────────────────────────────
class AdminAppealViewSet(viewsets.GenericViewSet):
    permission_classes = [Cap('manage_appeals')]
    pagination_class = StandardPagination
    serializer_class = AdminAppealSerializer

    def get_queryset(self):
        qs = Appeal.objects.select_related('user', 'reviewed_by', 'track').order_by('-created_at')
        status_f = self.request.query_params.get('status')
        if status_f in dict(Appeal.STATUS_CHOICES):
            qs = qs.filter(status=status_f)
        kind = self.request.query_params.get('kind')
        if kind in dict(Appeal.KIND_CHOICES):
            qs = qs.filter(kind=kind)
        return qs

    def list(self, request):
        return _paginated(self, self.get_queryset(), AdminAppealSerializer)

    def _resolve(self, request, pk, new_status):
        appeal = get_object_or_404(Appeal, pk=pk)
        if appeal.status != 'pending':
            return None
        appeal.status = new_status
        appeal.reviewed_by = request.user
        appeal.reviewed_at = timezone.now()
        appeal.review_notes = (request.data.get('notes') or '')[:2000]
        appeal.save(update_fields=['status', 'reviewed_by', 'reviewed_at', 'review_notes'])
        return appeal

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        appeal = self._resolve(request, pk, 'approved')
        if appeal is None:
            return Response({'error': 'This appeal was already decided.', 'code': 'already_decided'},
                            status=status.HTTP_409_CONFLICT)
        if appeal.kind == Appeal.KIND_COPYRIGHT:
            # A song takedown overturned: the song comes back (the uploader is
            # told by track_restored).
            if appeal.track_id and _soft_remove('track', appeal.track_id, False):
                rights.track_restored([appeal.track_id], actor=request.user)
            log_admin_action(request.user, 'approve_song_dispute', 'appeal', appeal.id)
            return Response(self.get_serializer(appeal).data)
        # Approving an appeal lifts the suspension.
        u = appeal.user
        u.is_suspended = False
        u.suspension_reason = ''
        u.suspended_at = None
        u.suspended_until = None
        u.save(update_fields=['is_suspended', 'suspension_reason', 'suspended_at', 'suspended_until'])
        notify_moderation(u, 'Appeal approved',
                          'Your appeal was approved and your suspension has been lifted. Welcome back!')
        log_admin_action(request.user, 'approve_appeal', 'appeal', appeal.id)
        return Response(self.get_serializer(appeal).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        appeal = self._resolve(request, pk, 'rejected')
        if appeal is None:
            return Response({'error': 'This appeal was already decided.', 'code': 'already_decided'},
                            status=status.HTTP_409_CONFLICT)
        if appeal.kind == Appeal.KIND_COPYRIGHT:
            title = appeal.track.title if appeal.track_id else 'your song'
            notify_moderation(appeal.user, 'Dispute reviewed',
                              f'We reviewed your dispute about "{title}" and the takedown stands.'
                              + (f" Note: {appeal.review_notes}" if appeal.review_notes else ''))
            log_admin_action(request.user, 'reject_song_dispute', 'appeal', appeal.id)
            return Response(self.get_serializer(appeal).data)
        notify_moderation(appeal.user, 'Appeal reviewed',
                          'Your appeal has been reviewed and the moderation decision stands.'
                          + (f" Note: {appeal.review_notes}" if appeal.review_notes else ''))
        log_admin_action(request.user, 'reject_appeal', 'appeal', appeal.id)
        return Response(self.get_serializer(appeal).data)


# ── Audit log viewer ─────────────────────────────────────────────────────────
class AdminLogViewSet(viewsets.GenericViewSet):
    """Read-only audit trail of every moderation action."""
    permission_classes = [Cap('view_audit_log')]
    pagination_class = StandardPagination
    serializer_class = AdminActionLogSerializer

    def get_queryset(self):
        # actor__profile: the actor's picture, read with the row (not one query each).
        qs = AdminActionLog.objects.select_related('actor__profile').order_by('-created_at')
        p = self.request.query_params
        if p.get('action'):
            qs = qs.filter(action=p['action'])
        if p.get('actor'):
            qs = qs.filter(Q(actor_name__iexact=p['actor']) | Q(actor__username__iexact=p['actor']))
        if p.get('target_type'):
            qs = qs.filter(target_type=p['target_type'])
        if str(p.get('target_id') or '').isdigit():
            qs = qs.filter(target_id=int(p['target_id']))
        from datetime import date
        for key, lookup in (('since', 'created_at__date__gte'), ('until', 'created_at__date__lte')):
            try:
                # A malformed date reached the database and failed as a 500.
                qs = qs.filter(**{lookup: date.fromisoformat((p.get(key) or '')[:10])})
            except ValueError:
                pass
        return qs

    def list(self, request):
        return _paginated(self, self.get_queryset(), AdminActionLogSerializer)

    @action(detail=False, methods=['get'])
    def verify(self, request):
        """Whether the trail is as written: every entry unchanged, none gone."""
        ok, broken, checked = verify_audit_chain()
        return Response({'ok': ok, 'first_broken_id': broken, 'checked': checked})


# ── Roles (super-admin manages capability bundles) ───────────────────────────
class AdminRoleViewSet(viewsets.ModelViewSet):
    queryset = Role.objects.all()
    serializer_class = RoleSerializer
    permission_classes = [IsSuperAdmin]
    pagination_class = None

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [RecentSuperAdmin()]
        return super().get_permissions()

    @staticmethod
    def _cut_off_powerless(users):
        from ..admin_security import cut_off
        for u in users:
            u.refresh_from_db()
            if not u.is_platform_admin:
                cut_off(u, 'role changed')

    @action(detail=False, methods=['get'])
    def capabilities(self, request):
        """The catalogue of assignable capabilities (key + label) for the editor."""
        return Response([{'key': k, 'label': lbl} for k, lbl in ADMIN_CAPABILITIES])

    def perform_create(self, serializer):
        role = serializer.save()
        log_admin_action(self.request.user, 'create_role', 'role', role.id, reason=role.name)

    def perform_update(self, serializer):
        role = serializer.save()
        log_admin_action(self.request.user, 'update_role', 'role', role.id, reason=role.name)
        self._cut_off_powerless(list(role.users.all()))

    def perform_destroy(self, instance):
        holders = list(instance.users.all())
        log_admin_action(self.request.user, 'delete_role', 'role', instance.id, reason=instance.name)
        instance.delete()
        self._cut_off_powerless(holders)


# ── Two-step sign-in for admins ──────────────────────────────────────────────
class IsAdminInGoodStanding(BasePermission):
    """An admin whose account may use admin tools: the doors to setting up
    and using two-step sign-in (no admin session needed to reach them)."""
    message = 'You do not have permission for this action.'

    def has_permission(self, request, view):
        from ..admin_security import in_good_standing
        u = request.user
        return bool(u and u.is_authenticated and u.is_platform_admin and in_good_standing(u))


class AdminSecurityViewSet(viewsets.ViewSet):
    """/admin/security/: status, set up the authenticator app, confirm it,
    open an admin session with a code (or a backup code), and close it."""
    permission_classes = [IsAdminInGoodStanding]

    def get_throttles(self):
        if self.action in ('setup', 'confirm', 'verify'):
            self.throttle_scope = 'admin_2fa'
        return super().get_throttles()

    def _two_factor(self, user):
        from ..models import AdminTwoFactor
        return AdminTwoFactor.objects.filter(user=user).first()

    @staticmethod
    def _locked(user):
        """A refusal while the code box is locked after too many wrong codes."""
        from ..admin_security import locked_out
        left = locked_out(user)
        if not left:
            return None
        minutes = max(1, (left + 59) // 60)
        return Response({'error': f'Too many wrong codes. Try again in {minutes} minute(s).',
                         'code': 'locked', 'retry_after': left}, status=status.HTTP_429_TOO_MANY_REQUESTS)

    @staticmethod
    def _wrong(user, message):
        """A wrong code counted; the one that locks the box tells the super admins."""
        from ..admin_security import code_failed
        if code_failed(user):
            log_admin_action(user, 'two_factor_locked', 'user', user.id)
            from ..admin_alerts import on_lockout
            on_lockout(user)
            return AdminSecurityViewSet._locked(user)
        return Response({'error': message, 'code': 'bad_code'}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['get'])
    def status(self, request):
        from ..admin_security import session_for, two_factor_required
        u = request.user
        tf = self._two_factor(u)
        session = session_for(request)
        return Response({
            'is_admin': True,
            'is_super_admin': u.is_super_admin,
            'capabilities': u.capabilities,
            'two_factor_required': two_factor_required(),
            'two_factor_enabled': bool(tf and tf.enabled),
            'session_valid': bool(session),
            'session_expires_at': session.expires_at if session else None,
        })

    @action(detail=False, methods=['post'])
    def setup(self, request):
        """A new secret for the authenticator app (replacing one not yet
        confirmed). Once confirmed, only a super admin can reset it."""
        from ..models import AdminTwoFactor
        from ..admin_security import new_secret, encrypt, otpauth_url
        tf = self._two_factor(request.user)
        if tf and tf.enabled:
            return Response({'error': 'Two-step sign-in is already set up.', 'code': 'already_enabled'},
                            status=status.HTTP_400_BAD_REQUEST)
        secret = new_secret()
        AdminTwoFactor.objects.update_or_create(
            user=request.user, defaults={'secret_encrypted': encrypt(secret), 'confirmed_at': None,
                                         'last_step': 0, 'backup_hashes': []})
        account = request.user.email or request.user.username
        return Response({'secret': secret, 'otpauth_url': otpauth_url(secret, account)})

    @action(detail=False, methods=['post'])
    def confirm(self, request):
        """The first code from the app: two-step sign-in is on, the backup
        codes are given (once), and an admin session opens."""
        from ..admin_security import decrypt, check_code, claim_step, new_backup_codes, open_session
        tf = self._two_factor(request.user)
        if not tf or tf.enabled:
            return Response({'error': 'Start the set-up first.', 'code': 'no_setup'},
                            status=status.HTTP_400_BAD_REQUEST)
        refused = self._locked(request.user)
        if refused:
            return refused
        step = check_code(decrypt(tf.secret_encrypted), request.data.get('code'), tf.last_step)
        if step is None or not claim_step(tf, step):
            return self._wrong(request.user, 'That code is not right. Try the one showing now.')
        codes, hashes = new_backup_codes()
        tf.confirmed_at = timezone.now()
        tf.last_step = step
        tf.backup_hashes = hashes
        tf.save(update_fields=['confirmed_at', 'last_step', 'backup_hashes'])
        token, expires = open_session(request.user, request)
        log_admin_action(request.user, 'enable_two_factor', 'user', request.user.id)
        return Response({'backup_codes': codes, 'admin_session': token, 'expires_at': expires})

    @action(detail=False, methods=['post'])
    def verify(self, request):
        """A code (or a backup code, used once): an admin session opens, or the
        one sent along is confirmed afresh (for the dangerous actions)."""
        from ..admin_security import (
            check_code, claim_backup_code, claim_step, code_passed, decrypt, digest, open_session, session_for,
        )
        tf = self._two_factor(request.user)
        if not tf or not tf.enabled:
            return Response({'error': 'Set up two-step sign-in first.', 'code': 'not_enabled'},
                            status=status.HTTP_400_BAD_REQUEST)
        refused = self._locked(request.user)
        if refused:
            return refused
        code = str(request.data.get('code') or '').strip()
        backup = str(request.data.get('backup_code') or '').strip().lower()
        ok = False
        if backup:
            if claim_backup_code(tf, digest(backup)):
                ok = True
                log_admin_action(request.user, 'used_backup_code', 'user', request.user.id,
                                 reason=f'{len(tf.backup_hashes)} left')
        else:
            step = check_code(decrypt(tf.secret_encrypted), code, tf.last_step)
            # claim_step: the same code sent twice at once opens one session.
            ok = step is not None and claim_step(tf, step)
        if not ok:
            log_admin_action(request.user, 'failed_two_factor', 'user', request.user.id)
            return self._wrong(request.user, 'That code is not right.')
        code_passed(request.user)
        current = session_for(request)
        if current:
            current.verified_at = timezone.now()
            current.save(update_fields=['verified_at'])
            return Response({'admin_session': None, 'expires_at': current.expires_at, 'refreshed': True})
        token, expires = open_session(request.user, request)
        log_admin_action(request.user, 'admin_sign_in', 'user', request.user.id)
        from ..admin_alerts import on_admin_sign_in
        from ..admin_security import client_ip
        on_admin_sign_in(request.user, client_ip(request), request.META.get('HTTP_USER_AGENT', '')[:255])
        return Response({'admin_session': token, 'expires_at': expires,
                         'backup_codes_left': len(tf.backup_hashes or [])})

    @action(detail=False, methods=['post'])
    def logout(self, request):
        from ..admin_security import session_for
        current = session_for(request)
        if current:
            current.revoked_at = timezone.now()
            current.revoked_reason = 'signed out'
            current.save(update_fields=['revoked_at', 'revoked_reason'])
        return Response({'status': 'signed_out'})

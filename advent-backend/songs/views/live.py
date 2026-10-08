from .common import *  # noqa: F401,F403
import re
import uuid
from datetime import timedelta
from django.db.models import F
from django.utils import timezone
from ..models import LiveBroadcast, CoHostRequest
from ..serializers import LiveBroadcastSerializer, LiveBroadcastListSerializer, CoHostRequestSerializer
from ..signals import credit_user_likes
from .. import livekit_service as lk


# How many co-hosts can share the stage with the host at once.
MAX_COHOSTS = 4

# Follower thresholds to go live (staff/admins are exempt). Video (Go-Live) is a
# heavier commitment than an audio Meet, so it needs a larger following.
MIN_FOLLOWERS = {'tv': 1000, 'meet': 100}
KIND_LABEL = {'tv': 'Go-Live', 'meet': 'Meet'}

# A broadcast still "live" this long after it started lost its host without
# LiveKit telling us (no webhook, a crash): it is ended when the hub is read,
# so the hub never shows a frozen room forever.
STALE_AFTER = timedelta(hours=12)
# Likes one flush may add: the app flushes every 5 s, a fast thumb manages
# perhaps 10 taps a second.
MAX_LIKES_PER_CALL = 50
OVERLAY_STYLES = ('lower3', 'banner', 'nametag', 'ticker')
# Control characters (newlines included) out of titles shown on cards.
_CONTROL = re.compile(r'[\x00-\x1f\x7f]')


def _clean_title(text, limit):
    return _CONTROL.sub(' ', str(text or '')).strip()[:limit]


def _int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _admin_may(request):
    """An admin whose role may take content down - through the admin gate
    (good standing, two-step session), like every other admin power."""
    return admin_gate(request, lambda u: u.has_capability('remove_content'))


def _log_admin(request, action, b):
    from .admin import log_admin_action
    log_admin_action(request.user, action, 'livebroadcast', b.id, reason=f'@{b.host.username}: {b.title}'[:200])


def reap_stale():
    """End broadcasts whose host vanished without LiveKit telling us."""
    LiveBroadcast.objects.filter(status='live', started_at__lt=timezone.now() - STALE_AFTER).update(
        status='ended', ended_at=timezone.now())


def _may_watch(user, b):
    """None if `user` may be in this broadcast, else (message, code)."""
    if b.host_id == user.id or user.is_super_admin:
        return None   # a block by the host can't shut a super admin out
    if is_blocked_between(user, b.host):
        return ('You cannot join this broadcast.', 'blocked')
    if b.singles_only and not user.is_platform_admin and not _approved_single(user):
        return ('This room is for Single & Searching members.', 'singles_only')
    # Removed by the host (or an admin): not back in for the rest of it.
    if CoHostRequest.objects.filter(broadcast=b, user=user, status='removed').exists():
        return ('The host removed you from this broadcast.', 'removed')
    return None


def _approved_single(user):
    from ..models import SinglesProfile
    from .. import singles
    return singles.feature_on() and SinglesProfile.objects.filter(
        user=user, status=SinglesProfile.APPROVED).exists() and not singles.blockers(user)


def _singles_host_refusal(user, kind):
    from ..models import SinglesProfile
    if kind != 'meet':
        return Response({'error': 'Single & Searching rooms are audio only.'}, status=status.HTTP_400_BAD_REQUEST)
    if user.is_platform_admin:
        return None
    if not _approved_single(user) or not SinglesProfile.objects.filter(
            user=user, photo_verified_at__isnull=False).exists():
        return Response({'error': 'Hosting a singles room needs an approved profile with a verified photo.',
                         'code': 'singles_host'}, status=status.HTTP_403_FORBIDDEN)
    return None


def _identity(user):
    return f"u{user.id}"


def _broadcast_payload(broadcast, token, request=None):
    """What the client needs to join: the LiveKit URL, a role token, and the row.
    `request` is passed so the serializer can resolve is_following for the viewer."""
    return {
        'url': settings.LIVEKIT_URL,
        'token': token,
        'broadcast': LiveBroadcastSerializer(broadcast, context={'request': request}).data,
    }


class LiveBroadcastViewSet(viewsets.GenericViewSet):
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination
    serializer_class = LiveBroadcastSerializer

    def get_queryset(self):
        return (
            LiveBroadcast.objects.select_related('host__profile')
            .filter(status='live', is_removed=False).order_by('-started_at')
        )

    def get_throttles(self):
        # Abuse guards on the two write paths a user can spam; other actions keep
        # the default user/anon throttles. (Global ScopedRateThrottle reads this.)
        if self.action == 'create':
            self.throttle_scope = 'go_live'
        elif self.action == 'request_cohost':
            self.throttle_scope = 'cohost_request'
        elif self.action == 'react':
            self.throttle_scope = 'live_react'
        elif self.action == 'overlay':
            self.throttle_scope = 'live_action'
        return super().get_throttles()

    # ── Discovery ────────────────────────────────────────────────────────────
    def list(self, request):
        reap_stale()
        # Single & Searching rooms are listed only inside it (views/singles_hub).
        # Hosts either side blocked, and deactivated accounts, aren't shown.
        qs = (self.get_queryset().filter(singles_only=False, host__is_active=True, host__is_deactivated=False)
              .exclude(host_id__in=blocked_ids_for(request.user)))
        # People I follow first, then the busiest rooms, then the newest:
        # the big card at the top is the one most worth opening.
        from django.db.models import Exists, OuterRef
        follows = User.followers.through.objects.filter(from_user=OuterRef('host_id'), to_user=request.user.id)
        qs = qs.annotate(followed=Exists(follows)).order_by('-followed', '-viewer_count', '-started_at')
        page = self.paginate_queryset(qs)
        data = LiveBroadcastListSerializer(
            page if page is not None else qs, many=True, context={'request': request},
        ).data
        return self.get_paginated_response(data) if page is not None else Response(data)

    def retrieve(self, request, pk=None):
        b = get_object_or_404(LiveBroadcast, pk=pk, is_removed=False)
        # A singles room is not there at all for anyone outside it.
        if b.singles_only and not request.user.is_platform_admin and not _approved_single(request.user):
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(LiveBroadcastSerializer(b, context={'request': request}).data)

    @action(detail=False, methods=['get'])
    def eligibility(self, request):
        """Who may start what, before they set anything up: the Go Live
        screen shows what is still needed instead of failing at the end."""
        followers = request.user.followers.count()
        exempt = request.user.is_platform_admin
        return Response({
            'followers': followers,
            'needed': MIN_FOLLOWERS,
            'allowed': {k: exempt or followers >= n for k, n in MIN_FOLLOWERS.items()},
        })

    # ── Go live (host) ─────────────────────────────────────────────────────────
    def create(self, request):
        kind = request.data.get('kind', 'meet')
        title = _clean_title(request.data.get('title'), 200)
        if kind not in dict(LiveBroadcast.KIND_CHOICES):
            return Response({'error': 'kind must be meet|tv'}, status=status.HTTP_400_BAD_REQUEST)
        if not title:
            return Response({'error': 'title is required'}, status=status.HTTP_400_BAD_REQUEST)

        # A Single & Searching room: hosted by an approved single with a
        # verified photo (or an admin), audio only, and no follower gate —
        # followers aren't told either: it is not theirs to see.
        singles_only = bool(request.data.get('singles_only'))
        if singles_only:
            refused = _singles_host_refusal(request.user, kind)
            if refused:
                return refused
        # Follower gate (staff/admins exempt): Go-Live (video) needs 1,000
        # followers; Meet (audio) needs 100.
        if not request.user.is_platform_admin and not singles_only:
            needed = MIN_FOLLOWERS.get(kind, 0)
            if needed and request.user.followers.count() < needed:
                return Response(
                    {'error': f"You need {needed:,} followers to start a {KIND_LABEL.get(kind, kind)}.",
                     'code': 'followers_needed', 'needed': needed},
                    status=status.HTTP_403_FORBIDDEN,
                )

        # One live broadcast per host: end any the host left dangling (e.g. a
        # crash where the room was never torn down) so the hub never shows two
        # live cards for the same host and stale rooms get reaped.
        for old in LiveBroadcast.objects.filter(host=request.user, status='live'):
            old.status = 'ended'
            old.ended_at = timezone.now()
            old.save(update_fields=['status', 'ended_at'])
            lk.end_room(old.room_name)

        room_name = f"bc_{uuid.uuid4().hex[:12]}"
        broadcast = LiveBroadcast.objects.create(
            host=request.user, kind=kind, title=title[:200], room_name=room_name, singles_only=singles_only,
        )
        lk.ensure_room(room_name, metadata={
            'broadcast_id': broadcast.id, 'host': request.user.username,
            'kind': kind, 'title': broadcast.title,
        })
        token = lk.create_access_token(
            identity=_identity(request.user), name=request.user.username,
            room=room_name, can_publish=True,
        )
        if not singles_only:
            self._notify_followers(request.user, broadcast)
        return Response(_broadcast_payload(broadcast, token, request), status=status.HTTP_201_CREATED)

    def _notify_followers(self, host, broadcast):
        """One push to every follower, in batches off the request thread: one
        notify_user per follower made a host with thousands wait minutes on
        the Go Live button."""
        from ..push import notify_many
        ids = list(host.followers.values_list('id', flat=True))
        if not ids:
            return
        try:
            notify_many(ids, 'live', f"{host.username} is live on air: {broadcast.title}",
                        {'type': 'live', 'broadcast_id': broadcast.id})
        except Exception:
            logger.exception('live notify failed')

    # ── Join (viewer) ──────────────────────────────────────────────────────────
    @action(detail=True, methods=['get'])
    def token(self, request, pk=None):
        b = get_object_or_404(LiveBroadcast, pk=pk, is_removed=False)
        if b.status != 'live':
            return Response({'error': 'This broadcast has ended.', 'code': 'ended'}, status=status.HTTP_410_GONE)
        refused = _may_watch(request.user, b)
        if refused:
            return Response({'error': refused[0], 'code': refused[1]}, status=status.HTTP_403_FORBIDDEN)
        token = lk.create_access_token(
            identity=_identity(request.user), name=request.user.username,
            room=b.room_name, can_publish=False,  # viewers are subscribe-only
        )
        return Response(_broadcast_payload(b, token, request))

    # ── Likes (❤️ reactions) ─────────────────────────────────────────────────────
    @action(detail=True, methods=['post'])
    def react(self, request, pk=None):
        """Batch-increment the broadcast's like tally. Clients flush the number
        of ❤️ reactions they produced since the last call, so the persisted total
        survives rejoins. Clamped so one call can't inflate the count."""
        b = get_object_or_404(LiveBroadcast, pk=pk, is_removed=False)
        if _may_watch(request.user, b):
            return Response({'error': 'You cannot react here.'}, status=status.HTTP_403_FORBIDDEN)
        n = max(1, min(_int(request.data.get('count')) or 1, MAX_LIKES_PER_CALL))
        applied = LiveBroadcast.objects.filter(pk=b.pk, status='live', is_removed=False).update(
            like_count=F('like_count') + n)
        # Credit the host's lifetime like total only when the tally actually
        # moved (an ended room is a no-op above), and never for the host's own
        # taps on their own broadcast.
        if applied and b.host_id != request.user.id:
            credit_user_likes(b.host_id, n)
        b.refresh_from_db(fields=['like_count'])
        return Response({'like_count': b.like_count})

    # ── On-screen graphic (lower third / banner / name tag / ticker) ─────────────
    @action(detail=True, methods=['post'])
    def overlay(self, request, pk=None):
        """Set or clear the persisted on-screen graphic. Host or an approved
        co-host only. Persisted so it survives a reconnect and reaches late
        joiners in the join payload; the live push still rides the data channel."""
        b = get_object_or_404(LiveBroadcast, pk=pk, is_removed=False)
        is_cohost = b.cohost_requests.filter(user=request.user, status='approved').exists()
        if b.host_id != request.user.id and not is_cohost and not request.user.is_super_admin:
            return Response({'error': 'Only the host or a co-host can set on-screen text.'}, status=status.HTTP_403_FORBIDDEN)
        if b.status != 'live':
            return Response({'error': 'This broadcast has ended.', 'code': 'ended'}, status=status.HTTP_410_GONE)
        title = _clean_title(request.data.get('title'), 120)
        if request.data.get('clear') or not title:
            b.overlay = None
        else:
            def _frac(v):
                try:
                    return round(min(1.0, max(0.0, float(v))), 4)
                except (TypeError, ValueError):
                    return None
            style = request.data.get('style')
            b.overlay = {
                # Only the styles the app draws: anything else is a lower third.
                'style': style if style in OVERLAY_STYLES else 'lower3',
                'title': title,
                'sub': _clean_title(request.data.get('sub'), 80),
                'x': _frac(request.data.get('x')),
                'y': _frac(request.data.get('y')),
            }
        b.save(update_fields=['overlay'])
        return Response({'overlay': b.overlay})

    # ── End (host or super admin) ───────────────────────────────────────────────
    @action(detail=True, methods=['post'])
    def end(self, request, pk=None):
        b = get_object_or_404(LiveBroadcast, pk=pk, is_removed=False)
        # The host ends their own broadcast; an admin who may take content
        # down can end anyone's - on the record.
        by_admin = b.host_id != request.user.id
        if by_admin and not _admin_may(request):
            return Response({'error': 'Only the host or an admin can end this broadcast.'}, status=status.HTTP_403_FORBIDDEN)
        if b.status != 'ended':
            b.status = 'ended'
            b.ended_at = timezone.now()
            b.save(update_fields=['status', 'ended_at'])
            lk.end_room(b.room_name)
            if by_admin:
                _log_admin(request, 'end_live', b)
        return Response(LiveBroadcastSerializer(b).data)

    # ── Delete (host or super admin) ────────────────────────────────────────────
    def destroy(self, request, pk=None):
        """Remove a broadcast entirely. The host can delete their own; a super
        admin can delete any. A still-live room is torn down first."""
        b = get_object_or_404(LiveBroadcast, pk=pk, is_removed=False)
        by_admin = b.host_id != request.user.id
        if by_admin and not _admin_may(request):
            return Response({'error': 'Only the host or an admin can delete this broadcast.'}, status=status.HTTP_403_FORBIDDEN)
        if b.status == 'live':
            lk.end_room(b.room_name)
        if by_admin:
            _log_admin(request, 'delete_live', b)
        b.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ── Co-host requests ───────────────────────────────────────────────────────
    @action(detail=True, methods=['post'], url_path='request-cohost')
    def request_cohost(self, request, pk=None):
        b = get_object_or_404(LiveBroadcast, pk=pk, is_removed=False)
        if b.status != 'live':
            return Response({'error': 'Broadcast has ended.'}, status=status.HTTP_410_GONE)
        if b.host_id == request.user.id:
            return Response({'error': "You're the host."}, status=status.HTTP_400_BAD_REQUEST)
        refused = _may_watch(request.user, b)
        if refused:
            return Response({'error': refused[0], 'code': refused[1]}, status=status.HTTP_403_FORBIDDEN)
        req, _created = CoHostRequest.objects.get_or_create(
            broadcast=b, user=request.user,
            defaults={'status': 'pending'},
        )
        asked_again = not _created and req.status in ('rejected', 'left')
        if asked_again:
            req.status = 'pending'
            req.save(update_fields=['status'])
        # One push per request: asking again while still waiting does not
        # buzz the host's phone again.
        if _created or asked_again:
            notify_user(b.host, 'cohost_request', f"{request.user.username} wants to co-host", {
                'type': 'cohost_request', 'broadcast_id': b.id, 'request_id': req.id,
            })
        return Response(CoHostRequestSerializer(req).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'], url_path='cohost-requests')
    def cohost_requests(self, request, pk=None):
        b = get_object_or_404(LiveBroadcast, pk=pk, is_removed=False)
        if b.host_id != request.user.id:
            return Response({'error': 'Host only.'}, status=status.HTTP_403_FORBIDDEN)
        qs = b.cohost_requests.select_related('user__profile').filter(status='pending')
        return Response(CoHostRequestSerializer(qs, many=True).data)

    @action(detail=True, methods=['post'], url_path='approve-cohost')
    def approve_cohost(self, request, pk=None):
        b = get_object_or_404(LiveBroadcast, pk=pk, is_removed=False)
        if b.host_id != request.user.id:
            return Response({'error': 'Host only.'}, status=status.HTTP_403_FORBIDDEN)
        if b.status != 'live':
            return Response({'error': 'This broadcast has ended.', 'code': 'ended'}, status=status.HTTP_410_GONE)
        # A text id reached the database and failed as a 500.
        req = get_object_or_404(CoHostRequest, pk=_int(request.data.get('request_id')) or 0, broadcast=b)
        if req.status != 'approved' and b.cohost_requests.filter(status='approved').count() >= MAX_COHOSTS:
            return Response(
                {'error': f'Maximum of {MAX_COHOSTS} co-hosts on stage.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        req.status = 'approved'
        req.save(update_fields=['status'])
        # Grant publish rights on the co-host's live connection so they can turn
        # on mic/camera immediately — no client-side token swap / reconnect.
        lk.grant_publish(b.room_name, _identity(req.user))
        notify_user(req.user, 'cohost_approved', f"You're now a co-host on {b.title}", {
            'type': 'cohost_approved', 'broadcast_id': b.id,
        })
        return Response(CoHostRequestSerializer(req).data)

    @action(detail=True, methods=['post'], url_path='reject-cohost')
    def reject_cohost(self, request, pk=None):
        b = get_object_or_404(LiveBroadcast, pk=pk, is_removed=False)
        if b.host_id != request.user.id:
            return Response({'error': 'Host only.'}, status=status.HTTP_403_FORBIDDEN)
        req = get_object_or_404(CoHostRequest, pk=_int(request.data.get('request_id')) or 0, broadcast=b)
        req.status = 'rejected'
        req.save(update_fields=['status'])
        return Response(CoHostRequestSerializer(req).data)

    @action(detail=True, methods=['get'], url_path='cohost-token')
    def cohost_token(self, request, pk=None):
        """An approved co-host fetches their publish token."""
        b = get_object_or_404(LiveBroadcast, pk=pk, is_removed=False)
        if b.status != 'live':
            return Response({'error': 'This broadcast has ended.'}, status=status.HTTP_410_GONE)
        mine = b.cohost_requests.filter(user=request.user).values_list('status', flat=True).first()
        if mine != 'approved':
            # 'pending': keep asking. Anything else is an answer: the app
            # stops asking every few seconds for the rest of the broadcast.
            return Response({'error': 'Not approved as a co-host.', 'code': mine or 'none'},
                            status=status.HTTP_403_FORBIDDEN)
        token = lk.create_access_token(
            identity=_identity(request.user), name=request.user.username,
            room=b.room_name, can_publish=True,
        )
        return Response(_broadcast_payload(b, token, request))

    # ── Moderation (host): remove a participant ─────────────────────────────────
    @action(detail=True, methods=['post'])
    def moderate(self, request, pk=None):
        b = get_object_or_404(LiveBroadcast, pk=pk, is_removed=False)
        by_admin = b.host_id != request.user.id
        if by_admin and not _admin_may(request):
            return Response({'error': 'Host only.'}, status=status.HTTP_403_FORBIDDEN)
        target = User.objects.filter(pk=_int(request.data.get('user_id')) or 0).first()
        if target is None:
            return Response({'error': 'user_id required'}, status=status.HTTP_400_BAD_REQUEST)
        if target.id == b.host_id:
            return Response({'error': 'The host cannot be removed; end the broadcast instead.'},
                            status=status.HTTP_400_BAD_REQUEST)
        lk.remove_participant(b.room_name, _identity(target))
        # Out for the rest of this broadcast: a fresh join token is refused
        # (before, they were back in a tap later).
        CoHostRequest.objects.update_or_create(broadcast=b, user=target, defaults={'status': 'removed'})
        if by_admin:
            _log_admin(request, 'live_remove_participant', b)
        return Response({'status': 'removed'})


class LiveKitWebhookView(APIView):
    """LiveKit server -> Django. Keeps broadcast status + viewer counts in sync.
    Auth is the LiveKit-signed Authorization header, not a user token."""
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        event = lk.verify_webhook(request.body.decode('utf-8'), request.headers.get('Authorization', ''))
        if event is None:
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        room = getattr(event, 'room', None)
        room_name = getattr(room, 'name', None)
        if room_name:
            if event.event == 'room_finished':
                LiveBroadcast.objects.filter(room_name=room_name, status='live').update(
                    status='ended', ended_at=timezone.now())
            elif event.event in ('participant_joined', 'participant_left'):
                n = max(0, getattr(room, 'num_participants', 0))
                LiveBroadcast.objects.filter(room_name=room_name).update(viewer_count=n)
                # Track the high-water mark for post-broadcast analytics.
                LiveBroadcast.objects.filter(room_name=room_name, peak_viewer_count__lt=n).update(
                    peak_viewer_count=n)
                # If the host drops without ending, tear the room down so co-hosts
                # and viewers aren't stranded in a frozen broadcast.
                if event.event == 'participant_left':
                    self._end_if_host_left(room_name, event)
        return Response({'ok': True})

    @staticmethod
    def _end_if_host_left(room_name, event):
        participant = getattr(event, 'participant', None)
        identity = getattr(participant, 'identity', None)
        if not identity:
            return
        b = LiveBroadcast.objects.filter(room_name=room_name, status='live').first()
        if b and identity == f"u{b.host_id}":
            b.status = 'ended'
            b.ended_at = timezone.now()
            b.save(update_fields=['status', 'ended_at'])
            lk.end_room(room_name)

from .common import *  # noqa: F401,F403
import uuid
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
            .filter(status='live').order_by('-started_at')
        )

    def get_throttles(self):
        # Abuse guards on the two write paths a user can spam; other actions keep
        # the default user/anon throttles. (Global ScopedRateThrottle reads this.)
        if self.action == 'create':
            self.throttle_scope = 'go_live'
        elif self.action == 'request_cohost':
            self.throttle_scope = 'cohost_request'
        return super().get_throttles()

    # ── Discovery ────────────────────────────────────────────────────────────
    def list(self, request):
        qs = self.get_queryset()
        page = self.paginate_queryset(qs)
        data = LiveBroadcastListSerializer(
            page if page is not None else qs, many=True, context={'request': request},
        ).data
        return self.get_paginated_response(data) if page is not None else Response(data)

    def retrieve(self, request, pk=None):
        b = get_object_or_404(LiveBroadcast, pk=pk)
        return Response(LiveBroadcastSerializer(b, context={'request': request}).data)

    # ── Go live (host) ─────────────────────────────────────────────────────────
    def create(self, request):
        kind = request.data.get('kind', 'meet')
        title = (request.data.get('title') or '').strip()
        if kind not in dict(LiveBroadcast.KIND_CHOICES):
            return Response({'error': 'kind must be meet|tv'}, status=status.HTTP_400_BAD_REQUEST)
        if not title:
            return Response({'error': 'title is required'}, status=status.HTTP_400_BAD_REQUEST)

        # Follower gate (staff/admins exempt): Go-Live (video) needs 1,000
        # followers; Meet (audio) needs 100.
        if not request.user.is_platform_admin:
            needed = MIN_FOLLOWERS.get(kind, 0)
            if needed and request.user.followers.count() < needed:
                return Response(
                    {'error': f"You need {needed:,} followers to start a {KIND_LABEL.get(kind, kind)}."},
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
            host=request.user, kind=kind, title=title[:200], room_name=room_name,
        )
        lk.ensure_room(room_name, metadata={
            'broadcast_id': broadcast.id, 'host': request.user.username,
            'kind': kind, 'title': broadcast.title,
        })
        token = lk.create_access_token(
            identity=_identity(request.user), name=request.user.username,
            room=room_name, can_publish=True,
        )
        self._notify_followers(request.user, broadcast)
        return Response(_broadcast_payload(broadcast, token, request), status=status.HTTP_201_CREATED)

    def _notify_followers(self, host, broadcast):
        msg = f"{host.username} is live on air: {broadcast.title}"
        data = {'type': 'live', 'broadcast_id': broadcast.id}
        for follower in host.followers.all().iterator():
            try:
                notify_user(follower, 'live', msg, data)
            except Exception:
                logger.exception('live notify failed')

    # ── Join (viewer) ──────────────────────────────────────────────────────────
    @action(detail=True, methods=['get'])
    def token(self, request, pk=None):
        b = get_object_or_404(LiveBroadcast, pk=pk)
        if b.status != 'live':
            return Response({'error': 'This broadcast has ended.'}, status=status.HTTP_410_GONE)
        # Super admins can join any broadcast — a block by the host can't shut them out.
        if not request.user.is_super_admin and is_blocked_between(request.user, b.host):
            return Response({'error': 'You cannot join this broadcast.'}, status=status.HTTP_403_FORBIDDEN)
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
        try:
            n = int(request.data.get('count') or 1)
        except (TypeError, ValueError):
            n = 1
        n = max(1, min(n, 100))
        applied = LiveBroadcast.objects.filter(pk=pk, status='live').update(like_count=F('like_count') + n)
        b = get_object_or_404(LiveBroadcast, pk=pk)
        # Credit the host's lifetime like total only when the tally actually
        # moved — reactions sent to an already-ended room are a no-op above and
        # must not inflate the profile stat either.
        if applied:
            credit_user_likes(b.host_id, n)
        return Response({'like_count': b.like_count})

    # ── On-screen graphic (lower third / banner / name tag / ticker) ─────────────
    @action(detail=True, methods=['post'])
    def overlay(self, request, pk=None):
        """Set or clear the persisted on-screen graphic. Host or an approved
        co-host only. Persisted so it survives a reconnect and reaches late
        joiners in the join payload; the live push still rides the data channel."""
        b = get_object_or_404(LiveBroadcast, pk=pk)
        is_cohost = b.cohost_requests.filter(user=request.user, status='approved').exists()
        if b.host_id != request.user.id and not is_cohost and not request.user.is_super_admin:
            return Response({'error': 'Only the host or a co-host can set on-screen text.'}, status=status.HTTP_403_FORBIDDEN)
        title = (request.data.get('title') or '').strip()
        if request.data.get('clear') or not title:
            b.overlay = None
        else:
            def _frac(v):
                try:
                    return round(min(1.0, max(0.0, float(v))), 4)
                except (TypeError, ValueError):
                    return None
            b.overlay = {
                'style': request.data.get('style') or 'lower3',
                'title': title[:120],
                'sub': (request.data.get('sub') or '').strip()[:80],
                'x': _frac(request.data.get('x')),
                'y': _frac(request.data.get('y')),
            }
        b.save(update_fields=['overlay'])
        return Response({'overlay': b.overlay})

    # ── End (host or super admin) ───────────────────────────────────────────────
    @action(detail=True, methods=['post'])
    def end(self, request, pk=None):
        b = get_object_or_404(LiveBroadcast, pk=pk)
        # The host ends their own broadcast; a super admin can end anyone's.
        if b.host_id != request.user.id and not request.user.is_super_admin:
            return Response({'error': 'Only the host or an admin can end this broadcast.'}, status=status.HTTP_403_FORBIDDEN)
        if b.status != 'ended':
            b.status = 'ended'
            b.ended_at = timezone.now()
            b.save(update_fields=['status', 'ended_at'])
            lk.end_room(b.room_name)
        return Response(LiveBroadcastSerializer(b).data)

    # ── Delete (host or super admin) ────────────────────────────────────────────
    def destroy(self, request, pk=None):
        """Remove a broadcast entirely. The host can delete their own; a super
        admin can delete any. A still-live room is torn down first."""
        b = get_object_or_404(LiveBroadcast, pk=pk)
        if b.host_id != request.user.id and not request.user.is_super_admin:
            return Response({'error': 'Only the host or an admin can delete this broadcast.'}, status=status.HTTP_403_FORBIDDEN)
        if b.status == 'live':
            lk.end_room(b.room_name)
        b.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ── Co-host requests ───────────────────────────────────────────────────────
    @action(detail=True, methods=['post'], url_path='request-cohost')
    def request_cohost(self, request, pk=None):
        b = get_object_or_404(LiveBroadcast, pk=pk)
        if b.status != 'live':
            return Response({'error': 'Broadcast has ended.'}, status=status.HTTP_410_GONE)
        if b.host_id == request.user.id:
            return Response({'error': "You're the host."}, status=status.HTTP_400_BAD_REQUEST)
        if is_blocked_between(request.user, b.host):
            return Response({'error': 'You cannot join this broadcast.'}, status=status.HTTP_403_FORBIDDEN)
        req, _created = CoHostRequest.objects.get_or_create(
            broadcast=b, user=request.user,
            defaults={'status': 'pending'},
        )
        if not _created and req.status in ('rejected', 'left'):
            req.status = 'pending'
            req.save(update_fields=['status'])
        notify_user(b.host, 'cohost_request', f"{request.user.username} wants to co-host", {
            'type': 'cohost_request', 'broadcast_id': b.id, 'request_id': req.id,
        })
        return Response(CoHostRequestSerializer(req).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'], url_path='cohost-requests')
    def cohost_requests(self, request, pk=None):
        b = get_object_or_404(LiveBroadcast, pk=pk)
        if b.host_id != request.user.id:
            return Response({'error': 'Host only.'}, status=status.HTTP_403_FORBIDDEN)
        qs = b.cohost_requests.select_related('user__profile').filter(status='pending')
        return Response(CoHostRequestSerializer(qs, many=True).data)

    @action(detail=True, methods=['post'], url_path='approve-cohost')
    def approve_cohost(self, request, pk=None):
        b = get_object_or_404(LiveBroadcast, pk=pk)
        if b.host_id != request.user.id:
            return Response({'error': 'Host only.'}, status=status.HTTP_403_FORBIDDEN)
        req = get_object_or_404(CoHostRequest, pk=request.data.get('request_id'), broadcast=b)
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
        b = get_object_or_404(LiveBroadcast, pk=pk)
        if b.host_id != request.user.id:
            return Response({'error': 'Host only.'}, status=status.HTTP_403_FORBIDDEN)
        req = get_object_or_404(CoHostRequest, pk=request.data.get('request_id'), broadcast=b)
        req.status = 'rejected'
        req.save(update_fields=['status'])
        return Response(CoHostRequestSerializer(req).data)

    @action(detail=True, methods=['get'], url_path='cohost-token')
    def cohost_token(self, request, pk=None):
        """An approved co-host fetches their publish token."""
        b = get_object_or_404(LiveBroadcast, pk=pk)
        if b.status != 'live':
            return Response({'error': 'This broadcast has ended.'}, status=status.HTTP_410_GONE)
        approved = b.cohost_requests.filter(user=request.user, status='approved').exists()
        if not approved:
            return Response({'error': 'Not approved as a co-host.'}, status=status.HTTP_403_FORBIDDEN)
        token = lk.create_access_token(
            identity=_identity(request.user), name=request.user.username,
            room=b.room_name, can_publish=True,
        )
        return Response(_broadcast_payload(b, token, request))

    # ── Moderation (host): remove a participant ─────────────────────────────────
    @action(detail=True, methods=['post'])
    def moderate(self, request, pk=None):
        b = get_object_or_404(LiveBroadcast, pk=pk)
        if b.host_id != request.user.id and not request.user.is_super_admin:
            return Response({'error': 'Host only.'}, status=status.HTTP_403_FORBIDDEN)
        target_user_id = request.data.get('user_id')
        if not target_user_id:
            return Response({'error': 'user_id required'}, status=status.HTTP_400_BAD_REQUEST)
        lk.remove_participant(b.room_name, f"u{target_user_id}")
        CoHostRequest.objects.filter(broadcast=b, user_id=target_user_id).update(status='left')
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

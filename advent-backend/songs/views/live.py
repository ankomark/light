from .common import *  # noqa: F401,F403
import uuid
from django.utils import timezone
from ..models import LiveBroadcast, CoHostRequest
from ..serializers import LiveBroadcastSerializer, CoHostRequestSerializer
from .. import livekit_service as lk


# How many co-hosts can share the stage with the host at once.
MAX_COHOSTS = 4


def _identity(user):
    return f"u{user.id}"


def _broadcast_payload(broadcast, token):
    """What the client needs to join: the LiveKit URL, a role token, and the row."""
    return {
        'url': settings.LIVEKIT_URL,
        'token': token,
        'broadcast': LiveBroadcastSerializer(broadcast).data,
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
        data = LiveBroadcastSerializer(page if page is not None else qs, many=True).data
        return self.get_paginated_response(data) if page is not None else Response(data)

    def retrieve(self, request, pk=None):
        b = get_object_or_404(LiveBroadcast, pk=pk)
        return Response(LiveBroadcastSerializer(b).data)

    # ── Go live (host) ─────────────────────────────────────────────────────────
    def create(self, request):
        kind = request.data.get('kind', 'radio')
        title = (request.data.get('title') or '').strip()
        if kind not in dict(LiveBroadcast.KIND_CHOICES):
            return Response({'error': 'kind must be radio|tv|podcast'}, status=status.HTTP_400_BAD_REQUEST)
        if not title:
            return Response({'error': 'title is required'}, status=status.HTTP_400_BAD_REQUEST)

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
        return Response(_broadcast_payload(broadcast, token), status=status.HTTP_201_CREATED)

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
        token = lk.create_access_token(
            identity=_identity(request.user), name=request.user.username,
            room=b.room_name, can_publish=False,  # viewers are subscribe-only
        )
        return Response(_broadcast_payload(b, token))

    # ── End (host) ─────────────────────────────────────────────────────────────
    @action(detail=True, methods=['post'])
    def end(self, request, pk=None):
        b = get_object_or_404(LiveBroadcast, pk=pk)
        if b.host_id != request.user.id:
            return Response({'error': 'Only the host can end this broadcast.'}, status=status.HTTP_403_FORBIDDEN)
        if b.status != 'ended':
            b.status = 'ended'
            b.ended_at = timezone.now()
            b.save(update_fields=['status', 'ended_at'])
            lk.end_room(b.room_name)
        return Response(LiveBroadcastSerializer(b).data)

    # ── Co-host requests ───────────────────────────────────────────────────────
    @action(detail=True, methods=['post'], url_path='request-cohost')
    def request_cohost(self, request, pk=None):
        b = get_object_or_404(LiveBroadcast, pk=pk)
        if b.status != 'live':
            return Response({'error': 'Broadcast has ended.'}, status=status.HTTP_410_GONE)
        if b.host_id == request.user.id:
            return Response({'error': "You're the host."}, status=status.HTTP_400_BAD_REQUEST)
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
        approved = b.cohost_requests.filter(user=request.user, status='approved').exists()
        if not approved:
            return Response({'error': 'Not approved as a co-host.'}, status=status.HTTP_403_FORBIDDEN)
        token = lk.create_access_token(
            identity=_identity(request.user), name=request.user.username,
            room=b.room_name, can_publish=True,
        )
        return Response(_broadcast_payload(b, token))

    # ── Moderation (host): remove a participant ─────────────────────────────────
    @action(detail=True, methods=['post'])
    def moderate(self, request, pk=None):
        b = get_object_or_404(LiveBroadcast, pk=pk)
        if b.host_id != request.user.id:
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

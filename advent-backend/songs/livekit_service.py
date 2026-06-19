"""Thin wrapper around the LiveKit server SDK.

Django is the control plane: it mints role-scoped access tokens and issues the
occasional server command (end room, remove participant). Media never touches
Django. Everything here is best-effort and credential-guarded so the app keeps
working in dev without LiveKit keys (tokens are still produced for tests)."""
import asyncio
import json
import logging
from datetime import timedelta

from django.conf import settings
from livekit import api

logger = logging.getLogger(__name__)

# How long a join token stays valid. A broadcast is expected to be shorter; the
# client reconnects with a fresh token if needed.
TOKEN_TTL = timedelta(hours=4)


def create_access_token(*, identity, name, room, can_publish):
    """Mint a LiveKit JWT. Viewers get subscribe-only; host/co-host can publish.
    Data publish is always allowed so chat/reactions/requests can ride the room's
    data channel."""
    grants = api.VideoGrants(
        room_join=True,
        room=room,
        can_publish=bool(can_publish),
        can_subscribe=True,
        can_publish_data=True,
    )
    token = (
        api.AccessToken(settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
        .with_identity(str(identity))
        .with_name(name or str(identity))
        .with_grants(grants)
        .with_ttl(TOKEN_TTL)
    )
    return token.to_jwt()


def _http_url():
    # LiveKit server API is HTTP(S); the client URL is ws(s). Convert.
    url = settings.LIVEKIT_URL or ''
    return url.replace('wss://', 'https://').replace('ws://', 'http://')


def _run(coro):
    """Run one async LiveKit server call from sync Django code, best-effort."""
    if not (settings.LIVEKIT_API_KEY and settings.LIVEKIT_URL):
        return  # not configured (dev/tests) — no-op
    try:
        asyncio.run(coro())
    except Exception:
        logger.exception('LiveKit server call failed')


def ensure_room(room_name, *, metadata=None, empty_timeout=120, max_participants=0):
    """Create the room up front with descriptive metadata and an empty_timeout.

    metadata (host/kind/title) lets clients and webhooks reason about a room
    without a Django round-trip. empty_timeout makes LiveKit reap a room that
    goes empty (e.g. host crashed) so it can't linger. Idempotent: creating an
    existing room is a no-op on the server side."""
    async def _go():
        lk = api.LiveKitAPI(_http_url(), settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
        try:
            await lk.room.create_room(api.CreateRoomRequest(
                name=room_name,
                empty_timeout=empty_timeout,
                max_participants=max_participants,
                metadata=json.dumps(metadata) if metadata else '',
            ))
        finally:
            await lk.aclose()
    _run(_go)


def end_room(room_name):
    async def _go():
        lk = api.LiveKitAPI(_http_url(), settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
        try:
            await lk.room.delete_room(api.DeleteRoomRequest(room=room_name))
        finally:
            await lk.aclose()
    _run(_go)


def grant_publish(room_name, identity):
    """Promote a connected participant to publisher *without* a reconnect.

    LiveKit pushes the new permission to the participant's live connection, so an
    approved co-host can immediately enable mic/camera on their existing
    (originally subscribe-only) session. This is the documented way to promote a
    viewer — far more reliable than swapping the join token client-side."""
    async def _go():
        lk = api.LiveKitAPI(_http_url(), settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
        try:
            await lk.room.update_participant(api.UpdateParticipantRequest(
                room=room_name,
                identity=str(identity),
                permission=api.ParticipantPermission(
                    can_subscribe=True, can_publish=True, can_publish_data=True,
                ),
            ))
        finally:
            await lk.aclose()
    _run(_go)


def remove_participant(room_name, identity):
    async def _go():
        lk = api.LiveKitAPI(_http_url(), settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
        try:
            await lk.room.remove_participant(
                api.RoomParticipantIdentity(room=room_name, identity=str(identity))
            )
        finally:
            await lk.aclose()
    _run(_go)


def verify_webhook(body, auth_header):
    """Verify a LiveKit webhook and return the decoded event (or None)."""
    try:
        receiver = api.WebhookReceiver(
            api.TokenVerifier(settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
        )
        return receiver.receive(body, auth_header)
    except Exception:
        logger.exception('LiveKit webhook verification failed')
        return None

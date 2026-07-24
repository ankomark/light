"""JWT authentication for WebSocket connections.

The RN client can't set Authorization headers on a WebSocket, so it passes the
access token as a `?token=` query param. This middleware validates it and puts
the user on the connection scope (AnonymousUser when missing/invalid).
"""
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth.models import AnonymousUser


@database_sync_to_async
def _get_user(user_id):
    from songs.models import User
    try:
        return User.objects.get(id=user_id)
    except User.DoesNotExist:
        return AnonymousUser()


class JWTAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        # Import here so Django apps are loaded first (asgi.py imports this early).
        from rest_framework_simplejwt.tokens import AccessToken

        scope['user'] = AnonymousUser()
        query = parse_qs(scope.get('query_string', b'').decode())
        token = (query.get('token') or [None])[0]
        if token:
            try:
                access = AccessToken(token)
                scope['user'] = await _get_user(access['user_id'])
            except Exception:
                pass  # leave AnonymousUser; the consumer rejects the connect
        return await super().__call__(scope, receive, send)

"""
ASGI config for music project.

Serves plain HTTP (Django) and WebSockets (Channels, for realtime group chat)
through one ASGI application.
"""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'music.settings')

# Initialise Django's app registry BEFORE importing anything that touches models
# (the consumers and the JWT middleware do).
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402

from songs.ws_auth import JWTAuthMiddleware  # noqa: E402
from songs.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter({
    'http': django_asgi_app,
    'websocket': JWTAuthMiddleware(URLRouter(websocket_urlpatterns)),
})

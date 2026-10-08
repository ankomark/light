"""Is Django wired to the live box? Run on the app box after deploying LiveKit.

    python manage.py livekit_check

Checks, in order, and stops at the first failure with what to fix:
  1. LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET are set and sane
  2. the live box answers over HTTPS (TLS certificate valid)
  3. our key and secret are accepted (we can list rooms)
  4. we can create and delete a room - what Go Live does

It cannot test media or TURN: that needs a real phone on mobile data (see
deploy/livekit/README.md, "Test from a phone").
"""
import asyncio
import uuid

import requests
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from livekit import api

from songs import livekit_service as lk


class Command(BaseCommand):
    help = 'Check that Django can reach and control the LiveKit server.'

    def handle(self, *args, **opts):
        url = settings.LIVEKIT_URL or ''
        key = settings.LIVEKIT_API_KEY or ''
        secret = settings.LIVEKIT_API_SECRET or ''

        # 1. settings
        if not (url and key and secret):
            raise CommandError('Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in the environment.')
        if not url.startswith('wss://'):
            raise CommandError(f'LIVEKIT_URL must start with wss:// (phones refuse plain ws://), not {url!r}.')
        if len(secret) < 32:
            raise CommandError('LIVEKIT_API_SECRET is shorter than 32 characters - not the live box secret?')
        self._ok(f'settings: {url} with key {key}')

        # 2. reachable, certificate valid
        http = lk._http_url()
        try:
            requests.get(http, timeout=10)
        except requests.exceptions.SSLError as e:
            raise CommandError(f'{http}: TLS failed ({e}). Is the certificate issued? '
                               f'On the live box: docker compose logs caddy')
        except requests.RequestException as e:
            raise CommandError(f'{http}: not reachable ({e}). DNS, the firewall (tcp 443), '
                               f'or the live box is down: docker compose ps')
        self._ok(f'reachable: {http}')

        # 3 + 4. key accepted; a room can be made and removed
        name = f'check_{uuid.uuid4().hex[:8]}'

        async def go():
            client = api.LiveKitAPI(http, key, secret)
            try:
                await client.room.list_rooms(api.ListRoomsRequest())
                self._ok('key and secret accepted')
                await client.room.create_room(api.CreateRoomRequest(name=name, empty_timeout=30))
                await client.room.delete_room(api.DeleteRoomRequest(room=name))
                self._ok('a room can be created and ended (what Go Live does)')
            finally:
                await client.aclose()

        try:
            asyncio.run(go())
        except api.TwirpError as e:
            if 'unauthenticated' in str(e).lower() or 'permission' in str(e).lower():
                raise CommandError('The live box refused our key/secret: they must match LIVEKIT_KEYS on '
                                   'the live box (deploy/livekit/.env).')
            raise CommandError(f'The live box refused: {e}')
        except Exception as e:  # noqa: BLE001 - say it plainly
            raise CommandError(f'Talking to the live box failed: {e}')

        self.stdout.write('')
        self.stdout.write('Next: the webhook. Start and end a broadcast from the app, then check the')
        self.stdout.write('broadcast shows as ended at once (not after 12 h). If not, the live box')
        self.stdout.write('cannot reach WEBHOOK_URL or its api_key differs from LIVEKIT_API_KEY.')

    def _ok(self, text):
        self.stdout.write(self.style.SUCCESS(f'✓ {text}'))

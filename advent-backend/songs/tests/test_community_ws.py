"""Realtime WebSocket for choir/church community chats.

    python manage.py test songs.tests.test_community_ws --settings=music.settings_test
"""
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.test import TransactionTestCase
from rest_framework_simplejwt.tokens import AccessToken

from music.asgi import application
from songs.consumers import broadcast_community_message
from songs.models import User, Choir, ChoirMembership


def _token(user):
    return str(AccessToken.for_user(user))


async def _connect(kind, cid, token):
    comm = WebsocketCommunicator(application, f'/ws/community/{kind}/{cid}/?token={token}')
    connected, _ = await comm.connect()
    return comm, connected


async def _receive_until(comm, wanted, timeout=2):
    import asyncio
    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        evt = await comm.receive_json_from(timeout=timeout)
        if evt.get('type') == wanted:
            return evt
    raise AssertionError(f'never received a {wanted} frame')


class CommunityWebSocketTests(TransactionTestCase):
    def setUp(self):
        self.owner = User.objects.create_user('cwsowner', 'o@x.com', 'x')
        self.member = User.objects.create_user('cwsmember', 'm@x.com', 'x')
        self.outsider = User.objects.create_user('cwsout', 'out@x.com', 'x')
        self.choir = Choir.objects.create(name='WS Choir', location='Nairobi', created_by=self.owner)
        ChoirMembership.objects.create(choir=self.choir, user=self.member, role='friend')

    async def test_member_connects_outsider_rejected(self):
        comm, ok = await _connect('choir', self.choir.id, _token(self.member))
        self.assertTrue(ok)
        await comm.disconnect()

        comm2, ok2 = await _connect('choir', self.choir.id, _token(self.outsider))
        self.assertFalse(ok2)

        # Owner (creator) is always allowed.
        comm3, ok3 = await _connect('choir', self.choir.id, _token(self.owner))
        self.assertTrue(ok3)
        await comm3.disconnect()

    async def test_broadcast_reaches_members(self):
        comm, ok = await _connect('choir', self.choir.id, _token(self.member))
        self.assertTrue(ok)
        await database_sync_to_async(broadcast_community_message)(
            'choir', self.choir.id, {'id': 7, 'content': 'live choir'},
        )
        evt = await _receive_until(comm, 'message')
        self.assertEqual(evt['message']['content'], 'live choir')
        await comm.disconnect()

"""Realtime group chat WebSocket consumer.

    python manage.py test songs.tests.test_group_ws --settings=music.settings_test

Uses the in-memory channel layer (settings_test has no REDIS_URL) so no Redis is
needed. Exercises the full stack: JWT query-param auth → membership gate →
realtime message fan-out and typing.
"""
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.test import TransactionTestCase
from rest_framework_simplejwt.tokens import AccessToken

from music.asgi import application
from songs.consumers import broadcast_group_message
from songs.models import User, Group, GroupMember


def _token(user):
    return str(AccessToken.for_user(user))


async def _connect(slug, token):
    communicator = WebsocketCommunicator(application, f'/ws/groups/{slug}/?token={token}')
    connected, _ = await communicator.connect()
    return communicator, connected


async def _receive_until(comm, wanted_type, timeout=2):
    """Read frames until one of the wanted type arrives (skips presence noise)."""
    import asyncio
    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        evt = await comm.receive_json_from(timeout=timeout)
        if evt.get('type') == wanted_type:
            return evt
    raise AssertionError(f'never received a {wanted_type} frame')


class GroupWebSocketTests(TransactionTestCase):
    def setUp(self):
        self.owner = User.objects.create_user('wsowner', 'o@x.com', 'x')
        self.member = User.objects.create_user('wsmember', 'm@x.com', 'x')
        self.outsider = User.objects.create_user('wsoutsider', 'out@x.com', 'x')
        self.group = Group.objects.create(creator=self.owner, name='WS Room', is_private=False)
        GroupMember.objects.create(group=self.group, user=self.owner, is_admin=True)
        GroupMember.objects.create(group=self.group, user=self.member)

    async def test_member_connects_outsider_rejected(self):
        # A member connects fine.
        comm, ok = await _connect(self.group.slug, _token(self.member))
        self.assertTrue(ok)
        await comm.disconnect()

        # A non-member is rejected.
        comm2, ok2 = await _connect(self.group.slug, _token(self.outsider))
        self.assertFalse(ok2)

        # No token → rejected.
        comm3, ok3 = await _connect(self.group.slug, 'not-a-token')
        self.assertFalse(ok3)

    async def test_broadcast_reaches_members(self):
        comm, ok = await _connect(self.group.slug, _token(self.member))
        self.assertTrue(ok)

        await database_sync_to_async(broadcast_group_message)(
            self.group.slug, {'id': 123, 'content': 'hello realtime'},
        )
        event = await _receive_until(comm, 'message')
        self.assertEqual(event['message']['content'], 'hello realtime')
        await comm.disconnect()

    async def test_presence_roster_on_join(self):
        """A newcomer learns who is already online (the direct-reply handshake)."""
        import asyncio
        owner_comm, _ = await _connect(self.group.slug, _token(self.owner))
        member_comm, _ = await _connect(self.group.slug, _token(self.member))

        seen = set()
        loop = asyncio.get_event_loop()
        deadline = loop.time() + 2
        while loop.time() < deadline and self.owner.id not in seen:
            try:
                evt = await member_comm.receive_json_from(timeout=1)
            except Exception:
                break
            if evt.get('type') == 'presence' and evt.get('event') == 'online':
                seen.add(evt['user_id'])
        self.assertIn(self.owner.id, seen, 'newcomer never learned the owner was already online')

        await owner_comm.disconnect()
        await member_comm.disconnect()

    async def test_typing_reaches_other_members_not_self(self):
        owner_comm, _ = await _connect(self.group.slug, _token(self.owner))
        member_comm, _ = await _connect(self.group.slug, _token(self.member))

        await member_comm.send_json_to({'type': 'typing', 'is_typing': True})
        # The owner sees the member typing (skipping any presence frames).
        evt = await _receive_until(owner_comm, 'typing')
        self.assertEqual(evt['username'], 'wsmember')
        self.assertTrue(evt['is_typing'])

        await owner_comm.disconnect()
        await member_comm.disconnect()

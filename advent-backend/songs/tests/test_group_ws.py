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

    async def test_online_is_a_count(self):
        """Who's here is a count: a newcomer is told it on joining, the others
        learn it went up — no roster traded between every pair of members."""
        from django.core.cache import cache
        await database_sync_to_async(cache.clear)()
        owner_comm, _ = await _connect(self.group.slug, _token(self.owner))
        first = await _receive_until(owner_comm, 'online_count')
        self.assertEqual(first['count'], 1)
        member_comm, _ = await _connect(self.group.slug, _token(self.member))
        mine = await _receive_until(member_comm, 'online_count')
        self.assertEqual(mine['count'], 2)
        seen = await _receive_until(owner_comm, 'presence')
        if seen['user_id'] == self.owner.id:          # its own arrival first
            seen = await _receive_until(owner_comm, 'presence')
        self.assertEqual((seen['event'], seen['user_id'], seen['count']), ('online', self.member.id, 2))
        await member_comm.disconnect()
        gone = await _receive_until(owner_comm, 'presence')
        self.assertEqual((gone['event'], gone['count']), ('offline', 1))
        await owner_comm.disconnect()

    async def test_a_removed_member_is_cut_off(self):
        from songs.group_live import tell_group
        member_comm, ok = await _connect(self.group.slug, _token(self.member))
        self.assertTrue(ok)
        await database_sync_to_async(tell_group)(self.group.slug, {'type': 'member_removed', 'user_id': self.member.id})
        evt = await _receive_until(member_comm, 'member_removed')
        self.assertEqual(evt['user_id'], self.member.id)
        out = await member_comm.receive_output(timeout=2)
        self.assertEqual(out['type'], 'websocket.close')

    async def test_banned_or_deactivated_turned_away(self):
        def ban():
            User.objects.filter(pk=self.member.pk).update(is_deactivated=True)
        await database_sync_to_async(ban)()
        comm, ok = await _connect(self.group.slug, _token(self.member))
        self.assertFalse(ok)
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

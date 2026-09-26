"""Realtime group chat over WebSockets.

Reads/writes still go through the REST API (validation, notifications, moderation
all live there); this consumer is the realtime fan-out layer:

  * new messages are pushed here by the REST view (see broadcast_group_message)
    so members see them instantly instead of on the 4s poll,
  * typing indicators and presence are handled entirely over the socket.

Membership is re-checked on connect — a non-member can't open the socket even if
they guess the URL (mirrors the members-only REST gate).
"""
from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.layers import get_channel_layer


def group_channel(slug):
    return f'chat_{slug}'


def broadcast_group_message(slug, message_data):
    """Fan a freshly-created post out to everyone in the group's socket room.
    Safe to call from sync REST code; a no-op if no channel layer is configured."""
    layer = get_channel_layer()
    if not layer:
        return
    async_to_sync(layer.group_send)(
        group_channel(slug), {'type': 'chat_message', 'message': message_data},
    )


def broadcast_group_deleted(slug, post_id):
    layer = get_channel_layer()
    if not layer:
        return
    async_to_sync(layer.group_send)(
        group_channel(slug), {'type': 'chat_deleted', 'id': post_id},
    )


def broadcast_group_edited(slug, message_data):
    """Like a new message, but the client updates it in place (no scroll)."""
    layer = get_channel_layer()
    if not layer:
        return
    async_to_sync(layer.group_send)(
        group_channel(slug), {'type': 'chat_edited', 'message': message_data},
    )


def broadcast_group_pinned(slug, pinned):
    """`pinned` is the pinned-message preview dict, or None when unpinned."""
    layer = get_channel_layer()
    if not layer:
        return
    async_to_sync(layer.group_send)(
        group_channel(slug), {'type': 'chat_pinned', 'pinned': pinned},
    )


class GroupChatConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.user = self.scope.get('user')
        self.slug = self.scope['url_route']['kwargs']['slug']
        self.group_name = group_channel(self.slug)

        if not self.user or not self.user.is_authenticated:
            await self.close(code=4401)  # unauthorized
            return
        if not await self._can_access():
            await self.close(code=4403)  # forbidden (not a member)
            return

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        self.joined = True
        # Who's here is a count (songs/group_live.py), not a roster traded
        # between every pair of members. I learn it now; the others learn when
        # my first device arrives.
        first, count = await self._came_online()
        await self.send_json({'type': 'online_count', 'count': count})
        if first:
            await self.channel_layer.group_send(self.group_name, {
                'type': 'presence', 'event': 'online', 'count': count,
                'user_id': self.user.id, 'username': self.user.username,
            })

    async def disconnect(self, code):
        if getattr(self, 'joined', False):
            last, count = await self._went_offline()
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
            if last:
                await self.channel_layer.group_send(self.group_name, {
                    'type': 'presence', 'event': 'offline', 'count': count,
                    'user_id': self.user.id, 'username': self.user.username,
                })

    @database_sync_to_async
    def _came_online(self):
        from songs.group_live import came_online
        return came_online(self.slug, self.user.id)

    @database_sync_to_async
    def _went_offline(self):
        from songs.group_live import went_offline
        return went_offline(self.slug, self.user.id)

    @database_sync_to_async
    def _can_access(self):
        from songs.models import Group, GroupMember, User
        # Banned (inactive) or deactivated accounts are turned away.
        u = User.objects.filter(pk=self.user.pk).values('is_active', 'is_deactivated').first()
        if not u or not u['is_active'] or u['is_deactivated']:
            return False
        try:
            group = Group.objects.get(slug=self.slug, is_removed=False)
        except Group.DoesNotExist:
            return False
        if getattr(self.user, 'is_super_admin', False):
            return True
        return GroupMember.objects.filter(group=group, user=self.user).exists()

    # ── inbound (from the client) ────────────────────────────────────────────
    async def receive_json(self, content):
        if content.get('type') == 'typing':
            await self.channel_layer.group_send(self.group_name, {
                'type': 'typing',
                'user_id': self.user.id, 'username': self.user.username,
                'is_typing': bool(content.get('is_typing')),
                'sender_channel': self.channel_name,
            })

    # ── outbound (group_send handlers) ───────────────────────────────────────
    async def chat_message(self, event):
        await self.send_json({'type': 'message', 'message': event['message']})

    async def chat_deleted(self, event):
        await self.send_json({'type': 'deleted', 'id': event['id']})

    async def chat_edited(self, event):
        await self.send_json({'type': 'edited', 'message': event['message']})

    async def chat_pinned(self, event):
        await self.send_json({'type': 'pinned', 'pinned': event['pinned']})

    async def typing(self, event):
        if event.get('sender_channel') == self.channel_name:
            return  # never echo the typist their own indicator
        await self.send_json({
            'type': 'typing', 'user_id': event['user_id'],
            'username': event['username'], 'is_typing': event['is_typing'],
        })

    async def presence(self, event):
        await self.send_json({
            'type': 'presence', 'event': event['event'], 'count': event.get('count'),
            'user_id': event['user_id'], 'username': event['username'],
        })

    async def group_event(self, event):
        """Reactions, members joining / leaving / removed, settings changes
        (songs/group_live.tell_group). Someone removed is told, then cut off —
        they don't keep reading the chat until they happen to reconnect."""
        payload = event['payload']
        await self.send_json(payload)
        kind = payload.get('type')
        if (kind in ('member_removed', 'member_left') and payload.get('user_id') == self.user.id) or kind == 'group_deleted':
            await self.close(code=4403)


class DMConsumer(AsyncJsonWebsocketConsumer):
    """Direct messages, live: one socket per device, joined to the person's
    own room (songs/messaging.py tells it about new messages, edits,
    deletions, reactions, read receipts). Typing goes out from here, to the
    other person in that chat only. Presence: online while connected; the
    people they chat with are told when they come and go.

    Banned, deactivated or unknown users are turned away."""

    async def connect(self):
        self.user = self.scope.get('user')
        if not self.user or not self.user.is_authenticated or not await self._allowed():
            await self.close(code=4401)
            return
        from songs.messaging import dm_room
        self.room = dm_room(self.user.id)
        await self.channel_layer.group_add(self.room, self.channel_name)
        await self.accept()
        first, partners = await self._came_online()
        if first:
            await self._tell_partners(partners, True)

    async def disconnect(self, code):
        if not hasattr(self, 'room'):
            return
        await self.channel_layer.group_discard(self.room, self.channel_name)
        last, partners = await self._went_offline()
        if last:
            await self._tell_partners(partners, False)

    async def receive_json(self, content):
        if content.get('type') != 'typing':
            return
        try:
            conv_id = int(content.get('conversation_id'))
        except (TypeError, ValueError):
            return
        other = await self._other_in(conv_id)
        if other:
            from songs.messaging import dm_room
            await self.channel_layer.group_send(dm_room(other), {'type': 'dm_event', 'payload': {
                'type': 'typing', 'conversation_id': conv_id, 'user_id': self.user.id,
                'is_typing': bool(content.get('is_typing')),
            }})

    async def dm_event(self, event):
        await self.send_json(event['payload'])

    async def _tell_partners(self, partners, online):
        from songs.messaging import dm_room
        payload = {'type': 'presence', 'user_id': self.user.id, 'online': online}
        for uid in partners:
            await self.channel_layer.group_send(dm_room(uid), {'type': 'dm_event', 'payload': payload})

    @database_sync_to_async
    def _allowed(self):
        from songs.models import User
        u = User.objects.filter(pk=self.user.pk).values('is_active', 'is_deactivated').first()
        return bool(u and u['is_active'] and not u['is_deactivated'])

    @database_sync_to_async
    def _came_online(self):
        from songs.messaging import went_online, partner_ids
        return went_online(self.user.id), partner_ids(self.user)

    @database_sync_to_async
    def _went_offline(self):
        from songs.messaging import went_offline, partner_ids
        return went_offline(self.user.id), partner_ids(self.user)

    @database_sync_to_async
    def _other_in(self, conv_id):
        """The other person in this chat — if this user is in it, and neither
        has blocked the other."""
        from songs.models import Conversation, is_blocked_between
        conv = Conversation.objects.filter(pk=conv_id, participants=self.user).first()
        if conv is None:
            return None
        other = conv.participants.exclude(pk=self.user.pk).first()
        if other is None or is_blocked_between(self.user, other):
            return None
        return other.pk

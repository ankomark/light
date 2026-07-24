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
        await self.channel_layer.group_send(self.group_name, {
            'type': 'presence', 'event': 'online',
            'user_id': self.user.id, 'username': self.user.username,
        })

    async def disconnect(self, code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_send(self.group_name, {
                'type': 'presence', 'event': 'offline',
                'user_id': self.user.id, 'username': self.user.username,
            })
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    @database_sync_to_async
    def _can_access(self):
        from songs.models import Group, GroupMember
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
            'type': 'presence', 'event': event['event'],
            'user_id': event['user_id'], 'username': event['username'],
        })

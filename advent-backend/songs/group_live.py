"""Groups & communities, live.

- Events to a group's socket room (songs/consumers.GroupChatConsumer): a
  reaction, someone joining / leaving / removed, the group's settings — on top
  of the new / edited / deleted / pinned messages consumers.py already sends.
- Who's here: a count per group (a shared counter in the cache), not a roster
  every member trades with every other — that was n² messages on a busy
  community each time someone opened it.
- A new message's pushes: batched, off the request, never to the sender, to
  whoever muted the group, or to whoever is looking at the chat right now.
- The group list, live: members of smaller groups are told on their own
  socket (ws/dm/) so the list reorders at once; big communities catch up on
  the list's poll (telling thousands of rooms per message isn't worth it).
"""
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.core.cache import cache
from django.utils import timezone

LIVE_LIST_MAX_MEMBERS = 200
ONLINE_TTL = 6 * 3600


def group_room(slug):
    from .consumers import group_channel
    return group_channel(slug)


def tell_group(slug, payload):
    """A live event to everyone in the group's room. Never fails the request."""
    layer = get_channel_layer()
    if not layer:
        return
    try:
        async_to_sync(layer.group_send)(group_room(slug), {'type': 'group_event', 'payload': payload})
    except Exception:
        pass


def public_copy(data):
    """A message as anyone may receive it live. The serializer fills is_owner
    and my reaction from the SENDER's request — sent as-is, every member saw
    the sender's message as their own until the next poll."""
    out = dict(data)
    out['is_owner'] = False
    r = out.get('reactions')
    if isinstance(r, dict):
        out['reactions'] = {**r, 'mine': None}
    return out


# ── Who's here ──────────────────────────────────────────────────────────────

def _user_key(slug, uid):
    return f'grp_on:{slug}:{uid}'


def _count_key(slug):
    return f'grp_on_n:{slug}'


def came_online(slug, uid):
    """This device joined the room. Returns (first device of theirs?, count)."""
    n = (cache.get(_user_key(slug, uid)) or 0) + 1
    cache.set(_user_key(slug, uid), n, ONLINE_TTL)
    total = cache.get(_count_key(slug)) or 0
    if n == 1:
        total += 1
        cache.set(_count_key(slug), total, ONLINE_TTL)
    return n == 1, total


def went_offline(slug, uid):
    """This device left. Returns (their last device?, count)."""
    n = max(0, (cache.get(_user_key(slug, uid)) or 0) - 1)
    cache.set(_user_key(slug, uid), n, ONLINE_TTL)
    total = cache.get(_count_key(slug)) or 0
    if n == 0:
        total = max(0, total - 1)
        cache.set(_count_key(slug), total, ONLINE_TTL)
    return n == 0, total


def online_count(slug):
    return cache.get(_count_key(slug)) or 0


def watching(slug, user_ids):
    """Which of these people have the chat open right now."""
    keys = {_user_key(slug, u): u for u in user_ids}
    found = cache.get_many(list(keys)) if keys else {}
    return {keys[k] for k, v in found.items() if v}


# ── A new message's pushes and the live list ───────────────────────────────

def fan_out(group, sender, post, preview):
    """Push the other members (batched), and tell smaller groups' members'
    own sockets so their list moves this group to the top."""
    from .models import GroupMember
    from .push import notify_many
    from . import messaging as dm

    now = timezone.now()
    members = GroupMember.objects.filter(group=group).exclude(user=sender)
    ids = list(members.values_list('user_id', flat=True))
    if not ids:
        return
    muted = set(members.filter(muted_until__gt=now).values_list('user_id', flat=True))
    here = watching(group.slug, ids)
    targets = [u for u in ids if u not in muted and u not in here]
    if targets:
        notify_many(targets, 'message', f"{group.name} — {sender.username}: {preview}",
                    data={'groupSlug': group.slug})

    if len(ids) <= LIVE_LIST_MAX_MEMBERS:
        dm.tell(ids + [sender.id], {
            'type': 'group_message', 'group_slug': group.slug, 'kind': group.kind,
            'message': {
                'id': post.id, 'content': (post.content or '')[:120], 'message_type': post.message_type,
                'file_name': post.file_name, 'sender_id': sender.id, 'sender_username': sender.username,
                'created_at': post.created_at.isoformat(),
            },
        })


def unread_groups(user):
    """How many of my groups, and communities, have something I haven't read
    (the menu badges)."""
    from django.db.models import Exists, OuterRef
    from .models import GroupMember, GroupPost
    theirs = (GroupPost.objects.filter(group=OuterRef('group'), is_removed=False)
              .exclude(user=user).exclude(message_type='system'))
    newer = theirs.filter(created_at__gt=OuterRef('last_read_at'))
    never = theirs
    # A muted group doesn't light the badge.
    mine = (GroupMember.objects.filter(user=user, group__is_removed=False)
            .exclude(muted_until__gt=timezone.now()))
    from django.db.models import Count
    rows = ((mine.filter(last_read_at__isnull=False).filter(Exists(newer)))
            | (mine.filter(last_read_at__isnull=True).filter(Exists(never))))
    by_kind = dict(rows.values('group__kind').annotate(n=Count('id')).values_list('group__kind', 'n'))
    return {'groups': by_kind.get('group', 0), 'communities': by_kind.get('community', 0)}

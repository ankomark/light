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
import re

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


def _incr(key):
    """Add one - with the cache's own atomic increment: a read-then-write
    lost a count whenever two devices arrived together."""
    cache.add(key, 0, ONLINE_TTL)
    try:
        n = cache.incr(key)
    except ValueError:          # expired between add and incr
        cache.set(key, 1, ONLINE_TTL)
        n = 1
    cache.touch(key, ONLINE_TTL)
    return n


def _decr(key):
    """Take one away, never below nothing. None when there was nothing to
    take (already gone: a second close of the same socket, an expired count)."""
    try:
        n = cache.decr(key)
    except ValueError:
        return None
    if n < 0:
        cache.set(key, 0, ONLINE_TTL)
        return None
    return n


def came_online(slug, uid):
    """This device joined the room. Returns (first device of theirs?, count)."""
    n = _incr(_user_key(slug, uid))
    total = _incr(_count_key(slug)) if n == 1 else (cache.get(_count_key(slug)) or 0)
    return n == 1, total


def went_offline(slug, uid):
    """This device left. Returns (their last device?, count)."""
    n = _decr(_user_key(slug, uid))
    if n == 0:
        # Their last device just left: one fewer here.
        total = _decr(_count_key(slug)) or 0
    else:
        # Still here on another device - or already counted gone (nothing to
        # take from the room's total twice).
        total = cache.get(_count_key(slug)) or 0
    return n is None or n == 0, total


def online_count(slug):
    return cache.get(_count_key(slug)) or 0


def watching(slug, user_ids):
    """Which of these people have the chat open right now."""
    keys = {_user_key(slug, u): u for u in user_ids}
    found = cache.get_many(list(keys)) if keys else {}
    return {keys[k] for k, v in found.items() if v}


# ── A new message's pushes and the live list ───────────────────────────────

MENTION_RE = re.compile(r'(?<![\w@])@([\w.]{1,40})')
MAX_MENTIONS = 20
# Being named rings through a mute - so not more than once in this long from
# the same person in the same group (twenty names a message, ninety messages
# a minute, was a way to flood people who had muted the group).
MENTION_PUSH_EVERY_S = 10 * 60


def mentioned_ids(group, text, exclude=None):
    """Members named with @username in `text` (at most 20)."""
    from .models import GroupMember
    names = {m.rstrip('.').lower() for m in MENTION_RE.findall(text or '')}
    names.discard('')
    if not names:
        return set()
    from functools import reduce
    from django.db.models import Q
    match = reduce(lambda a, b: a | b, (Q(user__username__iexact=n) for n in list(names)[:MAX_MENTIONS]))
    ids = set(GroupMember.objects.filter(group=group).filter(match).values_list('user_id', flat=True))
    ids.discard(exclude)
    return ids


def fan_out(group, sender, post, preview):
    """Push the other members (batched) — those @mentioned always (a mute or
    "mentions only" doesn't silence being named), everyone else unless they
    muted the group, chose mentions only, or are looking at it — and tell
    smaller groups' members' own sockets so their list moves this group up."""
    from .models import GroupMember, Notification
    from .push import notify_many
    from . import messaging as dm

    from .models import Group, blocked_ids_for

    now = timezone.now()
    rows = list(GroupMember.objects.filter(group=group).exclude(user=sender)
                .values_list('user_id', 'muted_until', 'notify_level'))
    ids = [r[0] for r in rows]
    if not ids:
        return
    # The group's own switch in Settings ("Groups" / "Communities").
    category = 'communities' if group.kind == Group.KIND_COMMUNITY else 'groups'
    # Nobody gets a push from someone blocked either way (the message is in
    # the chat as it is for everyone; their phone just doesn't ring for it).
    blocked = blocked_ids_for(sender)
    here = watching(group.slug, ids)
    named = mentioned_ids(group, post.content, exclude=sender.id) if post.message_type == 'text' else set()
    named -= blocked
    named = {u for u in named
             if cache.add(f'grp_mention:{group.pk}:{sender.pk}:{u}', 1, MENTION_PUSH_EVERY_S)}
    quiet = {uid for uid, until, level in rows
             if (until and until > now) or level == GroupMember.NOTIFY_MENTIONS}
    everyone = [u for u in ids if u not in quiet and u not in here and u not in named and u not in blocked]
    if everyone:
        notify_many(everyone, 'message', f"{group.name} — {sender.username}: {preview}",
                    data={'groupSlug': group.slug}, category=category)
    if named:
        Notification.objects.bulk_create([
            Notification(recipient_id=u, sender=sender, group=group, notification_type='group_mention',
                         message=f"{sender.username} mentioned you in {group.name}")
            for u in named
        ])
        reach = [u for u in named if u not in here]
        if reach:
            notify_many(reach, 'group_mention', f"{sender.username} mentioned you in {group.name}: {preview}",
                        data={'groupSlug': group.slug, 'messageId': post.id}, category=category)

    if len(ids) <= LIVE_LIST_MAX_MEMBERS:
        dm.tell(ids + [sender.id], {
            'type': 'group_message', 'group_slug': group.slug, 'kind': group.kind,
            'message': {
                'id': post.id, 'content': (post.content or '')[:120], 'message_type': post.message_type,
                'file_name': post.file_name, 'sender_id': sender.id, 'sender_username': sender.username,
                'created_at': post.created_at.isoformat(),
            },
            'mentions': sorted(named),
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

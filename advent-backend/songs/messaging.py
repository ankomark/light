"""Direct messages: the rules and the live fan-out.

- Each person's side of a chat (ConversationState): accepted (a first message
  from someone they don't follow is a *request* until they accept), muted,
  archived, cleared.
- Live events to each person's own socket room (songs/consumers.DMConsumer):
  a new message, an edit, a deletion, a reaction, read receipts, typing,
  presence. REST stays the source of truth; the socket only tells.
- Presence: online while any of their devices is connected (a shared
  counter in the cache), otherwise "last seen".
"""
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone

from .models import Conversation, ConversationState, Message, User

EDIT_WINDOW_S = 15 * 60                 # a message can be edited for 15 minutes
DELETE_FOR_ALL_WINDOW_S = 48 * 3600     # and deleted for everyone for 48 hours
REACTIONS = ('❤️', '👍', '😂', '😮', '😢', '🙏')
ONLINE_TTL = 6 * 3600                   # a crashed socket can't keep someone "online" for ever


def dm_room(user_id):
    return f'dm_{user_id}'


def tell(user_ids, payload):
    """Send a live event to each person's room (all their devices). Never
    fails the request that caused it — the fallback poll catches up."""
    layer = get_channel_layer()
    if not layer:
        return
    for uid in {u for u in user_ids if u}:
        try:
            async_to_sync(layer.group_send)(dm_room(uid), {'type': 'dm_event', 'payload': payload})
        except Exception:
            pass


# ── Presence ────────────────────────────────────────────────────────────────

def _online_key(uid):
    return f'dm_online:{uid}'


def went_online(uid):
    """One more device connected. Counted with the cache's own atomic
    increment: a read-then-write let two devices connecting at once count as
    one (and later leave someone "online" for hours, or offline while on)."""
    key = _online_key(uid)
    cache.add(key, 0, ONLINE_TTL)
    try:
        n = cache.incr(key)
    except ValueError:              # expired between add and incr
        cache.set(key, 1, ONLINE_TTL)
        n = 1
    cache.touch(key, ONLINE_TTL)
    return n == 1


def left(uid):
    """A device of theirs went away: the count only, in the cache — no
    database, so a socket closing never waits on it. True if it was their
    last device (they are offline now)."""
    key = _online_key(uid)
    try:
        n = cache.decr(key)
    except ValueError:              # nothing counted (expired): offline
        return True
    if n <= 0:
        cache.set(key, 0, ONLINE_TTL)
        return True
    return False


def stamp_last_seen(uid):
    User.objects.filter(pk=uid).update(last_seen_at=timezone.now())


def went_offline(uid):
    """left(), and when it was their last device, "last seen" now."""
    if left(uid):
        stamp_last_seen(uid)
        return True
    return False


def is_online(uid):
    return (cache.get(_online_key(uid)) or 0) > 0


def partner_ids(user, limit=300):
    """People this user has a chat with (who to tell they came online) -
    never anyone blocked either way: being told someone is online is
    exactly what a block must stop."""
    from .models import blocked_ids_for
    blocked = blocked_ids_for(user)
    qs = User.objects.filter(conversations__participants=user).exclude(pk=user.pk)
    if blocked:
        qs = qs.exclude(pk__in=blocked)
    return list(qs.values_list('pk', flat=True).distinct()[:limit])


# ── Each side of a chat ─────────────────────────────────────────────────────

def follows(follower, followed):
    """Does `follower` follow `followed`? (the followers M2M: from = the one
    followed, to = the follower)."""
    return User.followers.through.objects.filter(from_user_id=followed.pk, to_user_id=follower.pk).exists()


def state_of(conversation, user):
    s, _ = ConversationState.objects.get_or_create(conversation=conversation, user=user)
    return s


def start_between(starter, other):
    """The chat between two people (made if new). For `other` it's a request
    when they don't follow the starter — until they accept, or answer."""
    conv = Conversation.objects.filter(participants=starter).filter(participants=other).first()
    if conv is None:
        conv = Conversation.objects.create()
        conv.participants.add(starter, other)
        ConversationState.objects.create(conversation=conv, user=starter, accepted=True)
        ConversationState.objects.create(conversation=conv, user=other, accepted=follows(other, starter))
    else:
        state_of(conv, starter)
        state_of(conv, other)
    return conv


def visible_messages(conversation, user):
    """A chat's messages as this person sees them: not what they cleared or
    deleted for themselves, nor what a moderator took down."""
    from django.db.models import Subquery, Value
    from django.db.models.functions import Coalesce
    from .models import MessageHide
    # All in the one query: what they cleared and hid are subqueries.
    cleared = ConversationState.objects.filter(conversation=conversation, user=user).values('cleared_before_id')[:1]
    hidden = MessageHide.objects.filter(user=user, message__conversation=conversation).values('message_id')
    return (conversation.messages.filter(is_removed=False, id__gt=Coalesce(Subquery(cleared), Value(0)))
            .exclude(id__in=hidden))


def folder_q(user, folder):
    """Which chats go in which list: primary (accepted, not archived),
    requests (not accepted), archived."""
    mine = Q(states__user=user)
    if folder == 'requests':
        return mine & Q(states__accepted=False)
    if folder == 'archived':
        return mine & Q(states__accepted=True, states__archived=True)
    return mine & Q(states__accepted=True, states__archived=False)


def ensure_states(user):
    """Chats from before states existed get theirs (accepted — they were
    already talking). Cheap once done."""
    missing = (Conversation.objects.filter(participants=user).exclude(states__user=user).values_list('pk', flat=True)[:500])
    ConversationState.objects.bulk_create(
        [ConversationState(conversation_id=pk, user=user, accepted=True) for pk in missing], ignore_conflicts=True)


def preview_of(m):
    """A message in a line (a reply's quote)."""
    if m is None:
        return None
    if m.is_deleted or m.is_removed:
        text = ''
    else:
        text = (m.content or '')[:120]
    return {'id': m.id, 'sender_id': m.sender_id, 'content': text, 'message_type': m.message_type,
            'is_deleted': m.is_deleted or m.is_removed}

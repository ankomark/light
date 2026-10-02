import requests
import json

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

NOTIFICATION_TITLES = {
    # Single & Searching: discreet — never a name on the lock screen.
    'singles_match': '\U0001f49b Single & Searching',
    'quiz_duel': '\u2694\ufe0f Your duel was played',
    'puzzle_challenge': '\U0001f9e9 Your puzzle challenge was played',
    'like': '❤️ New Like',
    'comment': '\U0001f4ac New Comment',
    'follow': '\U0001f464 New Follower',
    'group_join_request': '\U0001f465 Join Request',
    'group_mention': '\U0001f4ac You were mentioned',
    'notice': '\U0001f4e2 Notice board',
    'admin_reply': '\U0001f4ec The admins answered',
    'group_join_approved': '✅ Request Approved',
    'group_join_rejected': '\U0001f6ab Request Declined',
    'message': '\U0001f4ac New Message',
    'mention': '@ You were mentioned',
    'security': '\U0001f512 Security alert',
    'milestone': '\U0001f389 Milestone',
    'new_book': '\U0001f4d6 New book',
    'new_chapter': '\U0001f4d6 New chapter',
    'book_discussion': '\U0001f4ac Book discussion',
    'book_review': '⭐ New review',
    'book_invite': '✍️ Invitation to write',
    'org_invite': '\U0001f3db Invitation to an organisation',
    'service_review': '⭐ Service review',
    'service_verified': '✅ Verification',
    'service_booking': '\U0001f4c5 Booking request',
    'market_order': '\U0001f6cd New order',
    'market_paid': '✅ Payment confirmed',
    'market_shipped': '\U0001f69a On its way',
    'market_delivered': '\U0001f4e6 Delivered',
    'market_cancelled': '✖️ Order cancelled',
    'market_wish': '❤️ From your wishlist',
    'test': '\U0001f514 Test notification',
}

# Maps a notification_type to the user-facing preference category that gates it.
# Types not listed here (e.g. 'system', account/moderation messages) are always
# delivered and cannot be turned off.
NOTIFICATION_CATEGORIES = {
    'like': 'likes',
    # "Your song reached 1,000 plays": good news about your music, like a like.
    'milestone': 'likes',
    'comment': 'comments',
    # No separate switch for mentions: they ride on the comments one, which is
    # where people expect "someone is talking to me" alerts to live.
    'mention': 'comments',
    'follow': 'follows',
    'message': 'messages',
    'singles_match': 'messages',
    'group_join_request': 'groups',
    'group_mention': 'messages',
    'notice': 'notices',
    'admin_reply': 'notices',
    'group_join_approved': 'groups',
    'group_join_rejected': 'groups',
    'group_added': 'groups',
    'live': 'live',
    'cohost_request': 'live',
    'cohost_approved': 'live',
    'quiz_reminder': 'quiz',
    # Someone played the duel you sent them.
    'quiz_duel': 'quiz',
    # Someone finished the word puzzle you challenged them to.
    'puzzle_challenge': 'quiz',
    'weather_briefing': 'weather',
    'verse_of_the_day': 'verse',
    'new_book': 'books',
    'new_chapter': 'books',
    # Someone replied in a chapter's discussion / reviewed your book: people
    # talking to you, like a comment.
    'book_discussion': 'comments',
    'book_review': 'comments',
    'book_invite': 'books',
    'org_invite': 'books',
    # A review of your service (or a reply to yours): people talking to you.
    'service_review': 'comments',
    # Bookings and quotes: someone asking of your service, or its answer.
    'service_booking': 'messages',
    # The marketplace, all under one switch: orders, their progress, and
    # wishlist price drops and restocks.
    'market_order': 'marketplace',
    'market_paid': 'marketplace',
    'market_shipped': 'marketplace',
    'market_delivered': 'marketplace',
    'market_cancelled': 'marketplace',
    'market_wish': 'marketplace',
}


def quiet_now(prefs, now=None):
    """Whether `prefs` asks for quiet at this moment (on the person's clock).
    A window that crosses midnight (22:00 to 07:00) is the usual case."""
    from datetime import timezone as dt_tz
    from django.utils import timezone
    if prefs is None or prefs.quiet_from is None or prefs.quiet_to is None:
        return False
    if prefs.quiet_from == prefs.quiet_to:
        return False
    now = now or timezone.now()
    utc = now.astimezone(dt_tz.utc) if timezone.is_aware(now) else now
    minute = (utc.hour * 60 + utc.minute + (prefs.utc_offset or 0)) % (24 * 60)
    start, end = prefs.quiet_from, prefs.quiet_to
    return start <= minute < end if start < end else (minute >= start or minute < end)


def _quiet_user_ids(user_ids):
    """Of these people, the ones in their quiet hours now."""
    from .models import NotificationPreference
    rows = NotificationPreference.objects.filter(
        quiet_from__isnull=False, quiet_to__isnull=False,
        **({'user_id__in': user_ids} if user_ids is not None else {}),
    )
    return {p.user_id for p in rows if quiet_now(p)}


def _is_category_enabled(recipient, notification_type):
    """Whether the recipient still wants pushes of this type. Unknown types and
    users with no preference row default to enabled (fail-open)."""
    category = NOTIFICATION_CATEGORIES.get(notification_type)
    if not category:
        return True
    prefs = getattr(recipient, 'notification_preference', None)
    if prefs is None:
        return True
    return bool(getattr(prefs, category, True))


def send_expo_push(tokens, title, body, data=None):
    """Send push notifications to a list of Expo push tokens."""
    if not tokens:
        return

    messages = [
        {
            "to": token,
            "title": title,
            "body": body,
            "data": data or {},
            "sound": "default",
            "badge": 1,
            "channelId": "default",
        }
        for token in tokens
        if isinstance(token, str) and token.startswith("ExponentPushToken[")
    ]

    if not messages:
        return

    try:
        response = requests.post(
            EXPO_PUSH_URL,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Accept-Encoding": "gzip, deflate",
            },
            data=json.dumps(messages),
            timeout=10,
        )
        result = response.json()

        # Deactivate any tokens that are no longer valid
        if "data" in result:
            from .models import DeviceToken
            invalid = [
                messages[i]["to"]
                for i, item in enumerate(result["data"])
                if item.get("status") == "error"
                and item.get("details", {}).get("error") in (
                    "DeviceNotRegistered", "InvalidCredentials"
                )
            ]
            if invalid:
                DeviceToken.objects.filter(token__in=invalid).update(is_active=False)

        return result
    except Exception as e:
        print(f"[Push] Error sending notification: {e}")
        return None


EXPO_BATCH = 100   # Expo takes up to 100 messages per request


def notify_many(user_ids, notification_type, message, data=None, title=None):
    """One push to many people (a group message): two queries for everyone's
    devices — whoever turned the category off is left out — then the sends in
    batches of 100, off the request thread. notify_user per person was two
    queries and a thread each: thousands for a big community."""
    from .models import DeviceToken
    from .tasks import run_in_background

    user_ids = list({u for u in user_ids if u})
    if not user_ids:
        return 0
    tokens = DeviceToken.objects.filter(user_id__in=user_ids, is_active=True)
    category = NOTIFICATION_CATEGORIES.get(notification_type)
    if category:
        tokens = tokens.exclude(**{f'user__notification_preference__{category}': False})
        # Quiet hours hold back what can be switched off.
        quiet = _quiet_user_ids(user_ids)
        if quiet:
            tokens = tokens.exclude(user_id__in=quiet)
    tokens = list(tokens.values_list('token', flat=True).distinct())
    if not tokens:
        return 0
    title = title or NOTIFICATION_TITLES.get(notification_type, "\U0001f514 Adventist Life")
    for i in range(0, len(tokens), EXPO_BATCH):
        run_in_background(send_expo_push, tokens[i:i + EXPO_BATCH], title, message, data)
    return len(tokens)


def notify_user(recipient, notification_type, message, data=None, title=None,
                category=None):
    """Send a push notification to all active devices of a recipient user.

    The token lookup is cheap and stays synchronous; the network round-trip to
    Expo is offloaded to a background thread so it never blocks the request.

    `title` overrides the per-type heading for the cases where it is not the
    same for everyone — the morning weather briefing greets people by name.

    `category` overrides which preference gates the send, for the cases where
    the type alone cannot say. Communities and groups are the same model with a
    different `kind`, so they share notification types but must honour separate
    switches.
    """
    from .models import DeviceToken
    from .tasks import run_in_background

    # Respect the recipient's per-category push preference.
    if category:
        prefs = getattr(recipient, 'notification_preference', None)
        if prefs is not None and not getattr(prefs, category, True):
            return
    elif not _is_category_enabled(recipient, notification_type):
        return
    # Quiet hours hold back what can be switched off; security and account
    # messages (no category) always come through.
    if category or NOTIFICATION_CATEGORIES.get(notification_type):
        try:
            prefs = recipient.notification_preference
        except Exception:  # noqa: BLE001 — no row: no quiet hours
            prefs = None
        if quiet_now(prefs):
            return

    tokens = list(
        DeviceToken.objects.filter(user=recipient, is_active=True)
        .values_list("token", flat=True)
    )
    if not tokens:
        return
    if not title:
        title = NOTIFICATION_TITLES.get(notification_type, "\U0001f514 Adventist Life")
    run_in_background(send_expo_push, tokens, title, message, data)

def notify_everyone(notification_type, message, data=None, exclude_ids=(), title=None):
    """One push to every signed-in device (a new notice): one query for the
    tokens — minus whoever turned the category off — then batches of 100,
    off the request thread."""
    from .models import DeviceToken
    from .tasks import run_in_background

    # Only open accounts: not banned (inactive) or deactivated.
    tokens = (DeviceToken.objects.filter(is_active=True, user__is_active=True, user__is_deactivated=False)
              .exclude(user_id__in=list(exclude_ids)))
    category = NOTIFICATION_CATEGORIES.get(notification_type)
    if category:
        tokens = tokens.exclude(**{f'user__notification_preference__{category}': False})
        quiet = _quiet_user_ids(None)
        if quiet:
            tokens = tokens.exclude(user_id__in=quiet)
    tokens = list(tokens.values_list('token', flat=True).distinct())
    title = title or NOTIFICATION_TITLES.get(notification_type, "\U0001f514 Adventist Life")
    for i in range(0, len(tokens), EXPO_BATCH):
        run_in_background(send_expo_push, tokens[i:i + EXPO_BATCH], title, message, data)
    return len(tokens)

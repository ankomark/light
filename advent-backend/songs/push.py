import requests
import json

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

NOTIFICATION_TITLES = {
    'like': '❤️ New Like',
    'comment': '\U0001f4ac New Comment',
    'follow': '\U0001f464 New Follower',
    'group_join_request': '\U0001f465 Join Request',
    'group_join_approved': '✅ Request Approved',
    'group_join_rejected': '\U0001f6ab Request Declined',
    'message': '\U0001f4ac New Message',
    'security': '\U0001f512 Security alert',
}

# Maps a notification_type to the user-facing preference category that gates it.
# Types not listed here (e.g. 'system', account/moderation messages) are always
# delivered and cannot be turned off.
NOTIFICATION_CATEGORIES = {
    'like': 'likes',
    'comment': 'comments',
    'follow': 'follows',
    'message': 'messages',
    'group_join_request': 'groups',
    'group_join_approved': 'groups',
    'group_join_rejected': 'groups',
    'group_added': 'groups',
    'church_request': 'communities',
    'church_approved': 'communities',
    'church_added': 'communities',
    'choir_request': 'communities',
    'choir_approved': 'communities',
    'choir_added': 'communities',
    'live': 'live',
    'cohost_request': 'live',
    'cohost_approved': 'live',
}


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


def notify_user(recipient, notification_type, message, data=None):
    """Send a push notification to all active devices of a recipient user.

    The token lookup is cheap and stays synchronous; the network round-trip to
    Expo is offloaded to a background thread so it never blocks the request.
    """
    from .models import DeviceToken
    from .tasks import run_in_background

    # Respect the recipient's per-category push preference.
    if not _is_category_enabled(recipient, notification_type):
        return

    tokens = list(
        DeviceToken.objects.filter(user=recipient, is_active=True)
        .values_list("token", flat=True)
    )
    if not tokens:
        return
    title = NOTIFICATION_TITLES.get(notification_type, "\U0001f514 Adventist Life")
    run_in_background(send_expo_push, tokens, title, message, data)

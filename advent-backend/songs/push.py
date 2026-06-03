import requests
import json

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

NOTIFICATION_TITLES = {
    'like': '❤️ New Like',
    'comment': '\U0001f4ac New Comment',
    'follow': '\U0001f464 New Follower',
    'group_join_request': '\U0001f465 Join Request',
    'message': '\U0001f4ac New Message',
}


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
    """Send a push notification to all active devices of a recipient user."""
    from .models import DeviceToken
    tokens = list(
        DeviceToken.objects.filter(user=recipient, is_active=True)
        .values_list("token", flat=True)
    )
    title = NOTIFICATION_TITLES.get(notification_type, "\U0001f514 Advent Light")
    send_expo_push(tokens, title, message, data)

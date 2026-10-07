"""A suspended account can look, not act — everywhere.

Suspension was enforced by a permission class on a handful of views, so a
suspended person could still post, comment, message and upload almost
anywhere else. This middleware is the one rule for all of it: while an
account is suspended, every write to the API is refused, except what a
suspended person still needs — to sign in and out, look after their account,
appeal, report, and receive their notifications.

Reads are untouched: a suspension is a time out, not a ban.
"""
from django.http import JsonResponse

WRITE_METHODS = ('POST', 'PUT', 'PATCH', 'DELETE')

# Writes a suspended person may still make.
ALLOWED_WHILE_SUSPENDED = (
    '/api/auth/',                       # sign in/out, password, sessions, leave
    '/api/appeals/',                    # appeal the suspension itself
    '/api/reports/',                    # still report abuse aimed at them
    '/api/device-tokens/',
    '/api/notification-preferences/',
    '/api/notifications/',              # mark as read
    '/api/app-status/',
)


def _user(request):
    """Who is asking, without waiting for the view: a test's forced user, or
    the bearer token's. None when there is no valid sign-in."""
    forced = getattr(request, '_force_auth_user', None)
    if forced is not None:
        return forced
    if not request.META.get('HTTP_AUTHORIZATION'):
        return None
    try:
        from rest_framework_simplejwt.authentication import JWTAuthentication
        found = JWTAuthentication().authenticate(request)
        return found[0] if found else None
    except Exception:  # noqa: BLE001 — a bad token is the view's to refuse
        return None


class SuspensionMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path
        if (request.method in WRITE_METHODS and path.startswith('/api/')
                and not path.startswith(ALLOWED_WHILE_SUSPENDED) and '/webhook' not in path):
            user = _user(request)
            if user is not None and getattr(user, 'is_currently_suspended', False):
                until = getattr(user, 'suspended_until', None)
                return JsonResponse({
                    'code': 'suspended',
                    'detail': 'Your account is suspended.',
                    'reason': getattr(user, 'suspension_reason', '') or '',
                    'until': until.isoformat() if until else None,
                }, status=403)
        return self.get_response(request)

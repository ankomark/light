"""The app's switches, set by admins: maintenance mode and parts of the app
turned off. Read often (every app start asks), so cached briefly; a change
forgets the cache at once."""
from django.core.cache import cache

FEATURES = ('marketplace', 'quiz', 'puzzle', 'live', 'singles')
DEFAULTS = {
    'maintenance': {'on': False, 'message': ''},
    'features': {name: True for name in FEATURES},
}
CACHE_KEY = 'app-status'
CACHE_SECONDS = 30


def status():
    """{maintenance: {on, message}, features: {name: bool}}."""
    cached = cache.get(CACHE_KEY)
    if cached is not None:
        return cached
    from .models import SiteSetting
    stored = {row.key: row.value for row in SiteSetting.objects.filter(key__in=DEFAULTS)}
    result = {
        'maintenance': {**DEFAULTS['maintenance'], **(stored.get('maintenance') or {})},
        'features': {**DEFAULTS['features'], **{k: bool(v) for k, v in (stored.get('features') or {}).items()
                                               if k in FEATURES}},
    }
    cache.set(CACHE_KEY, result, CACHE_SECONDS)
    return result


def save(key, value, user):
    from .models import SiteSetting
    SiteSetting.objects.update_or_create(key=key, defaults={'value': value, 'updated_by': user})
    cache.delete(CACHE_KEY)
    return status()


# While in maintenance, what members can still reach: the switch itself,
# signing in (so admins can), the admin tools, and who they are.
OPEN_IN_MAINTENANCE = ('/api/app-status/', '/api/auth/', '/api/admin/', '/api/profiles/me/')


class MaintenanceMiddleware:
    """In maintenance, the API answers members 503 {code: 'maintenance',
    message}; admins carry on (to check things before opening up again)."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        from django.conf import settings
        path = request.path
        if (getattr(settings, 'MAINTENANCE_CHECK', True) and path.startswith('/api/')
                and not path.startswith(OPEN_IN_MAINTENANCE)):
            state = status()['maintenance']
            if state.get('on') and not self._is_admin(request):
                from django.http import JsonResponse
                return JsonResponse({'code': 'maintenance', 'message': state.get('message') or '',
                                     'detail': 'The app is down for maintenance.'}, status=503)
        return self.get_response(request)

    @staticmethod
    def _is_admin(request):
        try:
            from rest_framework_simplejwt.authentication import JWTAuthentication
            found = JWTAuthentication().authenticate(request)
            return bool(found and found[0].is_platform_admin)
        except Exception:  # noqa: BLE001 — no valid sign-in: a member, as far as this goes
            return False

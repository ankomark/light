"""The app's switches, set by admins: maintenance mode and parts of the app
turned off. Read often (every app start asks), so cached briefly; a change
forgets the cache at once."""
from django.core.cache import cache

from .app_sections import KEYS as FEATURES, section_for

DEFAULTS = {
    'maintenance': {'on': False, 'message': ''},
    'features': {name: True for name in FEATURES},
    # What members are told about a section switched off: {key: text}.
    'feature_messages': {},
}
MESSAGE_MAX = 200
CACHE_KEY = 'app-status'
CACHE_SECONDS = 30


def status():
    """{maintenance: {on, message}, features: {name: bool}, messages: {name: text}}."""
    cached = cache.get(CACHE_KEY)
    if cached is not None:
        return cached
    from .models import SiteSetting
    stored = {row.key: row.value for row in SiteSetting.objects.filter(key__in=DEFAULTS)}
    result = {
        'maintenance': {**DEFAULTS['maintenance'], **(stored.get('maintenance') or {})},
        'features': {**DEFAULTS['features'], **{k: bool(v) for k, v in (stored.get('features') or {}).items()
                                               if k in FEATURES}},
        'messages': {k: str(v)[:MESSAGE_MAX] for k, v in (stored.get('feature_messages') or {}).items()
                     if k in FEATURES and v},
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
        refused = self._section_off(request, path)
        if refused is not None:
            return refused
        return self.get_response(request)

    def _section_off(self, request, path):
        """A request into a section an admin has switched off (app_sections):
        refused for members, with what they are to be told. Webhooks (one
        server telling another) always pass."""
        from django.conf import settings
        if not getattr(settings, 'SECTION_SWITCHES', True) or '/webhook' in path:
            return None
        section = section_for(path)
        if not section:
            return None
        current = status()
        if current['features'].get(section, True) or self._is_admin(request):
            return None
        from django.http import JsonResponse
        message = current.get('messages', {}).get(section, '')
        return JsonResponse({'code': 'feature_off', 'section': section, 'message': message,
                             'detail': 'This part of the app is switched off just now.'}, status=403)

    @staticmethod
    def _is_admin(request):
        try:
            from rest_framework_simplejwt.authentication import JWTAuthentication
            found = JWTAuthentication().authenticate(request)
            return bool(found and found[0].is_platform_admin)
        except Exception:  # noqa: BLE001 — no valid sign-in: a member, as far as this goes
            return False

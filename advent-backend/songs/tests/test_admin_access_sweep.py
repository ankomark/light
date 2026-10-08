"""Every admin endpoint, refused to everyone who is not an admin.

Not a list kept by hand: the routes are read from the URL configuration, so
an admin endpoint added later is checked too. A member (signed in, no
powers), a suspended admin and nobody at all must get nothing back from any
of them — no 2xx, whatever the method.

    python manage.py test songs.tests.test_admin_access_sweep --settings=music.settings_test
"""
import re

from django.core.cache import cache
from django.urls import URLPattern, URLResolver, get_resolver
from rest_framework.test import APITestCase

from songs.models import User


def _walk(patterns, prefix=''):
    for p in patterns:
        if isinstance(p, URLResolver):
            yield from _walk(p.url_patterns, prefix + str(p.pattern))
        elif isinstance(p, URLPattern):
            yield prefix + str(p.pattern)


def admin_paths():
    """Each admin route as a concrete path (any id filled in with 1)."""
    out = set()
    for raw in _walk(get_resolver().url_patterns):
        if 'admin/' not in raw or not raw.startswith('^api/') and not raw.startswith('api/'):
            continue
        path = raw.lstrip('^').rstrip('$')
        path = re.sub(r'\(\?P<format>[^)]*\)', '', path)          # DRF's .json suffix routes
        if '\\.' in path:
            continue
        path = re.sub(r'\(\?P<[^>]+>[^)]*\)', '1', path)           # regex groups
        path = re.sub(r'<(?:\w+:)?\w+>', '1', path)                # path converters
        path = path.replace('\\', '').replace('^', '').replace('$', '')
        out.add('/' + path)
    return sorted(out)


class AdminAccessSweepTests(APITestCase):
    def setUp(self):
        cache.clear()

    def _sweep(self, who):
        paths = admin_paths()
        self.assertGreater(len(paths), 40, 'the admin routes were not found')
        let_in = []
        for path in paths:
            for method in ('get', 'post', 'patch', 'delete'):
                r = getattr(self.client, method)(path, {}, format='json')
                if 200 <= r.status_code < 300:
                    let_in.append(f'{method.upper()} {path} -> {r.status_code}')
        self.assertEqual(let_in, [], f'{who} got into admin endpoints')

    def test_nobody_gets_in(self):
        self._sweep('an anonymous caller')

    def test_a_member_gets_in_nowhere(self):
        self.client.force_authenticate(User.objects.create_user('member', 'm@x.com', 'pw'))
        self._sweep('a member')

    def test_a_suspended_admin_gets_in_nowhere(self):
        boss = User.objects.create_user('boss', 'b@x.com', 'pw', admin_role='super_admin', is_superuser=True,
                                        is_suspended=True)
        self.client.force_authenticate(boss)
        self._sweep('a suspended admin')

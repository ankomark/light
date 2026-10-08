"""No endpoint crashes (500) on junk from an ordinary member.

Every route is read from the URL configuration (so new ones are covered),
filled with an id that does not exist, and sent GET / POST / PATCH / DELETE
with an empty body, then with wrong-typed junk. A 4xx (or a 503 "not ready") is a fine answer; a 500
is a bug - in production it is a broken screen and an error report.

    python manage.py test songs.tests.test_no_crash_sweep --settings=music.settings_test
"""
import re
import traceback
from unittest import mock

from django.db import transaction

from django.core.cache import cache
from django.test import override_settings
from django.urls import URLPattern, URLResolver, get_resolver
from rest_framework.test import APITestCase

from songs.models import User

JUNK = {
    'id': 'abc', 'user_id': 'x', 'count': 'many', 'page': -1, 'title': {'nested': True}, 'text': ['a'],
    'amount': 'NaN', 'quantity': -5, 'rating': 99, 'date': 'not-a-date', 'email': 12, 'items': 'not-a-list',
    'ids': 'nope', 'order': {'x': 1}, 'position': 'top', 'code': None, 'language': 'xx', 'days': 'ten',
}


def _walk(patterns, prefix=''):
    for p in patterns:
        if isinstance(p, URLResolver):
            yield from _walk(p.url_patterns, prefix + str(p.pattern))
        elif isinstance(p, URLPattern):
            yield prefix + str(p.pattern)


def api_paths():
    out = set()
    for raw in _walk(get_resolver().url_patterns):
        if not (raw.startswith('^api/') or raw.startswith('api/')) or 'admin/' in raw:
            continue
        path = raw.lstrip('^').rstrip('$')
        path = re.sub(r'\(\?P<format>[^)]*\)', '', path)
        if '\\.' in path:
            continue
        path = re.sub(r'\(\?P<[^>]+>[^)]*\)', '999999', path)
        path = re.sub(r'<int:\w+>', '999999', path)
        path = re.sub(r'<(?:\w+:)?\w+>', 'zz-not-here', path)
        path = path.replace('\\', '').replace('^', '').replace('$', '')
        out.add('/' + path)
    return sorted(out)


# Outside calls are not what is being tested: no pushes, mail, LiveKit, AI.
@mock.patch('songs.push.send_expo_push', lambda *a, **k: None)
@mock.patch('songs.livekit_service._run', lambda *a, **k: None)
@mock.patch('songs.emails.send_branded_mail', lambda *a, **k: 1)
@mock.patch('rest_framework.throttling.ScopedRateThrottle.allow_request', return_value=True)
@mock.patch('rest_framework.throttling.UserRateThrottle.allow_request', return_value=True)
@override_settings(ANTHROPIC_API_KEY='')
@mock.patch('requests.Session.request', side_effect=__import__('requests').exceptions.ConnectionError('no network in tests'))
class NoCrashSweepTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.member = User.objects.create_user('member', 'member@x.com', 'pw-12345678', is_email_verified=True)
        self.client.force_authenticate(self.member)
        self.client.raise_request_exception = True

    def test_no_endpoint_crashes_on_junk(self, *_):
        paths = api_paths()
        self.assertGreater(len(paths), 200, 'the routes were not found')
        crashes = []
        for path in paths:
            for method in ('get', 'post', 'patch', 'delete'):
                for body in ({}, JUNK):
                    what = f'{method.upper()} {path} {"junk" if body else "empty"}'
                    try:
                        # Each request in its own savepoint: one crash must not
                        # poison the test's transaction for all the rest.
                        with transaction.atomic():
                            if method == 'get' and body:
                                r = self.client.get(path, {'page': 'x', 'q': '%', 'limit': 'many', 'days': 'ten'})
                            elif method == 'get':
                                r = self.client.get(path)
                            else:
                                r = getattr(self.client, method)(path, body, format='json')
                        # 503 is an answer: "not set up" (payments) or "not ready"
                        # (content not imported yet) - said, not crashed.
                        if r.status_code >= 500 and r.status_code != 503:
                            crashes.append(f'{what} -> {r.status_code}')
                    except Exception as e:  # noqa: BLE001 - that is what is being looked for
                        frames = [f for f in traceback.extract_tb(e.__traceback__)
                                  if 'songs' in f.filename and 'site-packages' not in f.filename]
                        at = f'{frames[-1].filename.split("songs")[-1]}:{frames[-1].lineno}' if frames else '?'
                        crashes.append(f'{what} -> {type(e).__name__}: {str(e)[:110]} @ {at}')
        self.assertEqual(crashes, [], '\n' + '\n'.join(crashes))

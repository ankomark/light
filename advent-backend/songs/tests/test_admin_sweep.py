"""Admin phase 5: an attack-style sweep of every admin door.

Every URL under /api/admin/ (found from the URL conf, so a door added later
is swept too), with every method, as: nobody signed in, a member, an account
with only Django's staff flag, an admin removed from the admins, an admin
whose role covers something else, and (with two-step sign-in on) a real
admin without an admin session. None of them may get anything but a refusal.

    python manage.py test songs.tests.test_admin_sweep --settings=music.settings_test
"""
import re

from django.core.cache import cache
from django.test import override_settings
from django.urls import get_resolver
from rest_framework.test import APITestCase

from songs import admin_security as sec
from songs.models import Role, User

# The doors to the two-step sign-in itself are meant for admins without a
# session yet; they are swept separately (members and removed admins).
SESSION_FREE = ('admin/security/',)


def admin_urls():
    """Every /api/admin/... URL, with any {pk} filled with 1."""
    found = set()

    def walk(patterns, prefix=''):
        for p in patterns:
            route = prefix + str(p.pattern)
            if hasattr(p, 'url_patterns'):
                walk(p.url_patterns, route)
            else:
                found.add(route)

    walk(get_resolver().url_patterns)
    urls = set()
    for route in found:
        if 'admin/' not in route or route.startswith('admin/') or route.startswith('^admin/'):
            continue   # Django's own /admin/ site: off unless DJANGO_ADMIN_ENABLED
        path = route.replace('^', '').replace('$', '').replace('\\.', '.')
        path = re.sub(r'\(\?P<format>[^)]*\)', '', path)
        path = re.sub(r'\(\?P<[^>]+>[^)]*\)', '1', path)
        path = re.sub(r'<(?:int:|str:|slug:)?[^>]+>', '1', path)
        if '(' in path or '?' in path:
            continue
        if not path.startswith('/'):
            path = '/' + path
        if '/api/admin/' in path:
            urls.add(path)
    return sorted(urls)


class SweepTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.member = User.objects.create_user('member', 'm@x.com', 'pw')
        self.staffy = User.objects.create_user('staffy', 's@x.com', 'pw', is_staff=True)
        self.removed = User.objects.create_user('removed', 'r@x.com', 'pw')
        self.narrow = User.objects.create_user('narrow', 'n@x.com', 'pw',
                                               role=Role.objects.create(name='Wallpapers', capabilities=['manage_wallpapers']))
        self.urls = admin_urls()

    def test_the_sweep_found_the_doors(self):
        joined = ' '.join(self.urls)
        for door in ('/api/admin/users/', '/api/admin/reports/', '/api/admin/roles/', '/api/admin/logs/verify/',
                     '/api/admin/broadcasts/', '/api/admin/app-settings/', '/api/admin/quiz-bank/',
                     '/api/admin/verify/', '/api/admin/insights/', '/api/admin/dashboard/'):
            self.assertIn(door, joined)
        self.assertGreater(len(self.urls), 40)

    def sweep(self, user, skip=()):
        leaks = []
        for url in self.urls:
            if any(s in url for s in skip):
                continue
            for method in ('get', 'post', 'patch', 'put', 'delete'):
                self.client.force_authenticate(user)
                res = getattr(self.client, method)(url, {}, format='json')
                if res.status_code < 400 or res.status_code == 500:
                    leaks.append(f'{method.upper()} {url} -> {res.status_code}')
        return leaks

    def test_nobody_signed_in(self):
        self.assertEqual(self.sweep(None), [])

    def test_a_member(self):
        self.assertEqual(self.sweep(self.member), [])

    def test_the_staff_flag_alone(self):
        self.assertEqual(self.sweep(self.staffy), [])

    def test_an_admin_removed_from_the_admins(self):
        self.removed.admin_role = 'super_admin'
        self.removed.save()
        token, _ = sec.open_session(self.removed)
        self.client.force_authenticate(User.objects.get(pk=1) if User.objects.filter(pk=1, admin_role='super_admin').exists()
                                       else User.objects.create_user('boss', 'b@x.com', 'pw', admin_role='super_admin'))
        res = self.client.post(f'/api/admin/users/{self.removed.id}/set_role/', {'super_admin': False}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.removed.refresh_from_db()
        self.assertEqual(self.sweep(self.removed), [])

    def test_a_role_that_covers_something_else(self):
        # Wallpapers only: no other admin door opens (the two-step doors and
        # the dashboard are for every admin, and say nothing beyond its role).
        leaks = self.sweep(self.narrow, skip=SESSION_FREE + ('/api/admin/dashboard/',))
        self.assertEqual(leaks, [])

    @override_settings(ADMIN_2FA_REQUIRED=True)
    def test_a_real_admin_without_a_two_step_session(self):
        boss = User.objects.create_user('boss2', 'b2@x.com', 'pw', admin_role='super_admin')
        self.assertEqual(self.sweep(boss, skip=SESSION_FREE), [])

    def test_a_suspended_admin(self):
        from django.utils import timezone
        boss = User.objects.create_user('boss3', 'b3@x.com', 'pw', admin_role='super_admin',
                                        is_suspended=True, suspended_at=timezone.now())
        self.assertEqual(self.sweep(boss), [])


class OutsideAdminDoorsTests(APITestCase):
    """Admin powers that live outside /api/admin/: notices, the notes people
    send the admins, wallpapers, the marketplace's categories."""

    def setUp(self):
        cache.clear()
        from django.utils import timezone
        self.member = User.objects.create_user('member', 'm@x.com', 'pw')
        self.suspended = User.objects.create_user('susp', 's@x.com', 'pw', admin_role='moderator',
                                                  is_suspended=True, suspended_at=timezone.now())

    def attempts(self):
        return [
            ('post', '/api/notices/', {'title': 'x', 'body': 'y'}),
            ('get', '/api/admin-notes/', None),
            ('post', '/api/wallpapers/', {'image': 'https://x/y.jpg'}),
            ('post', '/api/marketplace/categories/', {'name': 'X'}),
        ]

    def test_members_and_suspended_admins_are_refused(self):
        for user in (None, self.member, self.suspended):
            for method, url, body in self.attempts():
                self.client.force_authenticate(user)
                res = getattr(self.client, method)(url, body or {}, format='json')
                self.assertIn(res.status_code, (401, 403), f'{user} {method} {url} -> {res.status_code}')

    @override_settings(ADMIN_2FA_REQUIRED=True)
    def test_an_admin_without_a_two_step_session_is_asked_for_one(self):
        boss = User.objects.create_user('boss', 'b@x.com', 'pw', admin_role='super_admin')
        self.client.force_authenticate(boss)
        res = self.client.get('/api/admin-notes/')
        self.assertEqual((res.status_code, res.data['code']), (403, 'admin_session_required'))
        token, _ = sec.open_session(boss)
        self.assertEqual(self.client.get('/api/admin-notes/', HTTP_X_ADMIN_SESSION=token).status_code, 200)

"""Admin phase 1 scan: inputs that used to fail as a 500, a slow takedown,
and the phones of someone cut off.

    python manage.py test songs.tests.test_admin_scan --settings=music.settings_test
"""
from unittest import mock

from django.core.cache import cache
from rest_framework.test import APITestCase

from songs.models import DeviceToken, Role, SocialPost, User


def make(name, **extra):
    return User.objects.create_user(name, f'{name}@x.com', 'pw', **extra)


class InputTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.admin = make('boss', admin_role='super_admin', is_superuser=True)
        self.client.force_authenticate(self.admin)

    def test_a_takedown_of_a_non_number_is_a_400(self):
        for path in ('/api/admin/content/remove/', '/api/admin/content/restore/'):
            r = self.client.post(path, {'type': 'post', 'id': 'abc', 'reason': 'spam spam'}, format='json')
            self.assertEqual(r.status_code, 400, path)

    def test_a_suspension_of_forever_and_a_day_is_ten_years(self):
        member = make('member')
        r = self.client.post(f'/api/admin/users/{member.pk}/suspend/', {'days': 10 ** 9, 'reason': 'abuse'},
                             format='json')
        self.assertEqual(r.status_code, 200, r.content[:200])
        member.refresh_from_db()
        self.assertLess((member.suspended_until - member.suspended_at).days, 3651)

    def test_the_audit_log_ignores_a_malformed_date(self):
        r = self.client.get('/api/admin/logs/?since=2026-99-99&until=yesterday')
        self.assertEqual(r.status_code, 200)

    def test_a_verified_tick_for_a_non_number_is_a_400(self):
        r = self.client.post('/api/admin/verify/set/', {'kind': 'artist', 'id': 'x', 'verified': True},
                             format='json')
        self.assertEqual(r.status_code, 400)


class TakedownSpeedTests(APITestCase):
    def test_authors_are_emailed_off_the_request(self):
        cache.clear()
        admin = make('boss', admin_role='super_admin', is_superuser=True)
        author = make('writer')
        post = SocialPost.objects.create(user=author, content_type='image', caption='x')
        self.client.force_authenticate(admin)
        with mock.patch('songs.tasks.run_in_background') as bg, \
                mock.patch('songs.emails.send_branded_mail') as send:
            r = self.client.post('/api/admin/content/remove/', {'type': 'post', 'id': post.pk, 'reason': 'spam!'},
                                 format='json')
        self.assertEqual(r.status_code, 200, r.content[:200])
        self.assertFalse(send.called)            # not on the request
        self.assertTrue(bg.called)               # handed to the task pool


class CutOffTests(APITestCase):
    def test_a_banned_persons_phones_stop_getting_pushes(self):
        cache.clear()
        admin = make('boss', admin_role='super_admin', is_superuser=True)
        member = make('member')
        DeviceToken.objects.create(user=member, token='ExponentPushToken[m]')
        self.client.force_authenticate(admin)
        r = self.client.post(f'/api/admin/users/{member.pk}/ban/', {'reason': 'scam account'}, format='json')
        self.assertEqual(r.status_code, 200, r.content[:200])
        self.assertFalse(DeviceToken.objects.filter(user=member, is_active=True).exists())

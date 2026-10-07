"""Admin phase 2: a switch for every part of the app.

    python manage.py test songs.tests.test_section_switches --settings=music.settings_test
"""
from django.core.cache import cache
from rest_framework.test import APITestCase

from songs import app_settings
from songs.app_sections import KEYS, section_for
from songs.models import User


def make(name, **extra):
    return User.objects.create_user(name, f'{name}@x.com', 'pw', **extra)


class SectionMapTests(APITestCase):
    def test_paths_find_their_section(self):
        self.assertEqual(section_for('/api/groups/choir/posts/'), 'groups')
        self.assertEqual(section_for('/api/communities/'), 'groups')
        self.assertEqual(section_for('/api/notices/3/'), 'notices')
        self.assertIsNone(section_for('/api/auth/token/'))
        self.assertIsNone(section_for('/api/profiles/me/'))
        self.assertIsNone(section_for('/api/reports/'))

    def test_every_old_switch_is_still_a_section(self):
        for key in ('marketplace', 'quiz', 'puzzle', 'live', 'singles'):
            self.assertIn(key, KEYS)


class SwitchTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.boss = make('boss', admin_role='super_admin', is_superuser=True)
        self.member = make('member')

    def tearDown(self):
        cache.clear()

    def _off(self, key, message=''):
        app_settings.save('features', {**app_settings.status()['features'], key: False}, self.boss)
        if message:
            app_settings.save('feature_messages', {key: message}, self.boss)

    def test_a_section_switched_off_is_refused_to_members_with_the_message(self):
        self._off('notices', 'Back on Sunday.')
        self.client.force_authenticate(self.member)
        r = self.client.get('/api/notices/')
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json(), {'code': 'feature_off', 'section': 'notices', 'message': 'Back on Sunday.',
                                    'detail': 'This part of the app is switched off just now.'})
        # Everything else carries on.
        self.assertNotEqual(self.client.get('/api/notifications/').status_code, 403)

    def test_admins_carry_on_to_check_it(self):
        self._off('notices')
        from rest_framework_simplejwt.tokens import AccessToken
        token = str(AccessToken.for_user(self.boss))
        r = self.client.get('/api/notices/', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertNotEqual(r.status_code, 403)

    def test_webhooks_always_pass(self):
        self._off('live')
        r = self.client.post('/api/live/webhook/', data='{}', content_type='application/webhook+json')
        self.assertNotEqual(r.status_code, 403)

    def test_admin_sets_switches_and_messages(self):
        self.client.force_authenticate(self.boss)
        r = self.client.patch('/api/admin/app-settings/', {
            'features': {'hymns': False, 'groups': False},
            'messages': {'groups': 'Moving to a new server tonight.'},
        }, format='json')
        self.assertEqual(r.status_code, 200, r.content[:300])
        self.assertFalse(r.data['features']['hymns'])
        self.assertEqual(r.data['messages'], {'groups': 'Moving to a new server tonight.'})
        public = self.client.get('/api/app-status/').json()
        self.assertFalse(public['features']['groups'])
        self.assertEqual(public['messages']['groups'], 'Moving to a new server tonight.')

    def test_an_unknown_section_is_refused(self):
        self.client.force_authenticate(self.boss)
        r = self.client.patch('/api/admin/app-settings/', {'features': {'casino': False}}, format='json')
        self.assertEqual(r.status_code, 400)

"""Signing out: one call ends the session and this phone's notifications for
the account; and a phone only ever gets one account's notifications.

    python manage.py test songs.tests.test_sign_out --settings=music.settings_test
"""
from django.core.cache import cache
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from songs.models import DeviceToken, User

PHONE = 'ExponentPushToken[phone-1]'


class SignOutTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.mark = User.objects.create_user('mark', 'mark@x.com', 'pw')
        self.ann = User.objects.create_user('ann', 'ann@x.com', 'pw')

    def test_one_call_revokes_the_session_and_stops_this_phones_notifications(self):
        DeviceToken.objects.create(user=self.mark, token=PHONE, is_active=True)
        DeviceToken.objects.create(user=self.mark, token='ExponentPushToken[tablet]', is_active=True)
        refresh = str(RefreshToken.for_user(self.mark))
        res = self.client.post('/api/auth/logout/', {'refresh': refresh, 'device_token': PHONE}, format='json')
        self.assertEqual(res.status_code, 205)
        self.assertFalse(DeviceToken.objects.get(token=PHONE).is_active)
        self.assertTrue(DeviceToken.objects.get(token='ExponentPushToken[tablet]').is_active)   # only this phone
        again = self.client.post('/api/auth/token/refresh/', {'refresh': refresh}, format='json')
        self.assertEqual(again.status_code, 401)

    def test_a_bad_refresh_token_switches_nothing_off(self):
        DeviceToken.objects.create(user=self.mark, token=PHONE, is_active=True)
        res = self.client.post('/api/auth/logout/', {'refresh': 'not-a-token', 'device_token': PHONE}, format='json')
        self.assertEqual(res.status_code, 205)
        self.assertTrue(DeviceToken.objects.get(token=PHONE).is_active)

    def test_someone_elses_device_token_is_left_alone(self):
        DeviceToken.objects.create(user=self.ann, token=PHONE, is_active=True)
        refresh = str(RefreshToken.for_user(self.mark))
        self.client.post('/api/auth/logout/', {'refresh': refresh, 'device_token': PHONE}, format='json')
        self.assertTrue(DeviceToken.objects.get(user=self.ann).is_active)

    def test_a_phone_gets_one_accounts_notifications(self):
        DeviceToken.objects.create(user=self.mark, token=PHONE, is_active=True)
        self.client.force_authenticate(self.ann)
        self.client.post('/api/device-tokens/register/', {'token': PHONE, 'platform': 'android'}, format='json')
        self.assertFalse(DeviceToken.objects.get(user=self.mark).is_active)
        self.assertTrue(DeviceToken.objects.get(user=self.ann).is_active)

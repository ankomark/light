"""Sign-up username uniqueness (case-insensitive).

    python manage.py test songs.tests.test_signup_username --settings=music.settings_test
"""
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APITestCase
from unittest import mock

from songs.models import User

SIGNUP = '/api/auth/signup/'


class SignupUsernameTests(APITestCase):
    def setUp(self):
        cache.clear()  # the signup endpoint is throttled (scope 'auth')

    def _signup(self, username, email):
        # The view tries to send a verification email; stub it out.
        with mock.patch('songs.views.auth._send_verification_email'):
            return self.client.post(
                SIGNUP,
                {'username': username, 'email': email, 'password': 'sup3rSecret!'},
                format='json',
            )

    def test_first_signup_succeeds(self):
        res = self._signup('Otieno', 'otieno@example.com')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content)
        self.assertTrue(User.objects.filter(username='Otieno').exists())

    def test_exact_duplicate_is_rejected(self):
        self._signup('Otieno', 'a@example.com')
        res = self._signup('Otieno', 'b@example.com')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('already taken', res.json()['username'][0])
        self.assertEqual(User.objects.filter(username__iexact='otieno').count(), 1)

    def test_different_case_is_rejected(self):
        self._signup('Otieno', 'a@example.com')
        # "otieno" must be blocked because "Otieno" already reserves it.
        res = self._signup('otieno', 'c@example.com')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('already taken', res.json()['username'][0])
        self.assertEqual(User.objects.filter(username__iexact='otieno').count(), 1)

    def test_short_or_spaced_usernames_rejected(self):
        self.assertEqual(self._signup('ab', 'x@example.com').status_code, 400)
        self.assertEqual(self._signup('john doe', 'y@example.com').status_code, 400)

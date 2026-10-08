"""Signing in whatever the capitals (or with the email), one lock per
account, and new usernames that fit in links and @mentions.

    python manage.py test songs.tests.test_login_spelling --settings=music.settings_test
"""
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APITestCase

from songs.models import LoginAttempt, User
from songs.tests.test_security_centre import NO_ANON_THROTTLE, NO_THROTTLE


@NO_THROTTLE
@NO_ANON_THROTTLE
class LoginSpellingTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('otieno', 'Otieno@Mail.com', 'right-pass-123')

    def _login(self, username, password='right-pass-123'):
        return self.client.post('/api/auth/token/', {'username': username, 'password': password}, format='json',
                                REMOTE_ADDR='41.90.1.1')

    def test_capitals_from_the_keyboard_still_sign_in(self, *_):
        for typed in ('Otieno', 'OTIENO', ' otieno '):
            self.assertEqual(self._login(typed).status_code, 200, typed)

    def test_the_email_signs_in_too(self, *_):
        self.assertEqual(self._login('otieno@mail.com').status_code, 200)

    def test_a_wrong_password_is_still_wrong(self, *_):
        self.assertEqual(self._login('Otieno', 'nope').status_code, 401)

    @override_settings(SECURITY_BLOCKS=True)
    def test_cycling_capitals_counts_against_the_one_account(self, *_):
        from songs import security
        for i in range(security.ACCOUNT_FAILS):
            self._login(['otieno', 'Otieno', 'OTIENO'][i % 3], 'wrong')
        self.assertEqual(LoginAttempt.objects.filter(username='otieno').count(), security.ACCOUNT_FAILS)
        r = self._login('OTIENO')                      # even the right one: locked
        self.assertEqual(r.data.get('code'), 'account_locked')

    def test_an_unknown_name_is_left_as_typed(self, *_):
        self.assertEqual(self._login('nobody').status_code, 401)


class NewUsernameTests(APITestCase):
    def _signup(self, username):
        return self.client.post('/api/auth/signup/', {
            'username': username, 'email': f'{abs(hash(username))}@x.com', 'password': 'Zx9kLmq2-play',
        }, format='json')

    def test_names_that_fit_in_links_and_mentions(self):
        for good in ('mark', 'mary.w', 'john_3_16', 'Otieno99'):
            self.assertEqual(self._signup(good).status_code, 201, good)
        for bad in ('a/b', 'me@home', 'pastor😊', 'x' * 31, 'semi;colon'):
            self.assertEqual(self._signup(bad).status_code, 400, bad)

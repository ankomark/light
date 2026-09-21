"""Password hashing: the Argon2 switch must not lock anybody out.

Every password stored before this change is a PBKDF2 hash. If the switch to
Argon2 broke verification of those, every existing user would be unable to sign
in and the only recovery would be a mass password reset — so this is asserted,
not assumed.
"""
import time

from django.contrib.auth.hashers import check_password, make_password
from django.test import TestCase, override_settings
from rest_framework.test import APITestCase

from songs.models import User

PBKDF2_ONLY = ['django.contrib.auth.hashers.PBKDF2PasswordHasher']
PASSWORD = 'Sabbath!2026x'


class PasswordHashingTests(TestCase):
    def test_new_passwords_use_argon2id(self):
        encoded = make_password(PASSWORD)
        self.assertTrue(encoded.startswith('argon2$argon2id$'), encoded[:32])

    def test_a_legacy_pbkdf2_password_still_verifies(self):
        # Exactly what is sitting in the production users table today.
        with override_settings(PASSWORD_HASHERS=PBKDF2_ONLY):
            legacy = make_password(PASSWORD)
        self.assertTrue(legacy.startswith('pbkdf2_sha256$'))
        # Back under the real (Argon2-first) config, it must still verify.
        self.assertTrue(check_password(PASSWORD, legacy))
        self.assertFalse(check_password('not-the-password', legacy))

    def test_legacy_hash_is_upgraded_to_argon2_on_next_login(self):
        with override_settings(PASSWORD_HASHERS=PBKDF2_ONLY):
            legacy = make_password(PASSWORD)
        user = User.objects.create(username='oldtimer', email='old@x.com', password=legacy)
        self.assertTrue(user.password.startswith('pbkdf2_sha256$'))

        # check_password() on the *user* re-hashes with the preferred hasher.
        self.assertTrue(user.check_password(PASSWORD))
        user.refresh_from_db()
        self.assertTrue(
            user.password.startswith('argon2$argon2id$'),
            f'legacy hash was not upgraded: {user.password[:32]}',
        )
        # And the upgraded hash still authenticates.
        self.assertTrue(user.check_password(PASSWORD))


class LoginLatencyTests(APITestCase):
    """The reason for the switch. A regression here (someone putting PBKDF2 back
    at the top, or raising its iteration count) is invisible in every other test
    — it just makes signing in slow again."""

    def test_verifying_a_password_is_fast_enough_to_sign_in_with(self):
        encoded = make_password(PASSWORD)
        t = time.perf_counter()
        self.assertTrue(check_password(PASSWORD, encoded))
        ms = (time.perf_counter() - t) * 1000
        # Argon2 at Django's defaults measured ~190ms on a dev laptop; PBKDF2 at
        # 1,000,000 iterations measured ~2100ms. A generous ceiling that still
        # catches a revert to the old scheme.
        self.assertLess(
            ms, 900,
            f'password verification took {ms:.0f}ms — login latency is back',
        )

    def test_login_endpoint_returns_a_token(self):
        User.objects.create_user(
            username='grace', email='grace@x.com', password=PASSWORD,
            is_email_verified=True)
        res = self.client.post('/api/auth/token/',
                               {'username': 'grace', 'password': PASSWORD},
                               format='json')
        self.assertEqual(res.status_code, 200, res.content[:200])
        self.assertIn('access', res.json())
        self.assertIn('refresh', res.json())

"""Account-security endpoints behind the Settings screen: change password,
delete/deactivate account, data export, notification preferences, and
session revocation. These are the paths where a mistake leaks data or lets an
action through without the password gate.

    python manage.py test songs.tests.test_account_security --settings=music.settings_test
"""
from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from songs.models import User, SocialPost, NotificationPreference

STRONG_PW = 'Zx9kLmq2-playnew'


class ChangePasswordTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('cp_user', 'cp@x.com', 'oldpass123')
        self.client.force_authenticate(self.user)

    def test_wrong_current_password_rejected(self):
        r = self.client.post('/api/auth/change-password/',
                             {'current_password': 'nope', 'new_password': STRONG_PW}, format='json')
        self.assertEqual(r.status_code, 400, r.content[:200])
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('oldpass123'))  # unchanged

    def test_weak_new_password_rejected(self):
        r = self.client.post('/api/auth/change-password/',
                             {'current_password': 'oldpass123', 'new_password': '123'}, format='json')
        self.assertEqual(r.status_code, 400, r.content[:200])

    def test_successful_change(self):
        r = self.client.post('/api/auth/change-password/',
                             {'current_password': 'oldpass123', 'new_password': STRONG_PW}, format='json')
        self.assertEqual(r.status_code, 200, r.content[:200])
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(STRONG_PW))


class DeleteAndDeactivateTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('del_user', 'del@x.com', 'mypass123')
        self.client.force_authenticate(self.user)

    def test_delete_requires_correct_password(self):
        self.assertEqual(
            self.client.post('/api/auth/delete-account/', {'password': 'wrong'}, format='json').status_code, 400)
        self.assertTrue(User.objects.filter(id=self.user.id).exists())

    def test_delete_succeeds_with_password(self):
        r = self.client.post('/api/auth/delete-account/', {'password': 'mypass123'}, format='json')
        self.assertEqual(r.status_code, 204, r.content[:200])
        self.assertFalse(User.objects.filter(id=self.user.id).exists())

    def test_deactivate_requires_password_and_hides_account(self):
        self.assertEqual(
            self.client.post('/api/auth/deactivate/', {'password': 'wrong'}, format='json').status_code, 400)
        r = self.client.post('/api/auth/deactivate/', {'password': 'mypass123'}, format='json')
        self.assertEqual(r.status_code, 200, r.content[:200])
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_deactivated)


class ExportDataTests(APITestCase):
    def test_export_returns_only_own_data(self):
        me = User.objects.create_user('exp_me', 'expme@x.com', 'x')
        other = User.objects.create_user('exp_other', 'expo@x.com', 'x')
        SocialPost.objects.create(user=me, caption='mine')
        SocialPost.objects.create(user=other, caption='theirs')
        self.client.force_authenticate(me)
        body = self.client.get('/api/auth/export-data/').json()
        self.assertEqual(body['account']['username'], 'exp_me')
        captions = [p['caption'] for p in body['posts']]
        self.assertIn('mine', captions)
        self.assertNotIn('theirs', captions)


class NotificationPreferenceTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('np_user', 'np@x.com', 'x')
        self.other = User.objects.create_user('np_other', 'npo@x.com', 'x')
        self.client.force_authenticate(self.user)

    def test_get_creates_defaults(self):
        r = self.client.get('/api/notification-preferences/')
        self.assertEqual(r.status_code, 200)
        self.assertIn('likes', r.json())

    def test_patch_updates_and_is_scoped(self):
        r = self.client.patch('/api/notification-preferences/', {'likes': False}, format='json')
        self.assertEqual(r.status_code, 200, r.content[:200])
        self.assertFalse(r.json()['likes'])
        # The other user's prefs are untouched (row is per-user).
        self.assertFalse(NotificationPreference.objects.filter(user=self.other).exists())

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        self.assertIn(self.client.get('/api/notification-preferences/').status_code, (401, 403))


class RevokeOtherSessionsTests(APITestCase):
    def test_revokes_outstanding_tokens(self):
        try:
            from rest_framework_simplejwt.token_blacklist.models import OutstandingToken, BlacklistedToken
        except Exception:
            self.skipTest('token_blacklist app not installed')
        user = User.objects.create_user('rs_user', 'rs@x.com', 'x')
        now = timezone.now()
        for jti in ('a', 'b'):
            OutstandingToken.objects.create(
                user=user, jti=jti, token=f'tok-{jti}',
                created_at=now, expires_at=now + timedelta(days=1),
            )
        self.client.force_authenticate(user)
        r = self.client.post('/api/auth/sessions/revoke-others/', {}, format='json')
        self.assertEqual(r.status_code, 200, r.content[:200])
        self.assertEqual(r.json().get('revoked'), 2)
        self.assertEqual(BlacklistedToken.objects.count(), 2)

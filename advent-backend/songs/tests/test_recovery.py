"""Admin phase 6: getting an account back.

    python manage.py test songs.tests.test_recovery --settings=music.settings_test
"""
from unittest import mock

from django.core import mail
from django.core.cache import cache
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from songs.models import DeviceToken, PasswordResetCode, RecoveryCase, SecurityEvent, User

SYNC = mock.patch('songs.tasks.run_in_background', side_effect=lambda fn, *a, **k: fn(*a, **k))
NO_THROTTLE = mock.patch('rest_framework.throttling.ScopedRateThrottle.allow_request', return_value=True)


def make(name, **extra):
    return User.objects.create_user(name, f'{name}@x.com', 'right-pass-123', **extra)


@SYNC
@NO_THROTTLE
class NotMeTests(APITestCase):
    def test_this_wasnt_me_signs_everyone_else_out_and_tells_the_admins(self, *_):
        cache.clear()
        owner = make('owner')
        mine = RefreshToken.for_user(owner)
        RefreshToken.for_user(owner)                       # the intruder's session
        DeviceToken.objects.create(user=owner, token='ExponentPushToken[mine]')
        DeviceToken.objects.create(user=owner, token='ExponentPushToken[intruder]')
        self.client.force_authenticate(owner)
        r = self.client.post('/api/auth/not-me/', {'refresh': str(mine), 'device_token': 'ExponentPushToken[mine]'},
                             format='json')
        self.assertEqual((r.status_code, r.data['revoked'], r.data['next']), (200, 1, 'change_password'))
        self.assertEqual(list(DeviceToken.objects.filter(user=owner, is_active=True).values_list('token', flat=True)),
                         ['ExponentPushToken[mine]'])
        self.assertTrue(SecurityEvent.objects.filter(kind='account_takeover', user=owner).exists())


@SYNC
@NO_THROTTLE
class OwnerIsToldTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.owner = make('owner')

    def test_a_new_sign_in_is_emailed(self, *_):
        self.client.post('/api/auth/token/', {'username': 'owner', 'password': 'right-pass-123'}, format='json',
                         HTTP_X_DEVICE_NAME='Pixel 8')
        self.assertTrue(any('New sign-in' in m.subject and 'Pixel 8' in m.body for m in mail.outbox))

    def test_a_password_change_is_emailed(self, *_):
        self.client.force_authenticate(self.owner)
        self.client.post('/api/auth/change-password/', {'current_password': 'right-pass-123',
                                                         'new_password': 'Zx9kLmq2-playnew'}, format='json')
        self.assertTrue(any('password was changed' in m.subject for m in mail.outbox))


@SYNC
@NO_THROTTLE
class RecoveryCaseTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.owner = make('owner')
        self.boss = make('boss', admin_role='super_admin', is_superuser=True)

    def _ask(self, account='owner', **extra):
        self.client.force_authenticate(None)
        return self.client.post('/api/auth/recovery-request/', {
            'account': account, 'contact_email': 'new-home@x.com',
            'details': 'Someone changed my password and my email last night, I cannot get in.', **extra,
        }, format='json')

    def test_the_answer_never_says_whether_an_account_matched(self, *_):
        self.assertEqual(self._ask().data, self._ask('nobody-at-all').data)
        self.assertEqual(RecoveryCase.objects.count(), 2)
        self.assertEqual(RecoveryCase.objects.get(account='owner').user, self.owner)

    def test_too_little_to_go_on_is_refused(self, *_):
        self.assertEqual(self._ask(details='help').status_code, 400)
        self.assertEqual(self._ask(contact_email='not-an-email').status_code, 400)

    def test_an_admin_moves_the_account_and_sends_a_reset(self, *_):
        self._ask()
        case = RecoveryCase.objects.get()
        self.client.force_authenticate(self.boss)
        url = '/api/admin/security-centre/'
        rows = self.client.get(url + 'recovery/').data
        self.assertEqual(rows[0]['user']['username'], 'owner')
        r = self.client.post(url + 'change-email/', {'user_id': self.owner.pk, 'email': 'new-home@x.com',
                                                     'reason': 'identity confirmed'}, format='json')
        self.assertEqual(r.status_code, 200, r.content[:200])
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.email, 'new-home@x.com')
        told = {m.to[0] for m in mail.outbox}
        self.assertTrue({'owner@x.com', 'new-home@x.com'} <= told)
        self.assertEqual(self.client.post(url + 'send-reset/', {'user_id': self.owner.pk}, format='json').status_code,
                         200)
        self.assertTrue(PasswordResetCode.objects.filter(user=self.owner, used=False).exists())
        self.client.post(url + 'recovery-close/', {'id': case.pk, 'status': 'resolved', 'note': 'done'},
                         format='json')
        case.refresh_from_db()
        self.assertEqual((case.status, case.handled_by), ('resolved', self.boss))

    def test_an_email_already_taken_is_refused(self, *_):
        make('other')
        self.client.force_authenticate(self.boss)
        r = self.client.post('/api/admin/security-centre/change-email/', {
            'user_id': self.owner.pk, 'email': 'other@x.com', 'reason': 'recovery'}, format='json')
        self.assertEqual(r.status_code, 400)

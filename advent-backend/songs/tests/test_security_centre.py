"""Admin phase 5: the Security Centre — attacks seen and stopped.

    python manage.py test songs.tests.test_security_centre --settings=music.settings_test
"""
from unittest import mock

from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APITestCase

from songs import security
from songs.models import BlockedIP, LoginAttempt, SecurityEvent, User

# The login rate limit is not what these tests are about.
NO_THROTTLE = mock.patch('rest_framework.throttling.ScopedRateThrottle.allow_request', return_value=True)
NO_ANON_THROTTLE = mock.patch('rest_framework.throttling.AnonRateThrottle.allow_request', return_value=True)


def make(name, **extra):
    return User.objects.create_user(name, f'{name}@x.com', 'right-pass-123', **extra)


@NO_THROTTLE
@NO_ANON_THROTTLE
class SignInWatchTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.victim = make('victim')

    def _login(self, username, password='wrong', ip='41.0.0.9'):
        return self.client.post('/api/auth/token/', {'username': username, 'password': password},
                                format='json', REMOTE_ADDR=ip)

    def test_every_sign_in_is_written_down(self, *_):
        self._login('victim')
        self._login('victim', 'right-pass-123')
        self._login('nobody')
        outcomes = list(LoginAttempt.objects.order_by('id').values_list('outcome', flat=True))
        self.assertEqual(outcomes, ['bad_password', 'ok', 'unknown'])

    def test_password_guessing_locks_the_account(self, *_):
        for _ in range(security.ACCOUNT_FAILS):
            self._login('victim')
        r = self._login('victim', 'right-pass-123')
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data['code'], 'account_locked')
        event = SecurityEvent.objects.get(kind='password_guessing')
        self.assertEqual(event.user, self.victim)

    def test_one_address_trying_many_accounts_is_blocked(self, *_):
        names = [make(f'u{i}').username for i in range(security.IP_ACCOUNTS)]
        for i in range(security.IP_FAILS):
            self._login(names[i % len(names)], ip='41.6.6.6')
        self.assertTrue(BlockedIP.objects.filter(network='41.6.6.6/32', automatic=True).exists())
        self.assertTrue(SecurityEvent.objects.filter(kind='credential_stuffing', ip='41.6.6.6').exists())
        self.assertTrue(security.is_blocked('41.6.6.6'))

    def test_strict_lockdown_halves_the_limits(self, *_):
        security.set_lockdown({'strict': True}, None)
        for _ in range(security.ACCOUNT_FAILS // 2):
            self._login('victim')
        self.assertEqual(self._login('victim', 'right-pass-123').status_code, 403)

    def test_a_banned_persons_address_flags_a_new_account(self, *_):
        banned = make('banned')
        LoginAttempt.objects.create(username='banned', user=banned, ip='41.1.1.1', outcome='ok',
                                    device_name='Tecno Spark 10')
        User.objects.filter(pk=banned.pk).update(is_active=False)
        # Same address, another phone: a shared network, nothing to say.
        self.client.post('/api/signup/', {'username': 'other', 'email': 'o@x.com', 'password': 'Zx9kLmq2-play'},
                         format='json', REMOTE_ADDR='41.1.1.1', HTTP_X_DEVICE_NAME='iPhone 13')
        self.assertFalse(SecurityEvent.objects.filter(kind='ban_evasion').exists())
        # Same address and the same phone: flagged.
        self.client.post('/api/signup/', {'username': 'newface', 'email': 'nf@x.com', 'password': 'Zx9kLmq2-play'},
                         format='json', REMOTE_ADDR='41.1.1.1', HTTP_X_DEVICE_NAME='Tecno Spark 10')
        self.assertTrue(SecurityEvent.objects.filter(kind='ban_evasion', ip='41.1.1.1').exists())

    def test_a_network_many_people_share_is_not_blocked(self, *_):
        """A mobile network's one address (carrier NAT): many people sign in
        from it, and blocking it would shut them all out."""
        for i in range(security.SHARED_ACCOUNTS):
            self._login(make(f'ok{i}').username, 'right-pass-123', ip='41.50.0.1')
        cache.delete('security:shared:41.50.0.1')
        names = [make(f's{i}').username for i in range(security.IP_ACCOUNTS)]
        for i in range(security.IP_FAILS):
            self._login(names[i % len(names)], ip='41.50.0.1')
        self.assertFalse(BlockedIP.objects.exists())
        self.assertIn('many people share', SecurityEvent.objects.get(kind='credential_stuffing').detail)


@NO_THROTTLE
@NO_ANON_THROTTLE
class SignUpWatchTests(APITestCase):
    def setUp(self):
        cache.clear()

    def _signup(self, n, ip='41.2.2.2'):
        return self.client.post('/api/signup/', {'username': f'new{n}', 'email': f'new{n}@x.com',
                                                  'password': 'Zx9kLmq2-play'}, format='json', REMOTE_ADDR=ip)

    def test_a_burst_from_one_address_pauses_it(self, *_):
        for n in range(security.SIGNUPS_PER_IP):
            self.assertEqual(self._signup(n).status_code, 201, n)
        r = self._signup(99)
        self.assertEqual((r.status_code, r.data['code']), (403, 'signups_burst'))
        self.assertEqual(self._signup(100, ip='41.3.3.3').status_code, 201)   # others still can

    def test_an_admin_can_pause_all_sign_ups(self, *_):
        security.set_lockdown({'signups_paused': True}, None)
        self.assertEqual(self._signup(1).data['code'], 'signups_paused')


@override_settings(SECURITY_BLOCKS=True)
class BlockTests(APITestCase):
    def setUp(self):
        cache.clear()

    def test_a_blocked_range_is_refused_everything(self):
        security.block('41.9.0.0/16', 'attack')
        r = self.client.get('/api/app-status/', REMOTE_ADDR='41.9.4.4')
        self.assertEqual((r.status_code, r.json()['code']), (403, 'blocked'))
        self.assertEqual(self.client.get('/api/app-status/', REMOTE_ADDR='41.8.4.4').status_code, 200)


class CentreTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.boss = make('boss', admin_role='super_admin', is_superuser=True)
        self.member = make('member')
        self.client.force_authenticate(self.boss)

    def test_the_picture(self):
        LoginAttempt.objects.create(username='member', ip='41.0.0.1', outcome='bad_password')
        security.raise_event('password_guessing', 'test', ip='41.0.0.1', user=self.member)
        data = self.client.get('/api/admin/security-centre/').data
        self.assertEqual(data['day']['failed'], 1)
        self.assertEqual(data['events'][0]['kind'], 'password_guessing')
        self.assertEqual(data['top_failing_ips'][0]['ip'], '41.0.0.1')

    def test_block_and_unblock_with_guards(self):
        url = '/api/admin/security-centre/'
        self.assertEqual(self.client.post(url + 'block/', {'network': '41.0.0.0/8', 'reason': 'flood'},
                                          format='json').status_code, 400)          # too wide
        self.assertEqual(self.client.post(url + 'block/', {'network': '127.0.0.1', 'reason': 'flood'},
                                          format='json').status_code, 400)          # yourself
        r = self.client.post(url + 'block/', {'network': '41.4.0.0/24', 'reason': 'flood', 'hours': 2},
                             format='json')
        self.assertEqual(r.status_code, 201, r.content[:200])
        self.assertTrue(security.is_blocked('41.4.0.7'))
        self.client.post(url + 'unblock/', {'network': '41.4.0.0/24'}, format='json')
        self.assertFalse(security.is_blocked('41.4.0.7'))

    def test_force_reset_and_lock(self):
        url = '/api/admin/security-centre/'
        r = self.client.post(url + 'force-reset/', {'user_id': self.member.pk, 'reason': 'taken over'},
                             format='json')
        self.assertEqual(r.status_code, 200, r.content[:200])
        self.member.refresh_from_db()
        self.assertFalse(self.member.has_usable_password())
        self.client.post(url + 'lock-account/', {'user_id': self.member.pk, 'reason': 'guessing', 'hours': 2},
                         format='json')
        self.assertTrue(security.login_refusal('member'))
        self.client.post(url + 'unlock-account/', {'user_id': self.member.pk}, format='json')
        self.assertFalse(security.login_refusal('member'))

    def test_lockdown_and_resolve(self):
        url = '/api/admin/security-centre/'
        self.assertTrue(self.client.post(url + 'lockdown/', {'strict': True}, format='json').data['strict'])
        event = security.raise_event('signup_burst', 'x', ip='41.0.0.2')
        self.client.post(url + 'resolve/', {'id': event.pk}, format='json')
        event.refresh_from_db()
        self.assertIsNotNone(event.resolved_at)

    def test_only_with_the_power(self):
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.get('/api/admin/security-centre/').status_code, 403)


@NO_THROTTLE
@NO_ANON_THROTTLE
class GuardTests(APITestCase):
    def setUp(self):
        cache.clear()

    def _login(self, username, password='wrong', ip='41.0.0.9'):
        return self.client.post('/api/auth/token/', {'username': username, 'password': password},
                                format='json', REMOTE_ADDR=ip)

    def test_an_internal_address_is_never_blocked_by_the_rules(self, *_):
        """Behind a proxy that is not set up, every request is 127.0.0.1:
        blocking it would shut everyone out."""
        names = [make(f'p{i}').username for i in range(security.IP_ACCOUNTS)]
        for i in range(security.IP_FAILS):
            self._login(names[i % len(names)], ip='127.0.0.1')
        self.assertFalse(BlockedIP.objects.exists())
        self.assertIn('TRUSTED_PROXY_COUNT', SecurityEvent.objects.get(kind='credential_stuffing').detail)

    def test_the_owner_at_their_usual_address_is_not_locked_out(self, *_):
        make('owner')
        self._login('owner', 'right-pass-123', ip='41.1.1.1')        # their usual place
        for _ in range(security.ACCOUNT_FAILS):
            self._login('owner', ip='41.66.66.66')                    # someone guessing
        self.assertEqual(self._login('owner', 'right-pass-123', ip='41.66.66.66').status_code, 403)
        self.assertEqual(self._login('owner', 'right-pass-123', ip='41.1.1.1').status_code, 200)

    def test_an_admin_cannot_block_an_internal_address(self, *_):
        boss = make('boss', admin_role='super_admin', is_superuser=True)
        self.client.force_authenticate(boss)
        r = self.client.post('/api/admin/security-centre/block/', {'network': '192.168.1.0/24', 'reason': 'x'},
                             format='json')
        self.assertEqual((r.status_code, r.data['code']), (400, 'internal'))


class DashboardAttentionTests(APITestCase):
    def test_security_admins_see_what_needs_them(self):
        cache.clear()
        from songs.models import RecoveryCase, Role
        security.raise_event('password_guessing', 'x', ip='41.0.0.1', severity='high')
        RecoveryCase.objects.create(account='mark', contact_email='m@x.com', details='help me please now')
        boss = make('boss', admin_role='super_admin', is_superuser=True)
        self.client.force_authenticate(boss)
        attention = self.client.get('/api/admin/dashboard/').data['attention']
        self.assertEqual(attention, {'security_events': 1, 'security_high': 1, 'recovery': 1})
        mod = make('mod', role=Role.objects.create(name='Reports only', capabilities=['handle_reports']))
        self.client.force_authenticate(mod)
        self.assertIsNone(self.client.get('/api/admin/dashboard/').data['attention'])

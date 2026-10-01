"""Admin phase 1: locked down.

Two-step sign-in (an authenticator code opens a short admin session), a fresh
code for the dangerous actions, no admin acting on an equal or higher one,
removed or suspended admins cut off at once, Django's staff flag no door, and
an audit trail that shows any change to it.

    python manage.py test songs.tests.test_admin_security --settings=music.settings_test
"""
from datetime import timedelta

from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken

from songs import admin_security as sec
from songs.models import AdminActionLog, AdminSession, AdminTwoFactor, Role, User
from songs.views.admin import log_admin_action, verify_audit_chain


def make(name, **extra):
    return User.objects.create_user(name, f'{name}@x.com', 'pw', **extra)


@override_settings(ADMIN_2FA_REQUIRED=True)
class TwoStepTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.boss = make('boss', admin_role='super_admin')
        self.member = make('member')
        self.client.force_authenticate(self.boss)

    def enrol(self):
        secret = self.client.post('/api/admin/security/setup/').data['secret']
        res = self.client.post('/api/admin/security/confirm/', {'code': sec.code_for(secret)}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        return secret, res.data

    def test_no_admin_tool_opens_without_the_two_step_session(self):
        res = self.client.get('/api/admin/dashboard/')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data['code'], 'admin_session_required')

    def test_set_up_confirm_and_use(self):
        status_ = self.client.get('/api/admin/security/status/').data
        self.assertFalse(status_['two_factor_enabled'])
        secret, done = self.enrol()
        self.assertEqual(len(done['backup_codes']), 10)
        # The secret is not kept in the clear.
        stored = AdminTwoFactor.objects.get(user=self.boss).secret_encrypted
        self.assertNotIn(secret, stored)
        res = self.client.get('/api/admin/dashboard/', HTTP_X_ADMIN_SESSION=done['admin_session'])
        self.assertEqual(res.status_code, 200)
        # A made-up session is nothing.
        self.assertEqual(self.client.get('/api/admin/dashboard/', HTTP_X_ADMIN_SESSION='guess').status_code, 403)

    def test_a_code_works_once_and_a_wrong_one_not_at_all(self):
        secret, _ = self.enrol()
        res = self.client.post('/api/admin/security/verify/', {'code': '000000'}, format='json')
        self.assertEqual(res.status_code, 400)
        # The code just used to confirm cannot open another session.
        res = self.client.post('/api/admin/security/verify/', {'code': sec.code_for(secret)}, format='json')
        self.assertEqual(res.status_code, 400)
        later = sec.code_for(secret, at=timezone.now().timestamp() + 31)
        tf = AdminTwoFactor.objects.get(user=self.boss)
        self.assertIsNotNone(sec.check_code(sec.decrypt(tf.secret_encrypted), later, tf.last_step,
                                            at=timezone.now().timestamp() + 31))

    def test_a_backup_code_works_once(self):
        _, done = self.enrol()
        code = done['backup_codes'][0]
        self.assertEqual(self.client.post('/api/admin/security/verify/', {'backup_code': code},
                                          format='json').status_code, 200)
        self.assertEqual(self.client.post('/api/admin/security/verify/', {'backup_code': code},
                                          format='json').status_code, 400)

    def test_dangerous_actions_want_a_fresh_code(self):
        secret, done = self.enrol()
        token = done['admin_session']
        AdminSession.objects.update(verified_at=timezone.now() - timedelta(minutes=30))
        res = self.client.post(f'/api/admin/users/{self.member.id}/ban/', HTTP_X_ADMIN_SESSION=token)
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data['code'], 'reauth_required')
        # Everyday tools still open.
        self.assertEqual(self.client.get('/api/admin/users/', HTTP_X_ADMIN_SESSION=token).status_code, 200)
        later = timezone.now().timestamp() + 31
        tf = AdminTwoFactor.objects.get(user=self.boss)
        step = sec.check_code(secret, sec.code_for(secret, at=later), tf.last_step, at=later)
        self.assertIsNotNone(step)
        AdminSession.objects.update(verified_at=timezone.now())
        res = self.client.post(f'/api/admin/users/{self.member.id}/ban/', HTTP_X_ADMIN_SESSION=token)
        self.assertEqual(res.status_code, 200, res.data)

    def test_a_member_cannot_reach_even_the_two_step_doors(self):
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.get('/api/admin/security/status/').status_code, 403)
        self.assertEqual(self.client.post('/api/admin/security/setup/').status_code, 403)
        self.assertEqual(self.client.get('/api/admin/dashboard/').status_code, 403)

    def test_too_many_wrong_codes_are_stopped(self):
        self.enrol()
        codes = [self.client.post('/api/admin/security/verify/', {'code': '111111'}, format='json').status_code
                 for _ in range(12)]
        self.assertIn(429, codes)


class RankAndStandingTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.boss = make('boss', admin_role='super_admin')
        self.mod = make('mod', admin_role='moderator')
        self.mod2 = make('mod2', admin_role='moderator')
        self.helper_role = Role.objects.create(name='Helper', capabilities=['manage_users', 'ban_users'])
        self.helper = make('helper', role=self.helper_role)
        self.member = make('member')

    def act(self, actor, verb, target):
        self.client.force_authenticate(actor)
        return self.client.post(f'/api/admin/users/{target.id}/{verb}/', {'reason': 'test'}, format='json')

    def test_no_admin_acts_on_an_equal_or_higher_one(self):
        self.assertEqual(self.act(self.mod, 'ban', self.mod2).status_code, 403)
        self.assertEqual(self.act(self.helper, 'suspend', self.mod).status_code, 403)
        self.assertEqual(self.act(self.mod, 'warn', self.boss).status_code, 403)
        self.assertEqual(self.act(self.mod, 'unban', self.mod2).status_code, 403)
        # Downward is fine.
        self.assertEqual(self.act(self.mod, 'suspend', self.helper).status_code, 200)
        self.assertEqual(self.act(self.helper, 'warn', self.member).status_code, 200)

    def test_a_suspended_admin_has_no_admin_powers(self):
        self.act(self.boss, 'suspend', self.mod)
        self.mod.refresh_from_db()        # as each real request loads the account afresh
        self.client.force_authenticate(self.mod)
        self.assertEqual(self.client.get('/api/admin/users/').status_code, 403)

    def test_no_one_changes_their_own_role(self):
        self.client.force_authenticate(self.boss)
        res = self.client.post(f'/api/admin/users/{self.boss.id}/set_role/', {'role_id': self.helper_role.id},
                               format='json')
        self.assertEqual(res.status_code, 400)

    def test_only_a_super_admin_hands_out_roles(self):
        self.client.force_authenticate(self.mod)
        res = self.client.post(f'/api/admin/users/{self.member.id}/set_role/', {'super_admin': True}, format='json')
        self.assertEqual(res.status_code, 403)
        self.member.refresh_from_db()
        self.assertFalse(self.member.is_super_admin)


class RemovedAdminsTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.boss = make('boss', admin_role='super_admin')
        self.client.force_authenticate(self.boss)

    def test_removed_from_admins_means_no_way_back(self):
        old = make('old', admin_role='super_admin', is_superuser=True, is_staff=True)
        refresh = RefreshToken.for_user(old)
        token, _ = sec.open_session(old)
        res = self.client.post(f'/api/admin/users/{old.id}/set_role/', {'super_admin': False}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        old.refresh_from_db()
        # Every admin flag gone, Django's staff flag too.
        self.assertFalse(old.is_staff or old.is_superuser or old.is_platform_admin)
        # The admin session is over, and every device is signed out.
        self.assertTrue(AdminSession.objects.filter(user=old, revoked_at__isnull=False).exists())
        self.assertTrue(BlacklistedToken.objects.filter(token__jti=refresh['jti']).exists())
        # And nothing they could reach before opens now.
        self.client.force_authenticate(old)
        for url in ('/api/admin/dashboard/', '/api/admin/users/', '/api/admin/security/status/'):
            self.assertEqual(self.client.get(url, HTTP_X_ADMIN_SESSION=token).status_code, 403, url)
        self.assertEqual(self.client.post('/api/marketplace/categories/', {'name': 'X'}).status_code, 403)

    def test_a_role_emptied_cuts_its_holders_off(self):
        role = Role.objects.create(name='Mods', capabilities=['manage_users'])
        helper = make('helper', role=role)
        sec.open_session(helper)
        res = self.client.patch(f'/api/admin/roles/{role.id}/', {'capabilities': []}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertFalse(AdminSession.objects.filter(user=helper, revoked_at__isnull=True).exists())

    def test_the_staff_flag_alone_opens_nothing(self):
        staff = make('staffy', is_staff=True)
        self.client.force_authenticate(staff)
        self.assertEqual(self.client.post('/api/marketplace/categories/', {'name': 'X'}).status_code, 403)
        self.assertEqual(self.client.get('/api/admin/dashboard/').status_code, 403)


class AuditTrailTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.boss = make('boss', admin_role='super_admin')

    def test_the_trail_shows_an_edit_and_a_gap(self):
        for i in range(3):
            log_admin_action(self.boss, 'warn_user', 'user', i, reason=f'r{i}')
        self.assertEqual(verify_audit_chain()[:1], (True,))
        middle = AdminActionLog.objects.order_by('id')[1]
        AdminActionLog.objects.filter(pk=middle.pk).update(reason='quietly changed')
        ok, broken, _ = verify_audit_chain()
        self.assertFalse(ok)
        self.assertEqual(broken, middle.pk)
        AdminActionLog.objects.filter(pk=middle.pk).delete()
        self.assertFalse(verify_audit_chain()[0])

    def test_it_says_who_from_where(self):
        self.client.force_authenticate(self.boss)
        member = make('member')
        self.client.post(f'/api/admin/users/{member.id}/warn/', {'reason': 'spam'}, format='json',
                         HTTP_USER_AGENT='AdventistLife/1.0', REMOTE_ADDR='10.0.0.7')
        entry = AdminActionLog.objects.get(action='warn_user')
        self.assertEqual((entry.actor_name, entry.ip, entry.user_agent), ('boss', '10.0.0.7', 'AdventistLife/1.0'))
        res = self.client.get('/api/admin/logs/', {'actor': 'boss', 'target_id': member.id})
        self.assertEqual(res.data['count'], 1)
        self.assertTrue(self.client.get('/api/admin/logs/verify/').data['ok'])

    def test_bulk_takes_only_whole_numbers(self):
        self.client.force_authenticate(self.boss)
        for bad in (['1; drop'], [True], list(range(201)), 'x'):
            res = self.client.post('/api/admin/reports/bulk/', {'ids': bad, 'action': 'resolve'}, format='json')
            self.assertEqual(res.status_code, 400, bad)


class DjangoAdminSiteTests(APITestCase):
    def test_only_an_active_superuser(self):
        from django.contrib import admin
        from django.test import RequestFactory
        request = RequestFactory().get('/admin/')
        request.user = make('staffy', is_staff=True)
        self.assertFalse(admin.site.has_permission(request))
        request.user = make('root', is_staff=True, is_superuser=True)
        self.assertTrue(admin.site.has_permission(request))

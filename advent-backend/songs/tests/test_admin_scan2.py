"""Second admin scan: wrong codes lock the box, one code opens one session,
authors are told about takedowns, rank holds on content, appeals and reports
are decided once, signing out elsewhere ends admin sessions.

    python manage.py test songs.tests.test_admin_scan2 --settings=music.settings_test
"""
from unittest import mock

from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APITestCase

from songs import admin_security as sec
from songs.models import AdminSession, AdminTwoFactor, Appeal, Report, Role, SocialPost, User


def make(name, **extra):
    return User.objects.create_user(name, f'{name}@x.com', 'pw', **extra)


@override_settings(ADMIN_2FA_REQUIRED=True)
class CodeTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.boss = make('boss', admin_role='super_admin')
        self.secret = sec.new_secret()
        self.tf = AdminTwoFactor.objects.create(user=self.boss, secret_encrypted=sec.encrypt(self.secret))
        from django.utils import timezone
        self.tf.confirmed_at = timezone.now()
        self.tf.save()
        self.client.force_authenticate(self.boss)

    def test_wrong_codes_lock_the_box_and_tell_the_super_admins(self):
        with mock.patch('songs.admin_alerts.on_lockout') as told:
            for _ in range(sec.MAX_FAILURES - 1):
                self.assertEqual(self.client.post('/api/admin/security/verify/', {'code': '000000'}).status_code, 400)
            res = self.client.post('/api/admin/security/verify/', {'code': '000000'})
            self.assertEqual(res.status_code, 429)
            self.assertEqual(res.data['code'], 'locked')
            told.assert_called_once()
        # Even the right code waits now.
        res = self.client.post('/api/admin/security/verify/', {'code': sec.code_for(self.secret)})
        self.assertEqual(res.status_code, 429)

    def test_one_code_one_session(self):
        code = sec.code_for(self.secret)
        step = sec.check_code(self.secret, code)
        self.assertTrue(sec.claim_step(self.tf, step))
        self.assertFalse(sec.claim_step(self.tf, step))       # the same code, the same moment

    def test_a_backup_code_once(self):
        codes, hashes = sec.new_backup_codes()
        self.tf.backup_hashes = hashes
        self.tf.save()
        self.assertEqual(self.client.post('/api/admin/security/verify/', {'backup_code': codes[0]}).status_code, 200)
        self.assertEqual(self.client.post('/api/admin/security/verify/', {'backup_code': codes[0]}).status_code, 400)

    def test_signing_out_elsewhere_ends_admin_sessions(self):
        from songs.views.auth import _revoke_other_sessions
        sec.open_session(self.boss)
        _revoke_other_sessions(self.boss)
        self.assertFalse(AdminSession.objects.filter(user=self.boss, revoked_at__isnull=True).exists())


@override_settings(ADMIN_2FA_REQUIRED=False)
class ModerationTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.boss = make('boss', admin_role='super_admin')
        self.mod = make('mod', admin_role='moderator')
        self.member = make('member')
        self.post = SocialPost.objects.create(user=self.member, caption='buy now', content_type='text')
        self.boss_post = SocialPost.objects.create(user=self.boss, caption='notice', content_type='text')

    def test_the_author_is_told_why(self):
        self.client.force_authenticate(self.mod)
        with mock.patch('songs.views.admin.notify_moderation') as told:
            res = self.client.post('/api/admin/content/remove/', {'type': 'post', 'id': self.post.id, 'reason': 'spam'})
            self.assertEqual(res.status_code, 200)
            user, subject, message = told.call_args[0]
            self.assertEqual(user, self.member)
            self.assertIn('Reason: spam', message)
            self.client.post('/api/admin/content/restore/', {'type': 'post', 'id': self.post.id})
            self.assertEqual(told.call_args[0][1], 'Content restored')

    def test_rank_holds_on_content(self):
        self.client.force_authenticate(self.mod)
        res = self.client.post('/api/admin/content/remove/', {'type': 'post', 'id': self.boss_post.id, 'reason': 'spam'})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data['code'], 'rank')
        res = self.client.post('/api/admin/content/bulk/', {
            'type': 'post', 'ids': [self.post.id, self.boss_post.id], 'action': 'remove', 'reason': 'spam'}, format='json')
        self.assertEqual(res.data, {'updated': 1, 'skipped_rank': 1})
        self.boss_post.refresh_from_db()
        self.assertFalse(self.boss_post.is_removed)

    def test_appeal_and_report_decided_once(self):
        self.client.force_authenticate(self.boss)
        appeal = Appeal.objects.create(user=self.member, message='please')
        self.assertEqual(self.client.post(f'/api/admin/appeals/{appeal.id}/reject/').status_code, 200)
        res = self.client.post(f'/api/admin/appeals/{appeal.id}/approve/')
        self.assertEqual(res.status_code, 409)
        report = Report.objects.create(reporter=self.mod, content_type='post', object_id=self.post.id, reason='spam')
        self.assertEqual(self.client.post(f'/api/admin/reports/{report.id}/dismiss/').status_code, 200)
        self.assertEqual(self.client.post(f'/api/admin/reports/{report.id}/resolve/').status_code, 409)

    def test_staff_role_cannot_take_down_a_moderators_post(self):
        staff = make('staff', role=Role.objects.create(name='C', capabilities=['remove_content']))
        mod_post = SocialPost.objects.create(user=self.mod, caption='hi', content_type='text')
        self.client.force_authenticate(staff)
        res = self.client.post('/api/admin/content/remove/', {'type': 'post', 'id': mod_post.id, 'reason': 'spam'})
        self.assertEqual(res.status_code, 403)


class ClientIpTests(APITestCase):
    def test_forwarded_for_believed_only_from_our_proxies(self):
        from django.test import RequestFactory
        req = RequestFactory().get('/', HTTP_X_FORWARDED_FOR='6.6.6.6, 1.2.3.4', REMOTE_ADDR='10.0.0.1')
        with override_settings(TRUSTED_PROXY_COUNT=0):
            self.assertEqual(sec.client_ip(req), '10.0.0.1')
        with override_settings(TRUSTED_PROXY_COUNT=1):
            self.assertEqual(sec.client_ip(req), '1.2.3.4')

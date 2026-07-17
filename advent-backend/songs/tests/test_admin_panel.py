"""End-to-end coverage of the admin/moderation panel: every list endpoint
executes, the reports duplicate-count subquery runs, privilege boundaries hold,
and the user list doesn't N+1.

    python manage.py test songs.tests.test_admin_panel --settings=music.settings_test
"""
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from songs.models import User, Report, SocialPost


def _super_admin(username):
    u = User.objects.create_user(username, f'{username}@x.com', 'x')
    u.admin_role = 'super_admin'
    u.is_superuser = True
    u.is_staff = True
    u.save(update_fields=['admin_role', 'is_superuser', 'is_staff'])
    return u


def _moderator(username):
    u = User.objects.create_user(username, f'{username}@x.com', 'x')
    u.admin_role = 'moderator'
    u.save(update_fields=['admin_role'])
    return u


class AdminPanelSmokeTests(APITestCase):
    def setUp(self):
        self.boss = _super_admin('ap_boss')
        self.regular = User.objects.create_user('ap_reg', 'apr@x.com', 'x')
        self.client.force_authenticate(self.boss)

    def test_dashboard_ok(self):
        r = self.client.get('/api/admin/dashboard/')
        self.assertEqual(r.status_code, 200, r.content[:300])
        self.assertIn('totals', r.json())

    def test_reports_list_runs_with_duplicate_count(self):
        # Two different reporters flag the same content -> duplicate_count == 2.
        r1 = User.objects.create_user('ap_rep1', 'ar1@x.com', 'x')
        r2 = User.objects.create_user('ap_rep2', 'ar2@x.com', 'x')
        Report.objects.create(reporter=r1, content_type='post', object_id=99, reason='spam')
        Report.objects.create(reporter=r2, content_type='post', object_id=99, reason='spam')
        resp = self.client.get('/api/admin/reports/')
        self.assertEqual(resp.status_code, 200, resp.content[:300])
        rows = resp.json()['results']
        self.assertTrue(all(row['duplicate_count'] == 2 for row in rows))

    def test_users_and_content_lists_ok(self):
        self.assertEqual(self.client.get('/api/admin/users/').status_code, 200)
        self.assertEqual(self.client.get('/api/admin/content/?type=post').status_code, 200)
        self.assertEqual(self.client.get('/api/admin/logs/').status_code, 200)
        self.assertEqual(self.client.get('/api/admin/appeals/').status_code, 200)


class AdminPrivilegeTests(APITestCase):
    def setUp(self):
        self.boss = _super_admin('priv_boss')
        self.other_boss = _super_admin('priv_boss2')
        self.mod = _moderator('priv_mod')
        self.victim = User.objects.create_user('priv_victim', 'pv@x.com', 'x')

    def test_regular_user_suspend_works(self):
        self.client.force_authenticate(self.boss)
        r = self.client.post(f'/api/admin/users/{self.victim.id}/suspend/', {'reason': 'x'}, format='json')
        self.assertEqual(r.status_code, 200, r.content[:300])
        self.victim.refresh_from_db()
        self.assertTrue(self.victim.is_suspended)

    def test_cannot_suspend_super_admin(self):
        self.client.force_authenticate(self.mod)
        r = self.client.post(f'/api/admin/users/{self.other_boss.id}/suspend/', {}, format='json')
        self.assertEqual(r.status_code, 400, r.content[:300])
        self.other_boss.refresh_from_db()
        self.assertFalse(self.other_boss.is_suspended)

    def test_cannot_warn_super_admin(self):
        self.client.force_authenticate(self.mod)
        r = self.client.post(f'/api/admin/users/{self.other_boss.id}/warn/', {}, format='json')
        self.assertEqual(r.status_code, 400, r.content[:300])

    def test_moderator_cannot_set_role(self):
        # set_role is super-admin only.
        self.client.force_authenticate(self.mod)
        r = self.client.post(f'/api/admin/users/{self.victim.id}/set_role/', {'super_admin': True}, format='json')
        self.assertEqual(r.status_code, 403, r.content[:300])


class AdminReportTargetTests(APITestCase):
    """The reports list batches target previews (one query per content type),
    so its query count must not grow with the number of reports."""

    def setUp(self):
        self.boss = _super_admin('rt_boss')
        self.author = User.objects.create_user('rt_author', 'rta@x.com', 'x')
        self.client.force_authenticate(self.boss)

    def _report_on_post(self, i):
        post = SocialPost.objects.create(user=self.author, caption=f'bad {i}')
        reporter = User.objects.create_user(f'rt_rep{i}', f'rtr{i}@x.com', 'x')
        Report.objects.create(reporter=reporter, content_type='post', object_id=post.id, reason='spam')

    def _load(self):
        with CaptureQueriesContext(connection) as ctx:
            r = self.client.get('/api/admin/reports/')
            self.assertEqual(r.status_code, 200)
        return len(ctx.captured_queries), r.json()['results']

    def test_targets_batched_no_n_plus_1(self):
        self._report_on_post(0)
        self._report_on_post(1)
        few, _ = self._load()
        for i in range(2, 7):
            self._report_on_post(i)
        many, rows = self._load()
        self.assertEqual(few, many, f'report targets scale per-row: {few} -> {many}')
        # Previews are still populated (author + type) — batching didn't lose data.
        self.assertTrue(rows and all(r['target'] and r['target']['type'] == 'post' for r in rows))
        self.assertTrue(all(r['target']['author']['username'] == 'rt_author' for r in rows))


class AdminUserListQueryTests(APITestCase):
    """The user-management list must not run COUNT queries per row."""

    def setUp(self):
        self.boss = _super_admin('q_boss')
        self.client.force_authenticate(self.boss)

    def _user_with_activity(self, i):
        u = User.objects.create_user(f'q_u{i}', f'qu{i}@x.com', 'x')
        SocialPost.objects.create(user=u, caption=f'p{i}')
        follower = User.objects.create_user(f'q_f{i}', f'qf{i}@x.com', 'x')
        u.followers.add(follower)  # followers is a self-M2M on User
        return u

    def test_user_list_query_count_is_constant(self):
        def load_count():
            with CaptureQueriesContext(connection) as ctx:
                r = self.client.get('/api/admin/users/')
                self.assertEqual(r.status_code, 200)
            return len(ctx.captured_queries)

        for i in range(2):
            self._user_with_activity(i)
        few = load_count()
        for i in range(2, 7):
            self._user_with_activity(i)
        many = load_count()
        self.assertEqual(few, many, f'admin user list scales per-row: {few} -> {many}')

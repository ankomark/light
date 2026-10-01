"""Admin phase 5: the admin lists cost the same number of queries for 5 rows
as for 25 (no per-row lookups), so a growing community does not slow them.

    python manage.py test songs.tests.test_admin_load --settings=music.settings_test
"""
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from songs.models import BankQuestion, Report, SocialPost, Track, User
from songs.views.admin import log_admin_action


class FlatListTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.boss = User.objects.create_user('boss', 'b@x.com', 'pw', admin_role='super_admin')
        self.client.force_authenticate(self.boss)
        self.n = 0

    def grow(self, count):
        for _ in range(count):
            self.n += 1
            u = User.objects.create_user(f'u{self.n}', f'u{self.n}@x.com', 'pw', strikes=1)
            post = SocialPost.objects.create(user=u, caption=f'post {self.n}', content_type='text')
            Report.objects.create(reporter=self.boss, content_type='post', object_id=post.id, reason='spam')
            Track.objects.create(artist=u, title=f't{self.n}', audio_file='https://x/a.mp3')
            log_admin_action(self.boss, 'warn_user', 'user', u.id, reason='x')
            BankQuestion.objects.create(kind='fact', difficulty='simple', prompt=f'q{self.n}',
                                        choices=['a', 'b'], answer_index=0)

    def queries(self, url, params=None):
        with CaptureQueriesContext(connection) as ctx:
            res = self.client.get(url, params or {})
        self.assertEqual(res.status_code, 200, (url, getattr(res, 'data', None)))
        return len(ctx)

    def assert_flat(self, url, params=None):
        # Each measured cold: the dashboard's shared counts are cached.
        self.grow(5)
        cache.clear()
        few = self.queries(url, params)
        self.grow(20)
        cache.clear()
        many = self.queries(url, params)
        self.assertEqual(few, many, f'{url}: {few} queries for 5 rows, {many} for 25')

    def test_users(self):
        self.assert_flat('/api/admin/users/')

    def test_reports_most_reported_first(self):
        self.assert_flat('/api/admin/reports/', {'order': 'priority'})

    def test_content(self):
        self.assert_flat('/api/admin/content/', {'type': 'post'})

    def test_audit_log(self):
        self.assert_flat('/api/admin/logs/')

    def test_verify_artists(self):
        self.assert_flat('/api/admin/verify/', {'kind': 'artist'})

    def test_quiz_bank(self):
        self.assert_flat('/api/admin/quiz-bank/')

    def test_dashboard(self):
        self.assert_flat('/api/admin/dashboard/')

    def test_dashboard_counts_are_shared_a_moment(self):
        self.grow(5)
        cache.clear()
        cold = self.queries('/api/admin/dashboard/')
        warm = self.queries('/api/admin/dashboard/')
        self.assertLess(warm, cold)

"""Admin phase 3: reporting everywhere, and the community's reports hiding
something before a moderator gets to it.

    python manage.py test songs.tests.test_reporting --settings=music.settings_test
"""
from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from songs.models import AdminActionLog, Report, SocialPost, User
from songs.reporting import AUTO_HIDE_AT, AUTO_HIDE_URGENT_AT


def make(name, days_old=30, **extra):
    user = User.objects.create_user(name, f'{name}@x.com', 'pw', **extra)
    User.objects.filter(pk=user.pk).update(date_joined=timezone.now() - timedelta(days=days_old))
    user.refresh_from_db()
    return user


@mock.patch('rest_framework.throttling.ScopedRateThrottle.allow_request', return_value=True)
class ReportTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.author = make('author')
        self.post = SocialPost.objects.create(user=self.author, content_type='image', caption='x')

    def _report(self, who, reason='spam', **body):
        self.client.force_authenticate(who)
        return self.client.post('/api/reports/', {'content_type': 'post', 'object_id': self.post.pk,
                                                  'reason': reason, **body}, format='json')

    def test_bad_reports_are_refused_cleanly(self, _t):
        me = make('me')
        self.client.force_authenticate(me)
        for body, code in (
            ({'content_type': 'post', 'object_id': 'abc', 'reason': 'spam'}, 400),
            ({'content_type': 'post', 'object_id': self.post.pk, 'reason': 'boring'}, 400),
            ({'content_type': 'post', 'object_id': 99999, 'reason': 'spam'}, 404),
            ({'content_type': 'user', 'object_id': me.pk, 'reason': 'spam'}, 400),
        ):
            self.assertEqual(self.client.post('/api/reports/', body, format='json').status_code, code, body)

    def test_the_new_reasons_and_kinds_are_taken(self, _t):
        self.assertEqual(self._report(make('r1'), 'harassment').status_code, 201)
        from songs.models import LiveBroadcast
        live = LiveBroadcast.objects.create(host=self.author, title='Live')
        self.client.force_authenticate(make('r2'))
        r = self.client.post('/api/reports/', {'content_type': 'livebroadcast', 'object_id': live.pk,
                                               'reason': 'violence'}, format='json')
        self.assertEqual(r.status_code, 201, r.content[:200])

    def test_enough_established_reports_hide_it_pending_review(self, _t):
        for n in range(AUTO_HIDE_AT - 1):
            self._report(make(f'r{n}'))
        self.post.refresh_from_db()
        self.assertFalse(self.post.is_removed)
        self._report(make('last'))
        self.post.refresh_from_db()
        self.assertTrue(self.post.is_removed)
        # Still in the queue admins work from, with the post already hidden.
        self.assertEqual(Report.objects.filter(object_id=self.post.pk, status='pending').count(), AUTO_HIDE_AT)
        self.assertTrue(AdminActionLog.objects.filter(action='auto_hide_post').exists())

    def test_fewer_reports_hide_it_when_urgent(self, _t):
        for n in range(AUTO_HIDE_URGENT_AT):
            self._report(make(f'u{n}'), 'child_safety')
        self.post.refresh_from_db()
        self.assertTrue(self.post.is_removed)

    def test_new_accounts_cannot_take_someone_down(self, _t):
        for n in range(AUTO_HIDE_AT + 2):
            self._report(make(f'fresh{n}', days_old=0))
        self.post.refresh_from_db()
        self.assertFalse(self.post.is_removed)

    def test_an_admins_post_is_never_auto_hidden(self, _t):
        boss = make('boss', admin_role='super_admin', is_superuser=True)
        self.post = SocialPost.objects.create(user=boss, content_type='image', caption='x')
        for n in range(AUTO_HIDE_AT + 1):
            self._report(make(f'a{n}'))
        self.post.refresh_from_db()
        self.assertFalse(self.post.is_removed)


class QueueOrderTests(APITestCase):
    def test_urgent_reports_come_first(self):
        cache.clear()
        boss = make('boss', admin_role='super_admin', is_superuser=True)
        author = make('author')
        posts = [SocialPost.objects.create(user=author, content_type='image', caption=str(i)) for i in range(2)]
        Report.objects.create(reporter=make('a'), content_type='post', object_id=posts[0].pk, reason='spam')
        Report.objects.create(reporter=make('b'), content_type='post', object_id=posts[0].pk, reason='spam')
        Report.objects.create(reporter=make('c'), content_type='post', object_id=posts[1].pk, reason='self_harm')
        self.client.force_authenticate(boss)
        rows = self.client.get('/api/admin/reports/?status=pending&order=priority').data['results']
        self.assertEqual(rows[0]['reason'], 'self_harm')

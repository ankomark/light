"""Admin phase 7: the Monitor.

    python manage.py test songs.tests.test_monitor --settings=music.settings_test
"""
from io import StringIO

from django.core.cache import cache
from django.core.management import call_command
from rest_framework.test import APITestCase

from songs import monitor
from songs.models import Job, User


class CountingTests(APITestCase):
    def setUp(self):
        cache.clear()

    def test_routes_not_objects(self):
        self.assertEqual(monitor.endpoint_of('/api/groups/12/posts/9/'), '/api/groups/{id}/posts/{id}/')

    def test_requests_are_counted_by_the_minute(self):
        self.client.get('/api/app-status/')
        self.client.get('/api/app-status/')
        self.client.get('/api/no-such-thing/')
        now = monitor.minutes()[-1]
        self.assertEqual(now['requests'], 3)
        self.assertEqual(now['refused'], 1)

    def test_the_slow_and_the_failing(self):
        for _ in range(3):
            monitor.record_request('/api/feed/1/', 200, 900)
            monitor.record_request('/api/quick/', 200, 5)
            monitor.record_request('/api/broken/', 500, 50)
        slow, failing = monitor.endpoints()
        self.assertEqual(slow[0]['endpoint'], '/api/feed/{id}/')
        self.assertEqual(failing[0]['endpoint'], '/api/broken/')


class MonitorViewTests(APITestCase):
    def test_the_picture_and_who_may_see_it(self):
        cache.clear()
        boss = User.objects.create_user('boss', 'b@x.com', 'pw', admin_role='super_admin', is_superuser=True)
        self.client.force_authenticate(boss)
        before = self.client.get('/api/admin/monitor/').data['health']['jobs']['queued']
        Job.objects.create(kind='x', status=Job.QUEUED)
        data = self.client.get('/api/admin/monitor/').data
        self.assertTrue(data['health']['database']['ok'])
        self.assertTrue(data['health']['cache']['ok'])
        self.assertEqual(data['health']['jobs']['queued'], before + 1)
        self.assertEqual(len(data['minutes']), monitor.MINUTES)
        self.client.force_authenticate(User.objects.create_user('member', 'm@x.com', 'pw'))
        self.assertEqual(self.client.get('/api/admin/monitor/').status_code, 403)

    def test_the_morning_note(self):
        out = StringIO()
        call_command('admin_daily_summary', '--print', stdout=out)
        self.assertIn('Yesterday:', out.getvalue())

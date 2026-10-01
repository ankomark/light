"""The Pulse dashboard's numbers (/api/admin/pulse/).

    python manage.py test songs.tests.test_admin_pulse --settings=music.settings_test
"""
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from songs.models import Appeal, Report, Role, SocialPost, User


def make(name, **extra):
    return User.objects.create_user(name, f'{name}@x.com', 'pw', **extra)


class PulseTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.boss = make('boss', admin_role='super_admin')
        self.a, self.b = make('anna'), make('ben')

    def test_the_numbers(self):
        now = timezone.now()
        User.objects.filter(pk=self.a.pk).update(last_seen_at=now)
        User.objects.filter(pk=self.b.pk).update(last_seen_at=now - timedelta(days=2))
        self.a.followers.add(self.b, self.boss)
        post = SocialPost.objects.create(user=self.a, caption='hello', content_type='text')
        quick = Report.objects.create(reporter=self.b, content_type='post', object_id=post.id, reason='spam',
                                      status='resolved', resolved_at=now)
        slow = Report.objects.create(reporter=self.boss, content_type='post', object_id=post.id, reason='spam',
                                     status='resolved')
        Report.objects.filter(pk=slow.pk).update(created_at=now - timedelta(days=3), resolved_at=now)
        Report.objects.create(reporter=self.a, content_type='post', object_id=post.id + 1, reason='hate')
        Appeal.objects.create(user=self.b, message='please', status='approved')
        Appeal.objects.create(user=self.a, message='please')
        assert quick

        self.client.force_authenticate(self.boss)
        res = self.client.get('/api/admin/pulse/', {'days': 7})
        self.assertEqual(res.status_code, 200, res.data)
        d = res.data
        self.assertEqual(len(d['dates']), 7)
        self.assertEqual(d['online_now'], 1)
        self.assertEqual(d['rings']['active'], {'pct': 67, 'value': 2, 'of': 3})
        self.assertEqual(d['rings']['reports']['value'], 2)
        self.assertEqual(d['rings']['reports']['fast'], 1)
        self.assertEqual(d['rings']['reports']['pct'], 50)
        self.assertEqual(d['rings']['reports']['open'], 1)
        self.assertEqual(d['rings']['appeals'], {'pct': 50, 'value': 1, 'waiting': 1})
        self.assertEqual(d['rings']['two_factor'], {'pct': 0, 'value': 0, 'of': 1})
        self.assertEqual([r['reason'] for r in d['reasons']], ['spam', 'hate'])
        self.assertEqual(sum(d['hours']), 1)
        self.assertEqual(len(d['hours']), 24)
        self.assertEqual(d['mix']['posts'], 1)
        self.assertEqual(d['top'][0]['username'], 'anna')
        self.assertEqual(d['top'][0]['followers'], 2)
        self.assertEqual(sum(d['trend']['signups']), 3)

    def test_only_with_view_analytics(self):
        self.client.force_authenticate(self.a)
        self.assertEqual(self.client.get('/api/admin/pulse/').status_code, 403)
        narrow = make('narrow', role=Role.objects.create(name='W', capabilities=['manage_wallpapers']))
        self.client.force_authenticate(narrow)
        self.assertEqual(self.client.get('/api/admin/pulse/').status_code, 403)
        analyst = make('analyst', role=Role.objects.create(name='A', capabilities=['view_analytics']))
        self.client.force_authenticate(analyst)
        self.assertEqual(self.client.get('/api/admin/pulse/').status_code, 200)

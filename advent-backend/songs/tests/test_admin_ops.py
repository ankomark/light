"""Admin phase 4: maintenance and the app's switches, broadcasts, a user's
history, the priority report queue, insights, and alerts to super admins.

    python manage.py test songs.tests.test_admin_ops --settings=music.settings_test
"""
from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from songs.models import AdminActionLog, Broadcast, Product, Report, Role, SocialPost, User


def make(name, **extra):
    return User.objects.create_user(name, f'{name}@x.com', 'pw', **extra)


class AppSwitchTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.boss = make('boss', admin_role='super_admin')
        self.member = make('member')

    @override_settings(MAINTENANCE_CHECK=True)
    def test_maintenance_stops_members_not_admins(self):
        self.client.force_authenticate(self.boss)
        res = self.client.patch('/api/admin/app-settings/', {'maintenance': {'on': True, 'message': 'Back at 6'}},
                                format='json')
        self.assertEqual(res.status_code, 200, res.data)
        # Anyone can see it, signed in or not.
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/app-status/').data['maintenance'], {'on': True, 'message': 'Back at 6'})
        # A member's requests wait; an admin's go through.
        member = self.client.get('/api/marketplace/products/', HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.member)}')
        self.assertEqual(member.status_code, 503)
        self.assertEqual(member.json()['code'], 'maintenance')
        admin = self.client.get('/api/marketplace/products/', HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.boss)}')
        self.assertEqual(admin.status_code, 200)
        self.assertTrue(AdminActionLog.objects.filter(action='maintenance_on').exists())

    def test_parts_of_the_app_switched_off(self):
        self.client.force_authenticate(self.boss)
        self.client.patch('/api/admin/app-settings/', {'features': {'marketplace': False}}, format='json')
        features = self.client.get('/api/app-status/').data['features']
        self.assertEqual((features['marketplace'], features['quiz']), (False, True))
        self.assertEqual(self.client.patch('/api/admin/app-settings/', {'features': {'nonsense': False}},
                                           format='json').status_code, 400)

    def test_only_with_the_capability(self):
        self.client.force_authenticate(make('mod', role=Role.objects.create(name='M', capabilities=['manage_users'])))
        self.assertEqual(self.client.patch('/api/admin/app-settings/', {'maintenance': {'on': True}},
                                           format='json').status_code, 403)


@mock.patch('songs.push.notify_many', return_value=0)
class BroadcastTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.sender = make('sender', role=Role.objects.create(name='B', capabilities=['broadcast']))
        self.client.force_authenticate(self.sender)
        self.seller = make('ivy')
        Product.objects.create(seller=self.seller, title='Hymnal', description='d', price=Decimal('5'), quantity=1)

    def test_preview_send_and_once_per_half_hour(self, notify):
        self.assertEqual(self.client.post('/api/admin/broadcasts/preview/', {'audience': 'sellers'},
                                          format='json').data['recipients'], 1)
        res = self.client.post('/api/admin/broadcasts/', {'title': 'Market day', 'message': 'Sellers, list your goods!',
                                                         'audience': 'sellers'}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        ids, kind, message = notify.call_args[0][:3]
        self.assertEqual((ids, kind), ([self.seller.id], 'notice'))
        self.assertEqual(notify.call_args[1]['title'], 'Market day')
        res = self.client.post('/api/admin/broadcasts/', {'title': 'Again', 'message': 'Another one now',
                                                         'audience': 'all'}, format='json')
        self.assertEqual(res.status_code, 429)
        self.assertEqual(Broadcast.objects.count(), 1)

    def test_nothing_empty_goes(self, notify):
        res = self.client.post('/api/admin/broadcasts/', {'title': '', 'message': 'x', 'audience': 'all'}, format='json')
        self.assertEqual(res.status_code, 400)
        notify.assert_not_called()


class HistoryAndQueueTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.boss = make('boss', admin_role='super_admin')
        self.client.force_authenticate(self.boss)
        self.troll = make('troll', strikes=2)
        self.post = SocialPost.objects.create(user=self.troll, caption='buy now', content_type='text')
        self.other = SocialPost.objects.create(user=make('nice'), caption='hello', content_type='text')
        for i in range(3):
            Report.objects.create(reporter=make(f'r{i}'), content_type='post', object_id=self.post.id, reason='spam')
        Report.objects.create(reporter=make('r9'), content_type='post', object_id=self.other.id, reason='other')

    def test_a_users_history(self):
        self.client.post(f'/api/admin/users/{self.troll.id}/warn/', {'reason': 'spam'}, format='json')
        res = self.client.get(f'/api/admin/users/{self.troll.id}/history/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['reports_against']['total'], 3)
        self.assertEqual(res.data['strikes'], 3)
        self.assertEqual(res.data['admin_actions'][0]['action'], 'warn_user')

    def test_most_reported_first_and_repeat_offenders_marked(self):
        res = self.client.get('/api/admin/reports/', {'order': 'priority', 'status': 'pending'})
        first = res.data['results'][0]
        self.assertEqual((first['object_id'], first['duplicate_count']), (self.post.id, 3))
        self.assertEqual(first['author_strikes'], 2)

    def test_insights_and_the_csv(self):
        res = self.client.get('/api/admin/insights/', {'days': 7})
        self.assertEqual(len(res.data['dates']), 7)
        self.assertIn('orders', res.data['series'])
        csv = self.client.get('/api/admin/insights/', {'days': 7, 'export': 'csv'})
        self.assertEqual(csv['Content-Type'], 'text/csv')
        self.assertTrue(csv.content.decode().startswith('date,signups,posts,orders'))


@mock.patch('songs.push.notify_many', return_value=0)
class AlertTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.boss = make('boss', admin_role='super_admin')
        self.other_boss = make('boss2', admin_role='super_admin')

    def test_a_burst_of_reports_is_told_once(self, notify):
        post = SocialPost.objects.create(user=make('x'), caption='c', content_type='text')
        for i in range(7):
            Report.objects.create(reporter=make(f'r{i}'), content_type='post', object_id=post.id, reason='spam')
        alerts = [c for c in notify.call_args_list if c[1].get('title') == 'Admin alert']
        self.assertEqual(len(alerts), 1)
        self.assertEqual(sorted(alerts[0][0][0]), sorted([self.boss.id, self.other_boss.id]))

    def test_many_bans_by_one_admin_are_told_to_the_others(self, notify):
        from songs.views.admin import log_admin_action
        from songs.admin_alerts import on_ban
        for i in range(10):
            log_admin_action(self.boss, 'ban_user', 'user', i)
        on_ban(self.boss)
        alert = [c for c in notify.call_args_list if c[1].get('title') == 'Admin alert'][0]
        self.assertEqual(alert[0][0], [self.other_boss.id])

    def test_a_new_device_is_told(self, notify):
        from songs import admin_security as sec
        from songs.admin_alerts import on_admin_sign_in
        sec.open_session(self.boss)
        on_admin_sign_in(self.boss, None, '')
        self.assertTrue(any(c[1].get('title') == 'Admin alert' for c in notify.call_args_list))

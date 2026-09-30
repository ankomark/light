"""Settings: quiet hours, the devices list, the fuller data export, and the
test notification.

    python manage.py test songs.tests.test_settings_upgrade
"""
from datetime import datetime, timezone as dt_tz
from decimal import Decimal
from unittest import mock

from django.core.cache import cache
from rest_framework.test import APITestCase

from songs.models import DeviceToken, NotificationPreference, Order, OrderItem, Product, User
from songs.push import notify_many, notify_user, quiet_now


def at(hour, minute=0):
    return datetime(2026, 9, 30, hour, minute, tzinfo=dt_tz.utc)


class QuietHoursTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw')
        DeviceToken.objects.create(user=self.user, token='ExponentPushToken[x]', is_active=True)
        # 22:00–07:00 on a UTC+3 clock.
        self.prefs = NotificationPreference.objects.create(
            user=self.user, quiet_from=22 * 60, quiet_to=7 * 60, utc_offset=180)

    def test_the_window_is_on_their_clock_and_crosses_midnight(self):
        self.assertTrue(quiet_now(self.prefs, at(19, 30)))    # 22:30 there
        self.assertTrue(quiet_now(self.prefs, at(2)))         # 05:00 there
        self.assertFalse(quiet_now(self.prefs, at(4)))        # 07:00 there
        self.assertFalse(quiet_now(self.prefs, at(12)))
        self.assertFalse(quiet_now(NotificationPreference(quiet_from=None, quiet_to=None), at(1)))

    @mock.patch('songs.tasks.run_in_background')
    @mock.patch('django.utils.timezone.now', return_value=at(20))     # 23:00 there
    def test_what_can_be_switched_off_waits_but_security_does_not(self, _now, run):
        notify_user(self.user, 'like', 'Someone liked your post')
        run.assert_not_called()
        notify_user(self.user, 'security', 'New sign-in')
        run.assert_called_once()

    @mock.patch('songs.tasks.run_in_background')
    @mock.patch('django.utils.timezone.now', return_value=at(20))
    def test_group_sends_leave_out_the_quiet(self, _now, run):
        other = User.objects.create_user('ivy', 'i@x.com', 'pw')
        DeviceToken.objects.create(user=other, token='ExponentPushToken[y]', is_active=True)
        sent = notify_many([self.user.id, other.id], 'group_mention', 'Hello')
        self.assertEqual(sent, 1)

    def test_the_times_are_checked(self):
        self.client.force_authenticate(self.user)
        res = self.client.patch('/api/notification-preferences/', {'quiet_from': 2000}, format='json')
        self.assertEqual(res.status_code, 400)
        res = self.client.patch('/api/notification-preferences/',
                                {'quiet_from': 21 * 60, 'quiet_to': 6 * 60, 'utc_offset': 60}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['quiet_from'], 1260)


class DevicesAndDataTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!x')

    def test_the_devices_list_is_mine_and_leaves_out_signed_out_ones(self):
        from rest_framework_simplejwt.tokens import RefreshToken
        from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
        other = User.objects.create_user('ivy', 'i@x.com', 'pw')
        RefreshToken.for_user(other)
        keep = RefreshToken.for_user(self.user)
        gone = RefreshToken.for_user(self.user)
        gone.blacklist()
        self.client.force_authenticate(self.user)
        res = self.client.get('/api/auth/sessions/', {'refresh': str(keep)})
        self.assertEqual(res.data['count'], 1)
        self.assertTrue(res.data['sessions'][0]['current'])
        self.assertEqual(OutstandingToken.objects.count(), 3)

    def test_the_export_includes_the_marketplace_and_games(self):
        seller = User.objects.create_user('sella', 's@x.com', 'pw')
        p = Product.objects.create(seller=self.user, title='My hymnal', description='d',
                                   price=Decimal('5'), quantity=1)
        order = Order.objects.create(buyer=self.user, total_amount=Decimal('9'))
        OrderItem.objects.create(order=order, product=None, quantity=1, price_at_purchase=Decimal('9'),
                                 seller=seller, title='A guitar', currency='KES')
        self.client.force_authenticate(self.user)
        res = self.client.get('/api/auth/export-data/')
        self.assertEqual(res.data['orders'][0]['items'][0]['title'], 'A guitar')
        self.assertEqual(res.data['products'][0]['title'], p.title)
        self.assertIn('coins', res.data['games'])

    @mock.patch('songs.push.notify_user')
    def test_a_test_notification(self, notify):
        self.client.force_authenticate(self.user)
        res = self.client.post('/api/auth/test-push/')
        self.assertEqual(res.data, {'devices': 0, 'code': 'no_devices'})
        DeviceToken.objects.create(user=self.user, token='ExponentPushToken[z]', is_active=True)
        res = self.client.post('/api/auth/test-push/')
        self.assertEqual(res.data['devices'], 1)
        notify.assert_called_once()
        self.assertEqual(self.client.post('/api/auth/test-push/').status_code, 429)

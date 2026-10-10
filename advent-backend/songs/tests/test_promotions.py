"""Paid promotions (songs/promotions.py): bought as a package, paid by M-Pesa
through the ticketing server, reviewed by an admin, shown in the feed marked
sponsored, counted once a day per person, finished when delivered or due."""
from datetime import timedelta
from unittest import mock

from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from songs.models import Profile, Promotion, PromotionPackage, Role, SocialPost, User
from songs import promotions as promo

KEY = 'k' * 40


def ticketing(status_='pending', **extra):
    """A stand-in for ticketing_staff.call answering payments/."""
    def call(user, method, path, *, params=None, body=None):
        return {'reference': (body or {}).get('reference') or path.split('/')[1], 'status': status_,
                'amount': 500, 'mpesa_receipt': 'TJK1' if status_ == 'paid' else None,
                'result_desc': extra.get('desc', '')}
    return call


@override_settings(TICKETING_SERVICE_KEY=KEY, TICKETING_API_URL='https://tickets.test')
class PromotionTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user('owner', 'o@x.com', 'x')
        self.viewer = User.objects.create_user('viewer', 'v@x.com', 'x')
        self.admin = User.objects.create_user('boss', 'b@x.com', 'x')
        self.admin.admin_role = 'super_admin'
        self.admin.save(update_fields=['admin_role'])
        self.post = SocialPost.objects.create(user=self.owner, content_type='image', media_file='https://m/1.jpg',
                                              caption='Choir night')
        self.client.force_authenticate(self.owner)

    def buy(self, **extra):
        body = {'kind': 'post', 'target_id': self.post.id, 'package': 'standard', **extra}
        return self.client.post('/api/promotions/', body, format='json')

    def paid_and_live(self):
        res = self.buy()
        pid = res.data['id']
        with mock.patch('songs.ticketing_staff.call', side_effect=ticketing('paid')):
            self.client.post(f'/api/promotions/{pid}/pay/', {'phone': '0712345678'}, format='json')
        p = Promotion.objects.get(pk=pid)
        promo.approve(p, self.admin)
        return Promotion.objects.get(pk=pid)

    def test_the_packages_and_counties(self):
        res = self.client.get('/api/promotions/packages/')
        self.assertEqual([p['key'] for p in res.data['packages']], ['starter', 'standard', 'plus'])
        self.assertEqual(res.data['packages'][1]['price'], 500)
        self.assertIn('Nairobi', res.data['counties'])

    def test_buying_keeps_the_price_paid(self):
        res = self.buy(counties=['nairobi', 'Kisumu'])
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual((res.data['status'], res.data['price'], res.data['views_target']), ('unpaid', 500, 3000))
        self.assertEqual(res.data['counties'], ['Nairobi', 'Kisumu'])
        PromotionPackage.objects.filter(key='standard').update(price=900)
        self.assertEqual(Promotion.objects.get(pk=res.data['id']).price, 500)

    def test_only_your_own_public_things(self):
        other = SocialPost.objects.create(user=self.viewer, content_type='image', media_file='x')
        self.assertEqual(self.buy(target_id=other.id).data['code'], 'target')
        SocialPost.objects.filter(pk=self.post.pk).update(visibility='followers')
        self.assertEqual(self.buy().data['code'], 'not_public')
        self.assertEqual(self.buy(kind='profile', target_id=None).status_code, 201)
        self.assertEqual(self.buy(kind='profile', target_id=None,
                                  counties=['Atlantis']).data['code'], 'counties')

    def test_one_live_promotion_per_thing(self):
        self.paid_and_live()
        self.assertEqual(self.buy().data['code'], 'already')

    def test_paying_prompts_through_the_ticketing_server(self):
        pid = self.buy().data['id']
        with mock.patch('songs.ticketing_staff.call', side_effect=ticketing('pending')) as call:
            res = self.client.post(f'/api/promotions/{pid}/pay/', {'phone': '0712345678'}, format='json')
        self.assertEqual(res.data['status'], 'paying')
        method, path = call.call_args.args[1:3]
        body = call.call_args.kwargs['body']
        self.assertEqual((method, path, body['amount'], body['phone']), ('post', 'payments/', 500, '0712345678'))
        # M-Pesa says paid: on to review.
        with mock.patch('songs.ticketing_staff.call', side_effect=ticketing('paid')):
            res = self.client.get(f'/api/promotions/{pid}/')
        self.assertEqual((res.data['status'], res.data['mpesa_receipt']), ('review', 'TJK1'))

    def test_a_failed_payment_can_be_tried_again(self):
        pid = self.buy().data['id']
        with mock.patch('songs.ticketing_staff.call', side_effect=ticketing('failed', desc='Cancelled by user')):
            res = self.client.post(f'/api/promotions/{pid}/pay/', {'phone': '0712345678'}, format='json')
        self.assertEqual((res.data['status'], res.data['payment_note']), ('unpaid', 'Cancelled by user'))

    @override_settings(TICKETING_SERVICE_KEY='')
    def test_no_payments_without_the_ticketing_server(self):
        pid = self.buy().data['id']
        res = self.client.post(f'/api/promotions/{pid}/pay/', {'phone': '0712345678'}, format='json')
        self.assertEqual((res.status_code, res.data['code']), (503, 'unavailable'))

    def test_nothing_runs_before_an_admin_approves(self):
        pid = self.buy().data['id']
        with mock.patch('songs.ticketing_staff.call', side_effect=ticketing('paid')):
            self.client.post(f'/api/promotions/{pid}/pay/', {'phone': '0712345678'}, format='json')
        self.client.force_authenticate(self.viewer)
        self.assertEqual(self.client.get('/api/promotions/serve/').data, [])
        self.assertEqual(self.client.get('/api/admin/promotions/?status=review').status_code, 403)

        self.client.force_authenticate(self.admin)
        queue = self.client.get('/api/admin/promotions/?status=review').data
        self.assertEqual([p['id'] for p in queue], [pid])
        with mock.patch('songs.push.notify_user') as push:
            res = self.client.post(f'/api/admin/promotions/{pid}/approve/')
        self.assertEqual(res.data['status'], 'active')
        push.assert_called_once()

        self.client.force_authenticate(self.viewer)
        served = self.client.get('/api/promotions/serve/').data
        self.assertEqual([s['promotion_id'] for s in served], [pid])
        self.assertEqual(served[0]['post']['id'], self.post.id)

    def test_a_declined_one_is_owed_back(self):
        pid = self.buy().data['id']
        with mock.patch('songs.ticketing_staff.call', side_effect=ticketing('paid')):
            self.client.post(f'/api/promotions/{pid}/pay/', {'phone': '0712345678'}, format='json')
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post(f'/api/admin/promotions/{pid}/reject/').data['code'], 'note')
        with mock.patch('songs.push.notify_user'):
            res = self.client.post(f'/api/admin/promotions/{pid}/reject/', {'note': 'Blurry picture'}, format='json')
        self.assertEqual((res.data['status'], res.data['refund_owed']), ('rejected', 500))
        res = self.client.post(f'/api/admin/promotions/{pid}/refunded/', {'note': 'M-Pesa QK1'}, format='json')
        self.assertFalse(res.data['refund_due'])

    def test_a_view_counts_once_a_day_and_never_the_owners_own(self):
        p = self.paid_and_live()
        self.client.force_authenticate(self.viewer)
        self.assertTrue(self.client.post(f'/api/promotions/{p.pk}/seen/').data['counted'])
        self.assertFalse(self.client.post(f'/api/promotions/{p.pk}/seen/').data['counted'])
        self.client.post(f'/api/promotions/{p.pk}/tap/', {'action': 'open'}, format='json')
        self.client.post(f'/api/promotions/{p.pk}/tap/', {'action': 'open'}, format='json')
        self.client.force_authenticate(self.owner)
        self.client.post(f'/api/promotions/{p.pk}/seen/')
        p.refresh_from_db()
        self.assertEqual((p.views, p.clicks), (1, 1))
        # Seen today: not served to them again today.
        self.client.force_authenticate(self.viewer)
        self.assertEqual(self.client.get('/api/promotions/serve/').data, [])

    def test_counties_are_matched_to_where_people_live(self):
        res = self.buy(counties=['Kisumu'])
        with mock.patch('songs.ticketing_staff.call', side_effect=ticketing('paid')):
            self.client.post(f'/api/promotions/{res.data["id"]}/pay/', {'phone': '0712345678'}, format='json')
        with mock.patch('songs.push.notify_user'):
            promo.approve(Promotion.objects.get(pk=res.data['id']), self.admin)
        Profile.objects.update_or_create(user=self.viewer, defaults={'location': 'Nairobi, Kenya'})
        self.client.force_authenticate(self.viewer)
        self.assertEqual(self.client.get('/api/promotions/serve/').data, [])
        Profile.objects.filter(user=self.viewer).update(location='Kisumu town')
        self.assertEqual(len(self.client.get('/api/promotions/serve/').data), 1)

    def test_done_when_delivered_or_due_with_the_shortfall_owed(self):
        p = self.paid_and_live()
        Promotion.objects.filter(pk=p.pk).update(views=2999)
        with mock.patch('songs.push.notify_user'):
            promo.seen(p, self.viewer)
        p.refresh_from_db()
        self.assertEqual((p.status, p.refund_due), ('done', False))

        q = Promotion.objects.create(owner=self.owner, kind='profile', package=p.package, price=500,
                                     views_target=3000, days=5, status='active', views=1500,
                                     starts_at=timezone.now() - timedelta(days=6), ends_at=timezone.now() - timedelta(days=1))
        with mock.patch('songs.push.notify_user'):
            promo.finish_expired()
        q.refresh_from_db()
        self.assertEqual((q.status, q.refund_due, promo.refund_owed(q)), ('done', True, 250))

    def test_a_promoted_post_taken_down_stops_showing(self):
        p = self.paid_and_live()
        SocialPost.objects.filter(pk=self.post.pk).update(is_removed=True)
        self.client.force_authenticate(self.viewer)
        self.assertEqual(self.client.get('/api/promotions/serve/').data, [])
        self.assertFalse(Promotion.objects.get(pk=p.pk).views)

    def test_prices_are_the_admins_to_change(self):
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.patch('/api/admin/promotion-packages/starter/', {'price': 1}).status_code, 403)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.patch('/api/admin/promotion-packages/starter/', {'price': 1},
                                           format='json').status_code, 400)
        res = self.client.patch('/api/admin/promotion-packages/starter/', {'price': 250}, format='json')
        self.assertEqual(res.data['price'], 250)

    def test_paid_while_the_app_was_closed_still_reaches_the_admins(self):
        pid = self.buy().data['id']
        with mock.patch('songs.ticketing_staff.call', side_effect=ticketing('pending')):
            self.client.post(f'/api/promotions/{pid}/pay/', {'phone': '0712345678'}, format='json')
        Promotion.objects.filter(pk=pid).update(updated_at=timezone.now() - timedelta(minutes=2))
        # Nobody opens the promotion again; the admins open their queue.
        self.client.force_authenticate(self.admin)
        with mock.patch('songs.ticketing_staff.call', side_effect=ticketing('paid')):
            queue = self.client.get('/api/admin/promotions/?status=review').data
        self.assertEqual([p['id'] for p in queue], [pid])

    def test_the_owners_list_catches_up_too(self):
        pid = self.buy().data['id']
        with mock.patch('songs.ticketing_staff.call', side_effect=ticketing('pending')):
            self.client.post(f'/api/promotions/{pid}/pay/', {'phone': '0712345678'}, format='json')
        Promotion.objects.filter(pk=pid).update(updated_at=timezone.now() - timedelta(minutes=2))
        with mock.patch('songs.ticketing_staff.call', side_effect=ticketing('paid')):
            rows = self.client.get('/api/promotions/').data
        self.assertEqual(rows[0]['status'], 'review')

    def test_following_from_a_promotion_counts_once(self):
        from django.core.cache import cache
        cache.clear()
        p = self.paid_and_live()
        self.client.force_authenticate(self.viewer)
        for _ in range(3):
            self.client.post(f'/api/promotions/{p.pk}/tap/', {'action': 'follow'}, format='json')
        p.refresh_from_db()
        self.assertEqual(p.follows, 1)


class TicketingAddressTests(APITestCase):
    def test_an_empty_setting_means_the_default(self):
        import importlib
        import os
        from unittest import mock as m
        with m.patch.dict(os.environ, {'TICKETING_API_URL': ''}):
            import music.settings as s
            importlib.reload(s)
            self.assertEqual(s.TICKETING_API_URL, 'https://tickets.smartbillsolution.com')
        importlib.reload(s)

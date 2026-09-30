"""Marketplace phases 3–5: orders you can follow (each seller's part on its
own, with a timeline and pushes), selling (dashboard numbers, saved details,
the shop front) and trust (wishlist alerts, near me, the verified tick).

    python manage.py test songs.tests.test_marketplace_orders
"""
from decimal import Decimal
from unittest import mock

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from songs.models import (
    Order, OrderItem, Product, ProductReview, SellerProfile, User, Wishlist,
)


def make(seller, title, price='10.00', **extra):
    return Product.objects.create(
        seller=seller, title=title, description='d', price=Decimal(price),
        quantity=extra.pop('quantity', 5), **extra,
    )


class TwoSellerOrderMixin:
    def setUp(self):
        cache.clear()
        self.a = User.objects.create_user('aseller', 'a@x.com', 'pw')
        self.b = User.objects.create_user('bseller', 'b@x.com', 'pw')
        self.buyer = User.objects.create_user('buyer', 'u@x.com', 'pw')
        self.pa = make(self.a, 'Hymnal', '10.00', currency='KES')
        self.pb = make(self.b, 'Guitar', '90.00', currency='USD')
        self.order = Order.objects.create(buyer=self.buyer, total_amount=Decimal('100'))
        self.ia = OrderItem.objects.create(order=self.order, product=self.pa, quantity=1, title='Hymnal',
                                           price_at_purchase=Decimal('10'), seller=self.a, currency='KES')
        self.ib = OrderItem.objects.create(order=self.order, product=self.pb, quantity=1, title='Guitar',
                                           price_at_purchase=Decimal('90'), seller=self.b, currency='USD')

    def post(self, user, action, data=None):
        self.client.force_authenticate(user)
        return self.client.post(f'/api/marketplace/orders/{self.order.id}/{action}/', data or {}, format='json')

    def status_(self):
        self.order.refresh_from_db()
        return self.order.status


@mock.patch('songs.views.marketplace.notify_user')
class OrderProgressTests(TwoSellerOrderMixin, APITestCase):
    def test_each_seller_moves_their_own_part_and_the_order_follows_the_slowest(self, notify):
        self.post(self.a, 'confirm-payment')
        self.assertEqual(self.status_(), 'PROCESSING')
        res = self.post(self.a, 'ship', {'note': 'Rider Joe, 0712'})
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(self.status_(), 'PROCESSING')           # B not sent yet
        self.post(self.b, 'confirm-payment')
        self.post(self.b, 'ship')
        self.assertEqual(self.status_(), 'SHIPPED')
        self.order.refresh_from_db()
        self.assertEqual(self.order.payment_status, 'PAID')
        self.post(self.buyer, 'received', {'seller_id': self.a.id})
        self.assertEqual(self.status_(), 'SHIPPED')
        res = self.post(self.buyer, 'received')
        self.assertEqual(self.status_(), 'DELIVERED')
        steps = {s['step']: s['at'] for s in res.data['timeline']}
        self.assertTrue(all(steps[k] for k in ('placed', 'paid', 'shipped', 'delivered')))
        line = next(i for i in res.data['items'] if i['title'] == 'Hymnal')
        self.assertEqual(line['tracking_note'], 'Rider Joe, 0712')

    def test_nothing_is_sent_before_it_is_paid(self, notify):
        res = self.post(self.a, 'ship')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['code'], 'not_paid')
        self.assertEqual(self.post(self.buyer, 'ship').status_code, 403)

    def test_the_buyer_cancels_one_sellers_part_and_keeps_the_other(self, notify):
        self.post(self.a, 'confirm-payment')
        res = self.post(self.buyer, 'cancel-part', {'seller_id': self.b.id})
        self.assertEqual(res.status_code, 200, res.data)
        self.ib.refresh_from_db()
        self.ia.refresh_from_db()
        self.assertIsNotNone(self.ib.cancelled_at)
        self.assertIsNone(self.ia.cancelled_at)
        self.assertEqual(self.status_(), 'PROCESSING')
        # Once a seller has been paid, their part is no longer the buyer's to cancel.
        res = self.post(self.buyer, 'cancel-part', {'seller_id': self.a.id})
        self.assertEqual(res.data['code'], 'paid')
        notify.assert_any_call(self.b, 'market_cancelled', mock.ANY, data=mock.ANY)

    def test_a_seller_cancels_their_own_part_and_gets_the_stock_back(self, notify):
        self.post(self.a, 'confirm-payment')
        self.pa.refresh_from_db()
        self.assertEqual(self.pa.quantity, 4)
        self.post(self.a, 'cancel-part')
        self.pa.refresh_from_db()
        self.assertEqual(self.pa.quantity, 5)
        self.post(self.b, 'cancel-part')
        self.assertEqual(self.status_(), 'CANCELLED')

    def test_a_seller_sees_their_own_part_not_the_other_sellers(self, notify):
        self.pb.mpesa_number = '0799 B-ONLY'
        self.pb.save()
        self.client.force_authenticate(self.a)
        res = self.client.get(f'/api/marketplace/orders/{self.order.id}/')
        self.assertEqual([i['title'] for i in res.data['items']], ['Hymnal'])
        self.assertEqual(res.data['totals'], [{'currency': 'KES', 'amount': '10.00'}])
        self.assertNotIn('0799 B-ONLY', str(res.data))
        # And in their list of sales, and in the answer to their own action.
        res = self.client.get('/api/marketplace/orders/?role=seller')
        self.assertEqual([i['title'] for i in res.data['results'][0]['items']], ['Hymnal'])
        res = self.post(self.a, 'confirm-payment')
        self.assertEqual([i['title'] for i in res.data['items']], ['Hymnal'])
        # The buyer still sees the whole order.
        self.client.force_authenticate(self.buyer)
        res = self.client.get(f'/api/marketplace/orders/{self.order.id}/')
        self.assertEqual(sorted(i['title'] for i in res.data['items']), ['Guitar', 'Hymnal'])

    def test_a_part_called_off_is_not_in_the_total(self, notify):
        self.post(self.buyer, 'cancel-part', {'seller_id': self.b.id})
        res = self.client.get(f'/api/marketplace/orders/{self.order.id}/')
        self.assertEqual(res.data['totals'], [{'currency': 'KES', 'amount': '10.00'}])
        # All called off: it still says what it came to.
        self.post(self.a, 'cancel-part')
        self.client.force_authenticate(self.buyer)
        res = self.client.get(f'/api/marketplace/orders/{self.order.id}/')
        self.assertEqual({t['currency'] for t in res.data['totals']}, {'KES', 'USD'})

    def test_a_delivery_note_reaches_the_sellers_still_to_send(self, notify):
        self.post(self.a, 'confirm-payment')
        self.post(self.a, 'ship')
        notify.reset_mock()
        res = self.post(self.buyer, 'set-shipping', {'shipping_address': 'Kisumu, Oginga Odinga St'})
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['shipping_address'], 'Kisumu, Oginga Odinga St')
        told = [c[0][0] for c in notify.call_args_list]
        self.assertEqual(told, [self.b])            # A has already sent theirs
        # The same note again is not news.
        notify.reset_mock()
        self.post(self.buyer, 'set-shipping', {'shipping_address': 'Kisumu, Oginga Odinga St'})
        notify.assert_not_called()

    def test_a_delivery_note_is_text_of_a_sensible_length(self, notify):
        self.assertEqual(self.post(self.buyer, 'set-shipping', {'shipping_address': 42}).status_code, 400)
        self.assertEqual(self.post(self.buyer, 'set-shipping', {'shipping_address': 'x' * 501}).status_code, 400)
        self.assertEqual(self.post(self.a, 'set-shipping', {'shipping_address': 'mine'}).status_code, 403)

    def test_the_right_people_hear(self, notify):
        self.post(self.a, 'confirm-payment')
        notify.assert_any_call(self.buyer, 'market_paid', mock.ANY, data={'type': 'market_paid', 'order_id': self.order.id})
        self.post(self.a, 'ship', {'note': 'bus'})
        notify.assert_any_call(self.buyer, 'market_shipped', mock.ANY, data=mock.ANY)
        self.post(self.buyer, 'received', {'seller_id': self.a.id})
        notify.assert_any_call(self.a, 'market_delivered', mock.ANY, data=mock.ANY)


@mock.patch('songs.views.marketplace.notify_user')
class NewOrderTests(APITestCase):
    def test_each_seller_hears_of_their_part_of_a_new_order(self, notify):
        a = User.objects.create_user('aseller', 'a@x.com', 'pw')
        buyer = User.objects.create_user('buyer', 'u@x.com', 'pw')
        p = make(a, 'Hymnal')
        self.client.force_authenticate(buyer)
        with self.captureOnCommitCallbacks(execute=True):
            res = self.client.post('/api/marketplace/cart/buy_now/', {'product_id': p.id}, format='json')
        notify.assert_called_once()
        user, kind, message = notify.call_args[0]
        self.assertEqual((user, kind), (a, 'market_order'))
        self.assertIn('Hymnal', message)
        self.assertEqual(notify.call_args[1]['data']['order_id'], res.data['id'])


class SellingTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.seller = User.objects.create_user('seller', 's@x.com', 'pw')
        self.buyer = User.objects.create_user('buyer', 'b@x.com', 'pw')
        self.client.force_authenticate(self.seller)

    def test_the_dashboard_numbers(self):
        p = make(self.seller, 'Hymnal', '10.00', currency='KES', quantity=2)
        make(self.seller, 'Plenty', '1.00', quantity=50)
        paid = Order.objects.create(buyer=self.buyer, total_amount=Decimal('20'))
        OrderItem.objects.create(order=paid, product=p, quantity=2, price_at_purchase=Decimal('10'),
                                 seller=self.seller, currency='KES', payment_confirmed_at=timezone.now())
        waiting = Order.objects.create(buyer=self.buyer, total_amount=Decimal('10'))
        OrderItem.objects.create(order=waiting, product=p, quantity=1, price_at_purchase=Decimal('10'),
                                 seller=self.seller, currency='KES')
        res = self.client.get('/api/marketplace/orders/seller-stats/')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['week'], [{'currency': 'KES', 'amount': '20.00'}])
        self.assertEqual(res.data['awaiting_payment'], 1)
        self.assertEqual(res.data['to_send'], 1)
        self.assertEqual(res.data['products'], 2)
        self.assertEqual([x['title'] for x in res.data['low_stock']], ['Hymnal'])

    def test_saved_details_are_mine_and_the_tick_is_staffs(self):
        res = self.client.put('/api/marketplace/seller-profile/',
                              {'mpesa_number': '0712', 'is_verified': True}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.client.get('/api/marketplace/seller-profile/').data['mpesa_number'], '0712')
        self.assertFalse(SellerProfile.objects.get(user=self.seller).is_verified)

    def test_a_quick_edit_changes_price_and_stock(self):
        p = make(self.seller, 'Hymnal', quantity=1)
        res = self.client.patch(f'/api/marketplace/products/{p.slug}/',
                                {'price': '8.50', 'quantity': 7, 'is_available': False}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        p.refresh_from_db()
        self.assertEqual((p.price, p.quantity, p.is_available), (Decimal('8.50'), 7, False))

    def test_the_shop_front(self):
        p = make(self.seller, 'Hymnal', location='Nairobi')
        make(self.seller, 'Gone', quantity=0)
        SellerProfile.objects.create(user=self.seller, is_verified=True)
        order = Order.objects.create(buyer=self.buyer, total_amount=Decimal('10'))
        OrderItem.objects.create(order=order, product=p, quantity=1, price_at_purchase=Decimal('10'),
                                 seller=self.seller, payment_confirmed_at='2026-09-01T00:00Z')
        ProductReview.objects.create(product=p, reviewer=self.buyer, rating=4)
        self.client.force_authenticate(None)
        res = self.client.get('/api/marketplace/shops/seller/')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['is_verified'])
        self.assertEqual((res.data['products_on_offer'], res.data['sales']), (1, 1))
        self.assertEqual((res.data['rating'], res.data['review_count']), (4.0, 1))
        self.assertEqual(res.data['location'], 'Nairobi')
        page = self.client.get(f'/api/marketplace/products/{p.slug}/').data
        self.assertTrue(page['seller_verified'])


class TrustTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.seller = User.objects.create_user('seller', 's@x.com', 'pw')
        self.fan = User.objects.create_user('fan', 'f@x.com', 'pw')
        self.product = make(self.seller, 'Hymnal', '20.00', quantity=0)
        Wishlist.objects.create(user=self.fan).products.add(self.product)
        self.client.force_authenticate(self.seller)

    def patch(self, **fields):
        return self.client.patch(f'/api/marketplace/products/{self.product.slug}/', fields, format='json')

    @mock.patch('songs.market_alerts.notify_many')
    def test_back_in_stock_then_cheaper_each_told_once_a_day(self, notify):
        self.patch(quantity=3)
        notify.assert_called_once()
        self.assertEqual(notify.call_args[0][:2], ([self.fan.id], 'market_wish'))
        self.assertIn('back in stock', notify.call_args[0][2])
        self.assertEqual(notify.call_args[1]['data']['slug'], self.product.slug)
        self.patch(price='15.00')
        self.assertEqual(notify.call_count, 1)                 # once a day per product
        cache.clear()
        self.patch(price='12.00')
        self.assertIn('was 15.00', notify.call_args[0][2])

    @mock.patch('songs.market_alerts.notify_many')
    def test_dearer_or_still_sold_out_is_not_news(self, notify):
        self.patch(price='10.00')                               # still sold out
        self.patch(quantity=2)
        notify.reset_mock()
        cache.clear()
        self.patch(price='30.00')                               # dearer
        notify.assert_not_called()

    def test_near_me_is_not_the_only_filter(self):
        self.assertEqual(self.client.get('/api/marketplace/products/?near=').status_code, 200)

    def test_near_me(self):
        make(self.seller, 'Kisumu thing', location='Kisumu, Kenya')
        make(self.seller, 'Nairobi thing', location='Nairobi')
        res = self.client.get('/api/marketplace/products/?near=kisumu')
        self.assertEqual([p['title'] for p in res.data['results']], ['Kisumu thing'])


class ScanFixTests(TwoSellerOrderMixin, APITestCase):
    """What the deep scan found: only what can be bought gets bought, a
    cancelled part is never confirmed, the card charge is in the order's own
    currency, and orders come a page at a time."""

    def test_cannot_put_the_unbuyable_in_a_cart(self):
        self.client.force_authenticate(self.buyer)
        gone = make(self.a, 'Withdrawn', is_available=False)
        taken = make(self.a, 'Taken down', is_removed=True)
        for p in (gone, taken):
            res = self.client.post('/api/marketplace/cart/add_item/', {'product_id': p.id}, format='json')
            self.assertEqual(res.status_code, 400, p.title)
        self.client.force_authenticate(self.a)
        res = self.client.post('/api/marketplace/cart/add_item/', {'product_id': self.pa.id}, format='json')
        self.assertEqual(res.data['error'], 'This is your own product.')

    def test_checkout_refuses_a_line_withdrawn_since(self):
        from songs.models import Cart, CartItem
        self.client.force_authenticate(self.buyer)
        cart = Cart.objects.create(user=self.buyer)
        CartItem.objects.create(cart=cart, product=self.pa, quantity=1)
        Product.objects.filter(pk=self.pa.pk).update(is_available=False)
        res = self.client.post('/api/marketplace/cart/checkout/')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(Order.objects.filter(buyer=self.buyer).count(), 1)   # only the fixture's

    @mock.patch('songs.views.marketplace.notify_user')
    def test_a_cancelled_part_is_never_confirmed(self, notify):
        self.post(self.a, 'cancel-part')
        before = Product.objects.get(pk=self.pa.pk).quantity
        res = self.post(self.a, 'confirm-payment')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['code'], 'cancelled')
        self.assertEqual(Product.objects.get(pk=self.pa.pk).quantity, before)

    @mock.patch('stripe.PaymentIntent.create')
    def test_the_card_charge_is_in_the_orders_own_currency(self, create):
        from django.test import override_settings
        create.return_value = mock.Mock(id='pi_1', client_secret='s')
        self.client.force_authenticate(self.buyer)
        with override_settings(STRIPE_SECRET_KEY='sk_test'):
            res = self.client.post('/api/marketplace/create-payment-intent/', {'order_id': self.order.id})
            self.assertEqual(res.status_code, 400)            # KES and USD: no single charge
            self.ib.delete()
            Order.objects.filter(pk=self.order.pk).update(total_amount=Decimal('10.00'))
            res = self.client.post('/api/marketplace/create-payment-intent/',
                                   {'order_id': self.order.id, 'currency': 'usd'})
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(create.call_args[1]['currency'], 'kes')    # not what the client said
        self.assertEqual(create.call_args[1]['amount'], 1000)

    def test_orders_come_a_page_at_a_time(self):
        self.client.force_authenticate(self.buyer)
        res = self.client.get('/api/marketplace/orders/?role=buyer')
        self.assertIn('results', res.data)
        self.assertEqual(res.data['results'][0]['id'], self.order.id)

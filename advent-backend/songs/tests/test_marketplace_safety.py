"""Marketplace money and trust: no trade across a block or with a closed
account, only real currencies, stock checked under the product's lock, and a
card payment (if ever switched on) that charges only what is still owed, in
the currency's own units, leaving cancelled parts alone.

    python manage.py test songs.tests.test_marketplace_safety --settings=music.settings_test
"""
import sys
import types
from decimal import Decimal
from unittest import mock

from django.core.cache import cache
from django.db import transaction
from django.test import override_settings
from rest_framework.test import APITestCase

from songs.models import Block, Order, OrderItem, Product, User


def make(seller, title, price='10.00', **extra):
    return Product.objects.create(seller=seller, title=title, description='d', price=Decimal(price),
                                  quantity=extra.pop('quantity', 5), **extra)


class WhoYouCanBuyFromTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.seller = User.objects.create_user('ws_seller', 'ws@x.com', 'pw')
        self.buyer = User.objects.create_user('ws_buyer', 'wb@x.com', 'pw')
        self.product = make(self.seller, 'Hymnal')
        self.client.force_authenticate(self.buyer)

    def listed(self):
        rows = self.client.get('/api/marketplace/products/').json()
        return [p['id'] for p in (rows.get('results', rows) if isinstance(rows, dict) else rows)]

    def test_across_a_block_nothing_shows_or_sells(self):
        Block.objects.create(blocker=self.seller, blocked=self.buyer)
        self.assertNotIn(self.product.id, self.listed())
        res = self.client.post('/api/marketplace/cart/add_item/', {'product_id': self.product.id}, format='json')
        self.assertEqual(res.status_code, 400)
        res = self.client.post('/api/marketplace/cart/buy_now/', {'product_id': self.product.id}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_a_closed_accounts_things_are_off_sale(self):
        User.objects.filter(pk=self.seller.pk).update(is_deactivated=True)
        self.assertNotIn(self.product.id, self.listed())
        res = self.client.post('/api/marketplace/cart/buy_now/', {'product_id': self.product.id}, format='json')
        self.assertEqual(res.status_code, 400)


class CurrencyTests(APITestCase):
    def test_only_the_marketplaces_currencies(self):
        seller = User.objects.create_user('cu_seller', 'cu@x.com', 'pw')
        self.client.force_authenticate(seller)
        body = {'title': 'Bible', 'description': 'd', 'price': '5.00', 'quantity': 1, 'category': 'Books'}
        bad = self.client.post('/api/marketplace/products/', {**body, 'currency': 'XYZ'}, format='json')
        self.assertEqual(bad.status_code, 400)
        self.assertIn('currency', bad.json())
        ok = self.client.post('/api/marketplace/products/', {**body, 'currency': 'kes'}, format='json')
        self.assertEqual(ok.status_code, 201, ok.content[:300])
        self.assertEqual(Product.objects.get(title='Bible').currency, 'KES')


class StockUnderTheLockTests(APITestCase):
    def test_a_strict_commit_refuses_what_is_no_longer_there(self):
        seller = User.objects.create_user('sl_seller', 'sl@x.com', 'pw')
        buyer = User.objects.create_user('sl_buyer', 'sb@x.com', 'pw')
        product = make(seller, 'Last one', quantity=1)
        lines = []
        for _ in range(2):
            order = Order.objects.create(buyer=buyer, total_amount=Decimal('10'))
            lines.append(OrderItem.objects.create(order=order, product=product, quantity=1, title='Last one',
                                                  price_at_purchase=Decimal('10'), seller=seller))
        with transaction.atomic():
            self.assertTrue(lines[0].commit_stock(strict=True))
        with self.assertRaises(OrderItem.OutOfStock):
            with transaction.atomic():
                lines[1].commit_stock(strict=True)
        product.refresh_from_db()
        self.assertEqual(product.quantity, 0)
        lines[1].refresh_from_db()
        self.assertFalse(lines[1].stock_committed)


@override_settings(STRIPE_SECRET_KEY='sk_test', STRIPE_PUBLISHABLE_KEY='pk_test', STRIPE_WEBHOOK_SECRET='wh')
class CardPaymentTests(APITestCase):
    """The card path isn't used by the app today; if switched on, it must
    charge the right amount."""

    def setUp(self):
        cache.clear()
        self.a = User.objects.create_user('cp_a', 'cpa@x.com', 'pw')
        self.b = User.objects.create_user('cp_b', 'cpb@x.com', 'pw')
        self.buyer = User.objects.create_user('cp_buyer', 'cpbu@x.com', 'pw')
        self.created = {}
        fake = types.SimpleNamespace(api_key=None)
        fake.PaymentIntent = types.SimpleNamespace(create=self._create)
        self.stripe = mock.patch.dict(sys.modules, {'stripe': fake})
        self.stripe.start()
        self.addCleanup(self.stripe.stop)
        self.client.force_authenticate(self.buyer)

    def _create(self, **kw):
        self.created = kw
        return types.SimpleNamespace(id='pi_1', client_secret='secret')

    def order(self, lines, currency='USD'):
        order = Order.objects.create(buyer=self.buyer, total_amount=sum(Decimal(p) * q for p, q, *_ in lines))
        for price, qty, *flags in lines:
            seller = self.a if 'b' not in flags else self.b
            product = make(seller, f'P{price}', price, currency=currency)
            OrderItem.objects.create(order=order, product=product, quantity=qty, title=product.title,
                                     price_at_purchase=Decimal(price), seller=seller, currency=currency,
                                     **({'cancelled_at': '2026-10-01T00:00Z'} if 'cancelled' in flags else {}),
                                     **({'payment_confirmed_at': '2026-10-01T00:00Z'} if 'paid' in flags else {}))
        return order

    def test_only_what_is_still_owed(self):
        order = self.order([('10.00', 2), ('5.00', 1, 'cancelled'), ('20.00', 1, 'paid', 'b')])
        res = self.client.post('/api/marketplace/create-payment-intent/', {'order_id': order.id}, format='json')
        self.assertEqual(res.status_code, 200, res.content[:300])
        self.assertEqual(self.created['amount'], 2000)          # 2 x 10.00, in cents - not 45.00

    def test_whole_units_for_a_currency_without_cents(self):
        order = self.order([('15000', 1)], currency='UGX')
        res = self.client.post('/api/marketplace/create-payment-intent/', {'order_id': order.id}, format='json')
        self.assertEqual(res.status_code, 200, res.content[:300])
        self.assertEqual(self.created['amount'], 15000)         # not 1,500,000

    def test_paid_by_card_leaves_a_cancelled_parts_stock_alone(self):
        from songs.views.marketplace import StripeWebhookView
        order = self.order([('10.00', 1), ('5.00', 2, 'cancelled')])
        cancelled = order.items.get(cancelled_at__isnull=False)
        before = cancelled.product.quantity
        StripeWebhookView._fulfill_order(order.id)
        cancelled.product.refresh_from_db()
        self.assertEqual(cancelled.product.quantity, before)
        live = order.items.get(cancelled_at__isnull=True)
        live.product.refresh_from_db()
        self.assertEqual(live.product.quantity, 4)


class WishlistAndTakedownTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.seller = User.objects.create_user('wl_seller', 'wls@x.com', 'pw')
        self.me = User.objects.create_user('wl_me', 'wlm@x.com', 'pw')
        self.client.force_authenticate(self.me)

    def test_a_bad_id_is_not_found_not_a_crash(self):
        res = self.client.post('/api/marketplace/wishlist/add_product/', {'product_id': 'abc'}, format='json')
        self.assertEqual(res.status_code, 404)

    def test_a_taken_down_product_cannot_be_saved_and_shows_without_its_pictures(self):
        from songs.models import ProductImage
        product = make(self.seller, 'Poster')
        ProductImage.objects.create(product=product, image='https://media.example.com/p/1.jpg')
        self.assertEqual(self.client.post('/api/marketplace/wishlist/add_product/', {'product_id': product.id},
                                          format='json').status_code, 200)
        Product.objects.filter(pk=product.pk).update(is_removed=True)
        res = self.client.post('/api/marketplace/wishlist/add_product/', {'product_id': product.id}, format='json')
        self.assertEqual(res.status_code, 404)
        row = self.client.get('/api/marketplace/wishlist/my_wishlist/').json()['products'][0]
        self.assertFalse(row['is_available'])
        self.assertEqual(row['images'], [])

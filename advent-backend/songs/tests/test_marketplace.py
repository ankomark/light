from decimal import Decimal

from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APITestCase

from songs.models import Product, Cart, CartItem, Order, OrderItem, User
from songs.views import StripeWebhookView


class CheckoutTests(APITestCase):
    """Checkout creates a PENDING order and validates — but does NOT commit —
    stock (inventory is only decremented once payment is confirmed)."""

    def setUp(self):
        cache.clear()
        self.seller = User.objects.create_user(username='seller', email='seller@test.local', password='pw')
        self.buyer = User.objects.create_user(username='buyer', email='buyer@test.local', password='pw')
        self.product = Product.objects.create(
            seller=self.seller, title='Hymnal', description='d',
            price=Decimal('10.00'), quantity=3,
        )

    def _add_to_cart(self, qty):
        cart, _ = Cart.objects.get_or_create(user=self.buyer)
        CartItem.objects.create(cart=cart, product=self.product, quantity=qty)

    def test_checkout_creates_pending_order_without_decrementing_stock(self):
        self._add_to_cart(2)
        self.client.force_authenticate(self.buyer)
        res = self.client.post('/api/marketplace/cart/checkout/')

        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        order = Order.objects.get(buyer=self.buyer)
        self.assertEqual(order.status, 'PENDING')
        self.assertEqual(order.payment_status, 'PENDING')
        self.product.refresh_from_db()
        self.assertEqual(self.product.quantity, 3)  # untouched until payment
        self.assertEqual(CartItem.objects.filter(cart__user=self.buyer).count(), 0)  # cart cleared

    def test_checkout_rejects_insufficient_stock(self):
        self._add_to_cart(10)  # only 3 available
        self.client.force_authenticate(self.buyer)
        res = self.client.post('/api/marketplace/cart/checkout/')

        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Order.objects.filter(buyer=self.buyer).exists())


class PaymentFulfillmentTests(APITestCase):
    """The webhook fulfilment path: marks PAID, commits inventory, idempotent."""

    def setUp(self):
        cache.clear()
        self.seller = User.objects.create_user(username='seller', email='seller@test.local', password='pw')
        self.buyer = User.objects.create_user(username='buyer', email='buyer@test.local', password='pw')
        self.product = Product.objects.create(
            seller=self.seller, title='Hymnal', description='d',
            price=Decimal('10.00'), quantity=5,
        )
        self.order = Order.objects.create(
            buyer=self.buyer, status='PENDING', total_amount=Decimal('20.00'),
        )
        OrderItem.objects.create(
            order=self.order, product=self.product, quantity=2,
            price_at_purchase=Decimal('10.00'), seller=self.seller,
        )

    def test_fulfill_marks_paid_and_decrements_inventory(self):
        StripeWebhookView._fulfill_order(self.order.id)
        self.order.refresh_from_db()
        self.product.refresh_from_db()
        self.assertEqual(self.order.payment_status, 'PAID')
        self.assertEqual(self.order.status, 'PROCESSING')
        self.assertEqual(self.product.quantity, 3)  # 5 - 2

    def test_fulfill_is_idempotent(self):
        StripeWebhookView._fulfill_order(self.order.id)
        StripeWebhookView._fulfill_order(self.order.id)  # duplicate webhook delivery
        self.product.refresh_from_db()
        self.assertEqual(self.product.quantity, 3)  # decremented once, not twice


class UpdateStatusAuthTests(APITestCase):
    """Fulfilment status: sellers drive it; buyers may only cancel."""

    def setUp(self):
        cache.clear()
        self.seller = User.objects.create_user(username='seller', email='seller@test.local', password='pw')
        self.buyer = User.objects.create_user(username='buyer', email='buyer@test.local', password='pw')
        self.product = Product.objects.create(
            seller=self.seller, title='Hymnal', description='d',
            price=Decimal('10.00'), quantity=5,
        )
        self.order = Order.objects.create(
            buyer=self.buyer, status='PENDING', total_amount=Decimal('10.00'),
        )
        OrderItem.objects.create(
            order=self.order, product=self.product, quantity=1,
            price_at_purchase=Decimal('10.00'), seller=self.seller,
        )

    def _post_status(self, new_status):
        return self.client.post(
            f'/api/marketplace/orders/{self.order.id}/update_status/',
            {'status': new_status},
        )

    def test_buyer_cannot_mark_delivered(self):
        self.client.force_authenticate(self.buyer)
        res = self._post_status('DELIVERED')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, 'PENDING')

    def test_buyer_can_cancel_pending_order(self):
        self.client.force_authenticate(self.buyer)
        res = self._post_status('CANCELLED')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, 'CANCELLED')

    def test_seller_can_advance_status(self):
        self.client.force_authenticate(self.seller)
        res = self._post_status('SHIPPED')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, 'SHIPPED')


class OrderMutationLockdownTests(APITestCase):
    """Orders can't be created/edited/deleted directly — only via the gated
    checkout/set-shipping/update_status paths and the Stripe webhook. Guards the
    payment-integrity bypass (a buyer PATCHing their own order to PAID)."""

    def setUp(self):
        cache.clear()
        self.seller = User.objects.create_user('lk_seller', 'lks@x.com', 'pw')
        self.buyer = User.objects.create_user('lk_buyer', 'lkb@x.com', 'pw')
        self.product = Product.objects.create(
            seller=self.seller, title='Book', description='d',
            price=Decimal('10.00'), quantity=5,
        )
        self.order = Order.objects.create(
            buyer=self.buyer, status='PENDING', payment_status='PENDING',
            total_amount=Decimal('10.00'),
        )
        OrderItem.objects.create(
            order=self.order, product=self.product, quantity=1,
            price_at_purchase=Decimal('10.00'), seller=self.seller,
        )

    def test_buyer_cannot_mark_own_order_paid_via_patch(self):
        self.client.force_authenticate(self.buyer)
        r = self.client.patch(f'/api/marketplace/orders/{self.order.id}/', {'payment_status': 'PAID'})
        self.assertEqual(r.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self.order.refresh_from_db()
        self.assertEqual(self.order.payment_status, 'PENDING')

    def test_buyer_cannot_tamper_status_or_total_via_put(self):
        self.client.force_authenticate(self.buyer)
        r = self.client.put(
            f'/api/marketplace/orders/{self.order.id}/',
            {'status': 'DELIVERED', 'total_amount': '0.01'},
        )
        self.assertEqual(r.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, 'PENDING')
        self.assertEqual(self.order.total_amount, Decimal('10.00'))

    def test_no_direct_order_create_or_delete(self):
        self.client.force_authenticate(self.buyer)
        self.assertEqual(
            self.client.post('/api/marketplace/orders/', {}).status_code,
            status.HTTP_405_METHOD_NOT_ALLOWED,
        )
        self.assertEqual(
            self.client.delete(f'/api/marketplace/orders/{self.order.id}/').status_code,
            status.HTTP_405_METHOD_NOT_ALLOWED,
        )
        self.assertTrue(Order.objects.filter(id=self.order.id).exists())

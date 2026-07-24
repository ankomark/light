from decimal import Decimal
from unittest import mock

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework import status
from rest_framework.test import APITestCase

from songs.models import Product, ProductImage, ProductReview, Cart, CartItem, Order, OrderItem, User
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


class ProductImageUpdateTests(APITestCase):
    """A PATCH that adds or removes images must go through the write-only
    'images'/'remove_images' helpers — never fall into the setattr loop, which
    would blow up on the reverse FK manager."""

    def setUp(self):
        cache.clear()
        self.seller = User.objects.create_user(username='imgseller', email='imgseller@test.local', password='pw')
        self.other = User.objects.create_user(username='imgother', email='imgother@test.local', password='pw')
        self.product = Product.objects.create(
            seller=self.seller, title='Guitar', description='d',
            price=Decimal('50.00'), quantity=1, slug='guitar-img-test',
        )
        self.img_a = ProductImage.objects.create(product=self.product, image='products/images/a.jpg')
        self.img_b = ProductImage.objects.create(product=self.product, image='products/images/b.jpg')

    def _gif(self, name):
        # Smallest valid GIF, so ImageField validation passes without Pillow gymnastics.
        raw = (b'GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!'
               b'\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;')
        return SimpleUploadedFile(name, raw, content_type='image/gif')

    def test_patch_without_images_still_works(self):
        self.client.force_authenticate(self.seller)
        res = self.client.patch(
            f'/api/marketplace/products/{self.product.slug}/', {'title': 'Renamed'}, format='multipart',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.product.refresh_from_db()
        self.assertEqual(self.product.title, 'Renamed')

    @mock.patch('songs.serializers.marketplace.r2.upload_file', return_value='products/images/new.jpg')
    def test_patch_with_new_image_creates_row(self, _upload):
        self.client.force_authenticate(self.seller)
        res = self.client.patch(
            f'/api/marketplace/products/{self.product.slug}/',
            {'title': 'With image', 'images': [self._gif('new.gif')]},
            format='multipart',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(self.product.images.count(), 3)

    def test_remove_images_deletes_only_the_listed_rows(self):
        self.client.force_authenticate(self.seller)
        res = self.client.patch(
            f'/api/marketplace/products/{self.product.slug}/',
            {'remove_images': [self.img_a.id]},
            format='multipart',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertFalse(ProductImage.objects.filter(id=self.img_a.id).exists())
        self.assertTrue(ProductImage.objects.filter(id=self.img_b.id).exists())

    def test_remove_images_cannot_touch_another_products_images(self):
        foreign = Product.objects.create(
            seller=self.other, title='Foreign', description='d',
            price=Decimal('5.00'), quantity=1, slug='foreign-img-test',
        )
        foreign_img = ProductImage.objects.create(product=foreign, image='products/images/f.jpg')

        self.client.force_authenticate(self.seller)
        res = self.client.patch(
            f'/api/marketplace/products/{self.product.slug}/',
            {'remove_images': [foreign_img.id]},
            format='multipart',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(ProductImage.objects.filter(id=foreign_img.id).exists())


class DirectPayConfirmationTests(APITestCase):
    """Direct-pay fulfilment: the seller confirming receipt — not Stripe — is
    what marks a line paid and commits its inventory."""

    def setUp(self):
        cache.clear()
        self.seller_a = User.objects.create_user(username='dpa', email='dpa@test.local', password='pw')
        self.seller_b = User.objects.create_user(username='dpb', email='dpb@test.local', password='pw')
        self.buyer = User.objects.create_user(username='dpbuyer', email='dpbuyer@test.local', password='pw')

        self.prod_a = Product.objects.create(
            seller=self.seller_a, title='Drum', description='d',
            price=Decimal('10.00'), quantity=5, slug='dp-drum',
        )
        self.prod_b = Product.objects.create(
            seller=self.seller_b, title='Flute', description='d',
            price=Decimal('20.00'), quantity=5, slug='dp-flute',
        )
        self.order = Order.objects.create(buyer=self.buyer, status='PENDING', total_amount=Decimal('40.00'))
        self.item_a = OrderItem.objects.create(
            order=self.order, product=self.prod_a, quantity=2,
            price_at_purchase=Decimal('10.00'), seller=self.seller_a,
        )
        self.item_b = OrderItem.objects.create(
            order=self.order, product=self.prod_b, quantity=1,
            price_at_purchase=Decimal('20.00'), seller=self.seller_b,
        )

    def _confirm(self, user):
        self.client.force_authenticate(user)
        return self.client.post(f'/api/marketplace/orders/{self.order.id}/confirm-payment/')

    def test_seller_confirmation_commits_only_their_own_lines(self):
        res = self._confirm(self.seller_a)
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        self.prod_a.refresh_from_db()
        self.prod_b.refresh_from_db()
        self.assertEqual(self.prod_a.quantity, 3)  # 5 - 2, committed
        self.assertEqual(self.prod_b.quantity, 5)  # seller B hasn't confirmed

        self.order.refresh_from_db()
        self.assertEqual(self.order.payment_status, 'PENDING')  # not all sellers in yet

    def test_order_becomes_paid_once_every_seller_confirms(self):
        self._confirm(self.seller_a)
        self._confirm(self.seller_b)

        self.order.refresh_from_db()
        self.assertEqual(self.order.payment_status, 'PAID')
        self.assertEqual(self.order.status, 'PROCESSING')
        self.prod_b.refresh_from_db()
        self.assertEqual(self.prod_b.quantity, 4)

    def test_confirmation_is_idempotent(self):
        self._confirm(self.seller_a)
        self._confirm(self.seller_a)
        self._confirm(self.seller_a)

        self.prod_a.refresh_from_db()
        self.assertEqual(self.prod_a.quantity, 3)  # decremented exactly once

    def test_buyer_cannot_confirm_payment(self):
        res = self._confirm(self.buyer)
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.prod_a.refresh_from_db()
        self.assertEqual(self.prod_a.quantity, 5)

    def test_unrelated_seller_cannot_confirm(self):
        # 404 rather than 403: get_queryset() scopes orders to buyer-or-seller,
        # so an outsider never resolves the object — it doesn't leak that the
        # order exists. The buyer, who IS in that queryset, gets the explicit 403.
        outsider = User.objects.create_user(username='dpout', email='dpout@test.local', password='pw')
        res = self._confirm(outsider)
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_confirmation_rejected_when_stock_ran_out(self):
        # Nothing is reserved at checkout, so the seller may confirm too late.
        self.prod_a.quantity = 1
        self.prod_a.save(update_fields=['quantity'])

        res = self._confirm(self.seller_a)
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.prod_a.refresh_from_db()
        self.assertEqual(self.prod_a.quantity, 1)  # never goes negative

    def test_cancelling_after_confirmation_returns_stock(self):
        # Sole-seller order (drop seller B's line) — a seller may only cancel an
        # order they solely own; multi-seller cancel is covered in
        # MultiSellerCancelTests.
        self.item_b.delete()

        self._confirm(self.seller_a)
        self.prod_a.refresh_from_db()
        self.assertEqual(self.prod_a.quantity, 3)

        self.client.force_authenticate(self.seller_a)
        res = self.client.post(
            f'/api/marketplace/orders/{self.order.id}/update_status/', {'status': 'CANCELLED'},
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        self.prod_a.refresh_from_db()
        self.assertEqual(self.prod_a.quantity, 5)  # handed back
        self.item_a.refresh_from_db()
        self.assertFalse(self.item_a.stock_committed)

    def test_cannot_confirm_a_cancelled_order(self):
        self.order.status = 'CANCELLED'
        self.order.save(update_fields=['status'])

        res = self._confirm(self.seller_a)
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.prod_a.refresh_from_db()
        self.assertEqual(self.prod_a.quantity, 5)

    def test_stripe_path_does_not_double_decrement_confirmed_lines(self):
        self._confirm(self.seller_a)  # direct-pay commits A
        StripeWebhookView._fulfill_order(self.order.id)  # legacy path runs too

        self.prod_a.refresh_from_db()
        self.prod_b.refresh_from_db()
        self.assertEqual(self.prod_a.quantity, 3)  # NOT decremented twice
        self.assertEqual(self.prod_b.quantity, 4)


class ProductReviewTests(APITestCase):
    """Reviews hang off the nested product route, which keys on slug."""

    def setUp(self):
        cache.clear()
        self.seller = User.objects.create_user(username='rvseller', email='rvs@test.local', password='pw')
        self.buyer = User.objects.create_user(username='rvbuyer', email='rvb@test.local', password='pw')
        self.other = User.objects.create_user(username='rvother', email='rvo@test.local', password='pw')
        self.product = Product.objects.create(
            seller=self.seller, title='Kalimba', description='d',
            price=Decimal('15.00'), quantity=4, slug='rv-kalimba',
        )
        self.decoy = Product.objects.create(
            seller=self.seller, title='Decoy', description='d',
            price=Decimal('15.00'), quantity=4, slug='rv-decoy',
        )
        ProductReview.objects.create(product=self.decoy, reviewer=self.other, rating=1, comment='decoy')

    def _url(self, slug=None):
        return f'/api/marketplace/products/{slug or self.product.slug}/reviews/'

    def test_create_review_succeeds_and_attaches_to_the_right_product(self):
        self.client.force_authenticate(self.buyer)
        res = self.client.post(self._url(), {'rating': 5, 'comment': 'Lovely tone'})
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)

        review = ProductReview.objects.get(product=self.product, reviewer=self.buyer)
        self.assertEqual(review.rating, 5)

    def test_list_returns_only_this_products_reviews(self):
        ProductReview.objects.create(product=self.product, reviewer=self.buyer, rating=4, comment='good')
        res = self.client.get(self._url())
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        comments = [r['comment'] for r in res.data]
        self.assertEqual(comments, ['good'])  # the decoy product's review is excluded

    def test_second_review_updates_instead_of_500ing_on_unique_together(self):
        self.client.force_authenticate(self.buyer)
        self.client.post(self._url(), {'rating': 2, 'comment': 'first'})
        res = self.client.post(self._url(), {'rating': 5, 'comment': 'changed my mind'})

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(ProductReview.objects.filter(product=self.product, reviewer=self.buyer).count(), 1)
        review = ProductReview.objects.get(product=self.product, reviewer=self.buyer)
        self.assertEqual(review.rating, 5)
        self.assertEqual(review.comment, 'changed my mind')

    def test_body_cannot_retarget_the_review_at_another_product(self):
        self.client.force_authenticate(self.buyer)
        res = self.client.post(
            self._url(), {'rating': 5, 'comment': 'x', 'product': self.decoy.id},
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        # 'product' is read-only, so the route's slug wins over the body.
        self.assertTrue(ProductReview.objects.filter(product=self.product, reviewer=self.buyer).exists())
        self.assertFalse(ProductReview.objects.filter(product=self.decoy, reviewer=self.buyer).exists())

    def test_product_payload_carries_real_rating_aggregates(self):
        ProductReview.objects.create(product=self.product, reviewer=self.buyer, rating=4, comment='a')
        ProductReview.objects.create(product=self.product, reviewer=self.other, rating=5, comment='b')

        res = self.client.get(f'/api/marketplace/products/{self.product.slug}/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['average_rating'], 4.5)
        self.assertEqual(res.data['review_count'], 2)

    def test_unreviewed_product_reports_null_rating_not_a_fake_one(self):
        res = self.client.get(f'/api/marketplace/products/{self.product.slug}/')
        self.assertIsNone(res.data['average_rating'])
        self.assertEqual(res.data['review_count'], 0)


class WishlistTests(APITestCase):
    """Wishlist add/remove/read, and the is_wishlisted flag products carry."""

    def setUp(self):
        cache.clear()
        self.seller = User.objects.create_user(username='wlseller', email='wls@test.local', password='pw')
        self.user = User.objects.create_user(username='wluser', email='wlu@test.local', password='pw')
        self.product = Product.objects.create(
            seller=self.seller, title='Shaker', description='d',
            price=Decimal('7.00'), quantity=9, slug='wl-shaker',
        )

    def test_my_wishlist_creates_and_returns_a_single_object(self):
        self.client.force_authenticate(self.user)
        res = self.client.get('/api/marketplace/wishlist/my_wishlist/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['products'], [])

    def test_add_then_remove_round_trips(self):
        self.client.force_authenticate(self.user)

        add = self.client.post('/api/marketplace/wishlist/add_product/', {'product_id': self.product.id})
        self.assertEqual(add.status_code, status.HTTP_200_OK)
        res = self.client.get('/api/marketplace/wishlist/my_wishlist/')
        self.assertEqual(len(res.data['products']), 1)

        rm = self.client.post('/api/marketplace/wishlist/remove_product/', {'product_id': self.product.id})
        self.assertEqual(rm.status_code, status.HTTP_200_OK)
        res = self.client.get('/api/marketplace/wishlist/my_wishlist/')
        self.assertEqual(res.data['products'], [])

    def test_remove_without_an_existing_wishlist_is_a_no_op_not_404(self):
        self.client.force_authenticate(self.user)
        res = self.client.post('/api/marketplace/wishlist/remove_product/', {'product_id': self.product.id})
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_is_wishlisted_reflects_server_state(self):
        self.client.force_authenticate(self.user)
        before = self.client.get(f'/api/marketplace/products/{self.product.slug}/')
        self.assertFalse(before.data['is_wishlisted'])

        self.client.post('/api/marketplace/wishlist/add_product/', {'product_id': self.product.id})
        after = self.client.get(f'/api/marketplace/products/{self.product.slug}/')
        self.assertTrue(after.data['is_wishlisted'])

    def test_is_wishlisted_is_false_for_anonymous_callers(self):
        res = self.client.get(f'/api/marketplace/products/{self.product.slug}/')
        self.assertFalse(res.data['is_wishlisted'])


class MultiSellerCancelTests(APITestCase):
    """A shared order status must not let one seller act on another seller's
    lines — the concrete hole being: seller B cancelling releases seller A's
    already-committed stock."""

    def setUp(self):
        cache.clear()
        self.seller_a = User.objects.create_user('msca', 'msca@t.local', 'pw')
        self.seller_b = User.objects.create_user('mscb', 'mscb@t.local', 'pw')
        self.buyer = User.objects.create_user('mscbuyer', 'mscbuyer@t.local', 'pw')
        self.pa = Product.objects.create(seller=self.seller_a, title='A', description='d',
                                         price=Decimal('10'), quantity=5, slug='msc-a')
        self.pb = Product.objects.create(seller=self.seller_b, title='B', description='d',
                                         price=Decimal('20'), quantity=5, slug='msc-b')
        self.order = Order.objects.create(buyer=self.buyer, status='PENDING', total_amount=Decimal('30'))
        self.ia = OrderItem.objects.create(order=self.order, product=self.pa, quantity=2,
                                           price_at_purchase=Decimal('10'), seller=self.seller_a)
        self.ib = OrderItem.objects.create(order=self.order, product=self.pb, quantity=1,
                                           price_at_purchase=Decimal('20'), seller=self.seller_b)

    def _status(self, user, s):
        self.client.force_authenticate(user)
        return self.client.post(f'/api/marketplace/orders/{self.order.id}/update_status/', {'status': s})

    def test_a_seller_cannot_cancel_a_multi_seller_order(self):
        # Seller A confirms — their stock is committed (5 -> 3).
        self.client.force_authenticate(self.seller_a)
        self.client.post(f'/api/marketplace/orders/{self.order.id}/confirm-payment/')
        self.pa.refresh_from_db()
        self.assertEqual(self.pa.quantity, 3)

        res = self._status(self.seller_b, 'CANCELLED')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

        self.order.refresh_from_db()
        self.pa.refresh_from_db()
        self.assertEqual(self.order.status, 'PENDING')   # not cancelled
        self.assertEqual(self.pa.quantity, 3)            # A's sale intact

    def test_seller_can_still_advance_fulfilment_on_a_multi_seller_order(self):
        res = self._status(self.seller_b, 'SHIPPED')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_sole_seller_can_cancel_and_reclaim_their_own_stock(self):
        # Single-seller order: seller B removed, A is the only seller.
        self.ib.delete()
        self.client.force_authenticate(self.seller_a)
        self.client.post(f'/api/marketplace/orders/{self.order.id}/confirm-payment/')
        self.pa.refresh_from_db()
        self.assertEqual(self.pa.quantity, 3)

        res = self._status(self.seller_a, 'CANCELLED')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.pa.refresh_from_db()
        self.assertEqual(self.pa.quantity, 5)            # handed back

    def test_buyer_cannot_cancel_once_a_seller_has_confirmed_payment(self):
        # Direct-pay: a confirmed line means money already moved off-platform.
        self.client.force_authenticate(self.seller_a)
        self.client.post(f'/api/marketplace/orders/{self.order.id}/confirm-payment/')

        res = self._status(self.buyer, 'CANCELLED')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, 'PENDING')

    def test_buyer_can_cancel_a_fully_unconfirmed_order(self):
        res = self._status(self.buyer, 'CANCELLED')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, 'CANCELLED')


class OrderRoleFilterTests(APITestCase):
    """?role=buyer / ?role=seller keep purchases and sales from bleeding into
    each other's screens for a user who does both."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('roleuser', 'role@t.local', 'pw')
        self.other = User.objects.create_user('roleother', 'roleother@t.local', 'pw')

        # An order the user BOUGHT (someone else sells).
        p_other = Product.objects.create(seller=self.other, title='O', description='d',
                                         price=Decimal('5'), quantity=9, slug='role-o')
        self.bought = Order.objects.create(buyer=self.user, status='PENDING', total_amount=Decimal('5'))
        OrderItem.objects.create(order=self.bought, product=p_other, quantity=1,
                                 price_at_purchase=Decimal('5'), seller=self.other)

        # An order the user SOLD (someone else buys).
        p_mine = Product.objects.create(seller=self.user, title='M', description='d',
                                        price=Decimal('7'), quantity=9, slug='role-m')
        self.sold = Order.objects.create(buyer=self.other, status='PENDING', total_amount=Decimal('7'))
        OrderItem.objects.create(order=self.sold, product=p_mine, quantity=1,
                                 price_at_purchase=Decimal('7'), seller=self.user)

    def _ids(self, res):
        rows = res.data['results'] if isinstance(res.data, dict) and 'results' in res.data else res.data
        return {o['id'] for o in rows}

    def test_no_role_returns_both(self):
        self.client.force_authenticate(self.user)
        ids = self._ids(self.client.get('/api/marketplace/orders/'))
        self.assertEqual(ids, {self.bought.id, self.sold.id})

    def test_role_buyer_is_purchases_only(self):
        self.client.force_authenticate(self.user)
        ids = self._ids(self.client.get('/api/marketplace/orders/', {'role': 'buyer'}))
        self.assertEqual(ids, {self.bought.id})

    def test_role_seller_is_sales_only(self):
        self.client.force_authenticate(self.user)
        ids = self._ids(self.client.get('/api/marketplace/orders/', {'role': 'seller'}))
        self.assertEqual(ids, {self.sold.id})

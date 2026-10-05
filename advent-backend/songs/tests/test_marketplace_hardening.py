"""Marketplace hardening: a buyer cannot make themselves a "buyer" by saying
an unsent order arrived; sent orders aren't cancelled; only pictures, and not
too many; sellers' numbers stay with signed-in people; "Popular" weighs more
than looks; the admin switch closes trading; every title gets a link.

    python manage.py test songs.tests.test_marketplace_hardening --settings=music.settings_test
"""
import io
from decimal import Decimal
from unittest import mock

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image as PILImage
from rest_framework.test import APITestCase

from songs import app_settings
from songs.models import Order, OrderItem, Product, ProductImage, User, Wishlist
from songs.serializers.marketplace import MAX_PRODUCT_IMAGES

from .test_marketplace_orders import TwoSellerOrderMixin, make


def png(name='p.png'):
    buf = io.BytesIO()
    PILImage.new('RGB', (4, 4), 'red').save(buf, 'PNG')
    return SimpleUploadedFile(name, buf.getvalue(), content_type='image/png')


@mock.patch('songs.views.marketplace.notify_user')
class ReceivedTests(TwoSellerOrderMixin, APITestCase):
    def test_a_buyer_cannot_mark_an_unpaid_unsent_order_received(self, notify):
        res = self.post(self.buyer, 'received')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['code'], 'not_sent')
        self.assertFalse(OrderItem.objects.filter(delivered_at__isnull=False).exists())
        # ...so they cannot review it as someone who bought it.
        self.client.force_authenticate(self.buyer)
        res = self.client.post(f'/api/marketplace/products/{self.pa.slug}/reviews/', {'rating': 5}, format='json')
        self.assertEqual(res.status_code, 403)

    def test_paid_and_handed_over_counts(self, notify):
        self.post(self.a, 'confirm-payment')
        res = self.post(self.buyer, 'received')
        self.assertEqual(res.status_code, 200, res.data)
        self.ia.refresh_from_db()
        self.ib.refresh_from_db()
        self.assertIsNotNone(self.ia.delivered_at)
        self.assertIsNone(self.ib.delivered_at)        # B was neither paid nor sent


@mock.patch('songs.views.marketplace.notify_user')
class CancelAfterSendingTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.seller = User.objects.create_user('seller', 's@x.com', 'pw')
        self.buyer = User.objects.create_user('buyer', 'b@x.com', 'pw')
        self.product = make(self.seller, 'Hymnal', quantity=3)
        self.order = Order.objects.create(buyer=self.buyer, total_amount=Decimal('10'))
        OrderItem.objects.create(order=self.order, product=self.product, quantity=1, title='Hymnal',
                                 price_at_purchase=Decimal('10'), seller=self.seller)

    def test_a_sole_seller_cannot_cancel_what_was_sent(self, notify):
        self.client.force_authenticate(self.seller)
        base = f'/api/marketplace/orders/{self.order.id}'
        self.client.post(f'{base}/confirm-payment/')
        self.client.post(f'{base}/ship/')
        res = self.client.post(f'{base}/update_status/', {'status': 'CANCELLED'})
        self.assertEqual(res.status_code, 400)
        self.product.refresh_from_db()
        self.assertEqual(self.product.quantity, 2)     # stock not handed back


class PhotoTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.seller = User.objects.create_user('seller', 's@x.com', 'pw')
        self.product = make(self.seller, 'Hymnal')
        self.client.force_authenticate(self.seller)
        self.url = f'/api/marketplace/products/{self.product.slug}/upload-images/'

    @mock.patch('songs.r2.upload_file', return_value='https://cdn.example/x.png')
    def test_only_pictures_are_uploaded(self, upload):
        bad = SimpleUploadedFile('x.png', b'<script>alert(1)</script>', content_type='image/png')
        res = self.client.post(self.url, {'images': [bad]}, format='multipart')
        self.assertEqual(res.status_code, 400)
        upload.assert_not_called()
        res = self.client.post(self.url, {'images': [png()]}, format='multipart')
        self.assertEqual(res.status_code, 201, res.data)

    @mock.patch('songs.r2.upload_file', return_value='https://cdn.example/x.png')
    def test_no_more_than_the_cap(self, upload):
        for _ in range(MAX_PRODUCT_IMAGES):
            ProductImage.objects.create(product=self.product, image='https://cdn.example/a.png')
        res = self.client.post(self.url, {'images': [png()]}, format='multipart')
        self.assertEqual(res.status_code, 400)
        upload.assert_not_called()


class PrivacyTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.seller = User.objects.create_user('seller', 's@x.com', 'pw')
        self.product = make(self.seller, 'Hymnal', mpesa_number='0712', whatsapp_number='+254712345678',
                            location='Nairobi')

    def test_numbers_are_for_people_signed_in(self):
        anon = self.client.get(f'/api/marketplace/products/{self.product.slug}/').data
        self.assertNotIn('mpesa_number', anon)
        self.assertNotIn('whatsapp_number', anon)
        self.assertEqual(anon['location'], 'Nairobi')
        listed = self.client.get('/api/marketplace/products/').data['results'][0]
        self.assertNotIn('mpesa_number', listed)
        self.client.force_authenticate(User.objects.create_user('buyer', 'b@x.com', 'pw'))
        signed_in = self.client.get(f'/api/marketplace/products/{self.product.slug}/').data
        self.assertEqual(signed_in['mpesa_number'], '0712')


class PopularTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.seller = User.objects.create_user('seller', 's@x.com', 'pw')

    def popular(self):
        return [p['title'] for p in self.client.get('/api/marketplace/products/?sort=popular').data['results']]

    def test_saves_and_sales_count_more_than_looks(self):
        looked = make(self.seller, 'Looked at')
        Product.objects.filter(pk=looked.pk).update(views=8)
        saved = make(self.seller, 'Saved')
        Product.objects.filter(pk=saved.pk).update(views=2)
        for n in range(2):
            user = User.objects.create_user(f'w{n}', f'w{n}@x.com', 'pw')
            Wishlist.objects.create(user=user).products.add(saved)
        sold = make(self.seller, 'Sold')
        buyer = User.objects.create_user('buyer', 'b@x.com', 'pw')
        order = Order.objects.create(buyer=buyer, total_amount=Decimal('10'))
        from django.utils import timezone
        OrderItem.objects.create(order=order, product=sold, quantity=1, price_at_purchase=Decimal('10'),
                                 seller=self.seller, payment_confirmed_at=timezone.now())
        self.assertEqual(self.popular(), ['Sold', 'Saved', 'Looked at'])

    def test_a_look_counts_once_a_day(self):
        p = make(self.seller, 'Hymnal')
        viewer = User.objects.create_user('v', 'v@x.com', 'pw')
        self.client.force_authenticate(viewer)
        for _ in range(3):
            self.client.get(f'/api/marketplace/products/{p.slug}/')
        p.refresh_from_db()
        self.assertEqual(p.views, 1)


class SwitchTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.seller = User.objects.create_user('seller', 's@x.com', 'pw')
        self.buyer = User.objects.create_user('buyer', 'b@x.com', 'pw')
        self.product = make(self.seller, 'Hymnal')
        app_settings.save('features', {'marketplace': False}, self.seller)

    def tearDown(self):
        cache.clear()

    def test_closed_means_nothing_new_is_ordered(self):
        self.client.force_authenticate(self.buyer)
        res = self.client.post('/api/marketplace/cart/add-item/', {'product_id': self.product.id}, format='json')
        self.assertEqual(res.status_code, 403)
        res = self.client.post('/api/marketplace/cart/buy_now/', {'product_id': self.product.id}, format='json')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data['code'], 'feature_off')
        # Browsing still answers (the app shows its own "closed" page).
        self.assertEqual(self.client.get('/api/marketplace/products/').status_code, 200)


class SlugTests(APITestCase):
    def test_a_title_without_latin_letters_still_gets_a_link(self):
        seller = User.objects.create_user('seller', 's@x.com', 'pw')
        a = make(seller, '🔥🔥')
        b = make(seller, 'ሰላም')
        self.assertEqual(a.slug, 'item')
        self.assertEqual(b.slug, 'item-1')

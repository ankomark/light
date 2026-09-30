"""Marketplace phase 1: browsing that works, orders that remember, money that
adds up.

    python manage.py test songs.tests.test_marketplace_browse
"""
from decimal import Decimal

from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from songs.models import (
    Cart, CartItem, Order, OrderItem, Product, ProductCategory, ProductImage, User,
)


def make(seller, title, price='10.00', **extra):
    return Product.objects.create(
        seller=seller, title=title, description=extra.pop('description', 'a thing'),
        price=Decimal(price), quantity=extra.pop('quantity', 5), **extra,
    )


class BrowseTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.seller = User.objects.create_user('seller', 's@x.com', 'pw')
        self.buyer = User.objects.create_user('buyer', 'b@x.com', 'pw')
        self.books = ProductCategory.objects.create(name='Books')
        self.music = ProductCategory.objects.create(name='Music')
        self.hymnal = make(self.seller, 'Hymnal', '12.00', category=self.books,
                           description='Songs of praise, hardback')
        self.bible = make(self.seller, 'Study Bible', '30.00', category=self.books, location='Nairobi')
        self.guitar = make(self.seller, 'Guitar', '90.00', category=self.music, condition='USED')
        self.gone = make(self.seller, 'Sold out songbook', '5.00', category=self.books, quantity=0)
        self.hidden = make(self.seller, 'Withdrawn', '5.00', category=self.books, is_available=False)

    def titles(self, query=''):
        res = self.client.get(f'/api/marketplace/products/{query}')
        self.assertEqual(res.status_code, 200, res.data)
        return [p['title'] for p in res.data['results']]

    def test_a_category_by_id_or_name_shows_only_that_category(self):
        self.assertEqual(sorted(self.titles(f'?category={self.books.id}')), ['Hymnal', 'Study Bible'])
        self.assertEqual(self.titles('?category=music'), ['Guitar'])

    def test_search_covers_the_whole_marketplace(self):
        self.assertEqual(self.titles('?q=praise'), ['Hymnal'])           # description
        self.assertEqual(self.titles('?q=nairobi'), ['Study Bible'])     # location
        self.assertEqual(self.titles('?q=music'), ['Guitar'])            # category name
        self.assertEqual(self.titles('?q=study bible'), ['Study Bible']) # every word

    def test_sort_and_price_range(self):
        self.assertEqual(self.titles('?sort=price_low'), ['Hymnal', 'Study Bible', 'Guitar'])
        self.assertEqual(self.titles('?sort=price_high'), ['Guitar', 'Study Bible', 'Hymnal'])
        self.assertEqual(self.titles('?min_price=20&max_price=50'), ['Study Bible'])
        self.assertEqual(self.titles('?condition=used'), ['Guitar'])
        # Nonsense is ignored, not a 500.
        self.assertEqual(len(self.titles('?min_price=abc&sort=wat')), 3)

    def test_sold_out_and_withdrawn_are_not_browsed(self):
        titles = self.titles()
        self.assertNotIn('Sold out songbook', titles)
        self.assertNotIn('Withdrawn', titles)

    def test_but_a_link_still_opens_them(self):
        res = self.client.get(f'/api/marketplace/products/{self.gone.slug}/')
        self.assertEqual(res.status_code, 200)

    def test_the_seller_sees_all_of_their_own(self):
        self.client.force_authenticate(self.seller)
        self.assertEqual(len(self.titles(f'?seller={self.seller.id}')), 5)
        self.client.force_authenticate(self.buyer)
        self.assertEqual(len(self.titles(f'?seller={self.seller.id}')), 3)


class CategoryTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('u', 'u@x.com', 'pw')
        self.admin = User.objects.create_user('a', 'a@x.com', 'pw', is_staff=True)
        self.books = ProductCategory.objects.create(name='Books')
        ProductCategory.objects.create(name='Empty')
        make(self.user, 'Hymnal', category=self.books)
        make(self.user, 'Gone', category=self.books, quantity=0)

    def test_anyone_can_read_with_counts_of_what_is_on_offer(self):
        res = self.client.get('/api/marketplace/categories/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data[0]['name'], 'Books')
        self.assertEqual(res.data[0]['product_count'], 1)
        self.assertEqual(res.data[1]['product_count'], 0)

    def test_only_staff_may_change_them(self):
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.post('/api/marketplace/categories/', {'name': 'X'}).status_code, 403)
        self.assertEqual(self.client.delete(f'/api/marketplace/categories/{self.books.id}/').status_code, 403)
        self.assertEqual(self.client.patch(f'/api/marketplace/categories/{self.books.id}/',
                                           {'name': 'Y'}).status_code, 403)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post('/api/marketplace/categories/', {'name': 'X'}).status_code, 201)


class OrderMemoryTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.seller = User.objects.create_user('seller', 's@x.com', 'pw')
        self.buyer = User.objects.create_user('buyer', 'b@x.com', 'pw')
        self.shillings = make(self.seller, 'Hymnal', '1200.00', currency='KES')
        self.dollars = make(self.seller, 'Guitar', '90.00', currency='USD')
        ProductImage.objects.create(product=self.shillings, image='https://cdn.example/hymnal.jpg')
        cart = Cart.objects.create(user=self.buyer)
        CartItem.objects.create(cart=cart, product=self.shillings, quantity=2)
        CartItem.objects.create(cart=cart, product=self.dollars, quantity=1)
        self.client.force_authenticate(self.buyer)

    def test_an_empty_cart_is_an_empty_cart_not_a_404(self):
        other = User.objects.create_user('new', 'n@x.com', 'pw')
        self.client.force_authenticate(other)
        res = self.client.get('/api/marketplace/cart/my_cart/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['items'], [])

    def test_the_cart_totals_each_currency_apart(self):
        res = self.client.get('/api/marketplace/cart/my_cart/')
        totals = {t['currency']: Decimal(t['amount']) for t in res.data['totals']}
        self.assertEqual(totals, {'KES': Decimal('2400.00'), 'USD': Decimal('90.00')})

    def test_a_line_taken_down_by_a_moderator_reads_as_not_for_sale(self):
        Product.objects.filter(pk=self.dollars.pk).update(is_removed=True)
        res = self.client.get('/api/marketplace/cart/my_cart/')
        lines = {i['product']['title']: i['product']['is_available'] for i in res.data['items']}
        self.assertEqual(lines, {'Hymnal': True, 'Guitar': False})

    def test_an_order_remembers_what_was_bought_after_it_is_deleted(self):
        order_id = self.client.post('/api/marketplace/cart/checkout/').data['id']
        self.shillings.delete()
        res = self.client.get(f'/api/marketplace/orders/{order_id}/')
        line = next(i for i in res.data['items'] if i['currency'] == 'KES')
        self.assertIsNone(line['product'])
        self.assertEqual(line['title'], 'Hymnal')
        self.assertEqual(line['image_url'], 'https://cdn.example/hymnal.jpg')
        totals = {t['currency']: Decimal(t['amount']) for t in res.data['totals']}
        self.assertEqual(totals, {'KES': Decimal('2400.00'), 'USD': Decimal('90.00')})

    def test_an_order_line_carries_the_sellers_payment_details_not_the_whole_product(self):
        self.shillings.mpesa_number = '0712345678'
        self.shillings.save()
        order_id = self.client.post('/api/marketplace/cart/checkout/').data['id']
        res = self.client.get(f'/api/marketplace/orders/{order_id}/')
        product = next(i for i in res.data['items'] if i['currency'] == 'KES')['product']
        self.assertEqual(product['mpesa_number'], '0712345678')
        self.assertNotIn('description', product)
        # A name and a picture — not the buyer's posts and follower counts.
        self.assertNotIn('social_posts', res.data['buyer'])
        self.assertEqual(res.data['buyer']['username'], 'buyer')

    def test_order_history_stays_a_few_queries(self):
        for _ in range(3):
            cart = Cart.objects.get(user=self.buyer)
            CartItem.objects.get_or_create(cart=cart, product=self.shillings, defaults={'quantity': 1})
            CartItem.objects.get_or_create(cart=cart, product=self.dollars, defaults={'quantity': 1})
            self.client.post('/api/marketplace/cart/checkout/')
        with CaptureQueriesContext(connection) as ctx:
            res = self.client.get('/api/marketplace/orders/?role=buyer')
        self.assertEqual(len(res.data['results'] if isinstance(res.data, dict) else res.data), 3)
        self.assertLessEqual(len(ctx.captured_queries), 8)


class BuyingTests(APITestCase):
    """Buy now, reviews from buyers only, and views that count."""

    def setUp(self):
        cache.clear()
        self.seller = User.objects.create_user('seller', 's@x.com', 'pw')
        self.buyer = User.objects.create_user('buyer', 'b@x.com', 'pw')
        self.hymnal = make(self.seller, 'Hymnal', '12.00', quantity=3)
        self.other = make(self.seller, 'Other', '5.00')
        self.client.force_authenticate(self.buyer)

    def test_buy_now_orders_just_this_and_leaves_the_cart_alone(self):
        cart = Cart.objects.create(user=self.buyer)
        CartItem.objects.create(cart=cart, product=self.other, quantity=1)
        res = self.client.post('/api/marketplace/cart/buy_now/',
                               {'product_id': self.hymnal.id, 'quantity': 2}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual([i['title'] for i in res.data['items']], ['Hymnal'])
        self.assertEqual(res.data['items'][0]['quantity'], 2)
        self.assertEqual(CartItem.objects.filter(cart=cart).count(), 1)

    def test_buy_now_respects_stock_and_ownership(self):
        res = self.client.post('/api/marketplace/cart/buy_now/',
                               {'product_id': self.hymnal.id, 'quantity': 9}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('Only 3', res.data['error'])
        self.client.force_authenticate(self.seller)
        res = self.client.post('/api/marketplace/cart/buy_now/',
                               {'product_id': self.hymnal.id}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertFalse(Order.objects.exists())

    def test_only_a_buyer_may_review_and_is_marked_verified(self):
        url = f'/api/marketplace/products/{self.hymnal.slug}/reviews/'
        res = self.client.post(url, {'rating': 5})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data['code'], 'not_a_buyer')
        page = self.client.get(f'/api/marketplace/products/{self.hymnal.slug}/').data
        self.assertFalse(page['can_review'])

        self.client.post('/api/marketplace/cart/buy_now/', {'product_id': self.hymnal.id}, format='json')
        page = self.client.get(f'/api/marketplace/products/{self.hymnal.slug}/').data
        self.assertTrue(page['can_review'])
        self.assertEqual(self.client.post(url, {'rating': 5}).status_code, 201)
        self.assertTrue(self.client.get(url).data[0]['verified']
                        if isinstance(self.client.get(url).data, list)
                        else self.client.get(url).data['results'][0]['verified'])

    def test_a_cancelled_order_is_not_a_purchase(self):
        order_id = self.client.post('/api/marketplace/cart/buy_now/',
                                    {'product_id': self.hymnal.id}, format='json').data['id']
        Order.objects.filter(pk=order_id).update(status='CANCELLED')
        url = f'/api/marketplace/products/{self.hymnal.slug}/reviews/'
        self.assertEqual(self.client.post(url, {'rating': 5}).status_code, 403)

    def test_a_view_counts_once_an_hour_and_not_the_sellers_own(self):
        url = f'/api/marketplace/products/{self.hymnal.slug}/'
        self.client.get(url)
        self.client.get(url)
        self.client.force_authenticate(self.seller)
        self.client.get(url)
        self.hymnal.refresh_from_db()
        self.assertEqual(self.hymnal.views, 1)


class ProductPageSpeedTests(APITestCase):
    """A page of what people are selling is a handful of queries, however
    many products, pictures and reviews are on it."""

    def test_twenty_products_in_a_few_queries(self):
        cache.clear()
        buyer = User.objects.create_user('b', 'b@x.com', 'pw')
        sellers = [User.objects.create_user(f's{i}', f's{i}@x.com', 'pw') for i in range(5)]
        for i in range(20):
            p = make(sellers[i % 5], f'Thing {i}')
            ProductImage.objects.create(product=p, image=f'https://cdn.example/{i}.jpg')
        self.client.force_authenticate(buyer)
        with CaptureQueriesContext(connection) as ctx:
            res = self.client.get('/api/marketplace/products/?page_size=20')
        self.assertEqual(len(res.data['results']), 20)
        self.assertLessEqual(len(ctx.captured_queries), 6)


class NewProductIsForSaleTests(APITestCase):
    """A product made from the app is for sale. The form is multipart (it
    carries photos), and a true/false field it leaves out used to be read as
    an unticked box: every product was saved not for sale, and so never
    shown to anyone browsing."""

    def test_a_product_made_without_saying_is_for_sale(self):
        seller = User.objects.create_user('ivy', 'i@x.com', 'pw')
        self.client.force_authenticate(seller)
        res = self.client.post('/api/marketplace/products/', {
            'title': 'Mechadisek', 'description': 'd', 'price': '10.00', 'currency': 'KES',
            'quantity': '80', 'condition': 'NEW', 'category': 'Music',
        }, format='multipart')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertTrue(Product.objects.get(title='Mechadisek').is_available)
        buyer = User.objects.create_user('mark', 'm@x.com', 'pw')
        self.client.force_authenticate(buyer)
        titles = [p['title'] for p in self.client.get('/api/marketplace/products/').data['results']]
        self.assertIn('Mechadisek', titles)

    def test_an_edit_that_leaves_it_out_does_not_take_it_off_sale(self):
        seller = User.objects.create_user('ivy', 'i@x.com', 'pw')
        p = make(seller, 'Hymnal')
        self.client.force_authenticate(seller)
        self.client.patch(f'/api/marketplace/products/{p.slug}/', {'title': 'Hymnal 2'}, format='multipart')
        p.refresh_from_db()
        self.assertTrue(p.is_available)

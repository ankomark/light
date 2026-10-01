"""The marketplace's fixed categories: sellers pick one, typing never makes a
new one, and the products listed before were moved into them.

    python manage.py test songs.tests.test_market_categories
"""
from decimal import Decimal
from importlib import import_module

from django.apps import apps
from django.core.cache import cache
from rest_framework.test import APITestCase

from songs.market_categories import NAMES, major_for
from songs.models import Product, ProductCategory, User


class FixedCategoryTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.seller = User.objects.create_user('ivy', 'i@x.com', 'pw')
        self.client.force_authenticate(self.seller)

    def post(self, category, title='Thing'):
        return self.client.post('/api/marketplace/products/', {
            'title': title, 'description': 'd', 'price': '10.00', 'currency': 'KES',
            'quantity': '2', 'condition': 'NEW', 'category': category,
        }, format='multipart')

    def test_the_list_is_there_from_the_start(self):
        names = {c['name'] for c in self.client.get('/api/marketplace/categories/').data}
        self.assertEqual(names, set(NAMES))

    def test_a_category_from_the_list_is_kept(self):
        res = self.post('Books & Bibles', 'Study Bible')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['category'], 'Books & Bibles')

    def test_typing_never_makes_a_new_category(self):
        before = ProductCategory.objects.count()
        res = self.post('viatu vya kanisa')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['category'], 'Shoes')
        res = self.post('Something nobody sells')
        self.assertEqual(res.data['category'], 'Other')
        self.assertEqual(ProductCategory.objects.count(), before)

    def test_an_edit_moves_it_to_another_listed_category(self):
        slug = self.post('Electronics', 'Radio').data['slug']
        res = self.client.patch(f'/api/marketplace/products/{slug}/', {'category': 'Music & Instruments'},
                                format='multipart')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['category'], 'Music & Instruments')

    def test_no_category_is_refused(self):
        self.assertEqual(self.post('  ').status_code, 400)


class MovingTheOldOnesTests(APITestCase):
    def test_typed_categories_are_folded_into_the_list_and_removed(self):
        seller = User.objects.create_user('mark', 'm@x.com', 'pw')
        typed = {name: ProductCategory.objects.create(name=name) for name in ('sneakers', 'Simu', 'Misc')}

        def make(title, category):
            return Product.objects.create(seller=seller, title=title, description='d', price=Decimal('5'),
                                          quantity=1, category=category)
        shoes = make('Air max', typed['sneakers'])
        phone = make('Old one', typed['Simu'])
        bible = make('Study Bible', typed['Misc'])        # the category says nothing; the title does
        loose = make('A thing', None)

        import_module('songs.migrations.0168_major_market_categories').to_majors(apps, None)

        for product, expected in ((shoes, 'Shoes'), (phone, 'Phones & Tablets'), (bible, 'Books & Bibles'),
                                  (loose, 'Other')):
            product.refresh_from_db()
            self.assertEqual(product.category.name, expected)
        self.assertEqual(set(ProductCategory.objects.values_list('name', flat=True)), set(NAMES))


class MatchingTests(APITestCase):
    def test_words_in_english_and_swahili(self):
        self.assertEqual(major_for('Toyota spare parts'), 'Vehicles & Parts')
        self.assertEqual(major_for('Mkoba wa ngozi'), 'Bags & Accessories')
        self.assertEqual(major_for('Maize seeds'), 'Farming & Agriculture')
        self.assertEqual(major_for('Irish potatoes'), 'Food & Drinks')
        self.assertEqual(major_for('', None, 'Hymnal'), 'Books & Bibles')
        self.assertEqual(major_for('scarves'), 'Bags & Accessories')

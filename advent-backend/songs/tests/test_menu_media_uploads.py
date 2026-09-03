"""Verify the hamburger-menu features that upload images now go to R2.

Communities and Marketplace were the Cloudinary-backed image features.
Their backends now push uploaded multipart files to R2 (r2.upload_file) and
store the returned URL. These tests mock the network call and assert a real
upload path runs and a URL — not a raw file / public_id — is persisted.

(Studios and Publications store base64 data-URIs in TextField columns — they
were never on Cloudinary and are intentionally untouched by the move. The old
separate church upload path is gone: churches are communities, so the group
cover test below covers it.)

    python manage.py test songs.tests.test_menu_media_uploads --settings=music.settings_test
"""
from decimal import Decimal
from io import BytesIO
from unittest import mock

from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APITestCase

from songs.models import Group, Product, ProductCategory, ProductImage, User

R2_URL = 'https://pub-test.r2.dev/{folder}/generated.jpg'


def _png():
    # A real 2x2 PNG — ImageField validation (Pillow) rejects fake bytes.
    buf = BytesIO()
    Image.new('RGB', (2, 2), (10, 22, 40)).save(buf, format='PNG')
    return SimpleUploadedFile('pic.png', buf.getvalue(), content_type='image/png')


@override_settings(R2_PUBLIC_BASE='https://pub-test.r2.dev')
class MenuMediaUploadTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('creator', 'c@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)


    @mock.patch('songs.serializers.groups.r2.upload_file',
                return_value=R2_URL.format(folder='group_covers'))
    def test_group_cover_uploads_to_r2(self, mock_up):
        res = self.client.post('/api/groups/', {
            'name': 'Youth Group', 'description': 'd', 'cover_image': _png(),
        }, format='multipart')
        self.assertIn(res.status_code, (200, 201), res.content[:300])
        mock_up.assert_called_once()
        group = Group.objects.get(name='Youth Group')
        self.assertEqual(group.cover_image, R2_URL.format(folder='group_covers'))

    @mock.patch('songs.views.marketplace.r2.upload_file',
                return_value=R2_URL.format(folder='products/images'))
    def test_product_images_upload_to_r2(self, mock_up):
        cat = ProductCategory.objects.create(name='Books')
        product = Product.objects.create(
            seller=self.user, title='Hymnal', description='d',
            price=Decimal('10.00'), quantity=3, category=cat,
        )
        res = self.client.post(
            f'/api/marketplace/products/{product.slug}/upload-images/',
            {'images': _png()}, format='multipart',
        )
        self.assertIn(res.status_code, (200, 201), res.content[:300])
        mock_up.assert_called_once()
        img = ProductImage.objects.get(product=product)
        self.assertEqual(img.image, R2_URL.format(folder='products/images'))

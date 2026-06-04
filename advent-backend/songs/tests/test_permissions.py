from decimal import Decimal

from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APITestCase

from songs.models import SocialPost, Product, User


class OwnershipPermissionTests(APITestCase):
    """IsOwnerOrReadOnly: users may read anything but only mutate their own."""

    def setUp(self):
        cache.clear()  # reset DRF throttle counters between tests
        self.alice = User.objects.create_user(username='alice', password='pw12345!')
        self.bob = User.objects.create_user(username='bob', password='pw12345!')

    # ---- SocialPost ----
    def test_non_owner_cannot_edit_post(self):
        post = SocialPost.objects.create(user=self.alice, content_type='image', caption='original')
        self.client.force_authenticate(self.bob)
        res = self.client.patch(f'/api/social-posts/{post.id}/', {'caption': 'hacked'})
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        post.refresh_from_db()
        self.assertEqual(post.caption, 'original')

    def test_non_owner_cannot_delete_post(self):
        post = SocialPost.objects.create(user=self.alice, content_type='image', caption='original')
        self.client.force_authenticate(self.bob)
        res = self.client.delete(f'/api/social-posts/{post.id}/')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(SocialPost.objects.filter(id=post.id).exists())

    def test_owner_can_delete_post(self):
        post = SocialPost.objects.create(user=self.alice, content_type='image', caption='original')
        self.client.force_authenticate(self.alice)
        res = self.client.delete(f'/api/social-posts/{post.id}/')
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(SocialPost.objects.filter(id=post.id).exists())

    def test_authenticated_user_can_read_others_posts(self):
        SocialPost.objects.create(user=self.alice, content_type='image', caption='public')
        self.client.force_authenticate(self.bob)
        res = self.client.get('/api/social-posts/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    # ---- Product ----
    def test_non_owner_cannot_delete_product(self):
        product = Product.objects.create(
            seller=self.alice, title='Study Bible', description='d',
            price=Decimal('9.99'), quantity=5,
        )
        self.client.force_authenticate(self.bob)
        res = self.client.delete(f'/api/marketplace/products/{product.slug}/')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(Product.objects.filter(id=product.id).exists())

    def test_owner_can_delete_product(self):
        product = Product.objects.create(
            seller=self.alice, title='Study Bible', description='d',
            price=Decimal('9.99'), quantity=5,
        )
        self.client.force_authenticate(self.alice)
        res = self.client.delete(f'/api/marketplace/products/{product.slug}/')
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Product.objects.filter(id=product.id).exists())

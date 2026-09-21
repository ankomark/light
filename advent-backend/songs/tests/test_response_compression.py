"""Guards the gzip middleware.

Feed and library payloads are deeply nested JSON with long R2 URLs repeated
across every row — exactly the shape gzip collapses. Losing the middleware
wouldn't break a single test or raise an error; responses would just silently
get several times bigger, and the app would feel slower on exactly the networks
that matter most. Hence an explicit test.
"""
from django.core.cache import cache
from rest_framework.test import APITestCase

from songs.models import User, SocialPost


class ResponseCompressionTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.viewer = User.objects.create_user(
            username='viewer', email='viewer@x.com', password='pw')
        self.client.force_authenticate(self.viewer)
        author = User.objects.create_user(
            username='author', email='author@x.com', password='pw')
        for i in range(20):
            SocialPost.objects.create(
                user=author, content_type='image',
                media_file=f'https://pub-abc123.r2.dev/social_media/images/photo_{i}.jpg',
                caption=f'A blessed Sabbath to everyone in the community, post {i}',
                tags='sabbath worship praise', location='Nairobi, Kenya',
                width=1080, height=1350,
            )

    def test_feed_page_is_gzipped_for_clients_that_ask(self):
        resp = self.client.get('/api/social-posts/', HTTP_ACCEPT_ENCODING='gzip')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get('Content-Encoding'), 'gzip')

    def test_gzip_is_a_large_saving_on_a_feed_page(self):
        plain = self.client.get('/api/social-posts/')
        gzipped = self.client.get('/api/social-posts/', HTTP_ACCEPT_ENCODING='gzip')
        ratio = len(gzipped.content) / len(plain.content)
        # Real captions vary more than these, so don't assert the ~0.05 this
        # fixture hits — just that compression is unambiguously happening.
        self.assertLess(
            ratio, 0.5,
            f'feed page compressed to {ratio:.0%} of its size — gzip is not working',
        )

    def test_client_that_does_not_ask_still_gets_readable_json(self):
        resp = self.client.get('/api/social-posts/')
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.get('Content-Encoding'))
        self.assertEqual(len(resp.json()['results']), 20)

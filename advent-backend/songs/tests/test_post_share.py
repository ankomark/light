"""Public shared-post landing page (/post/<id>/): rich preview + deep link + stores.

    python manage.py test songs.tests.test_post_share --settings=music.settings_test
"""
from django.test import TestCase, override_settings

from songs.models import User, SocialPost


@override_settings(
    APP_PLAY_STORE_URL='https://play.google.com/store/apps/details?id=com.ankom.streams',
    APP_STORE_URL='https://apps.apple.com/app/id0000000000',
    SHARE_FALLBACK_IMAGE='https://cdn.example/brand.png',
)
class PostSharePageTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('sharer', 's@x.com', 'x')

    def _get(self, post):
        return self.client.get(f'/post/{post.id}/')

    def test_image_post_has_preview_deeplink_and_stores(self):
        post = SocialPost.objects.create(
            user=self.user, caption='Praise the Lord!',
            content_type='image', media_file='https://cdn.example/pic.jpg',
        )
        html = self._get(post).content.decode()
        # Rich preview (thumbnail + title + caption).
        self.assertIn('og:image" content="https://cdn.example/pic.jpg"', html)
        self.assertIn('sharer on Adventist Life', html)              # og:title
        self.assertIn('Praise the Lord!', html)                      # caption in card + desc
        self.assertIn('twitter:card" content="summary_large_image"', html)
        # Deep link back to the exact post.
        self.assertIn(f'streams://post/{post.id}', html)
        # Download guidance for people without the app.
        self.assertIn("Don't have the app", html)
        self.assertIn('play.google.com/store', html)
        self.assertIn('apps.apple.com', html)

    def test_video_post_uses_its_poster_frame(self):
        post = SocialPost.objects.create(
            user=self.user, caption='Sermon clip',
            content_type='video', media_file='https://cdn.example/clip.mp4',
            thumbnail='https://cdn.example/poster.jpg',  # client-captured poster
        )
        html = self._get(post).content.decode()
        # The real poster frame is the preview image, not the brand fallback.
        self.assertIn('og:image" content="https://cdn.example/poster.jpg"', html)
        self.assertIn('og:video', html)  # video tag still present
        self.assertIn(f'streams://post/{post.id}', html)

    def test_video_without_poster_falls_back_to_brand(self):
        post = SocialPost.objects.create(
            user=self.user, caption='Clip', content_type='video',
            media_file='https://cdn.example/clip.mp4',  # no thumbnail captured
        )
        html = self._get(post).content.decode()
        self.assertIn('og:image" content="https://cdn.example/brand.png"', html)

    @override_settings(SHARE_FALLBACK_IMAGE='')  # no env override configured
    def test_default_fallback_is_self_hosted_brand_image(self):
        post = SocialPost.objects.create(
            user=self.user, caption='Clip', content_type='video',
            media_file='https://cdn.example/clip.mp4',
        )
        html = self._get(post).content.decode()
        # With no env override, the card points at the image we serve ourselves.
        self.assertIn('/share-og.png', html)

    def test_brand_image_endpoint_serves_png(self):
        res = self.client.get('/share-og.png')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res['Content-Type'], 'image/png')
        self.assertEqual(res.content[:8], b'\x89PNG\r\n\x1a\n')  # PNG magic bytes

    @override_settings(APP_STORE_URL='')  # iOS not published yet
    def test_only_configured_stores_appear(self):
        post = SocialPost.objects.create(
            user=self.user, caption='', content_type='image',
            media_file='https://cdn.example/pic.jpg',
        )
        html = self._get(post).content.decode()
        self.assertIn('play.google.com/store', html)   # Android shown
        self.assertNotIn('apps.apple.com', html)        # App Store hidden

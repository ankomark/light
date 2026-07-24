"""Studio logo/cover are R2 URLs now (moved off base64 data-URIs).

    python manage.py test songs.tests.test_studio_images --settings=music.settings_test
"""
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from songs.models import User


@override_settings(R2_PUBLIC_BASE='https://pub-test.r2.dev')
class StudioImageTests(APITestCase):
    LOGO = 'https://pub-test.r2.dev/cover_images/logo.jpg'
    COVER = 'https://pub-test.r2.dev/cover_images/cover.jpg'

    def setUp(self):
        self.user = User.objects.create_user('studioowner', 's@x.com', 'x')

    def test_list_returns_stored_r2_urls(self):
        self.client.force_authenticate(self.user)
        res = self.client.post('/api/video-studios/', {
            'name': 'HopeWorks Media', 'location': 'Nairobi',
            'service_types': ['editing'], 'logo': self.LOGO, 'cover_image': self.COVER,
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content)
        sid = res.json()['id']

        lst = self.client.get('/api/video-studios/')
        row = next(s for s in (lst.json().get('results') or lst.json()) if s['id'] == sid)
        self.assertEqual(row['logo'], self.LOGO)
        self.assertEqual(row['cover_image'], self.COVER)

    def test_missing_images_are_empty(self):
        self.client.force_authenticate(self.user)
        sid = self.client.post('/api/video-studios/', {
            'name': 'No Art Studio', 'location': 'Mombasa', 'service_types': ['recording'],
        }, format='json').json()['id']
        lst = self.client.get('/api/video-studios/')
        row = next(s for s in (lst.json().get('results') or lst.json()) if s['id'] == sid)
        self.assertEqual(row['logo'], '')
        self.assertEqual(row['cover_image'], '')

    def test_default_category_is_media(self):
        """Listings created without a category land in the legacy 'media' bucket."""
        self.client.force_authenticate(self.user)
        row = self.client.post('/api/video-studios/', {
            'name': 'Legacy Studio', 'location': 'Nairobi', 'service_types': ['editing'],
        }, format='json').json()
        self.assertEqual(row['category'], 'media')

    def test_new_category_and_freeform_service_types(self):
        """A hospitality listing accepts its own free-form service tags."""
        self.client.force_authenticate(self.user)
        res = self.client.post('/api/video-studios/', {
            'name': 'Palm Hotel', 'location': 'Diani', 'category': 'hospitality',
            'service_types': ['hotel', 'restaurant'],
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content)
        row = res.json()
        self.assertEqual(row['category'], 'hospitality')
        self.assertEqual(row['service_types'], ['hotel', 'restaurant'])

    def test_social_links_round_trip(self):
        """Optional web/social links persist and come back on the listing."""
        self.client.force_authenticate(self.user)
        res = self.client.post('/api/video-studios/', {
            'name': 'Palm Hotel', 'location': 'Diani', 'category': 'hospitality',
            'service_types': ['hotel'],
            'website_link': 'https://palmhotel.example',
            'instagram_link': 'https://instagram.com/palmhotel',
            'facebook_link': 'https://facebook.com/palmhotel',
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content)
        row = res.json()
        self.assertEqual(row['website_link'], 'https://palmhotel.example')
        self.assertEqual(row['instagram_link'], 'https://instagram.com/palmhotel')
        self.assertEqual(row['facebook_link'], 'https://facebook.com/palmhotel')

    def test_category_filter(self):
        """?category= narrows the directory to one bucket."""
        self.client.force_authenticate(self.user)
        self.client.post('/api/video-studios/', {
            'name': 'Media One', 'location': 'Nairobi', 'service_types': ['editing'],
        }, format='json')
        self.client.post('/api/video-studios/', {
            'name': 'Palm Hotel', 'location': 'Diani', 'category': 'hospitality',
            'service_types': ['hotel'],
        }, format='json')

        res = self.client.get('/api/video-studios/?category=hospitality')
        rows = res.json().get('results') or res.json()
        names = {r['name'] for r in rows}
        self.assertIn('Palm Hotel', names)
        self.assertNotIn('Media One', names)

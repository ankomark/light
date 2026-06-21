"""Studios list must serve logo/cover as cacheable URLs, not inline base64.

    python manage.py test songs.tests.test_studio_images
"""
from rest_framework import status
from rest_framework.test import APITestCase

from songs.models import User


class StudioImageTests(APITestCase):
    PNG_1PX = (
        'data:image/png;base64,'
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    )

    def setUp(self):
        self.user = User.objects.create_user('studioowner', 's@x.com', 'x')

    def test_list_serves_image_urls_not_base64(self):
        self.client.force_authenticate(self.user)
        res = self.client.post('/api/video-studios/', {
            'name': 'HopeWorks Media', 'location': 'Nairobi',
            'service_types': ['editing'], 'logo': self.PNG_1PX, 'cover_image': self.PNG_1PX,
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content)
        sid = res.json()['id']

        lst = self.client.get('/api/video-studios/')
        row = next(s for s in (lst.json().get('results') or lst.json()) if s['id'] == sid)
        self.assertNotIn('base64', row['logo'])
        self.assertIn(f'/video-studios/{sid}/logo/', row['logo'])
        self.assertIn(f'/video-studios/{sid}/cover/', row['cover_image'])

        # The image endpoint streams real PNG bytes, no auth required.
        self.client.force_authenticate(user=None)
        img = self.client.get(f'/api/video-studios/{sid}/logo/')
        self.assertEqual(img.status_code, 200)
        self.assertEqual(img['Content-Type'], 'image/png')
        self.assertEqual(img.content[:8], b'\x89PNG\r\n\x1a\n')

    def test_image_endpoint_404_when_no_image(self):
        self.client.force_authenticate(self.user)
        sid = self.client.post('/api/video-studios/', {
            'name': 'No Art Studio', 'location': 'Mombasa', 'service_types': ['recording'],
        }, format='json').json()['id']
        self.assertEqual(self.client.get(f'/api/video-studios/{sid}/cover/').status_code, 404)

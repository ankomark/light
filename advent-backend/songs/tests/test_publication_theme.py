"""Publication reading theme + inline (markdown) image round-trip.

    python manage.py test songs.tests.test_publication_theme
"""
from rest_framework import status
from rest_framework.test import APITestCase

from songs.models import User, Publication


class PublicationThemeTests(APITestCase):
    def setUp(self):
        self.author = User.objects.create_user('writer', 'w@x.com', 'x')
        self.client.force_authenticate(self.author)

    def test_theme_and_inline_image_persist(self):
        theme = {'bg': '#E8D9C0', 'text': '#3A2E20', 'font': 'serif', 'scale': 1}
        # An inline image is just a markdown image in the chapter body.
        body = 'Intro.\n\n![image](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==)\n\nMore.'
        res = self.client.post('/api/publications/', {
            'title': 'Themed Work', 'category': 'devotional', 'status': 'draft',
            'theme': theme,
            'chapters': [{'order': 1, 'title': 'One', 'body': body}],
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content)
        pid = res.json()['id']

        got = self.client.get(f'/api/publications/{pid}/').json()
        self.assertEqual(got['theme'], theme)
        self.assertIn('data:image/png;base64,', got['chapters'][0]['body'])

        # Editing the theme persists too.
        res = self.client.patch(f'/api/publications/{pid}/', {
            'title': 'Themed Work',
            'theme': {'bg': '#0A1628', 'text': '#E8ECF3', 'font': 'cinzel', 'scale': 0},
            'chapters': [{'order': 1, 'title': 'One', 'body': 'x'}],
        }, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(Publication.objects.get(pk=pid).theme['font'], 'cinzel')

    PNG_1PX = (
        'data:image/png;base64,'
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    )

    def test_list_serves_cover_url_detail_keeps_base64(self):
        res = self.client.post('/api/publications/', {
            'title': 'Cover Work', 'category': 'other', 'status': 'published',
            'cover': self.PNG_1PX, 'chapters': [{'order': 1, 'title': 'a', 'body': 'b'}],
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content)
        pid = res.json()['id']

        # List → cover is a URL, not base64.
        lst = self.client.get('/api/publications/')
        row = next(p for p in (lst.json().get('results') or lst.json()) if p['id'] == pid)
        self.assertNotIn('base64', row['cover'])
        self.assertIn(f'/publications/{pid}/cover/', row['cover'])

        # Detail keeps base64 (the editor reloads + re-saves it).
        self.assertIn('base64', self.client.get(f'/api/publications/{pid}/').json()['cover'])

        # The cover endpoint streams real PNG bytes, public.
        self.client.force_authenticate(user=None)
        img = self.client.get(f'/api/publications/{pid}/cover/')
        self.assertEqual(img.status_code, 200)
        self.assertEqual(img['Content-Type'], 'image/png')
        self.assertEqual(img.content[:8], b'\x89PNG\r\n\x1a\n')

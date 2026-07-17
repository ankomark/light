"""Publication reading theme + inline (markdown) image round-trip.

    python manage.py test songs.tests.test_publication_theme
"""
from django.test import override_settings
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

    COVER = 'https://pub-test.r2.dev/cover_images/pub.jpg'

    @override_settings(R2_PUBLIC_BASE='https://pub-test.r2.dev')
    def test_cover_is_r2_url_in_list_and_detail(self):
        # The cover moved off base64 to an R2 URL; inline body images stay base64.
        res = self.client.post('/api/publications/', {
            'title': 'Cover Work', 'category': 'other', 'status': 'published',
            'cover': self.COVER, 'chapters': [{'order': 1, 'title': 'a', 'body': 'b'}],
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content)
        pid = res.json()['id']

        lst = self.client.get('/api/publications/')
        row = next(p for p in (lst.json().get('results') or lst.json()) if p['id'] == pid)
        self.assertEqual(row['cover'], self.COVER)
        self.assertEqual(self.client.get(f'/api/publications/{pid}/').json()['cover'], self.COVER)

    def test_list_does_not_load_chapter_bodies(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        # A publication with a heavy chapter body (base64-image-like payload).
        self.client.post('/api/publications/', {
            'title': 'Heavy', 'category': 'other', 'status': 'published',
            'chapters': [{'order': 1, 'title': 'a', 'body': 'x' * 5000}],
        }, format='json')

        with CaptureQueriesContext(connection) as ctx:
            res = self.client.get('/api/publications/')
            self.assertEqual(res.status_code, 200)
        # The chapter_count annotation may JOIN the chapter table for a COUNT,
        # but NO query should load the heavy `body` column (that was the prefetch).
        loaded_bodies = any(
            'songs_chapter' in q['sql'] and 'body' in q['sql']
            for q in ctx.captured_queries
        )
        self.assertFalse(loaded_bodies, 'list is loading chapter bodies it never renders')
        # But detail still returns chapters.
        pid = (res.json().get('results') or res.json())[0]['id']
        detail = self.client.get(f'/api/publications/{pid}/')
        self.assertGreaterEqual(len(detail.json()['chapters']), 1)

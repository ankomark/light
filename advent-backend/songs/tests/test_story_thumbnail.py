"""A video story's poster: stored with the story, sent with it, and only
ever one of our own uploads.

    python manage.py test songs.tests.test_story_thumbnail --settings=music.settings_test
"""
from django.test import override_settings
from rest_framework.test import APITestCase

from songs.models import Story, User

BASE = 'https://media.test'


@override_settings(R2_PUBLIC_BASE=BASE)
class StoryThumbnailTests(APITestCase):
    def setUp(self):
        self.me = User.objects.create_user('st_me', 'st@x.com', 'pw')
        self.client.force_authenticate(self.me)

    def post(self, **extra):
        body = {'media_url': f'{BASE}/stories/v.mp4', 'media_file': 'stories/v.mp4', 'content_type': 'video',
                'caption': 'Choir', **extra}
        return self.client.post('/api/stories/', body, format='json')

    def test_a_video_story_keeps_its_poster_and_sends_it(self):
        res = self.post(thumbnail_url=f'{BASE}/posters/p.jpg')
        self.assertEqual(res.status_code, 201, res.content[:300])
        self.assertEqual(Story.objects.get().thumbnail_url, f'{BASE}/posters/p.jpg')
        feed = self.client.get('/api/stories/feed/').json()
        rows = feed if isinstance(feed, list) else feed.get('results', [])
        story = rows[0]['stories'][0]
        self.assertEqual(story['thumbnail_url'], f'{BASE}/posters/p.jpg')

    def test_a_poster_from_anywhere_else_is_refused(self):
        res = self.post(thumbnail_url='https://evil.example/p.jpg')
        self.assertEqual(res.status_code, 400)
        self.assertIn('thumbnail_url', res.json())

    def test_no_poster_is_fine(self):
        self.assertEqual(self.post().status_code, 201)
        self.assertEqual(Story.objects.get().thumbnail_url, '')

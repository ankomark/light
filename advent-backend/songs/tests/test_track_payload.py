"""The library list payload: what it carries, and what it must not.

Two things the music screen used to pay for on every open:
  - every track's full lyrics, so a page of 20 shipped 20 song texts to render
    a list of titles;
  - nothing at all for the comment count, so the client fetched each track's
    entire comment list just to call .length on it — one request per row.
"""
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from songs.models import User, Track, Comment, Like

LYRICS = ('Amazing grace, how sweet the sound\n' * 40)   # ~1.4 KB, a real song


class TrackListPayloadTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.viewer = User.objects.create_user(
            username='viewer', email='viewer@x.com', password='pw')
        self.artist = User.objects.create_user(
            username='artist', email='artist@x.com', password='pw')
        self.client.force_authenticate(self.viewer)
        self.tracks = [
            Track.objects.create(
                title=f'Hymn {i}', artist=self.artist, slug=f'hymn-{i}',
                audio_file='https://pub-test.r2.dev/audio_uploads/a.mp3',
                lyrics=LYRICS,
            )
            for i in range(20)
        ]

    def test_list_omits_lyrics_but_reports_whether_they_exist(self):
        resp = self.client.get('/api/tracks/')
        self.assertEqual(resp.status_code, 200)
        rows = resp.json()['results']
        self.assertEqual(len(rows), 20)
        for row in rows:
            self.assertNotIn('lyrics', row)
            self.assertTrue(row['has_lyrics'])

    def test_has_lyrics_is_false_when_there_are_none(self):
        Track.objects.create(
            title='Instrumental', artist=self.artist, slug='instrumental',
            audio_file='https://pub-test.r2.dev/audio_uploads/b.mp3',
            lyrics='   ',   # whitespace only is not lyrics
        )
        rows = self.client.get('/api/tracks/').json()['results']
        row = next(r for r in rows if r['title'] == 'Instrumental')
        self.assertFalse(row['has_lyrics'])

    def test_dropping_lyrics_makes_the_page_much_smaller(self):
        size = len(self.client.get('/api/tracks/').content)
        # 20 tracks x ~1.4 KB of lyrics was ~28 KB of the old body. Assert well
        # under that rather than an exact figure, which would be brittle.
        self.assertLess(
            size, 20_000,
            f'track list page is {size} bytes — lyrics may be back in the payload',
        )

    def test_lyrics_endpoint_serves_the_text_for_one_track(self):
        track = self.tracks[0]
        resp = self.client.get(f'/api/tracks/{track.id}/lyrics/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['lyrics'], LYRICS)
        self.assertEqual(resp.json()['id'], track.id)
        self.assertIn('max-age', resp['Cache-Control'])

    def test_detail_still_carries_lyrics(self):
        # The edit screen round-trips the full track, so retrieve must keep them.
        resp = self.client.get(f'/api/tracks/{self.tracks[0].id}/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['lyrics'], LYRICS)

    def test_list_carries_counts_so_rows_need_no_extra_requests(self):
        track = self.tracks[0]
        Comment.objects.create(track=track, user=self.viewer, content='Amen')
        Comment.objects.create(track=track, user=self.artist, content='Praise')
        Comment.objects.create(
            track=track, user=self.artist, content='hidden', is_removed=True)
        Like.objects.create(track=track, user=self.viewer)

        rows = self.client.get('/api/tracks/').json()['results']
        row = next(r for r in rows if r['id'] == track.id)
        self.assertEqual(row['comments_count'], 2)   # the takedown isn't counted
        self.assertEqual(row['likes_count'], 1)
        self.assertTrue(row['is_liked'])

    def test_list_query_count_is_flat_as_the_library_grows(self):
        with CaptureQueriesContext(connection) as small:
            self.client.get('/api/tracks/?page_size=5')
        with CaptureQueriesContext(connection) as large:
            self.client.get('/api/tracks/?page_size=20')
        self.assertEqual(
            len(small.captured_queries), len(large.captured_queries),
            'track list N+1: query count grows with the number of rows',
        )

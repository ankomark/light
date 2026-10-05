"""Favorites endpoint: reuses the track list's optimized queryset, so it must
return only liked tracks (with correct flags) and NOT scale queries per row.

    python manage.py test songs.tests.test_favorites --settings=music.settings_test
"""
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from songs.models import User, Track, Like, Profile


class FavoritesAPITests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('fav_user', 'favu@x.com', 'x')
        self.client.force_authenticate(self.user)

    def _like(self, i):
        # Distinct artist (+ profile) per track so a missing select_related on
        # artist__profile would show up as per-row query growth.
        artist = User.objects.create_user(f'fav_art{i}', f'fart{i}@x.com', 'x')
        Profile.objects.create(user=artist)
        track = Track.objects.create(title=f'Track {i}', artist=artist, audio_file='audio/x')
        Like.objects.create(user=self.user, track=track)
        return track

    def test_returns_only_liked_tracks_with_flags(self):
        liked = self._like(1)
        # An unliked track by another artist must not appear.
        other = User.objects.create_user('fav_other', 'favo@x.com', 'x')
        Track.objects.create(title='Unliked', artist=other, audio_file='audio/y')

        rows = self.client.get('/api/tracks/favorites/').json()
        self.assertEqual([r['id'] for r in rows], [liked.id])
        self.assertTrue(rows[0]['is_liked'])
        self.assertEqual(rows[0]['likes_count'], 1)

    def test_query_count_is_constant(self):
        def load_count():
            with CaptureQueriesContext(connection) as ctx:
                r = self.client.get('/api/tracks/favorites/')
                self.assertEqual(r.status_code, 200)
            return len(ctx.captured_queries)

        for i in range(2):
            self._like(i)
        few = load_count()
        for i in range(2, 7):
            self._like(i)
        many = load_count()
        # 7 favorites (7 distinct artists) must cost no more queries than 2.
        self.assertEqual(few, many, f'favorites scales per-row: {few} -> {many}')


class FavoritesListTests(APITestCase):
    """Newest like first; a song taken down, or of an account you blocked,
    isn't offered; list rows carry no lyrics text."""

    def test_order_takedowns_blocks_and_payload(self):
        from django.utils import timezone
        from datetime import timedelta
        from songs.models import Block, Like, Track, User
        me = User.objects.create_user('fl_me', 'flm@x.com', 'x')
        choir = User.objects.create_user('fl_choir', 'flc@x.com', 'x')
        rude = User.objects.create_user('fl_rude', 'flr@x.com', 'x')
        old = Track.objects.create(title='Old like', artist=choir, audio_file='https://m/1.mp3', lyrics='words')
        new = Track.objects.create(title='New like', artist=choir, audio_file='https://m/2.mp3')
        gone = Track.objects.create(title='Taken down', artist=choir, audio_file='https://m/3.mp3', is_removed=True)
        hidden = Track.objects.create(title='Blocked', artist=rude, audio_file='https://m/4.mp3')
        for tr in (old, new, gone, hidden):
            Like.objects.create(user=me, track=tr)
        Like.objects.filter(track=old).update(created_at=timezone.now() - timedelta(days=3))
        Block.objects.create(blocker=me, blocked=rude)
        self.client.force_authenticate(me)
        rows = self.client.get('/api/tracks/favorites/').json()
        self.assertEqual([r['title'] for r in rows], ['New like', 'Old like'])
        self.assertNotIn('lyrics', rows[1])

"""Tests for the music subsystem: playlists, track list annotations/search,
and the notifications serialization regression.

Run with the project's test settings:
    python manage.py test songs.tests.test_music --settings=music.settings_test
"""
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APITestCase

from songs.models import User, Track, Playlist, Like, SocialPost, Notification


def make_track(artist, title='Song', album='', audio='audio/sample'):
    return Track.objects.create(title=title, artist=artist, album=album, audio_file=audio)


class PlaylistAPITests(APITestCase):
    def setUp(self):
        cache.clear()
        self.alice = User.objects.create_user(username='alice', password='pw12345!')
        self.bob = User.objects.create_user(username='bob', password='pw12345!')
        self.track = make_track(self.alice, title='Amazing Grace')

    def test_create_playlist_sets_owner(self):
        self.client.force_authenticate(self.alice)
        res = self.client.post('/api/playlists/', {'name': 'Worship'})
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        playlist = Playlist.objects.get(id=res.data['id'])
        self.assertEqual(playlist.user, self.alice)
        self.assertEqual(playlist.name, 'Worship')

    def test_list_returns_only_my_playlists(self):
        mine = Playlist.objects.create(user=self.alice, name='Mine')
        Playlist.objects.create(user=self.bob, name='Theirs')
        self.client.force_authenticate(self.alice)
        res = self.client.get('/api/playlists/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        ids = [p['id'] for p in res.data]
        self.assertIn(mine.id, ids)
        self.assertEqual(len(ids), 1)

    def test_list_uses_lightweight_serializer(self):
        playlist = Playlist.objects.create(user=self.alice, name='Mine')
        playlist.tracks.add(self.track)
        self.client.force_authenticate(self.alice)
        res = self.client.get('/api/playlists/')
        item = res.data[0]
        self.assertIn('track_count', item)
        self.assertIn('cover_images', item)
        self.assertNotIn('tracks', item)  # full track payload excluded from list
        self.assertEqual(item['track_count'], 1)

    def test_add_track(self):
        playlist = Playlist.objects.create(user=self.alice, name='Mine')
        self.client.force_authenticate(self.alice)
        res = self.client.post(f'/api/playlists/{playlist.id}/add-track/', {'track_id': self.track.id})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['track_count'], 1)
        self.assertTrue(playlist.tracks.filter(id=self.track.id).exists())

    def test_remove_track(self):
        playlist = Playlist.objects.create(user=self.alice, name='Mine')
        playlist.tracks.add(self.track)
        self.client.force_authenticate(self.alice)
        res = self.client.post(f'/api/playlists/{playlist.id}/remove-track/', {'track_id': self.track.id})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertFalse(playlist.tracks.filter(id=self.track.id).exists())

    def test_non_owner_cannot_add_track(self):
        playlist = Playlist.objects.create(user=self.alice, name='Mine')
        self.client.force_authenticate(self.bob)
        res = self.client.post(f'/api/playlists/{playlist.id}/add-track/', {'track_id': self.track.id})
        # Scoped queryset hides others' playlists -> 404 (still denied).
        self.assertIn(res.status_code, (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND))
        self.assertFalse(playlist.tracks.filter(id=self.track.id).exists())

    def test_non_owner_cannot_delete(self):
        playlist = Playlist.objects.create(user=self.alice, name='Mine')
        self.client.force_authenticate(self.bob)
        res = self.client.delete(f'/api/playlists/{playlist.id}/')
        self.assertIn(res.status_code, (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND))
        self.assertTrue(Playlist.objects.filter(id=playlist.id).exists())

    def test_owner_can_delete(self):
        playlist = Playlist.objects.create(user=self.alice, name='Mine')
        self.client.force_authenticate(self.alice)
        res = self.client.delete(f'/api/playlists/{playlist.id}/')
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Playlist.objects.filter(id=playlist.id).exists())

    def test_detail_includes_tracks_and_count(self):
        playlist = Playlist.objects.create(user=self.alice, name='Mine')
        playlist.tracks.add(self.track)
        self.client.force_authenticate(self.alice)
        res = self.client.get(f'/api/playlists/{playlist.id}/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['track_count'], 1)
        self.assertEqual(len(res.data['tracks']), 1)
        self.assertEqual(res.data['tracks'][0]['id'], self.track.id)


class TrackListTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.alice = User.objects.create_user(username='alice', password='pw12345!')
        self.bob = User.objects.create_user(username='bob', password='pw12345!')
        self.grace = make_track(self.alice, title='Amazing Grace', album='Hymns')
        self.great = make_track(self.bob, title='How Great Thou Art', album='Classics')

    def _results(self, res):
        # Track list is paginated (StandardPagination).
        return res.data['results'] if isinstance(res.data, dict) else res.data

    def test_search_filters_by_title(self):
        self.client.force_authenticate(self.alice)
        res = self.client.get('/api/tracks/?search=amazing')
        titles = [t['title'] for t in self._results(res)]
        self.assertEqual(titles, ['Amazing Grace'])

    def test_search_matches_artist_username(self):
        self.client.force_authenticate(self.alice)
        res = self.client.get('/api/tracks/?search=bob')
        ids = [t['id'] for t in self._results(res)]
        self.assertEqual(ids, [self.great.id])

    def test_likes_count_and_is_liked_annotation(self):
        Like.objects.create(user=self.alice, track=self.grace)

        self.client.force_authenticate(self.alice)
        res = self.client.get('/api/tracks/')
        by_id = {t['id']: t for t in self._results(res)}
        self.assertEqual(by_id[self.grace.id]['likes_count'], 1)
        self.assertTrue(by_id[self.grace.id]['is_liked'])

        # A different user sees the same count but is_liked False.
        self.client.force_authenticate(self.bob)
        res = self.client.get('/api/tracks/')
        by_id = {t['id']: t for t in self._results(res)}
        self.assertEqual(by_id[self.grace.id]['likes_count'], 1)
        self.assertFalse(by_id[self.grace.id]['is_liked'])


class NotificationSerializationTests(APITestCase):
    """Regression: a notification whose track's artist has a song-bearing post
    used to recurse infinitely (track.artist -> social_posts -> post.song ->
    track.artist ...) and return HTTP 500. It must now serialize cleanly."""

    def setUp(self):
        cache.clear()
        self.alice = User.objects.create_user(username='alice', password='pw12345!')
        self.bob = User.objects.create_user(username='bob', password='pw12345!')

    def test_notifications_list_with_song_post_does_not_recurse(self):
        track = make_track(self.bob, title='Doxology')
        # The recursion trigger: the track's artist has a post featuring a song.
        SocialPost.objects.create(user=self.bob, content_type='image', song=track)
        Notification.objects.create(
            recipient=self.alice, sender=self.bob,
            message='bob liked your track', notification_type='like', track=track,
        )

        self.client.force_authenticate(self.alice)
        res = self.client.get('/api/notifications/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_notification_payload_is_lightweight(self):
        track = make_track(self.bob, title='Doxology')
        post = SocialPost.objects.create(user=self.bob, content_type='image', caption='hi')
        Notification.objects.create(
            recipient=self.alice, sender=self.bob,
            message='commented', notification_type='comment', post=post, track=track,
        )
        self.client.force_authenticate(self.alice)
        res = self.client.get('/api/notifications/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        results = res.data['results'] if isinstance(res.data, dict) else res.data
        note = results[0]
        # Slim refs: track has no nested artist, post carries only basic fields.
        self.assertNotIn('artist', note['track'])
        self.assertNotIn('tracks', note['post'])

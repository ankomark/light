"""Artists: albums, the verified tick, the profile's artist section, Artist
Studio numbers, and play milestones."""
from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from songs import artists
from songs.models import Album, Block, Like, Notification, PlayEvent, Profile, Track, User

R2 = 'https://media.example.com'
_n = [0]


def user(name, **kw):
    return User.objects.create_user(name, f'{name}@x.com', 'x', **kw)


def song(artist, title, **kw):
    return Track.objects.create(title=title, artist=artist, audio_file=f'{R2}/a/{title}.mp3', **kw)


def listen(track, listener, days_ago=0, counted=True, **kw):
    _n[0] += 1
    return PlayEvent.objects.create(user=listener, track=track, play_id=f'x{_n[0]}', counted=counted,
                                    started_at=timezone.now() - timedelta(days=days_ago), **kw)


class Base(APITestCase):
    def setUp(self):
        cache.clear()
        self.artist = user('ar_artist')
        self.fan = user('ar_fan')
        self.client.force_authenticate(self.artist)


class AlbumTests(Base):
    def test_make_an_album_set_its_songs_in_order_and_rename_it(self):
        a, b, c = (song(self.artist, x, duration_ms=60000) for x in 'ABC')
        res = self.client.post('/api/albums/', {'title': ' Sabbath Songs ', 'release_date': '2026-05-01'}, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        aid = res.json()['id']
        data = self.client.post(f'/api/albums/{aid}/set-tracks/', {'track_ids': [c.id, a.id]}, format='json').json()
        self.assertEqual([t['title'] for t in data['tracks']], ['C', 'A'])
        self.assertEqual((data['track_count'], data['duration_ms'], data['title']), (2, 120000, 'Sabbath Songs'))
        self.assertEqual(Track.objects.get(pk=a.pk).track_number, 2)
        self.assertEqual(Track.objects.get(pk=a.pk).album, 'Sabbath Songs')
        # Reorder, drop A, add B.
        self.client.post(f'/api/albums/{aid}/set-tracks/', {'track_ids': [b.id, c.id]}, format='json')
        a.refresh_from_db()
        self.assertEqual((a.album_ref_id, a.album), (None, None))
        self.client.patch(f'/api/albums/{aid}/', {'title': 'Vespers'}, format='json')
        self.assertEqual(Track.objects.get(pk=b.pk).album, 'Vespers')
        row = self.client.get('/api/tracks/').json()['results']
        self.assertEqual({r['title']: r['album_id'] for r in row}['B'], aid)

    def test_only_your_own_songs_and_only_you_edit(self):
        theirs = song(self.fan, 'Theirs')
        aid = self.client.post('/api/albums/', {'title': 'Mine'}, format='json').json()['id']
        res = self.client.post(f'/api/albums/{aid}/set-tracks/', {'track_ids': [theirs.id]}, format='json')
        self.assertEqual(res.status_code, 400)
        self.client.force_authenticate(self.fan)
        self.assertEqual(self.client.patch(f'/api/albums/{aid}/', {'title': 'x'}, format='json').status_code, 403)
        self.assertEqual(self.client.post(f'/api/albums/{aid}/set-tracks/', {'track_ids': []}, format='json').status_code, 403)
        self.assertEqual(self.client.get(f'/api/albums/{aid}/').status_code, 200)   # anyone can open it

    def test_deleting_an_album_keeps_its_songs(self):
        a = song(self.artist, 'A')
        aid = self.client.post('/api/albums/', {'title': 'Gone'}, format='json').json()['id']
        self.client.post(f'/api/albums/{aid}/set-tracks/', {'track_ids': [a.id]}, format='json')
        self.assertEqual(self.client.delete(f'/api/albums/{aid}/').status_code, 204)
        a.refresh_from_db()
        self.assertEqual((a.album_ref_id, a.album, a.is_removed), (None, None, False))

    def test_lists_others_only_see_albums_with_songs_and_blocks_hide_them(self):
        empty = Album.objects.create(artist=self.artist, title='Empty')
        full = Album.objects.create(artist=self.artist, title='Full')
        song(self.artist, 'A', album_ref=full, track_number=1)
        self.assertEqual({a['title'] for a in self.client.get('/api/albums/').json()}, {'Empty', 'Full'})
        self.client.force_authenticate(self.fan)
        rows = self.client.get(f'/api/albums/?artist={self.artist.id}').json()
        self.assertEqual([a['title'] for a in rows], ['Full'])
        self.assertEqual(rows[0]['cover'], None)
        Block.objects.create(blocker=self.artist, blocked=self.fan)
        self.assertEqual(self.client.get(f'/api/albums/{full.id}/').status_code, 404)
        self.assertEqual(self.client.get(f'/api/albums/{empty.id}/').status_code, 404)


class ArtistProfileTests(Base):
    def test_artist_section_top_songs_albums_listeners_and_the_tick(self):
        User.objects.filter(pk=self.artist.pk).update(is_verified_artist=True)
        for i, views in enumerate((5, 50, 20, 1, 9, 30)):
            song(self.artist, f'S{i}', views=views)
        album = Album.objects.create(artist=self.artist, title='Album')
        t = song(self.artist, 'On album', album_ref=album)
        listen(t, self.fan)
        listen(t, user('ar_fan2'), days_ago=40)          # not this month
        self.client.force_authenticate(self.fan)
        data = self.client.get(f'/api/users/{self.artist.id}/artist/').json()
        self.assertTrue(data['verified'])
        self.assertEqual(data['monthly_listeners'], 1)
        self.assertEqual([r['title'] for r in data['top_tracks']], ['S1', 'S5', 'S2', 'S4', 'S0'])
        self.assertEqual([a['title'] for a in data['albums']], ['Album'])
        self.assertTrue(self.client.get(f'/api/users/{self.artist.id}/').json()['verified'])
        self.assertTrue(data['top_tracks'][0]['artist']['verified'])   # the tick travels with the name

    def test_private_account_withholds_it(self):
        Profile.objects.create(user=self.artist, is_public=False)
        self.client.force_authenticate(self.fan)
        self.assertEqual(self.client.get(f'/api/users/{self.artist.id}/artist/').status_code, 403)


class StudioTests(Base):
    def test_numbers_for_the_period_with_change_and_breakdowns(self):
        a, b = song(self.artist, 'A'), song(self.artist, 'B')
        f2 = user('ar_f2')
        listen(a, self.fan, country='KE', source='profile', completed=True, ms_played=180000)
        listen(a, self.fan, country='KE', source='library')
        listen(a, f2, country='UG', source='library', ms_played=40000)
        listen(b, f2, counted=False, skipped=True, ms_played=5000)
        listen(a, self.fan, days_ago=40)                  # the period before (28 days)
        listen(a, self.artist)                            # the artist's own: never in the Studio
        Like.objects.create(user=self.fan, track=a)
        data = self.client.get('/api/studio/?days=28').json()
        tot = data['totals']
        self.assertEqual((tot['streams'], tot['listeners'], tot['likes']), (3, 2, 1))
        self.assertEqual((tot['completion'], tot['skip_rate']), (25.0, 25.0))   # of 4 starts
        self.assertEqual(data['change']['streams'], 200.0)     # 1 → 3
        self.assertIsNone(data['change']['likes'])             # nothing before
        self.assertEqual(len(data['daily']), 28)
        self.assertEqual(data['daily'][-1]['streams'], 3)
        self.assertEqual(data['top_tracks'][0], {
            'id': a.id, 'title': 'A', 'cover': None, 'streams': 3, 'listeners': 2, 'completion': 33.3})
        self.assertEqual([c['key'] for c in data['countries']], ['KE', 'UG'])
        self.assertEqual(data['countries'][0]['share'], 66.7)
        self.assertEqual(data['sources'][0], {'key': 'library', 'streams': 2, 'share': 66.7})

    def test_only_your_own_and_a_sane_period(self):
        listen(song(self.fan, 'Theirs'), user('ar_other'))
        data = self.client.get('/api/studio/?days=banana').json()
        self.assertEqual((data['days'], data['totals']['streams']), (28, 0))
        self.assertEqual(self.client.get('/api/studio/?days=365').json()['days'], 28)


class MilestoneTests(Base):
    def test_the_artist_hears_when_a_song_crosses_a_milestone_once(self):
        t = song(self.artist, 'Hit', views=99)
        self.client.force_authenticate(self.fan)
        with mock.patch('songs.artists.notify_user') as push, self.captureOnCommitCallbacks(execute=True):
            self.client.post('/api/tracks/plays/', {'events': [{'play_id': 'm1', 'track': t.id, 'ms_played': 40000}]}, format='json')
        note = Notification.objects.get(notification_type='milestone')
        self.assertEqual((note.recipient_id, note.track_id), (self.artist.id, t.id))
        self.assertIn('100 plays', note.message)
        push.assert_called_once()
        with mock.patch('songs.artists.notify_user'), self.captureOnCommitCallbacks(execute=True):
            self.client.post('/api/tracks/plays/', {'events': [{'play_id': 'm2', 'track': t.id, 'ms_played': 40000}]}, format='json')
        self.assertEqual(Notification.objects.filter(notification_type='milestone').count(), 1)

    def test_a_batch_that_jumps_over_a_milestone_still_reports_it_once(self):
        t = song(self.artist, 'Jump', views=998)
        self.client.force_authenticate(self.fan)
        events = [{'play_id': f'j{i}', 'track': t.id, 'ms_played': 40000} for i in range(3)]
        with mock.patch('songs.artists.notify_user'), self.captureOnCommitCallbacks(execute=True):
            self.client.post('/api/tracks/plays/', {'events': events}, format='json')
        t.refresh_from_db()
        self.assertEqual(t.views, 1001)
        notes = Notification.objects.filter(notification_type='milestone', track=t)
        self.assertEqual([n.message for n in notes], ['"Jump" reached 1,000 plays'])

    def test_no_milestone_between(self):
        t = song(self.artist, 'Quiet', views=500)
        self.assertFalse(artists.check_play_milestone(t.id))


class MigrationTests(Base):
    def test_album_names_on_songs_became_albums(self):
        # Mirrors 0129: run its function on rows made the old way.
        from importlib import import_module
        from django.apps import apps
        mig = import_module('songs.migrations.0129_albums_from_names')
        a = song(self.artist, 'A', album='Live at Camp')
        b = song(self.artist, 'B', album='live at camp ')
        song(self.fan, 'C', album='Live at Camp')          # another artist's: its own album
        mig.build(apps, None)
        a.refresh_from_db(); b.refresh_from_db()
        self.assertEqual(a.album_ref_id, b.album_ref_id)
        self.assertEqual((a.track_number, b.track_number), (1, 2))
        self.assertEqual(Album.objects.count(), 2)

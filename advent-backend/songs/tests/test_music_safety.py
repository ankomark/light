"""Music, kept safe: songs of a blocked or deactivated account appear nowhere;
a deleted song's files leave storage (unless something else still uses them);
song, cover and playlist media must be our own uploads; and an album or a
public playlist can be reported and taken down.

    python manage.py test songs.tests.test_music_safety --settings=music.settings_test
"""
from unittest import mock

from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APITestCase

from songs.models import Album, Block, Playlist, Report, SocialPost, Track, User

R2 = 'https://media.example.com'


def user(name):
    return User.objects.create_user(name, f'{name}@x.com', 'x')


def song(artist, title, **kw):
    return Track.objects.create(title=title, artist=artist, audio_file=f'{R2}/a/{title}.mp3', **kw)


def admin(name):
    u = user(name)
    u.admin_role = 'super_admin'
    u.is_superuser = True
    u.is_staff = True
    u.save(update_fields=['admin_role', 'is_superuser', 'is_staff'])
    return u


@override_settings(R2_PUBLIC_BASE=R2)
class HiddenArtistsTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.me = user('hs_me')
        self.choir = user('hs_choir')
        self.blocked = user('hs_blocked')
        self.gone = user('hs_gone')
        self.ok = song(self.choir, 'Amazing')
        self.from_blocked = song(self.blocked, 'Blocked')
        self.from_gone = song(self.gone, 'Gone')
        Block.objects.create(blocker=self.blocked, blocked=self.me)   # they blocked me
        User.objects.filter(pk=self.gone.pk).update(is_deactivated=True)
        self.client.force_authenticate(self.me)

    def ids(self, url, key='results', **params):
        data = self.client.get(url, params).json()
        rows = data.get(key, []) if isinstance(data, dict) else data
        return {r['id'] for r in rows}

    def test_the_library_and_shuffle_leave_them_out(self):
        self.assertEqual(self.ids('/api/tracks/'), {self.ok.id})
        self.assertEqual(self.ids('/api/tracks/shuffle/'), {self.ok.id})

    def test_search_leaves_them_out(self):
        for q in ('Blocked', 'Gone'):
            self.assertEqual(self.ids('/api/explore/search/', key='tracks', q=q, type='tracks'), set())

    def test_the_home_rails_leave_them_out(self):
        home = self.client.get('/api/music/home/').json()
        shown = {r['id'] for r in home['new_releases']}
        self.assertEqual(shown, {self.ok.id})

    def test_a_song_of_theirs_cannot_be_opened(self):
        self.assertEqual(self.client.get(f'/api/tracks/{self.from_blocked.id}/').status_code, 404)


@override_settings(R2_PUBLIC_BASE=R2)
class DeletingASongTests(APITestCase):
    def setUp(self):
        self.artist = user('ds_artist')
        self.client.force_authenticate(self.artist)

    def test_its_files_go_too_but_a_shared_cover_stays(self):
        cover = f'{R2}/c/shared.jpg'
        track = song(self.artist, 'Psalm', cover_image=cover, audio_low=f'{R2}/a/low.m4a',
                     spectrum=f'{R2}/s/spec.json')
        song(self.artist, 'Other', cover_image=cover)          # uses the same cover
        post = SocialPost.objects.create(user=self.artist, content_type='image', song_audio_url=track.audio_file)
        with mock.patch('songs.r2.delete') as delete:
            res = self.client.delete(f'/api/tracks/{track.id}/')
        self.assertEqual(res.status_code, 204)
        deleted = {c.args[0] for c in delete.call_args_list}
        self.assertEqual(deleted, {f'{R2}/a/Psalm.mp3', f'{R2}/a/low.m4a', f'{R2}/s/spec.json'})
        self.assertIsNone(SocialPost.objects.get(pk=post.pk).song_audio_url)


@override_settings(R2_PUBLIC_BASE=R2)
class OwnUploadsOnlyTests(APITestCase):
    def setUp(self):
        self.artist = user('ou_artist')
        self.client.force_authenticate(self.artist)

    def test_a_song_cover_or_playlist_cover_from_elsewhere_is_refused(self):
        track = song(self.artist, 'Hymn')
        res = self.client.patch(f'/api/tracks/{track.id}/', {'cover_image': 'https://elsewhere.example/x.jpg'},
                                format='json')
        self.assertEqual(res.status_code, 400)
        res = self.client.post('/api/playlists/', {'name': 'Mine', 'cover_image': 'https://elsewhere.example/p.jpg'},
                               format='json')
        self.assertEqual(res.status_code, 400)

    def test_our_own_upload_is_fine_and_an_unchanged_legacy_cover_may_be_sent_back(self):
        legacy = 'https://legacy-host.example/old.jpg'
        track = song(self.artist, 'Old', cover_image=legacy)
        res = self.client.patch(f'/api/tracks/{track.id}/', {'cover_image': legacy, 'title': 'Old hymn'}, format='json')
        self.assertEqual(res.status_code, 200, res.content[:300])
        res = self.client.patch(f'/api/tracks/{track.id}/', {'cover_image': f'{R2}/c/new.jpg'}, format='json')
        self.assertEqual(res.status_code, 200, res.content[:300])


@override_settings(R2_PUBLIC_BASE=R2)
class AlbumPlaylistTakedownTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.boss = admin('ap_boss')
        self.artist = user('ap_artist')
        self.fan = user('ap_fan')
        self.album = Album.objects.create(artist=self.artist, title='Vespers Live')
        song(self.artist, 'Track one', album_ref=self.album)
        self.playlist = Playlist.objects.create(user=self.artist, name='Sabbath mix', visibility=Playlist.PUBLIC)

    def test_both_can_be_reported(self):
        self.client.force_authenticate(self.fan)
        for ctype, oid in (('album', self.album.id), ('playlist', self.playlist.id)):
            res = self.client.post('/api/reports/', {'content_type': ctype, 'object_id': oid, 'reason': 'spam'},
                                   format='json')
            self.assertIn(res.status_code, (200, 201), res.content[:200])
        self.assertEqual(Report.objects.count(), 2)

    def test_taken_down_they_are_hidden_from_others_but_not_the_owner(self):
        self.client.force_authenticate(self.boss)
        for ctype, oid in (('album', self.album.id), ('playlist', self.playlist.id)):
            res = self.client.post('/api/admin/content/remove/', {'type': ctype, 'id': oid, 'reason': 'Breaks the rules'},
                                   format='json')
            self.assertEqual(res.status_code, 200, res.content[:200])
            listed = self.client.get('/api/admin/content/', {'type': ctype}).json()
            rows = listed.get('results', listed) if isinstance(listed, dict) else listed
            self.assertTrue(any(r['id'] == oid and r['is_removed'] for r in rows))
        self.client.force_authenticate(self.fan)
        self.assertEqual(self.client.get(f'/api/albums/{self.album.id}/').status_code, 404)
        self.assertEqual(self.client.get(f'/api/playlists/{self.playlist.id}/').status_code, 404)
        self.client.force_authenticate(self.artist)
        self.assertEqual(self.client.get(f'/api/albums/{self.album.id}/').status_code, 200)
        self.assertEqual(self.client.get(f'/api/playlists/{self.playlist.id}/').status_code, 200)


@override_settings(R2_PUBLIC_BASE=R2)
class HiddenSongsInListsTests(APITestCase):
    """A song taken down (or of an account hidden from you) inside a playlist
    or an album: reordering still works, saving the album keeps it there, and
    a hidden artist's song can't be added by id."""

    def setUp(self):
        cache.clear()
        self.me = user('hl_me')
        self.choir = user('hl_choir')
        self.a, self.b, self.gone = song(self.choir, 'A'), song(self.choir, 'B'), song(self.choir, 'Gone')
        self.playlist = Playlist.objects.create(user=self.me, name='Mine')
        self.client.force_authenticate(self.me)
        for tr in (self.a, self.gone, self.b):
            self.client.post(f'/api/playlists/{self.playlist.id}/add-track/', {'track_id': tr.id}, format='json')
        Track.objects.filter(pk=self.gone.pk).update(is_removed=True)

    def test_reorder_with_a_song_taken_down(self):
        res = self.client.post(f'/api/playlists/{self.playlist.id}/reorder/', {'track_ids': [self.b.id, self.a.id]},
                               format='json')
        self.assertEqual(res.status_code, 200, res.content[:200])
        self.assertEqual([t['id'] for t in res.json()['tracks']], [self.b.id, self.a.id])
        from songs.models import PlaylistTrack
        self.assertTrue(PlaylistTrack.objects.filter(playlist=self.playlist, track=self.gone).exists())

    def test_a_blocked_artists_song_cannot_be_added(self):
        rude = user('hl_rude')
        theirs = song(rude, 'Theirs')
        Block.objects.create(blocker=self.me, blocked=rude)
        res = self.client.post(f'/api/playlists/{self.playlist.id}/add-track/', {'track_id': theirs.id}, format='json')
        self.assertEqual(res.status_code, 404)

    def test_saving_an_album_keeps_a_song_that_was_taken_down(self):
        self.client.force_authenticate(self.choir)
        album = Album.objects.create(artist=self.choir, title='Vespers')
        Track.objects.filter(pk__in=[self.a.pk, self.gone.pk]).update(album_ref=album)
        res = self.client.post(f'/api/albums/{album.id}/set-tracks/', {'track_ids': [self.b.id, self.a.id]},
                               format='json')
        self.assertEqual(res.status_code, 200, res.content[:200])
        self.gone.refresh_from_db()
        self.assertEqual(self.gone.album_ref_id, album.id)


class SongCommentsTests(APITestCase):
    """A song's comments: its writer or the song's artist may delete one
    (replies go with it), nobody else; and a blocked artist's song takes no
    comments from you."""

    def setUp(self):
        cache.clear()
        self.artist = user('sc_artist')
        self.fan = user('sc_fan')
        self.other = user('sc_other')
        self.track = song(self.artist, 'Psalm')
        self.client.force_authenticate(self.fan)
        url = f'/api/tracks/{self.track.id}/comments/'
        self.comment = self.client.post(url, {'content': 'Beautiful'}, format='json').json()

    def test_the_writer_and_the_artist_may_delete_others_may_not(self):
        url = f'/api/tracks/{self.track.id}/comments/'
        self.assertTrue(self.client.get(url).json()['results'][0]['can_delete'])
        self.client.force_authenticate(self.other)
        self.assertFalse(self.client.get(url).json()['results'][0]['can_delete'])
        self.assertEqual(self.client.delete(f'{url}{self.comment["id"]}/').status_code, 403)
        self.client.force_authenticate(self.artist)
        self.assertTrue(self.client.get(url).json()['results'][0]['can_delete'])
        self.assertEqual(self.client.delete(f'{url}{self.comment["id"]}/').status_code, 204)

    def test_no_comments_on_a_blocked_artists_song(self):
        Block.objects.create(blocker=self.artist, blocked=self.other)
        self.client.force_authenticate(self.other)
        res = self.client.post(f'/api/tracks/{self.track.id}/comments/', {'content': 'hi'}, format='json')
        self.assertEqual(res.status_code, 404)

"""Playlists with an order, a description, a cover and a visibility; who may
open one; the profile's Playlists tab; and the Library screen's endpoint."""
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from songs.models import Block, Like, PlayEvent, Playlist, PlaylistTrack, Profile, Track, User

R2 = 'https://media.example.com'


def song(artist, title, **kw):
    return Track.objects.create(title=title, artist=artist, audio_file=f'{R2}/a/{title}.mp3', **kw)


class Base(APITestCase):
    def setUp(self):
        self.me = User.objects.create_user('pl_me', 'plme@x.com', 'x')
        self.other = User.objects.create_user('pl_other', 'plo@x.com', 'x')
        self.songs = [song(self.other, f'S{i}', cover_image=f'{R2}/c/{i}.jpg') for i in range(5)]
        self.client.force_authenticate(self.me)

    def create(self, **data):
        res = self.client.post('/api/playlists/', {'name': 'Sabbath', **data}, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        return res.json()

    def add(self, pid, track):
        return self.client.post(f'/api/playlists/{pid}/add-track/', {'track_id': track.id}, format='json')

    def titles(self, data):
        return [t['title'] for t in data['tracks']]


class OrderTests(Base):
    def test_songs_keep_the_order_they_were_added_and_can_be_reordered(self):
        pid = self.create()['id']
        for s in self.songs[:3]:
            data = self.add(pid, s).json()
        self.assertEqual(self.titles(data), ['S0', 'S1', 'S2'])
        a, b, c = (s.id for s in self.songs[:3])
        data = self.client.post(f'/api/playlists/{pid}/reorder/', {'track_ids': [c, a, b]}, format='json').json()
        self.assertEqual(self.titles(data), ['S2', 'S0', 'S1'])
        self.assertEqual(self.titles(self.client.get(f'/api/playlists/{pid}/').json()), ['S2', 'S0', 'S1'])
        # A song added after a reorder goes to the end.
        self.assertEqual(self.titles(self.add(pid, self.songs[3]).json())[-1], 'S3')

    def test_reorder_must_be_exactly_the_playlists_songs(self):
        pid = self.create()['id']
        for s in self.songs[:2]:
            self.add(pid, s)
        a, b = self.songs[0].id, self.songs[1].id
        for bad in ([a], [a, b, self.songs[2].id], [a, a], 'x', None):
            res = self.client.post(f'/api/playlists/{pid}/reorder/', {'track_ids': bad}, format='json')
            self.assertEqual(res.status_code, 400, bad)

    def test_adding_twice_keeps_one_and_removing_works(self):
        pid = self.create()['id']
        self.add(pid, self.songs[0])
        data = self.add(pid, self.songs[0]).json()
        self.assertEqual((data['track_count'], len(data['tracks'])), (1, 1))
        data = self.client.post(f'/api/playlists/{pid}/remove-track/', {'track_id': self.songs[0].id}, format='json').json()
        self.assertEqual(data['track_count'], 0)

    def test_taken_down_songs_drop_out_and_cannot_be_added(self):
        pid = self.create()['id']
        self.add(pid, self.songs[0])
        self.add(pid, self.songs[1])
        Track.objects.filter(pk=self.songs[0].pk).update(is_removed=True)
        data = self.client.get(f'/api/playlists/{pid}/').json()
        self.assertEqual((self.titles(data), data['track_count']), (['S1'], 1))
        self.assertEqual(self.add(pid, self.songs[0]).status_code, 404)

    def test_detail_totals_length_and_the_collage_follows_the_order(self):
        Track.objects.filter(pk=self.songs[0].pk).update(duration_ms=60000, cover_small=f'{R2}/small0.jpg')
        Track.objects.filter(pk=self.songs[1].pk).update(duration_ms=30000)
        pid = self.create()['id']
        self.add(pid, self.songs[1])
        data = self.add(pid, self.songs[0]).json()
        self.assertEqual(data['duration_ms'], 90000)
        self.assertEqual(data['cover_images'], [f'{R2}/c/1.jpg', f'{R2}/small0.jpg'])

    def test_opening_a_playlist_is_a_flat_number_of_queries(self):
        pid = self.create()['id']

        def measure():
            with CaptureQueriesContext(connection) as ctx:
                self.client.get(f'/api/playlists/{pid}/')
            return len(ctx.captured_queries)
        self.add(pid, self.songs[0])
        few = measure()
        for s in self.songs[1:]:
            self.add(pid, s)
        self.assertEqual(measure(), few)


class DetailsTests(Base):
    def test_create_with_details_then_edit_them(self):
        data = self.create(description='  For the drive to church ', visibility='public')
        self.assertEqual((data['description'], data['visibility'], data['is_owner']), ('For the drive to church', 'public', True))
        res = self.client.patch(f"/api/playlists/{data['id']}/", {
            'name': 'Vespers', 'cover_image': f'{R2}/cover_images/p.jpg', 'visibility': 'unlisted'}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.json()['name'], res.json()['cover_image'], res.json()['visibility']),
                         ('Vespers', f'{R2}/cover_images/p.jpg', 'unlisted'))
        res = self.client.patch(f"/api/playlists/{data['id']}/", {'cover_image': None}, format='json')
        self.assertIsNone(res.json()['cover_image'])

    def test_bad_details_are_refused(self):
        self.assertEqual(self.client.post('/api/playlists/', {'name': '   '}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/playlists/', {'name': 'x', 'visibility': 'secret'}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/playlists/', {'name': 'x', 'cover_image': 'not-a-url'}, format='json').status_code, 400)

    def test_new_playlists_are_private(self):
        self.assertEqual(self.create()['visibility'], 'private')


class VisibilityTests(Base):
    def their(self, visibility):
        pl = Playlist.objects.create(user=self.other, name=visibility, visibility=visibility)
        PlaylistTrack.objects.create(playlist=pl, track=self.songs[0])
        return pl

    def test_who_may_open_someone_elses_playlist(self):
        for vis, code in (('private', 404), ('unlisted', 200), ('public', 200)):
            pl = self.their(vis)
            res = self.client.get(f'/api/playlists/{pl.id}/')
            self.assertEqual(res.status_code, code, vis)
            if code == 200:
                self.assertFalse(res.json()['is_owner'])

    def test_only_the_owner_edits(self):
        pl = self.their('public')
        self.assertEqual(self.client.patch(f'/api/playlists/{pl.id}/', {'name': 'mine now'}, format='json').status_code, 404)
        self.assertEqual(self.client.post(f'/api/playlists/{pl.id}/add-track/', {'track_id': self.songs[1].id}, format='json').status_code, 404)
        self.assertEqual(self.client.delete(f'/api/playlists/{pl.id}/').status_code, 404)
        self.assertEqual(Playlist.objects.get(pk=pl.pk).name, 'public')

    def test_blocks_and_deactivation_hide_shared_playlists(self):
        pl = self.their('public')
        Block.objects.create(blocker=self.other, blocked=self.me)
        self.assertEqual(self.client.get(f'/api/playlists/{pl.id}/').status_code, 404)
        Block.objects.all().delete()
        User.objects.filter(pk=self.other.pk).update(is_deactivated=True)
        self.assertEqual(self.client.get(f'/api/playlists/{pl.id}/').status_code, 404)

    def test_my_list_is_only_mine(self):
        self.their('public')
        self.create()
        self.assertEqual([p['name'] for p in self.client.get('/api/playlists/').json()], ['Sabbath'])


class ProfileTabTests(Base):
    def test_profile_shows_public_playlists_only_and_counts_them(self):
        for vis in ('private', 'unlisted', 'public'):
            Playlist.objects.create(user=self.other, name=vis, visibility=vis)
        rows = self.client.get(f'/api/users/{self.other.id}/playlists/').json()
        self.assertEqual([r['name'] for r in rows], ['public'])
        self.assertNotIn('tracks', rows[0])
        self.assertEqual(self.client.get(f'/api/users/{self.other.id}/').json()['playlists_count'], 1)

    def test_my_own_profile_lists_all_of_mine(self):
        for vis in ('private', 'public'):
            Playlist.objects.create(user=self.me, name=vis, visibility=vis)
        self.assertEqual(len(self.client.get(f'/api/users/{self.me.id}/playlists/').json()), 2)

    def test_private_account_withholds_them(self):
        Profile.objects.create(user=self.other, is_public=False)
        Playlist.objects.create(user=self.other, name='p', visibility='public')
        self.assertEqual(self.client.get(f'/api/users/{self.other.id}/playlists/').status_code, 403)


class LibraryTests(Base):
    def test_library_in_one_request(self):
        Like.objects.create(user=self.me, track=self.songs[0])
        Like.objects.create(user=self.me, track=self.songs[1])
        pl = Playlist.objects.create(user=self.me, name='Mine')
        PlaylistTrack.objects.create(playlist=pl, track=self.songs[2])
        Playlist.objects.create(user=self.other, name='Theirs', visibility='public')
        PlayEvent.objects.create(user=self.me, track=self.songs[3], play_id='a')
        data = self.client.get('/api/library/').json()
        self.assertEqual(data['liked']['count'], 2)
        self.assertEqual(len(data['liked']['covers']), 2)
        self.assertEqual([p['name'] for p in data['playlists']], ['Mine'])
        self.assertEqual(data['playlists'][0]['track_count'], 1)
        self.assertEqual([t['title'] for t in data['recent']], ['S3'])

    def test_liked_songs_newest_like_first(self):
        Like.objects.create(user=self.me, track=self.songs[3])
        Like.objects.create(user=self.me, track=self.songs[0])     # liked later
        titles = [t['title'] for t in self.client.get('/api/tracks/favorites/').json()]
        self.assertEqual(titles, ['S0', 'S3'])


class MigrationTests(Base):
    def test_the_old_many_to_many_calls_still_work(self):
        pl = Playlist.objects.create(user=self.me, name='legacy')
        pl.tracks.add(self.songs[0])
        self.assertEqual(list(pl.tracks.all()), [self.songs[0]])

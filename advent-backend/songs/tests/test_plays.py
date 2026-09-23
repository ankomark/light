"""Listening events: play counts that mean something, and "Recently played".

A listen is reported at 30s and again when it ends, under one play_id, and a
report may arrive twice (the app's offline outbox retries), so ingestion is an
idempotent upsert that counts each 30s+ listen once."""
from unittest import mock

from django.core.cache import cache
from rest_framework.test import APITestCase

from songs.management.commands.backfill_track_durations import read_duration_ms
from songs.models import PlayEvent, Track, User


def make_track(artist, title='Song', **kw):
    return Track.objects.create(title=title, artist=artist, audio_file='https://m.x/a.mp3', **kw)


class Base(APITestCase):
    def setUp(self):
        cache.clear()
        self.artist = User.objects.create_user('pl_artist', 'pla@x.com', 'x')
        self.fan = User.objects.create_user('pl_fan', 'plf@x.com', 'x')
        self.track = make_track(self.artist, 'Hymn')
        self.client.force_authenticate(self.fan)

    def send(self, *events):
        return self.client.post('/api/tracks/plays/', {'events': list(events)}, format='json')

    def plays(self):
        self.track.refresh_from_db()
        return self.track.views


class CountingTests(Base):
    def test_a_30s_listen_counts_once_even_when_reported_again(self):
        ev = {'play_id': 'a1', 'track': self.track.id, 'ms_played': 30500}
        self.send(ev)
        self.send(ev)                                             # outbox retry
        self.send({**ev, 'ms_played': 180000, 'completed': True, 'ended': True})
        self.assertEqual(self.plays(), 1)
        row = PlayEvent.objects.get(play_id='a1')
        self.assertEqual((row.ms_played, row.completed, row.skipped, row.counted), (180000, True, False, True))

    def test_short_listen_is_a_skip_and_does_not_count(self):
        self.send({'play_id': 's1', 'track': self.track.id, 'ms_played': 8000, 'ended': True})
        self.assertEqual(self.plays(), 0)
        self.assertTrue(PlayEvent.objects.get(play_id='s1').skipped)

    def test_a_finished_short_song_counts(self):
        short = make_track(self.artist, 'Chorus', duration_ms=20000)
        self.send({'play_id': 'c1', 'track': short.id, 'ms_played': 20000, 'completed': True, 'ended': True})
        short.refresh_from_db()
        self.assertEqual(short.views, 1)

    def test_the_artists_own_listens_do_not_count(self):
        self.client.force_authenticate(self.artist)
        self.send({'play_id': 'o1', 'track': self.track.id, 'ms_played': 60000})
        self.assertEqual(self.plays(), 0)
        self.assertTrue(PlayEvent.objects.filter(play_id='o1').exists())

    def test_repeat_is_capped_per_listener_per_day(self):
        for i in range(15):
            self.send({'play_id': f'r{i}', 'track': self.track.id, 'ms_played': 31000})
        self.assertEqual(self.plays(), 10)

    def test_removed_tracks_and_junk_are_ignored(self):
        gone = make_track(self.artist, 'Gone', is_removed=True)
        res = self.send(
            {'play_id': 'g1', 'track': gone.id, 'ms_played': 40000},
            {'play_id': '', 'track': self.track.id, 'ms_played': 40000},
            {'play_id': 'j1', 'track': 'x', 'ms_played': 40000},
            'nonsense',
        )
        self.assertEqual(res.json()['stored'], 0)
        self.assertEqual(self.client.post('/api/tracks/plays/', {'events': 'x'}, format='json').status_code, 400)

    def test_learns_an_unknown_length_but_never_overwrites_one(self):
        self.send({'play_id': 'd1', 'track': self.track.id, 'ms_played': 1000, 'duration_ms': 222000})
        self.track.refresh_from_db()
        self.assertEqual(self.track.duration_ms, 222000)
        self.send({'play_id': 'd2', 'track': self.track.id, 'ms_played': 1000, 'duration_ms': 999000})
        self.track.refresh_from_db()
        self.assertEqual(self.track.duration_ms, 222000)

    def test_offline_listens_keep_their_time(self):
        self.send({'play_id': 'off1', 'track': self.track.id, 'ms_played': 40000,
                   'started_at': '2020-01-01T00:00:00Z'})             # too old: clamped
        self.send({'play_id': 'off2', 'track': self.track.id, 'ms_played': 40000,
                   'started_at': PlayEvent.objects.get(play_id='off1').started_at.isoformat()})
        a, b = PlayEvent.objects.get(play_id='off1'), PlayEvent.objects.get(play_id='off2')
        self.assertEqual(a.started_at.year, b.started_at.year)
        self.assertNotEqual(a.started_at.year, 2020)

    def test_play_count_and_length_are_on_track_rows(self):
        self.send({'play_id': 'p1', 'track': self.track.id, 'ms_played': 31000, 'duration_ms': 200000})
        row = self.client.get('/api/tracks/').json()['results'][0]
        self.assertEqual((row['views'], row['duration_ms']), (1, 200000))

    def test_logged_out_cannot_report(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.send({'play_id': 'x', 'track': self.track.id, 'ms_played': 40000}).status_code, 401)


class RecentTests(Base):
    def test_recently_played_is_newest_first_each_once_and_mine_only(self):
        other = make_track(self.artist, 'Other')
        gone = make_track(self.artist, 'Gone')
        for pid, t in (('1', self.track), ('2', other), ('3', self.track), ('4', gone)):
            self.send({'play_id': pid, 'track': t.id, 'ms_played': 5000})
        Track.objects.filter(pk=gone.pk).update(is_removed=True)
        titles = [r['title'] for r in self.client.get('/api/tracks/recent/').json()]
        self.assertEqual(titles, ['Hymn', 'Other'])
        self.client.force_authenticate(self.artist)
        self.assertEqual(self.client.get('/api/tracks/recent/').json(), [])


class UploadLengthTests(Base):
    def test_upload_keeps_a_sane_length_and_edits_cannot_change_it(self):
        self.client.force_authenticate(self.artist)
        res = self.client.post('/api/tracks/', {'title': 'New', 'audio_file': 'https://m.x/n.mp3',
                                                'duration_ms': 185000}, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        tid = res.json()['id']
        self.assertEqual(Track.objects.get(pk=tid).duration_ms, 185000)
        self.client.patch(f'/api/tracks/{tid}/', {'duration_ms': 5000}, format='json')
        self.assertEqual(Track.objects.get(pk=tid).duration_ms, 185000)
        res = self.client.post('/api/tracks/', {'title': 'Bad', 'audio_file': 'https://m.x/b.mp3',
                                                'duration_ms': 5}, format='json')
        self.assertIsNone(Track.objects.get(pk=res.json()['id']).duration_ms)

    def test_backfill_reader_rejects_junk(self):
        self.assertIsNone(read_duration_ms(b'not audio'))
        fake = mock.Mock(info=mock.Mock(length=201.5))
        with mock.patch('mutagen.File', return_value=fake):
            self.assertEqual(read_duration_ms(b'x'), 201500)

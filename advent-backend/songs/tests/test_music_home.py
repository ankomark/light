"""The Music home: charts from plays (world and per country), new releases,
following, genres, and recommendations that learn from listening."""
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from songs import charts, jobs
from songs.models import Category, ChartEntry, Job, Like, PlayEvent, Track, User

R2 = 'https://media.example.com'
_n = [0]


def user(name):
    return User.objects.create_user(name, f'{name}@x.com', 'x')


def song(artist, title, **kw):
    return Track.objects.create(title=title, artist=artist, audio_file=f'{R2}/a/{title}.mp3', **kw)


def plays(track, n, country='', days_ago=0, **kw):
    for _ in range(n):
        _n[0] += 1
        listener = kw.pop('user', None) or user(f'l{_n[0]}')
        PlayEvent.objects.create(user=listener, track=track, play_id=f'p{_n[0]}', counted=True,
                                 country=country, started_at=timezone.now() - timedelta(days=days_ago), **kw)


class Base(APITestCase):
    def setUp(self):
        cache.clear()
        self.me = user('mh_me')
        self.artist = user('mh_artist')
        self.client.force_authenticate(self.me)


class ChartTests(Base):
    def test_trending_is_this_week_top_is_four_weeks_removed_and_uncounted_left_out(self):
        a, b, c, gone = (song(self.artist, x) for x in ('A', 'B', 'C', 'Gone'))
        plays(a, 3)
        plays(b, 5, days_ago=10)        # too old for trending, in the top 50
        plays(c, 1)
        plays(gone, 9)
        Track.objects.filter(pk=gone.pk).update(is_removed=True)
        PlayEvent.objects.create(user=self.me, track=c, play_id='skip', counted=False, skipped=True)
        self.assertEqual([t for t, _ in charts.compute('trending')], [a.id, c.id])
        self.assertEqual(charts.compute('top'), [(b.id, 5), (a.id, 3), (c.id, 1)])

    def test_a_country_needs_enough_listening_for_its_own_chart(self):
        ke, us = song(self.artist, 'KE'), song(self.artist, 'US')
        plays(ke, charts.MIN_COUNTRY_PLAYS, country='KE')
        plays(us, 3, country='US')
        self.assertEqual(charts.chart_countries(), ['KE'])
        self.assertEqual([t for t, _ in charts.read('top', 'KE')], [ke.id])
        self.assertEqual(charts.read('top', 'US'), [])

    def test_refresh_stores_charts_and_reading_uses_them(self):
        a = song(self.artist, 'A')
        plays(a, 2)
        self.assertEqual(charts.refresh_all(), 2)             # world trending + top
        self.assertEqual(ChartEntry.objects.count(), 2)
        plays(song(self.artist, 'B'), 5)                    # after the refresh
        self.assertEqual([t for t, _ in charts.read('top')], [a.id])   # until the next one

    def test_the_refresh_job_books_the_next_run_even_when_it_fails(self):
        from unittest import mock
        Job.objects.all().delete()
        jobs.enqueue('refresh_charts', key='charts')
        with mock.patch('songs.charts.refresh_all', side_effect=RuntimeError('db down')):
            jobs.run_next()
        nxt = Job.objects.get(status=Job.QUEUED)
        self.assertEqual(nxt.kind, 'refresh_charts')
        self.assertGreater(nxt.run_after, timezone.now() + timedelta(minutes=50))
        self.assertEqual(Job.objects.filter(status=Job.DONE).count(), 1)

    def test_chart_endpoint(self):
        a = song(self.artist, 'A')
        plays(a, 2, country='KE')
        rows = self.client.get('/api/music/charts/top/').json()['tracks']
        self.assertEqual((rows[0]['id'], rows[0]['position'], rows[0]['plays']), (a.id, 1, 2))
        self.assertEqual(self.client.get('/api/music/charts/nope/').status_code, 404)


class PlaysCountryTests(Base):
    def test_the_phones_region_is_stored_and_junk_ignored(self):
        t = song(self.artist, 'A')
        for pid, country in (('c1', 'ke'), ('c2', 'Kenya'), ('c3', None)):
            self.client.post('/api/tracks/plays/', {'events': [
                {'play_id': pid, 'track': t.id, 'ms_played': 40000, 'country': country}]}, format='json')
        got = dict(PlayEvent.objects.values_list('play_id', 'country'))
        self.assertEqual(got, {'c1': 'KE', 'c2': '', 'c3': ''})


class HomeTests(Base):
    def test_every_section_in_one_request(self):
        followed = user('mh_followed')
        followed.followers.add(self.me)                      # me follows them
        fresh = song(followed, 'Fresh')
        old = song(self.artist, 'Old')
        Track.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=200))
        hit = song(self.artist, 'Hit')
        plays(hit, charts.MIN_COUNTRY_PLAYS, country='KE')
        PlayEvent.objects.create(user=self.me, track=old, play_id='mine', counted=True)
        gospel = Category.objects.get(slug='gospel')
        gospel.tracks.add(hit)

        data = self.client.get('/api/music/home/?country=ke').json()
        self.assertEqual([t['title'] for t in data['recent']], ['Old'])
        self.assertIn('Hit', [t['title'] for t in data['trending']])
        self.assertIn('Fresh', [t['title'] for t in data['new_releases']])
        self.assertNotIn('Old', [t['title'] for t in data['new_releases']])
        self.assertEqual([t['title'] for t in data['following']], ['Fresh'])
        self.assertEqual(data['top_country']['country'], 'KE')
        self.assertEqual((data['top_country']['tracks'][0]['title'], data['top_country']['tracks'][0]['position']), ('Hit', 1))
        self.assertEqual(data['top_world']['tracks'][0]['title'], 'Hit')
        self.assertEqual([g['slug'] for g in data['genres']], ['gospel'])
        self.assertEqual(data['genres'][0]['track_count'], 1)
        self.assertTrue(all('reason' in r for r in data['for_you']))

    def test_no_country_chart_until_it_has_listening(self):
        plays(song(self.artist, 'A'), 2, country='UG')
        data = self.client.get('/api/music/home/?country=UG').json()
        self.assertIsNone(data['top_country'])
        self.assertIsNotNone(data['top_world'])


class GenreTests(Base):
    def test_genres_are_seeded_listed_in_order_and_read_only(self):
        rows = self.client.get('/api/categories/').json()
        self.assertEqual(rows[0]['slug'], 'gospel')
        self.assertIn('track_count', rows[0])
        self.assertEqual(self.client.post('/api/categories/', {'name': 'Spam'}).status_code, 405)
        self.assertEqual(self.client.delete(f"/api/categories/{rows[0]['id']}/").status_code, 405)

    def test_a_song_gets_a_genre_on_upload_and_can_change_it(self):
        self.client.force_authenticate(self.artist)
        res = self.client.post('/api/tracks/', {'title': 'New', 'audio_file': f'{R2}/n.mp3', 'genre': 'hymns', 'rights_confirmed': True}, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        tid = res.json()['id']
        self.assertEqual(res.json()['genre'], {'slug': 'hymns', 'name': 'Hymns'})
        self.client.patch(f'/api/tracks/{tid}/', {'genre': 'choir'}, format='json')
        self.assertEqual(list(Track.objects.get(pk=tid).categories.values_list('slug', flat=True)), ['choir'])
        self.client.patch(f'/api/tracks/{tid}/', {'title': 'Renamed'}, format='json')   # genre untouched
        self.assertEqual(Track.objects.get(pk=tid).categories.count(), 1)
        self.client.patch(f'/api/tracks/{tid}/', {'genre': None}, format='json')
        self.assertEqual(Track.objects.get(pk=tid).categories.count(), 0)
        bad = self.client.post('/api/tracks/', {'title': 'X', 'audio_file': f'{R2}/x.mp3', 'genre': 'polka', 'rights_confirmed': True}, format='json')
        self.assertEqual(bad.status_code, 400)

    def test_genre_page_lists_its_songs(self):
        a, b = song(self.artist, 'A'), song(self.artist, 'B')
        Category.objects.get(slug='choir').tracks.add(a)
        rows = self.client.get('/api/tracks/?genre=choir').json()['results']
        self.assertEqual([r['title'] for r in rows], ['A'])
        self.assertEqual(rows[0]['genre']['slug'], 'choir')


class ListeningTasteTests(Base):
    def test_for_you_learns_from_listening_and_leaves_out_skips(self):
        fan = user('mh_fan')
        seed, suggested, skipped = song(self.artist, 'Seed'), song(user('a2'), 'Suggested'), song(user('a3'), 'Skipped')
        # I never liked anything, but listened to Seed properly.
        PlayEvent.objects.create(user=self.me, track=seed, play_id='s', counted=True, completed=True)
        # Someone else who listened to Seed also listened to Suggested and Skipped.
        for t, pid in ((seed, 'f1'), (suggested, 'f2'), (skipped, 'f3')):
            PlayEvent.objects.create(user=fan, track=t, play_id=pid, counted=True)
        # I skipped Skipped.
        PlayEvent.objects.create(user=self.me, track=skipped, play_id='k', skipped=True)
        got = {r['id']: r['reason'] for r in self.client.get('/api/tracks/for_you/').json()}
        self.assertEqual(got.get(suggested.id), 'fans_also_like')
        self.assertNotIn(skipped.id, got)

    def test_an_artist_skipped_again_and_again_is_left_out(self):
        nope = user('mh_nope')
        tracks = [song(nope, f'N{i}') for i in range(4)]
        for i, t in enumerate(tracks[:3]):
            PlayEvent.objects.create(user=self.me, track=t, play_id=f'k{i}', skipped=True)
        for i in range(2):
            Like.objects.create(user=user(f'mh_p{i}'), track=tracks[3])   # popular, but not for me
        got = {r['id'] for r in self.client.get('/api/tracks/for_you/').json()}
        self.assertNotIn(tracks[3].id, got)

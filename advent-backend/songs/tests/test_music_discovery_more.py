"""Music discovery, made solid: charts rank by listeners (a song on repeat by
one person doesn't top them), "Made for you" holds at most three songs per
artist and leaves out what you already play on repeat, "More like this" knows
a brand-new song by its genre, the home has On repeat and Rediscover, and the
year recap adds up your own listening.

    python manage.py test songs.tests.test_music_discovery_more --settings=music.settings_test
"""
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from songs import charts, discovery
from songs.models import Category, Like, PlayEvent, Track, User

R2 = 'https://media.example.com'
_n = [0]


def user(name):
    return User.objects.create_user(name, f'{name}@x.com', 'x')


def song(artist, title, **kw):
    return Track.objects.create(title=title, artist=artist, audio_file=f'{R2}/a/{title}.mp3', **kw)


def play(track, listener, days_ago=0, **kw):
    _n[0] += 1
    return PlayEvent.objects.create(user=listener, track=track, play_id=f'dm{_n[0]}', counted=True,
                                    started_at=timezone.now() - timedelta(days=days_ago), **kw)


class ChartsByListenersTests(APITestCase):
    def setUp(self):
        cache.clear()

    def test_one_person_on_repeat_does_not_beat_three_people(self):
        choir = user('cl_choir')
        loved = song(choir, 'Loved')
        looped = song(choir, 'Looped')
        fan = user('cl_fan')
        for _ in range(8):
            play(looped, fan)
        for i in range(3):
            play(loved, user(f'cl_{i}'))
        ranked = [tid for tid, _ in charts.compute('trending')]
        self.assertEqual(ranked[:2], [loved.id, looped.id])


class MadeForYouTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.me = user('mf_me')
        self.big = user('mf_big')        # an artist I like, with many songs
        liked = song(self.big, 'Big 0')
        Like.objects.create(user=self.me, track=liked)
        self.big_songs = [song(self.big, f'Big {i}') for i in range(1, 8)]

    def test_no_more_than_three_from_one_artist(self):
        ids, reasons = discovery.for_you(self.me)
        from_big = [i for i in ids if i in {t.id for t in self.big_songs}]
        self.assertLessEqual(len(from_big), discovery.PER_ARTIST)

    def test_what_you_already_play_on_repeat_is_not_suggested(self):
        repeat = self.big_songs[0]
        for _ in range(discovery.ON_REPEAT_PLAYS):
            play(repeat, self.me)
        cache.clear()
        ids, _ = discovery.for_you(self.me)
        self.assertNotIn(repeat.id, ids)
        self.assertEqual(discovery.on_repeat(self.me), [repeat.id])


class SimilarByGenreTests(APITestCase):
    def test_a_new_song_with_no_listeners_gets_its_genre(self):
        cache.clear()
        hymns = Category.objects.exclude(slug__isnull=True).first()
        a, b = user('sg_a'), user('sg_b')
        new = song(a, 'Brand new')
        same = song(b, 'Same style')
        other = song(b, 'Other style')
        hymns.tracks.add(new, same)
        ids, reasons = discovery.similar(new, a)
        self.assertIn(same.id, ids)
        self.assertEqual(reasons[same.id], 'same_genre')
        self.assertLess(ids.index(same.id), ids.index(other.id) if other.id in ids else len(ids))


class HomeRailsAndRecapTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.me = user('hr_me')
        self.choir = user('hr_choir')
        self.client.force_authenticate(self.me)

    def test_on_repeat_and_rediscover_rails(self):
        repeat = song(self.choir, 'Again and again')
        for _ in range(3):
            play(repeat, self.me)
        old = song(self.choir, 'Old favourite')
        like = Like.objects.create(user=self.me, track=old)
        Like.objects.filter(pk=like.pk).update(created_at=timezone.now() - timedelta(days=60))
        home = self.client.get('/api/music/home/').json()
        self.assertEqual([r['id'] for r in home['on_repeat']], [repeat.id])
        self.assertEqual([r['id'] for r in home['rediscover']], [old.id])

    def test_the_year_recap_adds_up_your_listening(self):
        a = song(self.choir, 'Amazing grace')
        b = song(self.choir, 'Be thou my vision')
        for _ in range(3):
            play(a, self.me, ms_played=120000)
        play(b, self.me, ms_played=60000)
        play(a, user('hr_someone_else'), ms_played=999999)        # not mine
        data = self.client.get('/api/music/recap/').json()
        self.assertEqual(data['minutes'], 7)
        self.assertEqual(data['songs'], 2)
        self.assertEqual(data['top_songs'][0]['id'], a.id)
        self.assertEqual(data['top_songs'][0]['plays'], 3)
        self.assertEqual(data['top_artists'][0]['username'], 'hr_choir')
        self.assertEqual(data['busiest'], timezone.now().month)

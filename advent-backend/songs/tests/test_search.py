"""Search: typos forgiven, relevance first, new sections (artists, albums,
public playlists, genres, a top result), and nothing the viewer mustn't see."""
from django.core.cache import cache
from django.test import SimpleTestCase
from rest_framework.test import APITestCase

from songs import search as fz
from songs.models import Album, Block, Playlist, PlaylistTrack, Track, User

R2 = 'https://media.example.com'


class ScoringTests(SimpleTestCase):
    def test_typos_and_word_starts_still_match(self):
        for q, text in (('amzing grce', 'Amazing Grace'), ('munug', 'Mungu ni Mwema'),
                        ('how grat tho art', 'How Great Thou Art'), ('jesu', 'Jesus Loves Me'),
                        ('kwaya ya', 'Kwaya ya Vijana')):
            self.assertGreaterEqual(fz.text_score(q, text), fz.MIN_SCORE, (q, text))

    def test_unrelated_does_not(self):
        for q, text in (('peace', 'It Is Well'), ('hymn', 'Amazing Grace'), ('love', 'Blessed Assurance')):
            self.assertLess(fz.text_score(q, text), fz.MIN_SCORE, (q, text))

    def test_order_exact_then_prefix_then_word_then_inside_then_close(self):
        s = lambda t: fz.text_score('grace', t)  # noqa: E731
        self.assertGreater(s('Grace'), s('Grace Alone'))
        self.assertGreater(s('Grace Alone'), s('Amazing Grace'))
        self.assertGreater(s('Amazing Grace'), s('Disgraceful'))
        self.assertGreater(s('Disgraceful'), s('Grave'))

    def test_accents_case_punctuation_do_not_matter(self):
        self.assertEqual(fz.text_score('cafe', 'Café!'), 1.0)
        self.assertEqual(fz.normalize('  Ámen,  AMEN! '), 'amen amen')

    def test_pieces_include_word_starts_and_typo_pieces_but_are_capped(self):
        p = fz.pieces('amzing grce')
        self.assertIn('amzing', p)
        self.assertIn('amz', p)
        self.assertLessEqual(len(fz.pieces('a very long query with many many words indeed')), fz.MAX_PIECES)

    def test_popularity_only_nudges(self):
        self.assertGreater(fz.score('grace', [('Grace', 1)], 0), fz.score('grace', [('Amazing Grace', 1)], 10 ** 9))


class SearchApiTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.me = User.objects.create_user('sr_me', 'srme@x.com', 'x')
        self.artist = User.objects.create_user('grace_choir', 'gc@x.com', 'x')
        self.client.force_authenticate(self.me)

    def search(self, q, **kw):
        return self.client.get('/api/explore/search/', {'q': q, **kw}).json()

    def song(self, title, artist=None, **kw):
        return Track.objects.create(title=title, artist=artist or self.artist, audio_file=f'{R2}/{title}.mp3', **kw)

    def test_a_typo_finds_the_song_and_the_best_match_comes_first(self):
        self.song('Amazing Grace', views=5)
        self.song('Grace Alone', views=900)
        self.song('It Is Well', views=5000)
        titles = [t['title'] for t in self.search('amzing grce')['tracks']]
        self.assertEqual(titles[0], 'Amazing Grace')
        self.assertNotIn('It Is Well', titles)

    def test_artists_albums_public_playlists_and_genres(self):
        t = self.song('Hosanna')
        album = Album.objects.create(artist=self.artist, title='Grace Sessions')
        Track.objects.filter(pk=t.pk).update(album_ref=album)
        public = Playlist.objects.create(user=self.me, name='Grace on Sunday', visibility='public')
        private = Playlist.objects.create(user=self.me, name='Grace secret', visibility='private')
        unlisted = Playlist.objects.create(user=self.me, name='Grace link', visibility='unlisted')
        for pl in (public, private, unlisted):
            PlaylistTrack.objects.create(playlist=pl, track=t)
        Playlist.objects.create(user=self.me, name='Grace empty', visibility='public')   # no songs
        res = self.search('grace')
        self.assertEqual([a['username'] for a in res['artists']], ['grace_choir'])
        self.assertEqual([a['title'] for a in res['albums']], ['Grace Sessions'])
        self.assertEqual([p['name'] for p in res['playlists']], ['Grace on Sunday'])
        self.assertEqual(res['playlists'][0]['owner'], 'sr_me')
        self.assertEqual([g['slug'] for g in self.search('hymns')['genres']], ['hymns'])
        self.assertEqual([g['slug'] for g in self.search('afro gospel')['genres']][0], 'afro-gospel')

    def test_top_result_only_for_a_clear_winner(self):
        self.song('Blessed Assurance')
        res = self.search('blessed assurance')
        self.assertEqual((res['top']['kind'], res['top']['item']['title']), ('track', 'Blessed Assurance'))
        self.assertIsNone(self.search('zzqq')['top'])

    def test_nothing_the_viewer_must_not_see(self):
        blocked = User.objects.create_user('grace_blocked', 'gb2@x.com', 'x')
        self.song('Grace Hidden', artist=blocked)
        Block.objects.create(blocker=blocked, blocked=self.me)
        gone = User.objects.create_user('grace_gone', 'gg@x.com', 'x', is_deactivated=True)
        self.song('Grace Gone', artist=gone)
        self.song('Grace Removed', is_removed=True)
        res = self.search('grace')
        titles = [t['title'] for t in res['tracks']]
        for never in ('Grace Hidden', 'Grace Gone', 'Grace Removed'):
            self.assertNotIn(never, titles)
        names = [u['username'] for u in res['users']]
        self.assertNotIn('grace_blocked', names)
        self.assertNotIn('grace_gone', names)

    def test_one_section_with_more_rows(self):
        for i in range(12):
            self.song(f'Grace {i}')
        res = self.search('grace', type='tracks')
        self.assertEqual(len(res['tracks']), 12)
        self.assertEqual(res['users'], [])                   # only what was asked
        self.assertEqual(len(self.search('grace')['tracks']), 8)

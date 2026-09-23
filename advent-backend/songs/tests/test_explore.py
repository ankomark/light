"""Explore: trending grid, people to follow, and search — fast, light, and
never showing what the viewer mustn't see (blocked accounts, private
accounts they don't follow, followers-only / removed / "not interested"
posts, deactivated accounts)."""
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from songs.models import (
    Block, Hashtag, NotInterested, Profile, SocialPost, Track, User,
)

IMG = 'https://media.example.com/p.jpg'


def post(user, likes=0, caption='', **kw):
    return SocialPost.objects.create(user=user, content_type='image', media_file=IMG,
                                     caption=caption, likes_count=likes, **kw)


class TrendingTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.me = User.objects.create_user('tr_me', 'trme@x.com', 'x')
        self.alice = User.objects.create_user('tr_alice', 'tra@x.com', 'x')
        self.client.force_authenticate(self.me)

    def ids(self, page=1):
        return [r['id'] for r in self.client.get(f'/api/explore/trending_posts/?page={page}').json()]

    def test_ranked_and_light(self):
        low, high = post(self.alice, likes=1), post(self.alice, likes=50)
        rows = self.client.get('/api/explore/trending_posts/').json()
        self.assertEqual([r['id'] for r in rows], [high.id, low.id])
        self.assertEqual(set(rows[0]), {
            'id', 'content_type', 'media_url', 'optimized_url', 'thumbnail_url',
            'width', 'height', 'view_count', 'visibility', 'likes_count', 'comments_count',
        })

    def test_never_shows_what_the_viewer_must_not_see(self):
        blocked = User.objects.create_user('tr_blocked', 'trb@x.com', 'x')
        blocker = User.objects.create_user('tr_blocker', 'trbr@x.com', 'x')
        private = User.objects.create_user('tr_private', 'trp@x.com', 'x')
        gone = User.objects.create_user('tr_gone', 'trg@x.com', 'x')
        Profile.objects.create(user=private, is_public=False)
        Block.objects.create(blocker=self.me, blocked=blocked)
        Block.objects.create(blocker=blocker, blocked=self.me)
        User.objects.filter(pk=gone.pk).update(is_deactivated=True)
        ok = post(self.alice, likes=1)
        hidden = [
            post(blocked, likes=99), post(blocker, likes=99), post(private, likes=99), post(gone, likes=99),
            post(self.alice, likes=99, visibility='followers'),
            post(self.alice, likes=99, is_removed=True),
        ]
        ni = post(self.alice, likes=98)
        NotInterested.objects.create(user=self.me, post=ni)
        got = self.ids()
        self.assertEqual(got, [ok.id])
        for h in hidden + [ni]:
            self.assertNotIn(h.id, got)

    def test_pages(self):
        for i in range(35):
            post(self.alice, likes=i)
        first, second = self.ids(1), self.ids(2)
        self.assertEqual((len(first), len(second)), (30, 5))
        self.assertFalse(set(first) & set(second))

    def test_falls_back_to_the_month_on_a_quiet_week(self):
        from datetime import timedelta
        from django.utils import timezone
        old = post(self.alice, likes=5)
        SocialPost.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=20))
        self.assertEqual(self.ids(), [old.id])

    def test_query_count_is_flat(self):
        def measure(n):
            cache.clear()
            for i in range(n):
                post(self.alice, likes=i)
            with CaptureQueriesContext(connection) as ctx:
                self.client.get('/api/explore/trending_posts/')
            return len(ctx.captured_queries)
        self.assertEqual(measure(3), measure(20))


class SuggestedTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.me = User.objects.create_user('sg_me', 'sgme@x.com', 'x')
        self.friend = User.objects.create_user('sg_friend', 'sgf@x.com', 'x')
        self.friend.followers.add(self.me)                    # I follow friend
        self.fof = User.objects.create_user('sg_fof', 'sgfof@x.com', 'x')
        self.fof.followers.add(self.friend)                   # friend follows fof
        self.star = User.objects.create_user('sg_star', 'sgs@x.com', 'x')
        for i in range(5):
            self.star.followers.add(User.objects.create_user(f'sg_fan{i}', f'sgfan{i}@x.com', 'x'))
        self.blocked = User.objects.create_user('sg_blocked', 'sgb@x.com', 'x')
        for i in range(9):
            self.blocked.followers.add(User.objects.get(username=f'sg_fan{i % 5}'))
        Block.objects.create(blocker=self.me, blocked=self.blocked)
        self.client.force_authenticate(self.me)

    def test_friends_of_friends_first_then_popular_with_real_counts(self):
        rows = self.client.get('/api/explore/suggested_users/').json()
        names = [r['username'] for r in rows]
        self.assertEqual(names[0], 'sg_fof')                  # followed by someone I follow
        self.assertEqual(rows[0]['mutual_count'], 1)
        self.assertIn('sg_star', names)
        star = next(r for r in rows if r['username'] == 'sg_star')
        self.assertEqual(star['followers_count'], 5)          # used to always read 0
        for never in ('sg_me', 'sg_friend', 'sg_blocked'):
            self.assertNotIn(never, names)


class SearchTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.me = User.objects.create_user('se_me', 'seme@x.com', 'x')
        self.client.force_authenticate(self.me)

    def search(self, q):
        return self.client.get('/api/explore/search/', {'q': q}).json()

    def test_people_prefix_first_and_blocked_hidden(self):
        User.objects.create_user('amazing_grace', 'ag@x.com', 'x')
        User.objects.create_user('the_grace_choir', 'tgc@x.com', 'x')
        blocked = User.objects.create_user('grace_blocked', 'gb@x.com', 'x')
        Block.objects.create(blocker=blocked, blocked=self.me)
        names = [u['username'] for u in self.search('grace')['users']]
        self.assertNotIn('grace_blocked', names)
        prefix = [u['username'] for u in self.search('amaz')['users']]
        self.assertEqual(prefix[0], 'amazing_grace')
        self.assertIn('followers_count', self.search('grace')['users'][0])

    def test_hashtags_posts_and_tracks(self):
        author = User.objects.create_user('se_author', 'sea@x.com', 'x')
        private = User.objects.create_user('se_private', 'sep@x.com', 'x')
        Profile.objects.create(user=private, is_public=False)
        visible = post(author, caption='Sabbath worship #sabbath')
        post(private, caption='Sabbath private')
        tag = Hashtag.objects.create(name='sabbath')
        visible.hashtags.add(tag)
        Track.objects.create(title='Sabbath Song', artist=author, audio_file='https://m.x/a.mp3', lyrics='long lyrics')
        res = self.search('sabbath')
        self.assertEqual(res['hashtags'], [{'tag': 'sabbath', 'count': 1}])
        self.assertEqual([p['id'] for p in res['posts']], [visible.id])
        self.assertNotIn('user', res['posts'][0])             # a light tile
        self.assertNotIn('lyrics', res['tracks'][0])          # no lyrics in search
        self.assertEqual(self.search('#sab')['hashtags'][0]['tag'], 'sabbath')

    def test_short_query_is_empty(self):
        res = self.search('a')
        self.assertIsNone(res.pop('top'))
        self.assertEqual(res, {k: [] for k in ('users', 'artists', 'tracks', 'albums', 'playlists',
                                               'groups', 'genres', 'hashtags', 'posts')})

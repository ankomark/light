"""Ranked "For You" feed (?rank=1): 3-pool blend, diversity, stable pagination.

    python manage.py test songs.tests.test_feed_ranking --settings=music.settings_test
"""
from unittest import mock

from django.core.cache import cache
from rest_framework.test import APITestCase

from songs import feed
from songs.models import SocialPost, User


def mkpost(user, **counts):
    return SocialPost.objects.create(
        user=user, content_type='image', caption='p',
        likes_count=counts.get('likes', 0),
        comments_count=counts.get('comments', 0),
        view_count=counts.get('views', 0),
    )


def follow(follower, followee):
    followee.followers.add(follower)  # follower now follows followee


class TrendingTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.u = User.objects.create_user('t', 't@x.com', 'pw')

    def test_ranks_by_engagement(self):
        low = mkpost(self.u, likes=1)
        high = mkpost(self.u, likes=50, comments=10)
        mid = mkpost(self.u, likes=10)
        ids = [t['id'] for t in feed.compute_trending()]
        self.assertEqual(ids[0], high.id)
        self.assertLess(ids.index(high.id), ids.index(mid.id))
        self.assertLess(ids.index(mid.id), ids.index(low.id))


class DiscoveryTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.alice = User.objects.create_user('alice', 'a@x.com', 'pw')
        self.bob = User.objects.create_user('bob', 'b@x.com', 'pw')
        self.carol = User.objects.create_user('carol', 'c@x.com', 'pw')

    def test_followers_of_followers(self):
        follow(self.alice, self.bob)   # alice -> bob
        follow(self.bob, self.carol)   # bob -> carol
        disc = feed.get_discovery_authors(self.alice, [self.bob.id])
        self.assertIn(self.carol.id, disc)     # carol is 2nd-degree
        self.assertNotIn(self.bob.id, disc)    # already followed, excluded
        self.assertNotIn(self.alice.id, disc)  # self excluded


class RankedFeedEndpointTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.alice = User.objects.create_user('alice', 'a@x.com', 'pw')
        self.bob = User.objects.create_user('bob', 'b@x.com', 'pw')
        self.carol = User.objects.create_user('carol', 'c@x.com', 'pw')
        self.dave = User.objects.create_user('dave', 'd@x.com', 'pw')
        follow(self.alice, self.bob)   # alice follows bob
        follow(self.bob, self.carol)   # bob follows carol -> discovery for alice

        self.bob_post = mkpost(self.bob, likes=5)          # following pool
        self.carol_post = mkpost(self.carol, likes=3)      # discovery pool
        self.dave_post = mkpost(self.dave, likes=99, comments=20)  # trending (unfollowed)
        self.own_post = mkpost(self.alice, likes=1)        # must be excluded
        self.client.force_authenticate(self.alice)

    def _ids(self, res):
        return [p['id'] for p in res.data['results']]

    def test_blend_includes_all_pools_excludes_own(self):
        res = self.client.get('/api/social-posts/?rank=1')
        self.assertEqual(res.status_code, 200)
        ids = self._ids(res)
        self.assertIn(self.bob_post.id, ids)     # following
        self.assertIn(self.carol_post.id, ids)   # discovery
        self.assertIn(self.dave_post.id, ids)    # trending
        self.assertNotIn(self.own_post.id, ids)  # own excluded

    def test_author_diversity_no_consecutive_same_author(self):
        # With enough author variety, a burst from one author (bob) must not
        # stack consecutively — the ranker spreads them out.
        others = [
            User.objects.create_user(f'div{i}', f'div{i}@x.com', 'pw')
            for i in range(5)
        ]
        for o in others:
            follow(self.alice, o)          # alice follows them -> following pool
            mkpost(o, likes=3)
        for _ in range(5):
            mkpost(self.bob, likes=2)      # bob burst
        cache.clear()
        res = self.client.get('/api/social-posts/?rank=1&fresh=1')
        authors = [p['user']['id'] for p in res.data['results']]
        for a, b in zip(authors, authors[1:]):
            self.assertNotEqual(a, b, 'consecutive posts from the same author')

    def test_pagination_is_stable_and_disjoint(self):
        for i in range(6):
            mkpost(self.bob, likes=i)
            mkpost(self.carol, likes=i)
        with mock.patch.object(feed, 'PAGE_SIZE', 3):
            cache.clear()
            p1 = self.client.get('/api/social-posts/?rank=1&fresh=1')
            self.assertIsNotNone(p1.data['next'])
            p2 = self.client.get('/api/social-posts/?rank=1&page=2')
            ids1, ids2 = set(self._ids(p1)), set(self._ids(p2))
            self.assertEqual(len(ids1), 3)
            self.assertTrue(ids1.isdisjoint(ids2), 'pages overlap — snapshot not stable')

    def test_falls_back_to_chronological_when_no_candidates(self):
        # With ONLY the viewer's own content in existence, every pool is empty
        # (own posts are excluded from ranking), so the snapshot is empty and the
        # feed falls through to chronological (which does include own posts).
        SocialPost.objects.all().delete()
        cache.clear()
        zoe = User.objects.create_user('zoe', 'z@x.com', 'pw')
        zoe_post = mkpost(zoe, likes=0)
        self.client.force_authenticate(zoe)
        res = self.client.get('/api/social-posts/?rank=1')
        self.assertEqual(res.status_code, 200)
        self.assertIn(zoe_post.id, self._ids(res))

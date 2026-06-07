"""Tests for the social feed: feed=following filter, search, like/save
annotations, and an N+1 query-count guard.

Run with:
    python manage.py test songs.tests.test_social --settings=music.settings_test
"""
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework import status
from rest_framework.test import APITestCase

from songs.models import User, Profile, SocialPost, PostLike, PostSave, PostComment


def make_post(user, caption='', content_type='image', location='', tags=''):
    return SocialPost.objects.create(
        user=user, content_type=content_type, caption=caption,
        location=location, tags=tags,
    )


def follow(follower, followee):
    # X.followers are the users who follow X, so adding `follower` to
    # `followee.followers` means follower now follows followee.
    followee.followers.add(follower)


class FeedFilterTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.alice = User.objects.create_user(username='alice', password='pw12345!')
        self.bob = User.objects.create_user(username='bob', password='pw12345!')
        self.carol = User.objects.create_user(username='carol', password='pw12345!')
        follow(self.alice, self.bob)  # alice follows bob (not carol)

        self.bob_post = make_post(self.bob, caption='bob post')
        self.carol_post = make_post(self.carol, caption='carol post')
        self.alice_post = make_post(self.alice, caption='my post')

    def _ids(self, res):
        results = res.data['results'] if isinstance(res.data, dict) else res.data
        return {p['id'] for p in results}

    def test_following_feed_excludes_non_followed(self):
        self.client.force_authenticate(self.alice)
        res = self.client.get('/api/social-posts/?feed=following')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        ids = self._ids(res)
        self.assertIn(self.bob_post.id, ids)     # followed
        self.assertIn(self.alice_post.id, ids)   # own
        self.assertNotIn(self.carol_post.id, ids)  # not followed

    def test_default_feed_includes_everyone(self):
        self.client.force_authenticate(self.alice)
        res = self.client.get('/api/social-posts/')
        ids = self._ids(res)
        self.assertEqual(ids, {self.bob_post.id, self.carol_post.id, self.alice_post.id})


class FeedSearchTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.alice = User.objects.create_user(username='alice', password='pw12345!')
        self.bob = User.objects.create_user(username='bob', password='pw12345!')
        self.p_caption = make_post(self.alice, caption='Sabbath blessing')
        self.p_user = make_post(self.bob, caption='hello')
        self.p_loc = make_post(self.alice, caption='trip', location='Nairobi')
        self.p_tag = make_post(self.alice, caption='praise', tags='worship')

    def _ids(self, res):
        results = res.data['results'] if isinstance(res.data, dict) else res.data
        return {p['id'] for p in results}

    def test_search_matches_caption_user_location_tags(self):
        self.client.force_authenticate(self.alice)
        self.assertEqual(self._ids(self.client.get('/api/social-posts/?search=sabbath')), {self.p_caption.id})
        self.assertEqual(self._ids(self.client.get('/api/social-posts/?search=bob')), {self.p_user.id})
        self.assertEqual(self._ids(self.client.get('/api/social-posts/?search=nairobi')), {self.p_loc.id})
        self.assertEqual(self._ids(self.client.get('/api/social-posts/?search=worship')), {self.p_tag.id})


class FeedAnnotationTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.alice = User.objects.create_user(username='alice', password='pw12345!')
        self.bob = User.objects.create_user(username='bob', password='pw12345!')
        self.post = make_post(self.bob, caption='hi')
        PostLike.objects.create(post=self.post, user=self.alice)
        PostComment.objects.create(post=self.post, user=self.alice, content='nice')

    def _first(self, res):
        results = res.data['results'] if isinstance(res.data, dict) else res.data
        return next(p for p in results if p['id'] == self.post.id)

    def test_counts_and_liked_state_per_user(self):
        self.client.force_authenticate(self.alice)
        p = self._first(self.client.get('/api/social-posts/'))
        self.assertEqual(p['likes_count'], 1)
        self.assertEqual(p['comments_count'], 1)
        self.assertTrue(p['is_liked'])
        self.assertFalse(p['is_saved'])

        # Another user sees the same counts but not their own like.
        self.client.force_authenticate(self.bob)
        p = self._first(self.client.get('/api/social-posts/'))
        self.assertEqual(p['likes_count'], 1)
        self.assertFalse(p['is_liked'])


class FeedQueryCountTests(APITestCase):
    """N+1 guard: the feed must use a constant number of queries regardless of
    how many posts are on the page."""

    def setUp(self):
        cache.clear()
        self.viewer = User.objects.create_user(username='viewer', password='pw12345!')
        self.a1 = User.objects.create_user(username='a1', password='pw12345!')
        self.a2 = User.objects.create_user(username='a2', password='pw12345!')
        Profile.objects.create(user=self.a1)
        Profile.objects.create(user=self.a2)

    def _count(self, url):
        with CaptureQueriesContext(connection) as ctx:
            res = self.client.get(url)
            self.assertEqual(res.status_code, status.HTTP_200_OK)
        return len(ctx.captured_queries)

    def test_feed_query_count_is_constant(self):
        self.client.force_authenticate(self.viewer)
        for i in range(3):
            make_post(self.a1, caption=f'a{i}')
            make_post(self.a2, caption=f'b{i}')

        self.client.get('/api/social-posts/')  # warm up
        small = self._count('/api/social-posts/')

        for i in range(6):
            post = make_post(self.a1, caption=f'c{i}')
            PostLike.objects.create(post=post, user=self.viewer)
            PostComment.objects.create(post=post, user=self.viewer, content='x')
        large = self._count('/api/social-posts/')

        self.assertEqual(
            small, large,
            f'Feed query count grew with posts ({small} -> {large}); N+1 reintroduced.'
        )
        self.assertLessEqual(small, 8)

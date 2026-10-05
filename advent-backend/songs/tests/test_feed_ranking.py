"""Ranked "For You" feed (?rank=1): 3-pool blend, diversity, stable pagination.

    python manage.py test songs.tests.test_feed_ranking --settings=music.settings_test
"""
from unittest import mock

from django.core.cache import cache
from rest_framework.test import APITestCase

from songs import feed
from songs.models import SocialPost, User


def mkpost(user, tags='', **counts):
    return SocialPost.objects.create(
        user=user, content_type='image', caption='p', tags=tags,
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

    def test_seen_posts_are_demoted_on_refresh(self):
        # bob & carol are both followed; bob's post scores higher, so it leads.
        follow(self.alice, self.carol)
        hi = mkpost(self.bob, likes=50)     # ranks above...
        lo = mkpost(self.carol, likes=1)    # ...this one
        cache.clear()
        from songs import feed
        feed.mark_seen(self.alice.id, [hi.id])   # pretend hi was already served
        snap = feed.build_ranked_feed(self.alice)
        # The seen high-scorer is demoted below the unseen low-scorer.
        self.assertLess(snap.index(lo.id), snap.index(hi.id))

    def test_a_post_counts_as_seen_when_viewed_not_when_sent(self):
        res = self.client.get('/api/social-posts/?rank=1&fresh=1')
        self.assertIn(self.bob_post.id, self._ids(res))
        self.assertEqual(feed.get_seen(self.alice.id), [])          # sent, not yet on screen
        self.client.post('/api/social-posts/mark_viewed/', {'post_ids': [self.bob_post.id, 'x']}, format='json')
        self.assertEqual(feed.get_seen(self.alice.id), [self.bob_post.id])

    def test_scrolling_keeps_the_snapshot_alive(self):
        self.client.get('/api/social-posts/?rank=1&fresh=1')
        with mock.patch.object(feed.cache, 'touch', wraps=feed.cache.touch) as touch:
            self.client.get('/api/social-posts/?rank=1&page=2')
            touched = [c.args[0] for c in touch.call_args_list]
        self.assertIn(f'feed:rank:{self.alice.id}', touched)

    def test_an_author_flicked_past_again_and_again_is_demoted(self):
        from songs.models import WatchEvent
        follow(self.alice, self.carol)
        skipped = mkpost(self.bob, likes=6)        # would lead on engagement
        kept = mkpost(self.carol, likes=5)
        for _ in range(feed.QUICK_SKIP_MIN):
            WatchEvent.objects.create(user=self.alice, post=self.bob_post, dwell_ms=600)
        cache.clear()
        snap = feed.build_ranked_feed(self.alice)
        self.assertLess(snap.index(kept.id), snap.index(skipped.id))

    def test_a_liked_author_is_not_demoted_for_quick_skips(self):
        from songs.models import PostLike, WatchEvent
        for _ in range(feed.QUICK_SKIP_MIN):
            WatchEvent.objects.create(user=self.alice, post=self.bob_post, dwell_ms=600)
        PostLike.objects.create(user=self.alice, post=self.bob_post)
        cache.clear()
        self.assertNotIn(self.bob.id, feed.negative_taste(self.alice)['skipped'])

    def test_trending_reaches_engaged_posts_beyond_the_cap(self):
        star = mkpost(self.dave, likes=500, comments=80)
        for _ in range(4):
            mkpost(self.dave, likes=0)              # newer, but nobody cares
        with mock.patch.object(feed, 'CANDIDATE_CAP', 2):
            cache.clear()
            ids = [t['id'] for t in feed.compute_trending()]
        self.assertIn(star.id, ids)

    def test_taste_boosts_matching_tag(self):
        from songs import feed
        # Alice likes a 'worship' post -> her taste tags include 'worship'.
        seed = mkpost(self.dave, tags='worship', likes=1)
        self.client.post(f'/api/social-posts/{seed.id}/like/')
        # Two equal-engagement candidates from followed authors; only p1 matches.
        follow(self.alice, self.carol)
        p1 = mkpost(self.bob, tags='worship', likes=5)
        p2 = mkpost(self.carol, tags='random', likes=5)
        cache.clear()
        snap = feed.build_ranked_feed(self.alice)
        self.assertLess(snap.index(p1.id), snap.index(p2.id))

    def test_latest_endpoint_returns_newest_visible_id(self):
        newest = mkpost(self.bob, likes=0)   # newest overall
        res = self.client.get('/api/social-posts/latest/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['latest_id'], newest.id)

    def test_latest_following_filter_and_not_interested(self):
        # Following filter: newest among followed authors (+ self).
        follow(self.alice, self.carol)
        newest_followed = mkpost(self.carol, likes=0)
        mkpost(self.dave, likes=0)  # not followed, newer, must be ignored on following
        res = self.client.get('/api/social-posts/latest/?feed=following')
        self.assertEqual(res.json()['latest_id'], newest_followed.id)

        # A "not interested" newest post is skipped.
        self.client.post(f'/api/social-posts/{newest_followed.id}/not_interested/')
        cache.clear()
        res = self.client.get('/api/social-posts/latest/?feed=following')
        self.assertNotEqual(res.json()['latest_id'], newest_followed.id)

    def test_watch_batch_stores_and_clamps(self):
        from songs.models import WatchEvent
        res = self.client.post('/api/social-posts/watch/', {'events': [
            {'post_id': self.bob_post.id, 'dwell_ms': 5000},
            {'post_id': self.carol_post.id, 'dwell_ms': 100},   # below MIN -> dropped
            {'post_id': 999999, 'dwell_ms': 4000},              # invalid post -> dropped
        ]}, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()['stored'], 1)
        self.assertTrue(WatchEvent.objects.filter(user=self.alice, post=self.bob_post).exists())

    def test_long_dwell_boosts_taste(self):
        from songs import feed
        # Two equal-engagement candidates from followed authors; alice watched
        # dave (untracked here) — instead seed a dwell on a bob-authored topic.
        follow(self.alice, self.carol)
        p_watched_author = mkpost(self.bob, tags='choir', likes=5)
        rival = mkpost(self.carol, tags='news', likes=5)
        # Long dwell on a 'choir' post by bob -> taste favors bob/choir.
        seed = mkpost(self.dave, tags='choir', likes=1)
        self.client.post('/api/social-posts/watch/',
                         {'events': [{'post_id': seed.id, 'dwell_ms': 8000}]}, format='json')
        cache.clear()
        snap = feed.build_ranked_feed(self.alice)
        self.assertIn(p_watched_author.id, snap)
        if rival.id in snap:
            self.assertLess(snap.index(p_watched_author.id), snap.index(rival.id))

    def test_feed_reason_chip_labels_each_post(self):
        res = self.client.get('/api/social-posts/?rank=1&fresh=1')
        self.assertEqual(res.status_code, 200)
        by_id = {p['id']: p.get('feed_reason') for p in res.data['results']}
        # bob is followed; carol is a follower-of-follower; dave is trending.
        self.assertEqual(by_id.get(self.bob_post.id), 'following')
        self.assertEqual(by_id.get(self.carol_post.id), 'discovery')
        self.assertEqual(by_id.get(self.dave_post.id), 'trending')

    def test_not_interested_hides_post_from_both_feeds(self):
        from songs.models import NotInterested
        target = self.bob_post  # bob is followed, so normally in-feed
        res = self.client.post(f'/api/social-posts/{target.id}/not_interested/')
        self.assertEqual(res.status_code, 201, res.content)
        self.assertTrue(NotInterested.objects.filter(user=self.alice, post=target).exists())

        cache.clear()
        # Ranked feed excludes it...
        ranked = self.client.get('/api/social-posts/?rank=1&fresh=1')
        self.assertNotIn(target.id, self._ids(ranked))
        # ...and so does the chronological (Following) feed.
        chrono = self.client.get('/api/social-posts/?feed=following&fresh=1')
        self.assertNotIn(target.id, self._ids(chrono))

    def test_not_interested_demotes_same_author(self):
        from songs import feed
        # Mark one of dave's posts not-interested -> dave's other posts sink.
        disliked = mkpost(self.dave, likes=5)
        neutral = mkpost(self.carol, likes=5)   # carol followed below
        follow(self.alice, self.carol)
        another_dave = mkpost(self.dave, likes=5)
        self.client.post(f'/api/social-posts/{disliked.id}/not_interested/')
        cache.clear()
        snap = feed.build_ranked_feed(self.alice)
        # dave (penalised author) ranks below carol at equal engagement.
        self.assertIn(neutral.id, snap)
        if another_dave.id in snap:
            self.assertLess(snap.index(neutral.id), snap.index(another_dave.id))

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


class VideoForYouTests(APITestCase):
    """The Videos page's For You (?rank=1&content_type=video): ranked like the
    home feed, videos only, and going on through older videos after that."""

    def setUp(self):
        cache.clear()
        self.me = User.objects.create_user('viewer', 'v@x.com', 'pw')
        self.maker = User.objects.create_user('maker', 'm@x.com', 'pw')
        self.client.force_authenticate(self.me)

    def video(self, **counts):
        return SocialPost.objects.create(
            user=self.maker, content_type='video', caption='v',
            likes_count=counts.get('likes', 0), comments_count=counts.get('comments', 0),
        )

    def test_only_videos_best_first_then_older_ones(self):
        from datetime import timedelta
        from django.utils import timezone
        quiet = self.video(likes=0)
        loved = self.video(likes=40, comments=8)
        old = self.video(likes=90)
        SocialPost.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=60))
        mkpost(self.maker, likes=500)                       # a photo: not here
        res = self.client.get('/api/social-posts/?rank=1&fresh=1&content_type=video')
        ids = [p['id'] for p in res.data['results']]
        self.assertEqual(ids[0], loved.id)
        self.assertIn(quiet.id, ids)
        self.assertEqual(ids[-1], old.id)                  # past the ranking window, still there
        self.assertTrue(all(p['content_type'] == 'video' for p in res.data['results']))

    def test_the_home_feed_snapshot_is_its_own(self):
        v = self.video(likes=5)
        photo = mkpost(self.maker, likes=5)
        self.client.get('/api/social-posts/?rank=1&fresh=1&content_type=video')
        home = [p['id'] for p in self.client.get('/api/social-posts/?rank=1&fresh=1').data['results']]
        self.assertIn(photo.id, home)
        self.assertIn(v.id, home)

    def test_not_interested_leaves_the_videos_too(self):
        v = self.video(likes=5)
        self.client.get('/api/social-posts/?rank=1&fresh=1&content_type=video')
        self.client.post(f'/api/social-posts/{v.id}/not_interested/')
        ids = [p['id'] for p in self.client.get('/api/social-posts/?rank=1&content_type=video').data['results']]
        self.assertNotIn(v.id, ids)


class VideoRescanTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.me = User.objects.create_user('viewer2', 'v2@x.com', 'pw')
        self.maker = User.objects.create_user('maker2', 'm2@x.com', 'pw')
        self.client.force_authenticate(self.me)

    def test_following_nobody_the_videos_following_tab_is_empty(self):
        SocialPost.objects.create(user=self.maker, content_type='video', caption='v')
        res = self.client.get('/api/social-posts/?feed=following&content_type=video&fresh=1')
        self.assertEqual(res.data['results'], [])
        # The home feed keeps its fallback (a new user never sees an empty timeline).
        self.assertTrue(self.client.get('/api/social-posts/?feed=following&fresh=1').data['results'])

    def test_ones_own_videos_are_not_in_for_you(self):
        mine = SocialPost.objects.create(user=self.me, content_type='video', caption='mine')
        theirs = SocialPost.objects.create(user=self.maker, content_type='video', caption='theirs')
        ids = [p['id'] for p in self.client.get('/api/social-posts/?rank=1&fresh=1&content_type=video').data['results']]
        self.assertIn(theirs.id, ids)
        self.assertNotIn(mine.id, ids)

    def test_replaying_watch_time_stores_it_once(self):
        from songs.models import WatchEvent
        post = SocialPost.objects.create(user=self.maker, content_type='video', caption='v')
        batch = {'events': [{'post_id': post.id, 'dwell_ms': 5000}]}
        for _ in range(5):
            self.client.post('/api/social-posts/watch/', batch, format='json')
        self.assertEqual(WatchEvent.objects.filter(user=self.me, post=post).count(), 1)

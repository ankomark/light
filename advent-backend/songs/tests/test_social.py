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
        self.alice = User.objects.create_user(username='alice', email='alice@test.co', password='pw12345!')
        self.bob = User.objects.create_user(username='bob', email='bob@test.co', password='pw12345!')
        self.carol = User.objects.create_user(username='carol', email='carol@test.co', password='pw12345!')
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
        self.alice = User.objects.create_user(username='alice', email='alice@test.co', password='pw12345!')
        self.bob = User.objects.create_user(username='bob', email='bob@test.co', password='pw12345!')
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
        self.alice = User.objects.create_user(username='alice', email='alice@test.co', password='pw12345!')
        self.bob = User.objects.create_user(username='bob', email='bob@test.co', password='pw12345!')
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


class SongTrimTests(APITestCase):
    """Creating an image post with a trimmed accompanying audio clip."""

    def setUp(self):
        cache.clear()
        self.alice = User.objects.create_user(username='alice', email='alice@test.co', password='pw12345!')
        self.client.force_authenticate(self.alice)

    def _payload(self, start, end):
        return {
            'content_type': 'image',
            'caption': 'with song',
            'song_audio_url': 'https://res.cloudinary.com/demo/video/upload/song.mp3',
            'song_title': 'Hymn',
            'song_artist': 'Choir',
            'song_start_time': start,
            'song_end_time': end,
        }

    def test_create_persists_trim_window(self):
        res = self.client.post('/api/social-posts/', self._payload(5, 25), format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        post = SocialPost.objects.get(id=res.data['id'])
        self.assertEqual(post.song_start_time, 5)
        self.assertEqual(post.song_end_time, 25)
        self.assertEqual(post.song_audio_url, self._payload(5, 25)['song_audio_url'])
        # And the feed returns the trim fields for client playback.
        feed = self.client.get('/api/social-posts/')
        results = feed.data['results'] if isinstance(feed.data, dict) else feed.data
        item = next(p for p in results if p['id'] == post.id)
        self.assertEqual(item['song_start_time'], 5)
        self.assertEqual(item['song_end_time'], 25)

    def test_clip_longer_than_30s_rejected(self):
        res = self.client.post('/api/social-posts/', self._payload(0, 40), format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_inverted_range_rejected(self):
        res = self.client.post('/api/social-posts/', self._payload(20, 10), format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)


class EditPreservesMediaTests(APITestCase):
    """Editing a post's caption must not mutate/corrupt its stored media_file
    (regression: image went 'media unavailable' after edit + relogin)."""

    def setUp(self):
        cache.clear()
        self.alice = User.objects.create_user(username='alice', email='alice@test.co', password='pw12345!')
        self.client.force_authenticate(self.alice)

    def test_edit_caption_keeps_media_file(self):
        post = SocialPost.objects.create(
            user=self.alice, content_type='image',
            media_file='social_media/sample_abc123',
        )
        before = str(SocialPost.objects.get(id=post.id).media_file)

        res = self.client.patch(
            f'/api/social-posts/{post.id}/', {'caption': 'edited caption'}, format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.data)

        refreshed = SocialPost.objects.get(id=post.id)
        self.assertEqual(refreshed.caption, 'edited caption')
        self.assertEqual(
            str(refreshed.media_file), before,
            'Editing the caption changed the stored media_file (media will 404 after relogin).'
        )


class HealMediaMigrationTests(APITestCase):
    """The 0026 data migration strips leading 'auto/upload/' from media_file."""

    def test_heal_strips_leading_prefix(self):
        import importlib
        from django.apps import apps as global_apps

        user = User.objects.create_user(username='h', email='h@test.co', password='pw12345!')
        post = SocialPost.objects.create(
            user=user, content_type='image', media_file='social_media/xyz',
        )
        table = SocialPost._meta.db_table
        # Force a (doubly) corrupted value straight into the column.
        with connection.cursor() as cur:
            cur.execute(
                f"UPDATE {table} SET media_file = %s WHERE id = %s",
                ['auto/upload/auto/upload/social_media/xyz', post.id],
            )

        mig = importlib.import_module('songs.migrations.0026_heal_corrupted_media_file')
        # heal() only needs schema_editor.connection; a real schema editor can't be
        # opened inside the test's transaction on sqlite, so stand in for it.
        editor = type('SE', (), {'connection': connection})()
        mig.heal(global_apps, editor)

        with connection.cursor() as cur:
            cur.execute(f"SELECT media_file FROM {table} WHERE id = %s", [post.id])
            healed = cur.fetchone()[0]
        self.assertEqual(healed, 'social_media/xyz')


class GalleryTests(APITestCase):
    """1–4 image carousel posts: gallery persistence + media_items output."""

    def setUp(self):
        cache.clear()
        self.alice = User.objects.create_user(username='alice', email='alice@test.co', password='pw12345!')
        self.client.force_authenticate(self.alice)

    def test_create_carousel_returns_media_items(self):
        base = 'https://pub-test.r2.dev/social_media/images'
        gallery = [
            {'url': f'{base}/a.jpg', 'width': 1080, 'height': 1350},
            {'url': f'{base}/b.jpg', 'width': 1080, 'height': 1080},
            {'url': f'{base}/c.jpg', 'width': 1080, 'height': 720},
        ]
        res = self.client.post('/api/social-posts/', {
            'content_type': 'image',
            'caption': 'trip',
            'media_file': f'{base}/a.jpg',
            'gallery': gallery,
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)

        post = SocialPost.objects.get(id=res.data['id'])
        self.assertEqual(len(post.gallery), 3)

        feed = self.client.get('/api/social-posts/')
        results = feed.data['results'] if isinstance(feed.data, dict) else feed.data
        item = next(p for p in results if p['id'] == post.id)
        self.assertEqual(len(item['media_items']), 3)
        self.assertEqual(item['media_items'][0]['media_url'], f'{base}/a.jpg')
        self.assertNotIn('gallery', item)  # write-only

    def test_single_image_without_gallery_yields_one_media_item(self):
        res = self.client.post('/api/social-posts/', {
            'content_type': 'image',
            'media_file': 'social_media/solo',
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        feed = self.client.get('/api/social-posts/')
        results = feed.data['results'] if isinstance(feed.data, dict) else feed.data
        item = next(p for p in results if p['id'] == res.data['id'])
        self.assertEqual(len(item['media_items']), 1)

    def test_more_than_four_images_rejected(self):
        gallery = [{'public_id': f'social_media/{i}'} for i in range(5)]
        res = self.client.post('/api/social-posts/', {
            'content_type': 'image', 'media_file': 'social_media/0', 'gallery': gallery,
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)


class SavedPostsListTests(APITestCase):
    """The saved-posts listing (Favorites > Posts) returns the user's saves with
    the nested post + media_items."""

    def setUp(self):
        cache.clear()
        self.alice = User.objects.create_user(username='alice', email='alice@test.co', password='pw12345!')
        self.bob = User.objects.create_user(username='bob', email='bob@test.co', password='pw12345!')
        self.post = SocialPost.objects.create(user=self.bob, content_type='image', media_file='social_media/x')
        self.client.force_authenticate(self.alice)

    def test_saved_posts_listing(self):
        # Save it, then it should appear in /post-saves/ with the nested post.
        self.client.post(f'/api/social-posts/{self.post.id}/save_post/')
        res = self.client.get('/api/post-saves/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        rows = res.data['results'] if isinstance(res.data, dict) else res.data
        self.assertEqual(len(rows), 1)
        post = rows[0]['post']
        self.assertEqual(post['id'], self.post.id)
        self.assertTrue(len(post['media_items']) >= 1)

    def test_only_my_saves(self):
        # Bob saves it; Alice's listing stays empty.
        self.client.force_authenticate(self.bob)
        self.client.post(f'/api/social-posts/{self.post.id}/save_post/')
        self.client.force_authenticate(self.alice)
        res = self.client.get('/api/post-saves/')
        rows = res.data['results'] if isinstance(res.data, dict) else res.data
        self.assertEqual(len(rows), 0)


class VideoTrimTests(APITestCase):
    """Video posts: the trim window persists (for the client player), and the
    stored R2 URL is served verbatim — clips are trimmed client-side before
    upload, so no trim offsets appear in the URL."""

    VIDEO_URL = 'https://pub-test.r2.dev/social_media/videos/clip.mp4'

    def setUp(self):
        cache.clear()
        self.alice = User.objects.create_user(username='alice', email='alice@test.co', password='pw12345!')
        self.client.force_authenticate(self.alice)

    def _create(self, start, end):
        return self.client.post('/api/social-posts/', {
            'content_type': 'video',
            'media_file': self.VIDEO_URL,
            'video_start_time': start,
            'video_end_time': end,
            'duration': int(end - start),
        }, format='json')

    def test_trim_window_persists_and_url_served_verbatim(self):
        res = self._create(10, 35)
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        post = SocialPost.objects.get(id=res.data['id'])
        self.assertEqual(post.video_start_time, 10)
        self.assertEqual(post.video_end_time, 35)

        feed = self.client.get('/api/social-posts/')
        results = feed.data['results'] if isinstance(feed.data, dict) else feed.data
        item = next(p for p in results if p['id'] == post.id)
        self.assertEqual(item['media_items'][0]['media_url'], self.VIDEO_URL)
        self.assertEqual(item['media_items'][0]['optimized_url'], self.VIDEO_URL)

    def test_clip_over_30s_rejected(self):
        res = self._create(0, 45)
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)


class FeedQueryCountTests(APITestCase):
    """N+1 guard: the feed must use a constant number of queries regardless of
    how many posts are on the page."""

    def setUp(self):
        cache.clear()
        self.viewer = User.objects.create_user(username='viewer', email='viewer@test.co', password='pw12345!')
        self.a1 = User.objects.create_user(username='a1', email='a1@test.co', password='pw12345!')
        self.a2 = User.objects.create_user(username='a2', email='a2@test.co', password='pw12345!')
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

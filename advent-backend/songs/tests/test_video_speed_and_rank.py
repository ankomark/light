"""Videos that start at once, ranked the way short-video apps rank.

    python manage.py test songs.tests.test_video_speed_and_rank --settings=music.settings_test
"""
import struct
from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APITestCase

from songs import feed, video_processing as vp
from songs.models import Job, SocialPost, User, WatchEvent


def box(kind, payload=b''):
    return struct.pack('>I4s', 8 + len(payload), kind) + payload


class IndexFirstTests(TestCase):
    def test_reads_the_order_of_the_boxes(self):
        self.assertTrue(vp.index_first(box(b'ftyp', b'isom') + box(b'moov', b'x' * 20) + box(b'mdat')))
        self.assertFalse(vp.index_first(box(b'ftyp', b'isom') + box(b'free') + box(b'mdat', b'x' * 9)))
        self.assertIsNone(vp.index_first(b'not an mp4 at all'))


@mock.patch.object(vp.r2, 'is_configured', return_value=True)
@mock.patch.object(vp.r2, 'is_r2_url', return_value=True)
@mock.patch.object(vp.r2, 'key_from_url', side_effect=lambda u: u.split('/', 3)[-1])
class FaststartJobTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('maker', 'm@x.com', 'pw')
        self.post = SocialPost.objects.create(user=self.user, content_type='video',
                                              media_file='https://cdn.x/posts/clip.mp4')

    def test_an_index_at_the_end_is_moved_to_the_front_under_a_new_name(self, *_):
        late = box(b'ftyp', b'isom') + box(b'mdat', b'x' * 50)
        with mock.patch.object(vp, '_head', return_value=late), \
                mock.patch.object(vp, '_download'), \
                mock.patch.object(vp, '_ffmpeg') as ffmpeg, \
                mock.patch.object(vp.r2, 'put_file', return_value='https://cdn.x/posts/clip-fast.mp4') as put:
            vp.faststart_video(self.post.pk)
        self.assertIn('+faststart', ffmpeg.call_args[0][0])
        self.assertEqual(put.call_args[0][0], 'posts/clip-fast.mp4')
        self.post.refresh_from_db()
        self.assertEqual(self.post.media_file, 'https://cdn.x/posts/clip-fast.mp4')

    def test_a_file_already_fine_is_left_alone(self, *_):
        good = box(b'ftyp', b'isom') + box(b'moov', b'x' * 10) + box(b'mdat')
        with mock.patch.object(vp, '_head', return_value=good), mock.patch.object(vp, '_ffmpeg') as ffmpeg:
            vp.faststart_video(self.post.pk)
        ffmpeg.assert_not_called()

    def test_a_new_video_post_is_queued(self, *_):
        with self.captureOnCommitCallbacks(execute=True):
            post = SocialPost.objects.create(user=self.user, content_type='video', media_file='https://cdn.x/v.mp4')
        self.assertTrue(Job.objects.filter(kind='faststart_video', key=f'post:{post.pk}').exists())
        with self.captureOnCommitCallbacks(execute=True):
            SocialPost.objects.create(user=self.user, content_type='image', media_file='https://cdn.x/p.jpg')
        self.assertEqual(Job.objects.filter(kind='faststart_video').count(), 1)


class VideoQualityTests(TestCase):
    def test_rate_and_completion_not_raw_size(self):
        base = {'likes_count': 0, 'comments_count': 0, 'view_count': 0, 'duration': timedelta(seconds=20)}
        # A small creator: 40 views, 12 likes, watched through and again.
        small = {**base, 'view_count': 40, 'likes_count': 12, 'avg_dwell': 26000}
        # A big one: 5000 views, 100 likes, left after a few seconds.
        big = {**base, 'view_count': 5000, 'likes_count': 100, 'avg_dwell': 3000}
        self.assertGreater(feed.video_quality(small), 2 * feed.video_quality(big))
        self.assertEqual(feed.video_quality({'likes_count': 5}), 1.0)   # not a video row


class VideoRankingTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.me = User.objects.create_user('viewer', 'v@x.com', 'pw')
        self.client.force_authenticate(self.me)

    def test_a_video_people_finish_beats_one_they_leave(self):
        watchers = [User.objects.create_user(f'w{i}', f'w{i}@x.com', 'pw') for i in range(5)]
        a = User.objects.create_user('a', 'a@x.com', 'pw')
        b = User.objects.create_user('b', 'b@x.com', 'pw')
        kept = SocialPost.objects.create(user=a, content_type='video', duration=timedelta(seconds=15),
                                         view_count=30, likes_count=3)
        left = SocialPost.objects.create(user=b, content_type='video', duration=timedelta(seconds=15),
                                         view_count=30, likes_count=3)
        for w in watchers:
            WatchEvent.objects.create(user=w, post=kept, dwell_ms=15000)
            WatchEvent.objects.create(user=w, post=left, dwell_ms=1500)
        ids = [p['id'] for p in self.client.get('/api/social-posts/?rank=1&fresh=1&content_type=video').data['results']]
        self.assertLess(ids.index(kept.id), ids.index(left.id))

    def test_video_taste_comes_from_what_was_watched_through(self):
        fan_of = User.objects.create_user('fav', 'f@x.com', 'pw')
        skipped = User.objects.create_user('meh', 'h@x.com', 'pw')
        p1 = SocialPost.objects.create(user=fan_of, content_type='video', duration=timedelta(seconds=10))
        p2 = SocialPost.objects.create(user=skipped, content_type='video', duration=timedelta(seconds=120))
        WatchEvent.objects.create(user=self.me, post=p1, dwell_ms=9500)    # watched through
        WatchEvent.objects.create(user=self.me, post=p2, dwell_ms=5000)    # 5 s of 2 min: not
        taste = feed.taste_profile(self.me, 'video')
        self.assertIn(fan_of.id, taste['authors'])
        self.assertNotIn(skipped.id, taste['authors'])

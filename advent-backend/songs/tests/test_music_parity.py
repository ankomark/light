"""Music at Home's level: track comments with threads/reactions/mentions,
"For you" and "More like this" discovery, and counted downloads."""
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from songs.models import (
    Block, Comment, Like, Notification, Track, TrackCommentReaction, User,
)

AUDIO = 'https://media.example.com/a.mp3'


def rows(res):
    body = res.json()
    return body['results'] if isinstance(body, dict) and 'results' in body else body


def track(artist, title, **kw):
    return Track.objects.create(title=title, artist=artist, audio_file=AUDIO, **kw)


class TrackCommentTests(APITestCase):
    def setUp(self):
        self.artist = User.objects.create_user('mp_artist', 'mpa@x.com', 'x')
        self.amy = User.objects.create_user('mp_amy', 'mpamy@x.com', 'x')
        self.ben = User.objects.create_user('mp_ben', 'mpben@x.com', 'x')
        self.track = track(self.artist, 'Hymn')
        self.base = f'/api/tracks/{self.track.id}/comments/'

    def post(self, user, content, parent=None):
        self.client.force_authenticate(user)
        res = self.client.post(self.base, {'content': content, **({'parent': parent} if parent else {})}, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        return res.json()

    def test_threads_flatten_and_count(self):
        top = self.post(self.amy, 'beautiful')
        r1 = self.post(self.ben, 'agreed', parent=top['id'])
        r2 = self.post(self.amy, 'thanks!', parent=r1['id'])
        self.assertEqual((r1['parent'], r2['parent']), (top['id'], top['id']))
        self.assertEqual(r2['reply_to']['username'], 'mp_ben')
        listed = rows(self.client.get(self.base))
        self.assertEqual([c['id'] for c in listed], [top['id']])
        self.assertEqual(listed[0]['replies_count'], 2)
        thread = rows(self.client.get(f'{self.base}{top["id"]}/replies/'))
        self.assertEqual([c['content'] for c in thread], ['agreed', 'thanks!'])

    def test_notifications_link_the_exact_track_comment(self):
        top = self.post(self.amy, 'lovely')
        reply = self.post(self.ben, 'yes @mp_artist', parent=top['id'])
        amy_note = Notification.objects.get(recipient=self.amy, notification_type='comment_reply')
        self.assertEqual((amy_note.track_id, amy_note.track_comment_id), (self.track.id, reply['id']))
        # The artist was mentioned AND owns the track → one notification.
        self.assertEqual(Notification.objects.filter(recipient=self.artist, sender=self.ben).count(), 1)
        self.client.force_authenticate(self.amy)
        row = next(n for n in rows(self.client.get('/api/notifications/')) if n['notification_type'] == 'comment_reply')
        self.assertEqual(row['related_comment_id'], reply['id'])
        self.assertEqual(row['track']['id'], self.track.id)

    def test_reactions(self):
        c = Comment.objects.create(track=self.track, user=self.amy, content='react')
        self.client.force_authenticate(self.ben)
        url = f'{self.base}{c.id}/react/'
        self.assertEqual(self.client.post(url, {}, format='json').json()['mine'], '❤️')
        res = self.client.post(url, {'emoji': '🔥'}, format='json').json()
        self.assertEqual(res['reactions'], {'total': 1, 'top': ['🔥'], 'mine': '🔥'})
        self.assertEqual(Notification.objects.filter(recipient=self.amy, notification_type='comment_like').count(), 1)
        self.assertIsNone(self.client.delete(url).json()['mine'])
        c.refresh_from_db()
        self.assertEqual(c.reactions_count, 0)

    def test_top_comments_first_with_flat_queries(self):
        quiet = Comment.objects.create(track=self.track, user=self.ben, content='newer')
        loved = Comment.objects.create(track=self.track, user=self.amy, content='older')
        Comment.objects.filter(pk=loved.pk).update(created_at=quiet.created_at.replace(year=2020))
        for i in range(3):
            u = User.objects.create_user(f'mp_f{i}', f'mpf{i}@x.com', 'x')
            TrackCommentReaction.objects.create(comment=loved, user=u, emoji='❤️')
        self.client.force_authenticate(self.ben)
        listed = rows(self.client.get(self.base))
        self.assertEqual([c['id'] for c in listed], [loved.id, quiet.id])

        def measure(n):
            for i in range(n):
                cm = Comment.objects.create(track=self.track, user=self.amy, content=f'c{i}')
                TrackCommentReaction.objects.create(comment=cm, user=self.ben, emoji='🙏')
            with CaptureQueriesContext(connection) as ctx:
                self.client.get(self.base)
            return len(ctx.captured_queries)
        self.assertEqual(measure(2), measure(8))

    def test_blocked_hidden_and_removed_track_closed(self):
        self.post(self.amy, 'hi')
        Block.objects.create(blocker=self.ben, blocked=self.amy)
        self.client.force_authenticate(self.ben)
        self.assertEqual(rows(self.client.get(self.base)), [])
        self.track.is_removed = True
        self.track.save(update_fields=['is_removed'])
        res = self.client.post(self.base, {'content': 'x'}, format='json')
        self.assertEqual(res.status_code, 404)


class DiscoveryTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.me = User.objects.create_user('dv_me', 'dvme@x.com', 'x')
        self.artist = User.objects.create_user('dv_artist', 'dva@x.com', 'x')
        self.other_artist = User.objects.create_user('dv_other', 'dvo@x.com', 'x')
        self.fan = User.objects.create_user('dv_fan', 'dvf@x.com', 'x')
        self.seed = track(self.artist, 'Seed')
        self.co_liked = track(self.other_artist, 'Fans also like this')
        self.same_artist = track(self.artist, 'More from artist')
        self.popular = track(self.other_artist, 'Popular')
        self.removed = track(self.other_artist, 'Removed', is_removed=True)
        self.mine = track(self.me, 'My own upload')
        Like.objects.create(user=self.me, track=self.seed)
        Like.objects.create(user=self.fan, track=self.seed)
        Like.objects.create(user=self.fan, track=self.co_liked)
        Like.objects.create(user=self.fan, track=self.removed)
        Like.objects.create(user=self.fan, track=self.mine)
        for i in range(2):
            u = User.objects.create_user(f'dv_p{i}', f'dvp{i}@x.com', 'x')
            Like.objects.create(user=u, track=self.popular)
        self.client.force_authenticate(self.me)

    def test_for_you_blends_sources_with_reasons(self):
        got = self.client.get('/api/tracks/for_you/').json()
        by_id = {r['id']: r['reason'] for r in got}
        self.assertEqual(by_id[self.co_liked.id], 'fans_also_like')
        self.assertEqual(by_id[self.same_artist.id], 'from_artist')
        self.assertEqual(by_id[self.popular.id], 'popular')
        for never in (self.seed.id, self.removed.id, self.mine.id):
            self.assertNotIn(never, by_id)          # liked / removed / own
        self.assertEqual(got[0]['id'], self.co_liked.id)  # round-robin opens with fans_also_like

    def test_new_listener_still_gets_a_list(self):
        newbie = User.objects.create_user('dv_new', 'dvn@x.com', 'x')
        self.client.force_authenticate(newbie)
        got = self.client.get('/api/tracks/for_you/').json()
        self.assertTrue(got)
        self.assertTrue(all(r['reason'] == 'popular' for r in got))

    def test_liking_refreshes_for_you(self):
        first = {r['id'] for r in self.client.get('/api/tracks/for_you/').json()}
        self.assertIn(self.popular.id, first)
        self.client.post(f'/api/tracks/{self.popular.id}/toggle-like/')
        after = {r['id'] for r in self.client.get('/api/tracks/for_you/').json()}
        self.assertNotIn(self.popular.id, after)   # now liked → no longer suggested

    def test_similar(self):
        got = self.client.get(f'/api/tracks/{self.seed.id}/similar/').json()
        ids = [r['id'] for r in got]
        self.assertNotIn(self.seed.id, ids)
        self.assertEqual(got[0]['id'], self.co_liked.id)
        self.assertIn(self.same_artist.id, ids)


class DownloadCountTests(APITestCase):
    def test_download_counts(self):
        u = User.objects.create_user('dl_u', 'dlu@x.com', 'x')
        t = track(u, 'Song')
        self.client.force_authenticate(u)
        res = self.client.get(f'/api/tracks/{t.id}/download/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['download_url'], AUDIO)
        t.refresh_from_db()
        self.assertEqual(t.downloads, 1)

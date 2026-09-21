"""Post privacy, comment switch, hashtags, mentions, upload idempotency,
trending sounds.

Visibility is the part with teeth: a followers-only or "only me" post must be
invisible — not just unlisted — on every path that can reach it. The tests
walk each path rather than trusting the shared queryset to cover them all.
"""
from datetime import timedelta
from importlib import import_module

from django.apps import apps as django_apps
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from songs.captions import extract_hashtags, extract_mentions
from songs.models import (
    Block, Hashtag, Notification, PostSave, Profile, SocialPost, Track, User,
)

IMG = 'https://media.example.com/p.jpg'


def make_post(user, caption='', visibility='public', **kw):
    return SocialPost.objects.create(
        user=user, content_type='image', media_file=IMG, caption=caption,
        visibility=visibility, **kw,
    )


def ids(response):
    body = response.json()
    rows = body['results'] if isinstance(body, dict) and 'results' in body else body
    return {r['id'] for r in rows}


class CaptionParsingTests(APITestCase):
    def test_hashtags(self):
        self.assertEqual(
            extract_hashtags('Praise #Sabbath and #sabbath, #Mungu_Mwema #2024 a#b ##x'),
            ['sabbath', 'mungu_mwema'],
        )

    def test_mentions(self):
        self.assertEqual(
            extract_mentions('thanks @john. and @Mary-Ann, email a@b.com, @john again'),
            ['john', 'Mary-Ann'],
        )


class VisibilityTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.author = User.objects.create_user('vis_author', 'va@x.com', 'x')
        self.fan = User.objects.create_user('vis_fan', 'vf@x.com', 'x')
        self.stranger = User.objects.create_user('vis_stranger', 'vs@x.com', 'x')
        self.author.followers.add(self.fan)  # fan follows author
        Profile.objects.get_or_create(user=self.author)
        self.public = make_post(self.author, 'pub', 'public')
        self.followers = make_post(self.author, 'fol', 'followers')
        self.private = make_post(self.author, 'me', 'private')

    def as_(self, user):
        self.client.force_authenticate(user)

    def test_feed(self):
        for user, expected in (
            (self.author, {self.public.id, self.followers.id, self.private.id}),
            (self.fan, {self.public.id, self.followers.id}),
            (self.stranger, {self.public.id}),
        ):
            self.as_(user)
            got = ids(self.client.get('/api/social-posts/')) & {self.public.id, self.followers.id, self.private.id}
            self.assertEqual(got, expected, user.username)

    def test_anonymous_sees_public_only(self):
        self.client.force_authenticate(None)
        got = ids(self.client.get('/api/social-posts/'))
        self.assertIn(self.public.id, got)
        self.assertNotIn(self.followers.id, got)
        self.assertNotIn(self.private.id, got)

    def test_detail_and_actions_404_for_hidden(self):
        self.as_(self.stranger)
        for post in (self.followers, self.private):
            self.assertEqual(self.client.get(f'/api/social-posts/{post.id}/').status_code, 404)
            self.assertEqual(self.client.post(f'/api/social-posts/{post.id}/like/').status_code, 404)
            self.assertEqual(self.client.post(f'/api/social-posts/{post.id}/comment/',
                                              {'content': 'hi'}, format='json').status_code, 404)
        self.as_(self.fan)
        self.assertEqual(self.client.get(f'/api/social-posts/{self.followers.id}/').status_code, 200)
        self.assertEqual(self.client.get(f'/api/social-posts/{self.private.id}/').status_code, 404)

    def test_comments_of_hidden_post_are_not_listable(self):
        self.as_(self.author)
        self.client.post(f'/api/social-posts/{self.private.id}/comment/', {'content': 'note to self'}, format='json')
        self.as_(self.stranger)
        body = self.client.get(f'/api/social-posts/{self.private.id}/comments/').json()
        rows = body['results'] if isinstance(body, dict) else body
        self.assertEqual(rows, [])
        res = self.client.post(f'/api/social-posts/{self.private.id}/comments/', {'content': 'x'}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_profile_grid_and_count(self):
        self.as_(self.stranger)
        res = self.client.get(f'/api/users/{self.author.id}/')
        grid = {p['id'] for p in res.json()['social_posts']}
        self.assertEqual(grid, {self.public.id})
        self.assertEqual(res.json()['profile']['posts_count'], 1)
        self.as_(self.author)
        res = self.client.get(f'/api/users/{self.author.id}/')
        grid = {p['id'] for p in res.json()['social_posts']}
        self.assertEqual(grid, {self.public.id, self.followers.id, self.private.id})
        self.assertEqual(res.json()['profile']['posts_count'], 3)

    def test_user_posts_endpoint(self):
        self.as_(self.stranger)
        self.assertEqual(ids(self.client.get(f'/api/users/{self.author.id}/social_posts/')), {self.public.id})

    def test_latest_ignores_hidden(self):
        newest_private = make_post(self.author, 'newer', 'private')
        self.as_(self.stranger)
        latest = self.client.get('/api/social-posts/latest/').json()['latest_id']
        self.assertNotEqual(latest, newest_private.id)

    def test_search_and_explore(self):
        self.as_(self.stranger)
        posts = {p['id'] for p in self.client.get('/api/explore/search/?q=fol').json()['posts']}
        self.assertNotIn(self.followers.id, posts)

    def test_saved_post_that_becomes_hidden_drops_out(self):
        PostSave.objects.create(user=self.stranger, post=self.public)
        self.public.visibility = 'private'
        self.public.save(update_fields=['visibility'])
        self.as_(self.stranger)
        body = self.client.get('/api/post-saves/').json()
        rows = body['results'] if isinstance(body, dict) else body
        self.assertEqual(rows, [])

    def test_share_page_serves_public_only(self):
        self.assertEqual(self.client.get(f'/post/{self.public.id}/').status_code, 200)
        self.assertEqual(self.client.get(f'/post/{self.followers.id}/').status_code, 404)
        self.public.is_removed = True
        self.public.save(update_fields=['is_removed'])
        self.assertEqual(self.client.get(f'/post/{self.public.id}/').status_code, 404)

    def test_ranked_feed_respects_visibility(self):
        self.as_(self.stranger)
        got = ids(self.client.get('/api/social-posts/?rank=1&fresh=1'))
        self.assertNotIn(self.followers.id, got)
        self.assertNotIn(self.private.id, got)

    def test_author_can_change_visibility(self):
        self.as_(self.author)
        res = self.client.patch(f'/api/social-posts/{self.private.id}/', {'visibility': 'public'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.as_(self.stranger)
        self.assertEqual(self.client.get(f'/api/social-posts/{self.private.id}/').status_code, 200)


class CommentSwitchTests(APITestCase):
    def setUp(self):
        self.author = User.objects.create_user('cs_a', 'csa@x.com', 'x')
        self.viewer = User.objects.create_user('cs_v', 'csv@x.com', 'x')
        self.post = make_post(self.author, 'quiet', comments_enabled=False)
        self.client.force_authenticate(self.viewer)

    def test_both_comment_routes_refuse(self):
        a = self.client.post(f'/api/social-posts/{self.post.id}/comment/', {'content': 'hi'}, format='json')
        b = self.client.post(f'/api/social-posts/{self.post.id}/comments/', {'content': 'hi'}, format='json')
        self.assertEqual(a.status_code, 403)
        self.assertEqual(b.status_code, 403)
        self.assertEqual(self.post.comments.count(), 0)

    def test_flag_is_serialized(self):
        row = self.client.get(f'/api/social-posts/{self.post.id}/').json()
        self.assertIs(row['comments_enabled'], False)
        self.assertEqual(row['visibility'], 'public')


class HashtagTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('ht_u', 'htu@x.com', 'x')
        self.client.force_authenticate(self.user)

    def create(self, caption, **extra):
        res = self.client.post('/api/social-posts/', {
            'content_type': 'image', 'media_file': IMG, 'caption': caption, **extra,
        }, format='json')
        self.assertIn(res.status_code, (200, 201), res.content)
        return res.json()['id']

    def test_caption_creates_hashtags(self):
        pid = self.create('Morning #Worship with #choir #worship')
        self.assertEqual(set(SocialPost.objects.get(pk=pid).hashtags.values_list('name', flat=True)),
                         {'worship', 'choir'})

    def test_tag_filter_is_exact_and_unduplicated(self):
        love = self.create('#love #joy #peace')
        self.create('#loveliness')
        got = self.client.get('/api/social-posts/?tag=love').json()
        rows = got['results'] if isinstance(got, dict) else got
        self.assertEqual([r['id'] for r in rows], [love])  # once, despite 3 tags

    def test_legacy_tags_string_still_matches(self):
        legacy = make_post(self.user, 'old post', tags='hymns sabbath')
        rows = self.client.get('/api/social-posts/?tag=hymns').json()
        rows = rows['results'] if isinstance(rows, dict) else rows
        self.assertIn(legacy.id, [r['id'] for r in rows])

    def test_trending_counts_public_only(self):
        self.create('#grace')
        self.create('#grace', visibility='private')
        self.create('#hope')
        top = {t['tag']: t['count'] for t in self.client.get('/api/explore/trending_hashtags/').json()}
        self.assertEqual(top['grace'], 1)
        self.assertEqual(top['hope'], 1)

    def test_suggest_and_header(self):
        self.create('#sabbath #sabbath_school')
        self.create('#sabbath')
        sug = self.client.get('/api/explore/hashtag_suggest/?q=sab').json()
        self.assertEqual([s['tag'] for s in sug], ['sabbath', 'sabbath_school'])
        self.assertEqual(sug[0]['count'], 2)
        head = self.client.get('/api/explore/hashtag/?tag=%23Sabbath').json()
        self.assertEqual(head, {'tag': 'sabbath', 'posts_count': 2})


class MentionTests(APITestCase):
    def setUp(self):
        self.author = User.objects.create_user('mn_author', 'mna@x.com', 'x')
        self.friend = User.objects.create_user('mn_friend', 'mnf@x.com', 'x')
        self.other = User.objects.create_user('mn_other', 'mno@x.com', 'x')
        self.author.followers.add(self.friend)
        self.client.force_authenticate(self.author)

    def post(self, caption, visibility='public'):
        return self.client.post('/api/social-posts/', {
            'content_type': 'image', 'media_file': IMG, 'caption': caption, 'visibility': visibility,
        }, format='json').json()['id']

    def notified(self, user):
        return Notification.objects.filter(recipient=user, notification_type='mention').count()

    def test_mention_notifies_and_links(self):
        pid = self.post('with @MN_Friend and @mn_other and @nobody_here and @mn_author')
        self.assertEqual(self.notified(self.friend), 1)
        self.assertEqual(self.notified(self.other), 1)
        self.assertEqual(self.notified(self.author), 0)  # never yourself
        self.assertEqual(set(SocialPost.objects.get(pk=pid).mentions.values_list('username', flat=True)),
                         {'mn_friend', 'mn_other'})

    def test_followers_only_post_pings_followers_only(self):
        self.post('hey @mn_friend @mn_other', visibility='followers')
        self.assertEqual(self.notified(self.friend), 1)
        self.assertEqual(self.notified(self.other), 0)

    def test_private_post_pings_nobody(self):
        self.post('note @mn_friend', visibility='private')
        self.assertEqual(self.notified(self.friend), 0)

    def test_blocked_users_are_not_pinged(self):
        Block.objects.create(blocker=self.other, blocked=self.author)
        self.post('hi @mn_other')
        self.assertEqual(self.notified(self.other), 0)

    def test_edit_only_notifies_new_mentions(self):
        pid = self.post('hi @mn_friend')
        self.client.patch(f'/api/social-posts/{pid}/', {'caption': 'hi @mn_friend and @mn_other'}, format='json')
        self.assertEqual(self.notified(self.friend), 1)  # not re-pinged
        self.assertEqual(self.notified(self.other), 1)


class IdempotentCreateTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('id_u', 'idu@x.com', 'x')
        self.client.force_authenticate(self.user)

    def payload(self, **kw):
        return {'content_type': 'image', 'media_file': IMG, 'caption': 'c', **kw}

    def test_retry_with_same_key_returns_the_same_post(self):
        a = self.client.post('/api/social-posts/', self.payload(client_id='up_1'), format='json')
        b = self.client.post('/api/social-posts/', self.payload(client_id='up_1'), format='json')
        self.assertEqual(a.status_code, 201)
        self.assertEqual(b.status_code, 200)
        self.assertEqual(a.json()['id'], b.json()['id'])
        self.assertEqual(SocialPost.objects.filter(user=self.user).count(), 1)

    def test_blank_keys_do_not_collide(self):
        for _ in range(2):
            res = self.client.post('/api/social-posts/', self.payload(client_id=''), format='json')
            self.assertEqual(res.status_code, 201)
        self.assertEqual(SocialPost.objects.filter(user=self.user).count(), 2)

    def test_keys_are_per_user(self):
        other = User.objects.create_user('id_o', 'ido@x.com', 'x')
        self.client.post('/api/social-posts/', self.payload(client_id='same'), format='json')
        self.client.force_authenticate(other)
        res = self.client.post('/api/social-posts/', self.payload(client_id='same'), format='json')
        self.assertEqual(res.status_code, 201)


class TrackUploadTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('tr_u', 'tru@x.com', 'x')
        self.client.force_authenticate(self.user)

    def upload(self, **kw):
        return self.client.post('/api/tracks/upload/', {
            'title': 'Amazing Grace', 'audio_file': 'https://media.example.com/a.mp3', **kw,
        }, format='json')

    def test_same_title_twice_gets_distinct_slugs(self):
        a, b = self.upload(), self.upload()
        self.assertEqual((a.status_code, b.status_code), (201, 201))
        self.assertNotEqual(a.json()['slug'], b.json()['slug'])

    def test_retry_with_same_key_returns_the_same_track(self):
        a = self.upload(client_id='t1')
        b = self.upload(client_id='t1')
        self.assertEqual(b.status_code, 200)
        self.assertEqual(a.json()['id'], b.json()['id'])
        self.assertEqual(Track.objects.filter(artist=self.user).count(), 1)


class TrendingSoundsTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('ts_u', 'tsu@x.com', 'x')
        self.client.force_authenticate(self.user)
        mk = lambda t: Track.objects.create(title=t, artist=self.user, audio_file=f'https://m.x/{t}.mp3')
        self.hot, self.warm, self.cold = mk('hot'), mk('warm'), mk('cold')

    def test_ranked_by_recent_public_use(self):
        for _ in range(3):
            make_post(self.user, song=self.hot)
        make_post(self.user, song=self.warm)
        make_post(self.user, song=self.cold, visibility='private')  # doesn't count
        stale = make_post(self.user, song=self.cold)
        SocialPost.objects.filter(pk=stale.pk).update(created_at=timezone.now() - timedelta(days=30))
        rows = self.client.get('/api/tracks/trending_sounds/').json()
        self.assertEqual([r['id'] for r in rows], [self.hot.id, self.warm.id])
        self.assertEqual(rows[0]['recent_uses'], 3)

    def test_falls_back_when_nothing_is_trending(self):
        rows = self.client.get('/api/tracks/trending_sounds/').json()
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(r['recent_uses'] == 0 for r in rows))


class MentionSuggestTests(APITestCase):
    def setUp(self):
        self.me = User.objects.create_user('ms_me', 'msme@x.com', 'x')
        self.followed = User.objects.create_user('ms_zed', 'msz@x.com', 'x')
        self.popular = User.objects.create_user('ms_amy', 'msa@x.com', 'x')
        self.blocked = User.objects.create_user('ms_bob', 'msb@x.com', 'x')
        self.followed.followers.add(self.me)
        for i in range(3):
            self.popular.followers.add(User.objects.create_user(f'ms_fan{i}', f'msf{i}@x.com', 'x'))
        Block.objects.create(blocker=self.me, blocked=self.blocked)
        self.client.force_authenticate(self.me)

    def test_followed_first_blocked_never(self):
        names = [u['username'] for u in self.client.get('/api/users/mention_suggest/?q=ms_').json()]
        self.assertEqual(names[0], 'ms_zed')      # followed beats more popular
        self.assertIn('ms_amy', names)
        self.assertNotIn('ms_bob', names)
        self.assertNotIn('ms_me', names)

    def test_empty_query_lists_people_you_follow(self):
        names = [u['username'] for u in self.client.get('/api/users/mention_suggest/?q=').json()]
        self.assertEqual(names, ['ms_zed'])


class ByUsernameTests(APITestCase):
    def test_resolves_case_insensitively_and_hides_blocked(self):
        me = User.objects.create_user('bu_me', 'bume@x.com', 'x')
        target = User.objects.create_user('Bu_Target', 'but@x.com', 'x')
        self.client.force_authenticate(me)
        self.assertEqual(self.client.get('/api/users/by_username/?u=@bu_target').json(),
                         {'id': target.id, 'username': 'Bu_Target'})
        Block.objects.create(blocker=target, blocked=me)
        self.assertEqual(self.client.get('/api/users/by_username/?u=bu_target').status_code, 404)
        self.assertEqual(self.client.get('/api/users/by_username/?u=nobody').status_code, 404)


class HashtagBackfillTests(APITestCase):
    def test_backfill_links_captions_and_legacy_tags(self):
        u = User.objects.create_user('bf_u', 'bfu@x.com', 'x')
        a = make_post(u, 'Old #Hymns post')
        b = make_post(u, 'no tags in caption', tags='sabbath #choir')
        make_post(u, 'nothing here')
        backfill = import_module('songs.migrations.0119_backfill_hashtags').backfill
        backfill(django_apps, None)
        backfill(django_apps, None)  # idempotent
        self.assertEqual(list(a.hashtags.values_list('name', flat=True)), ['hymns'])
        self.assertEqual(set(b.hashtags.values_list('name', flat=True)), {'sabbath', 'choir'})
        self.assertEqual(Hashtag.objects.count(), 3)

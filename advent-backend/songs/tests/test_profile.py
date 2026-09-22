"""Profiles: one fast request per screen, and nothing a viewer mustn't see —
no directory dump, no one else's email or birth date, no profile of someone
who blocked you, no private account's posts or follower lists."""
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase, APIClient

from songs.models import Block, FollowRequest, Profile, SocialPost, User

IMG = 'https://media.example.com/p.jpg'


def post(user, **kw):
    return SocialPost.objects.create(user=user, content_type='image', media_file=IMG, **kw)


class Base(APITestCase):
    def setUp(self):
        self.me = User.objects.create_user('pf_me', 'pfme@x.com', 'x')
        Profile.objects.create(user=self.me, birth_date='1990-01-01', location='Nairobi', bio='hi')
        self.star = User.objects.create_user('pf_star', 'star-secret@x.com', 'x')
        Profile.objects.create(user=self.star, birth_date='1985-05-05', location='Kisumu', bio='singer')
        self.client.force_authenticate(self.me)

    def get(self, user, suffix=''):
        return self.client.get(f'/api/users/{user.id}/{suffix}')


class DirectoryTests(Base):
    def test_no_logged_out_access_and_no_user_or_profile_lists(self):
        anon = APIClient()
        self.assertEqual(anon.get(f'/api/users/{self.star.id}/').status_code, 401)
        self.assertEqual(anon.get(f'/api/profiles/by_user/{self.star.id}/').status_code, 401)
        for url in ('/api/users/', '/api/profiles/'):
            self.assertEqual(anon.get(url).status_code, 404)
            self.assertEqual(self.client.get(url).status_code, 404)

    def test_someone_elses_profile_has_no_private_fields(self):
        body = self.get(self.star).content.decode()
        self.assertNotIn('star-secret', body)
        self.assertNotIn('1985-05-05', body)
        for url in (f'/api/profiles/by_user/{self.star.id}/', f'/api/profiles/{self.star.profile.id}/'):
            data = self.client.get(url).json()
            self.assertEqual(data['bio'], 'singer')
            for private in ('email', 'birth_date', 'is_staff', 'admin_role', 'capabilities'):
                self.assertNotIn(private, data)

    def test_my_own_profile_keeps_my_birth_date(self):
        self.assertEqual(self.get(self.me).json()['profile']['birth_date'], '1990-01-01')
        self.assertTrue(self.get(self.me).json()['is_self'])


class DetailTests(Base):
    def test_header_counts_and_follow_state(self):
        fan = User.objects.create_user('pf_fan', 'pff@x.com', 'x')
        self.star.followers.add(self.me, fan)
        self.me.followers.add(self.star)                  # star follows me back
        self.star.followed_by.add(fan)
        post(self.star)
        post(self.star, visibility='followers')
        post(self.star, is_removed=True)
        data = self.get(self.star).json()
        self.assertEqual((data['followers_count'], data['following_count'], data['posts_count']), (2, 2, 2))
        self.assertTrue(data['is_following'])
        self.assertTrue(data['follows_you'])
        self.assertEqual(data['follow_status'], 'following')
        self.assertFalse(data['is_self'])

    def test_first_page_only_then_paged_grid(self):
        for _ in range(35):
            post(self.star)
        data = self.get(self.star).json()
        self.assertEqual(len(data['social_posts']), 30)
        self.assertTrue(data['posts_has_more'])
        page2 = self.get(self.star, 'social_posts/?page=2').json()
        self.assertEqual(len(page2['results']), 5)
        self.assertIsNone(page2['next'])
        self.assertNotIn('user', page2['results'][0])     # light tiles, not feed posts

    def test_query_count_is_flat(self):
        def measure(n):
            for _ in range(n):
                post(self.star)
            with CaptureQueriesContext(connection) as ctx:
                self.get(self.star)
            with CaptureQueriesContext(connection) as grid:
                self.get(self.star, 'social_posts/?page=1')
            return len(ctx.captured_queries), len(grid.captured_queries)
        self.assertEqual(measure(3), measure(40))


class PrivacyTests(Base):
    def test_blocked_either_way_is_not_found(self):
        blocker = User.objects.create_user('pf_blocker', 'pfb@x.com', 'x')
        Block.objects.create(blocker=blocker, blocked=self.me)
        mine = User.objects.create_user('pf_mine', 'pfm@x.com', 'x')
        Block.objects.create(blocker=self.me, blocked=mine)
        for u in (blocker, mine):
            for suffix in ('', 'social_posts/', 'followers/', 'following/'):
                self.assertEqual(self.get(u, suffix).status_code, 404, (u.username, suffix))
            self.assertEqual(self.client.post(f'/api/users/{u.id}/follow/').status_code, 404)
            self.assertEqual(self.client.get(f'/api/profiles/by_user/{u.id}/').status_code, 404)
        # ...but the one I blocked can still be unblocked.
        self.assertEqual(self.client.post(f'/api/users/{mine.id}/unblock/').status_code, 200)

    def test_deactivated_is_not_found(self):
        User.objects.filter(pk=self.star.pk).update(is_deactivated=True)
        self.assertEqual(self.get(self.star).status_code, 404)

    def test_private_account_withholds_posts_and_lists_until_approved(self):
        priv = User.objects.create_user('pf_priv', 'pfp@x.com', 'x')
        Profile.objects.create(user=priv, is_public=False)
        post(priv)
        FollowRequest.objects.create(requester=self.me, target=priv, status='pending')
        data = self.get(priv).json()
        self.assertEqual((data['social_posts'], data['can_view'], data['posts_count']), ([], False, 1))
        self.assertEqual(data['follow_status'], 'requested')
        for suffix in ('social_posts/', 'followers/', 'following/'):
            self.assertEqual(self.get(priv, suffix).status_code, 403)
        priv.followers.add(self.me)
        self.assertEqual(len(self.get(priv).json()['social_posts']), 1)
        self.assertEqual(self.get(priv, 'social_posts/').status_code, 200)

    def test_follower_lists_hide_blocked_rows(self):
        blocked = User.objects.create_user('pf_blk2', 'pfb2@x.com', 'x')
        ok = User.objects.create_user('pf_ok', 'pfok@x.com', 'x')
        self.star.followers.add(blocked, ok)
        Block.objects.create(blocker=self.me, blocked=blocked)
        names = [r['username'] for r in self.get(self.star, 'followers/').json()['results']]
        self.assertEqual(names, ['pf_ok'])

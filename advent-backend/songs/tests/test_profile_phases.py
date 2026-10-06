"""Profile phases 1–6: safe profile data, a display name and a link, a shared
profile page, pinned posts, and a moderator clearing a profile.

    python manage.py test songs.tests.test_profile_phases --settings=music.settings_test
"""
from datetime import date, timedelta
from unittest import mock

from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APITestCase

from songs.models import AdminActionLog, Profile, SocialPost, User


def make(name, **extra):
    return User.objects.create_user(name, f'{name}@x.com', 'pw', **extra)


@override_settings(R2_PUBLIC_BASE='https://cdn.ours.example')
class SafeProfileDataTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.me = make('mark')
        Profile.objects.create(user=self.me, bio='hi', location='Nairobi', birth_date=date(1990, 1, 1))
        self.client.force_authenticate(self.me)

    def patch(self, **data):
        return self.client.patch('/api/profiles/update_me/', data, format='json')

    def test_a_picture_must_be_one_of_our_uploads(self):
        self.assertEqual(self.patch(picture='https://tracker.example/pixel.png').status_code, 400)
        self.assertEqual(self.patch(picture='https://cdn.ours.example/profiles/a.jpg').status_code, 200)

    def test_bio_location_and_birth_date_are_checked_on_the_server(self):
        self.assertEqual(self.patch(bio='x' * 151).status_code, 400)
        self.assertEqual(self.patch(location='y' * 101).status_code, 400)
        self.assertEqual(self.patch(birth_date=str(date.today() + timedelta(days=1))).status_code, 400)
        self.assertEqual(self.patch(birth_date=str(date.today() - timedelta(days=365 * 10))).status_code, 400)
        res = self.patch(bio='  Singing in the choir  ')
        self.assertEqual(res.data['bio'], 'Singing in the choir')

    def test_a_name_and_a_safe_link(self):
        res = self.patch(display_name='  Mark   Ankomah ', website='adventist.org')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['display_name'], 'Mark Ankomah')
        self.assertEqual(res.data['website'], 'https://adventist.org')
        for bad in ('javascript:alert(1)', 'file:///etc/passwd', 'not a link'):
            self.assertEqual(self.patch(website=bad).status_code, 400, bad)
        # Others see them on the profile.
        self.client.force_authenticate(make('friend'))
        prof = self.client.get(f'/api/users/{self.me.id}/').data['profile']
        self.assertEqual(prof['display_name'], 'Mark Ankomah')
        self.assertEqual(prof['website'], 'https://adventist.org')
        self.assertNotIn('birth_date', prof)


class PinnedPostTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.me = make('mark')
        self.client.force_authenticate(self.me)
        self.posts = [SocialPost.objects.create(user=self.me, content_type='image', caption=str(i)) for i in range(5)]

    def grid(self):
        return [p['id'] for p in self.client.get(f'/api/users/{self.me.id}/social_posts/').data['results']]

    def test_pinned_posts_lead_the_grid_up_to_three(self):
        oldest, second = self.posts[0], self.posts[1]
        self.assertTrue(self.client.post(f'/api/social-posts/{oldest.id}/pin/').data['pinned'])
        self.client.post(f'/api/social-posts/{second.id}/pin/')
        self.assertEqual(self.grid()[:2], [second.id, oldest.id])          # latest pin first
        first_page = [p['id'] for p in self.client.get(f'/api/users/{self.me.id}/').data['social_posts']]
        self.assertEqual(first_page[:2], [second.id, oldest.id])
        self.client.post(f'/api/social-posts/{self.posts[2].id}/pin/')
        res = self.client.post(f'/api/social-posts/{self.posts[3].id}/pin/')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['code'], 'pin_limit')
        # Unpin, and the order is the plain newest-first again for it.
        self.assertFalse(self.client.post(f'/api/social-posts/{oldest.id}/pin/', {'pinned': False}, format='json').data['pinned'])
        self.assertEqual(self.grid()[-1], oldest.id)

    def test_only_ones_own(self):
        other = SocialPost.objects.create(user=make('else'), content_type='image')
        self.assertEqual(self.client.post(f'/api/social-posts/{other.id}/pin/').status_code, 403)


class SharedProfilePageTests(APITestCase):
    def test_a_rich_card_and_a_way_into_the_app(self):
        u = make('mark')
        Profile.objects.create(user=u, bio='Choir <b>leader</b>', display_name='Mark A')
        res = self.client.get('/u/Mark/')
        html = res.content.decode()
        self.assertEqual(res.status_code, 200)
        self.assertIn('streams://u/mark', html)
        self.assertIn('Mark A on Adventist Life', html)
        self.assertIn('Choir &lt;b&gt;leader&lt;/b&gt;', html)     # escaped

    def test_private_shows_no_bio_and_closed_is_not_found(self):
        p = make('quiet')
        Profile.objects.create(user=p, bio='secret things', is_public=False)
        self.assertNotIn('secret things', self.client.get('/u/quiet/').content.decode())
        gone = make('gone', is_deactivated=True)
        self.assertEqual(self.client.get(f'/u/{gone.username}/').status_code, 404)


@mock.patch('songs.views.admin.notify_moderation')
class ClearProfileTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.boss = make('boss', admin_role='super_admin')
        self.troll = make('troll')
        Profile.objects.create(user=self.troll, bio='rude words', website='https://scam.example',
                               display_name='Fake Pastor', location='Here')
        self.client.force_authenticate(self.boss)

    def test_a_moderator_clears_what_the_profile_says(self, notify):
        url = f'/api/admin/users/{self.troll.id}/clear-profile/'
        res = self.client.post(url, {'fields': ['bio', 'website'], 'reason': 'scam link'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        prof = Profile.objects.get(user=self.troll)
        self.assertEqual((prof.bio, prof.website, prof.display_name), ('', '', 'Fake Pastor'))
        notify.assert_called_once()
        # Not someone of one's own rank, and not oneself.
        self.assertEqual(self.client.post(f'/api/admin/users/{self.boss.id}/clear-profile/',
                                          {'reason': 'x'}, format='json').status_code, 400)
        self.assertTrue(AdminActionLog.objects.filter(action='clear_profile', target_id=self.troll.id).exists())


@mock.patch('songs.views.accounts.notify_user')
class FollowNoticeTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.me = make('fan')
        self.star = make('star')
        self.client.force_authenticate(self.me)

    def test_following_again_and_again_rings_once(self, notify):
        for _ in range(3):
            self.client.post(f'/api/users/{self.star.id}/follow/')   # follow
            self.client.post(f'/api/users/{self.star.id}/follow/')   # unfollow
        self.assertEqual(notify.call_count, 1)

    def test_asking_withdrawing_and_asking_again_rings_once(self, notify):
        Profile.objects.create(user=self.star, is_public=False)
        for _ in range(3):
            self.client.post(f'/api/users/{self.star.id}/follow/')
        self.assertEqual(notify.call_count, 1)

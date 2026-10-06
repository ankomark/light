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


@mock.patch('songs.views.accounts.notify_user')
class FollowRequestHygieneTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.owner = make('owner')
        Profile.objects.create(user=self.owner, is_public=False)
        self.fan = make('fan2')
        self.client.force_authenticate(self.fan)
        self.client.post(f'/api/users/{self.owner.id}/follow/')      # a request

    def test_blocking_drops_the_request_and_a_blocked_one_is_never_listed(self, notify):
        from songs.models import Block, FollowRequest
        Block.objects.create(blocker=self.owner, blocked=self.fan)
        self.client.force_authenticate(self.owner)
        data = self.client.get('/api/follow-requests/').data
        self.assertEqual(data['results'] if isinstance(data, dict) else data, [])
        self.client.post(f'/api/users/{self.fan.id}/block/')
        self.assertFalse(FollowRequest.objects.filter(requester=self.fan, target=self.owner).exists())

    def test_going_public_lets_those_waiting_in(self, notify):
        from songs.models import FollowRequest
        self.client.force_authenticate(self.owner)
        self.client.patch('/api/profiles/update_me/', {'is_public': True}, format='json')
        self.assertTrue(self.owner.followers.filter(pk=self.fan.pk).exists())
        self.assertFalse(FollowRequest.objects.filter(target=self.owner).exists())


class ImageThumbnailTests(APITestCase):
    def setUp(self):
        self.user = make('snap')
        self.post = SocialPost.objects.create(user=self.user, content_type='image',
                                              media_file='https://cdn.ours.example/posts/big.jpg')

    def photo(self, size=(3000, 2000), orientation=None):
        import io as _io
        from PIL import Image
        img = Image.new('RGB', size, 'blue')
        buf = _io.BytesIO()
        exif = Image.Exif()
        if orientation:
            exif[0x0112] = orientation
        img.save(buf, 'JPEG', exif=exif.tobytes())
        return buf.getvalue()

    def test_a_small_upright_still_and_the_photo_untouched(self):
        from PIL import Image
        import io as _io
        from songs import image_thumbs as it
        thumb = it.make_thumbnail(self.photo(orientation=6))      # a phone held upright
        img = Image.open(_io.BytesIO(thumb))
        self.assertEqual(max(img.size), it.GRID_EDGE)
        self.assertGreater(img.size[1], img.size[0])            # rotated as the phone showed it
        self.assertIsNone(it.make_thumbnail(b'not a picture'))

        with mock.patch.object(it.r2, 'is_r2_url', return_value=True), \
                mock.patch.object(it.r2, 'is_configured', return_value=True), \
                mock.patch('songs.audio_tags._fetch', return_value=(self.photo(), 'image/jpeg')), \
                mock.patch.object(it.r2, 'put_bytes', return_value='https://cdn.ours.example/thumbs/x.jpg') as put:
            it.image_thumbnail(self.post.pk)
        self.post.refresh_from_db()
        self.assertEqual(self.post.thumbnail, 'https://cdn.ours.example/thumbs/x.jpg')
        self.assertEqual(self.post.media_file, 'https://cdn.ours.example/posts/big.jpg')
        self.assertTrue(put.call_args[0][0].startswith(f'thumbs/posts/{self.post.pk}/'))
        # The grid now gets the small one.
        tile = self.client.get(f'/api/users/{self.user.id}/social_posts/')
        self.client.force_authenticate(self.user)
        tile = self.client.get(f'/api/users/{self.user.id}/social_posts/').data['results'][0]
        self.assertEqual(tile['thumbnail_url'], 'https://cdn.ours.example/thumbs/x.jpg')

    def test_a_new_photo_post_is_queued(self):
        from songs.models import Job
        with self.captureOnCommitCallbacks(execute=True):
            p = SocialPost.objects.create(user=self.user, content_type='image', media_file='https://cdn.x/p.jpg')
        self.assertTrue(Job.objects.filter(kind='image_thumbnail', key=f'post:{p.pk}').exists())


@mock.patch('songs.views.accounts.notify_user')
class FollowSetStateTests(APITestCase):
    """{"follow": true} from a stale screen must never unfollow."""

    def setUp(self):
        cache.clear()
        self.me = make('setter')
        self.them = make('them')
        self.client.force_authenticate(self.me)

    def post(self, **data):
        return self.client.post(f'/api/users/{self.them.id}/follow/', data, format='json')

    def test_follow_true_twice_stays_following(self, notify):
        self.assertTrue(self.post(follow=True).data['is_following'])
        self.assertTrue(self.post(follow=True).data['is_following'])      # a stale "Follow" tap
        self.assertTrue(self.them.followers.filter(pk=self.me.pk).exists())
        self.assertFalse(self.post(follow=False).data['is_following'])
        self.assertFalse(self.post(follow=False).data['is_following'])
        self.assertEqual(notify.call_count, 1)

    def test_a_private_request_is_not_withdrawn_by_asking_again(self, notify):
        Profile.objects.create(user=self.them, is_public=False)
        self.assertEqual(self.post(follow=True).data['follow_status'], 'requested')
        self.assertEqual(self.post(follow=True).data['follow_status'], 'requested')
        self.assertEqual(self.post(follow=False).data['follow_status'], 'none')

    def test_without_it_the_old_toggle_still_works(self, notify):
        self.assertTrue(self.post().data['is_following'])
        self.assertFalse(self.post().data['is_following'])

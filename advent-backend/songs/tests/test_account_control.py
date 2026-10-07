"""Admin phase 4: one account, all at once — suspension everywhere, bans that
end, every post taken down (and back), signing someone out.

    python manage.py test songs.tests.test_account_control --settings=music.settings_test
"""
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from songs.models import DeviceToken, MassTakedown, PostComment, SocialPost, User


def make(name, **extra):
    return User.objects.create_user(name, f'{name}@x.com', 'pw12345!', **extra)


class SuspensionEverywhereTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.member = make('member')
        User.objects.filter(pk=self.member.pk).update(is_suspended=True, suspension_reason='spam')
        self.member.refresh_from_db()
        self.client.force_authenticate(self.member)

    def test_a_suspended_account_cannot_write_anywhere(self):
        for path, body in (('/api/social-posts/', {'caption': 'hi'}), ('/api/conversations/', {}),
                           ('/api/groups/', {'name': 'x'})):
            r = self.client.post(path, body, format='json')
            self.assertEqual(r.status_code, 403, path)
            self.assertEqual(r.json()['code'], 'suspended')

    def test_it_can_still_read_appeal_and_look_after_itself(self):
        self.assertEqual(self.client.get('/api/notifications/').status_code, 200)
        r = self.client.post('/api/appeals/', {'message': 'I did not post that spam, please look.'},
                             format='json')
        self.assertNotEqual(r.status_code, 403)

    def test_a_lapsed_suspension_writes_again(self):
        User.objects.filter(pk=self.member.pk).update(suspended_until=timezone.now() - timedelta(hours=1))
        self.member.refresh_from_db()
        self.client.force_authenticate(self.member)
        r = self.client.post('/api/social-posts/', {'caption': 'hi'}, format='json')
        self.assertNotEqual(r.json().get('code') if r.status_code == 403 else None, 'suspended')


class BanTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.boss = make('boss', admin_role='super_admin', is_superuser=True)
        self.member = make('member')
        self.client.force_authenticate(self.boss)

    def test_a_ban_for_days_ends_at_the_next_sign_in_after_it(self):
        r = self.client.post(f'/api/admin/users/{self.member.pk}/ban/', {'reason': 'scam links', 'days': 3},
                             format='json')
        self.assertEqual(r.status_code, 200, r.content[:200])
        self.member.refresh_from_db()
        self.assertFalse(self.member.is_active)
        self.assertEqual(self.member.ban_reason, 'scam links')
        self.client.force_authenticate(None)
        login = {'username': 'member', 'password': 'pw12345!'}
        self.assertNotEqual(self.client.post('/api/auth/token/', login, format='json').status_code, 200)
        User.objects.filter(pk=self.member.pk).update(banned_until=timezone.now() - timedelta(minutes=1))
        cache.clear()
        self.assertEqual(self.client.post('/api/auth/token/', login, format='json').status_code, 200)

    def test_a_ban_for_good_stays(self):
        self.client.post(f'/api/admin/users/{self.member.pk}/ban/', {'reason': 'threats'}, format='json')
        self.member.refresh_from_db()
        self.assertIsNone(self.member.banned_until)
        self.client.force_authenticate(None)
        r = self.client.post('/api/auth/token/', {'username': 'member', 'password': 'pw12345!'}, format='json')
        self.assertNotEqual(r.status_code, 200)


class TakedownAllTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.boss = make('boss', admin_role='super_admin', is_superuser=True)
        self.spammer = make('spammer')
        self.posts = [SocialPost.objects.create(user=self.spammer, content_type='image', caption=str(i))
                      for i in range(3)]
        self.earlier = SocialPost.objects.create(user=self.spammer, content_type='image', caption='old',
                                                 is_removed=True)
        PostComment.objects.create(user=self.spammer, post=self.posts[0], content='buy now')
        self.client.force_authenticate(self.boss)

    def test_everything_goes_and_exactly_that_comes_back(self):
        r = self.client.post(f'/api/admin/users/{self.spammer.pk}/takedown-all/', {'reason': 'spam bot'},
                             format='json')
        self.assertEqual(r.status_code, 200, r.content[:200])
        self.assertEqual(r.data['removed'], {'post': 3, 'comment': 1})
        self.assertFalse(SocialPost.objects.filter(user=self.spammer, is_removed=False).exists())
        r = self.client.post(f'/api/admin/users/{self.spammer.pk}/restore-all/', {}, format='json')
        self.assertEqual(r.data['restored'], 4)
        self.earlier.refresh_from_db()
        self.assertTrue(self.earlier.is_removed)            # removed before, for its own reason
        self.assertTrue(MassTakedown.objects.get().restored_at)

    def test_sign_out_everywhere(self):
        from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
        from rest_framework_simplejwt.tokens import RefreshToken
        RefreshToken.for_user(self.spammer)
        DeviceToken.objects.create(user=self.spammer, token='ExponentPushToken[s]')
        r = self.client.post(f'/api/admin/users/{self.spammer.pk}/sign-out/', {'reason': 'hijacked'}, format='json')
        self.assertEqual(r.status_code, 200, r.content[:200])
        self.assertFalse(OutstandingToken.objects.filter(user=self.spammer, blacklistedtoken__isnull=True).exists())
        self.assertFalse(DeviceToken.objects.filter(user=self.spammer, is_active=True).exists())

    def test_history_counts_every_kind(self):
        data = self.client.get(f'/api/admin/users/{self.spammer.pk}/history/').data
        self.assertEqual(data['content']['post'], {'up': 3, 'removed': 1})
        self.assertEqual(data['content']['comment'], {'up': 1, 'removed': 0})

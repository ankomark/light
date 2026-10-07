"""Security holes found in the October Settings scan, kept shut.

    python manage.py test songs.tests.test_settings_security --settings=music.settings_test
"""
from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from songs.models import DeviceToken, PasswordResetCode, User

STRONG_PW = 'Zx9kLmq2-playnew'


def _code(user, code='123456'):
    return PasswordResetCode.objects.create(user=user, code=code,
                                            expires_at=timezone.now() + timedelta(minutes=15))


class ResetPasswordTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('reset_me', 'reset@x.com', 'oldpass123')

    def _reset(self, code, password=STRONG_PW):
        return self.client.post('/api/auth/reset-password/', {
            'email': 'reset@x.com', 'code': code, 'new_password': password}, format='json')

    def test_a_reset_signs_out_everywhere_and_stops_pushes(self):
        RefreshToken.for_user(self.user)        # a session on another phone
        DeviceToken.objects.create(user=self.user, token='ExponentPushToken[thief]')
        _code(self.user)
        r = self._reset('123456')
        self.assertEqual(r.status_code, 200, r.content[:200])
        from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
        self.assertFalse(OutstandingToken.objects.filter(user=self.user, blacklistedtoken__isnull=True).exists())
        self.assertFalse(DeviceToken.objects.filter(user=self.user, is_active=True).exists())

    def test_a_weak_password_is_refused(self):
        _code(self.user)
        self.assertEqual(self._reset('123456', password='12345678').status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('oldpass123'))

    @mock.patch('rest_framework.throttling.ScopedRateThrottle.allow_request', return_value=True)
    def test_guessing_stops_at_the_account_not_the_address(self, _allow):
        # The per-address throttle is off: as for someone with many addresses.
        _code(self.user, '654321')
        for n in range(5):
            self.assertEqual(self._reset(f'00000{n}').status_code, 400)
        r = self._reset('654321')
        self.assertEqual(r.status_code, 400)
        self.assertFalse(PasswordResetCode.objects.filter(user=self.user, used=False).exists())
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('oldpass123'))

    def test_codes_come_from_the_secure_source(self):
        import inspect
        from songs.views import auth
        source = inspect.getsource(auth)
        self.assertNotIn('random.randint', source)


class SignOutOthersTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('many_phones', 'mp@x.com', 'oldpass123')
        self.client.force_authenticate(self.user)
        DeviceToken.objects.create(user=self.user, token='ExponentPushToken[mine]')
        DeviceToken.objects.create(user=self.user, token='ExponentPushToken[lost]')

    def _active(self):
        return set(DeviceToken.objects.filter(user=self.user, is_active=True).values_list('token', flat=True))

    def test_this_phone_keeps_its_pushes_and_the_others_lose_theirs(self):
        mine = RefreshToken.for_user(self.user)
        RefreshToken.for_user(self.user)
        r = self.client.post('/api/auth/sessions/revoke-others/', {
            'refresh': str(mine), 'device_token': 'ExponentPushToken[mine]'}, format='json')
        self.assertEqual(r.data['revoked'], 1)
        self.assertEqual(self._active(), {'ExponentPushToken[mine]'})

    def test_an_older_app_that_names_no_phone_keeps_every_push(self):
        RefreshToken.for_user(self.user)
        self.client.post('/api/auth/sessions/revoke-others/', {}, format='json')
        self.assertEqual(len(self._active()), 2)

    def test_a_new_password_does_the_same(self):
        self.client.post('/api/auth/change-password/', {
            'current_password': 'oldpass123', 'new_password': STRONG_PW,
            'device_token': 'ExponentPushToken[mine]'}, format='json')
        self.assertEqual(self._active(), {'ExponentPushToken[mine]'})

    def test_deactivating_stops_every_push(self):
        self.client.post('/api/auth/deactivate/', {'password': 'oldpass123'}, format='json')
        self.assertEqual(self._active(), set())


class SessionsHeaderTests(APITestCase):
    def test_this_phone_is_found_from_the_header(self):
        user = User.objects.create_user('hdr', 'hdr@x.com', 'oldpass123')
        self.client.force_authenticate(user)
        mine = RefreshToken.for_user(user)
        RefreshToken.for_user(user)
        r = self.client.get('/api/auth/sessions/', HTTP_X_REFRESH_TOKEN=str(mine))
        self.assertEqual([s['current'] for s in r.data['sessions']].count(True), 1)


class LogoutAfterDeleteTests(APITestCase):
    def test_signing_out_a_deleted_account_is_quiet(self):
        user = User.objects.create_user('gone', 'gone@x.com', 'oldpass123')
        refresh = str(RefreshToken.for_user(user))
        user.delete()
        r = self.client.post('/api/auth/logout/', {'refresh': refresh}, format='json')
        self.assertEqual(r.status_code, 205)


class StoryReactionSwitchTests(APITestCase):
    def test_story_reactions_are_under_likes(self):
        from songs.push import NOTIFICATION_CATEGORIES
        self.assertEqual(NOTIFICATION_CATEGORIES.get('story_reaction'), 'likes')


class ForgotPasswordPrivacyTests(APITestCase):
    def test_the_answer_does_not_say_who_has_an_account(self):
        from unittest import mock
        cache.clear()
        User.objects.create_user('member', 'member@x.com', 'oldpass123')
        with mock.patch('django.core.mail.send_mail') as send:
            known = self.client.post('/api/auth/forgot-password/', {'email': 'member@x.com'}, format='json')
            cache.clear()
            unknown = self.client.post('/api/auth/forgot-password/', {'email': 'nobody@x.com'}, format='json')
        self.assertEqual(known.status_code, unknown.status_code)
        self.assertEqual(known.data, unknown.data)
        self.assertEqual(send.call_count, 1)


class FullerExportTests(APITestCase):
    def test_messages_groups_and_books_are_in_it_but_not_the_other_side(self):
        from songs.models import Conversation, Group, GroupMember, GroupPost, Message, Publication
        cache.clear()
        me = User.objects.create_user('exporter', 'ex@x.com', 'oldpass123')
        friend = User.objects.create_user('friend', 'fr@x.com', 'oldpass123')
        chat = Conversation.objects.create()
        chat.participants.add(me, friend)
        Message.objects.create(conversation=chat, sender=me, content='mine to send')
        Message.objects.create(conversation=chat, sender=friend, content='theirs to keep')
        group = Group.objects.create(name='Choir', creator=me)
        GroupMember.objects.create(group=group, user=me, is_admin=True)
        GroupPost.objects.create(group=group, user=me, content='practice at six')
        Publication.objects.create(title='My Book', author=me)
        self.client.force_authenticate(me)
        data = self.client.get('/api/auth/export-data/').data
        self.assertEqual([m['content'] for m in data['messages_sent']], ['mine to send'])
        self.assertEqual(data['messages_sent'][0]['to'], ['friend'])
        self.assertNotIn('theirs to keep', str(data))
        self.assertEqual(data['groups'][0]['name'], 'Choir')
        self.assertEqual(data['group_posts'][0]['content'], 'practice at six')
        self.assertEqual(data['books_written'][0]['title'], 'My Book')


class AppPrefsSyncTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('two_phones', 'tp@x.com', 'oldpass123')
        self.client.force_authenticate(self.user)

    def _patch(self, body):
        return self.client.patch('/api/notification-preferences/', body, format='json')

    def test_choices_are_kept_and_merged(self):
        self._patch({'app_prefs': {'wallpaperOn': False, 'bibleTextSize': 22}})
        self._patch({'app_prefs': {'videoQuality': 'hd'}})
        prefs = self.client.get('/api/notification-preferences/').data['app_prefs']
        self.assertEqual(prefs, {'wallpaperOn': False, 'bibleTextSize': 22, 'videoQuality': 'hd'})

    def test_only_known_choices_with_sane_values(self):
        r = self._patch({'app_prefs': {
            'wallpaperOn': 'yes', 'bibleTextSize': 900, 'audioQuality': 'lossless',
            'pushEnabled': False, 'anything': {'x': 1}, 'dataSaver': True,
        }})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['app_prefs'], {'dataSaver': True})

    def test_the_language_pushes_are_written_in(self):
        self.assertEqual(self._patch({'language': 'sw'}).data['language'], 'sw')
        self.assertEqual(self._patch({'language': 'fr'}).status_code, 400)

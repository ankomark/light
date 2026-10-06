"""Messages deep scan: the requests badge, presence that can't drift or leak
across a block, legacy attachments out of the database, and delete for
everyone taking the file too.

    python manage.py test songs.tests.test_messages_scan --settings=music.settings_test
"""
import base64
from unittest import mock

from django.core.cache import cache
from rest_framework.test import APITestCase

from songs import messaging as dm
from songs.models import Block, Conversation, Message, User


@mock.patch('songs.views.messaging.notify_user')
class RequestsBadgeTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.me = User.objects.create_user('me', 'me@x.com', 'x')
        self.stranger = User.objects.create_user('stranger', 's@x.com', 'x')

    def request_from(self, who):
        self.client.force_authenticate(who)
        conv = self.client.post('/api/conversations/', {'user_id': self.me.id}, format='json').data
        self.client.post(f"/api/conversations/{conv['id']}/send_message/", {'content': 'hi'}, format='json')
        self.client.force_authenticate(self.me)
        return conv['id']

    def badge(self):
        return self.client.get('/api/conversations/unread_count/').data['requests']

    def test_a_declined_request_stops_counting(self, notify):
        conv = self.request_from(self.stranger)
        self.assertEqual(self.badge(), 1)
        self.client.post(f'/api/conversations/{conv}/state/', {'clear': True}, format='json')   # decline
        self.assertEqual(self.badge(), 0)

    def test_requests_from_across_a_block_or_closed_accounts_dont_count(self, notify):
        self.request_from(self.stranger)
        other = User.objects.create_user('other', 'o@x.com', 'x')
        self.request_from(other)
        self.assertEqual(self.badge(), 2)
        Block.objects.create(blocker=self.me, blocked=self.stranger)
        User.objects.filter(pk=other.pk).update(is_deactivated=True)
        # Changed behind the endpoints' back (which forget the kept counts):
        # someone else's account closing shows within the counts' few seconds.
        cache.clear()
        self.assertEqual(self.badge(), 0)


class PresenceTests(APITestCase):
    def setUp(self):
        cache.clear()

    def test_two_devices_count_as_two(self):
        self.assertTrue(dm.went_online(5))
        self.assertFalse(dm.went_online(5))
        self.assertFalse(dm.left(5))            # one still on
        self.assertTrue(dm.is_online(5))
        self.assertTrue(dm.left(5))
        self.assertFalse(dm.is_online(5))
        self.assertTrue(dm.left(5))             # never below zero

    def test_nobody_across_a_block_is_told(self):
        a = User.objects.create_user('a', 'a@x.com', 'x')
        b = User.objects.create_user('b', 'b@x.com', 'x')
        c = User.objects.create_user('c', 'c@x.com', 'x')
        dm.start_between(a, b)
        dm.start_between(a, c)
        Block.objects.create(blocker=b, blocked=a)
        self.assertEqual(dm.partner_ids(a), [c.id])


@mock.patch('songs.views.messaging.notify_user')
class AttachmentTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.a = User.objects.create_user('ann2', 'a2@x.com', 'x')
        self.b = User.objects.create_user('bob2', 'b2@x.com', 'x')
        self.client.force_authenticate(self.a)
        self.conv = self.client.post('/api/conversations/', {'user_id': self.b.id}, format='json').data['id']

    def test_a_legacy_base64_photo_is_stored_as_a_file(self, notify):
        data = 'data:image/png;base64,' + base64.b64encode(b'\x89PNG fake').decode()
        with mock.patch('songs.r2.is_configured', return_value=True), \
                mock.patch('songs.r2.put_bytes', return_value='https://cdn.x/messages/image/a.png') as put:
            res = self.client.post(f'/api/conversations/{self.conv}/send_message/',
                                   {'attachment': data, 'message_type': 'image'}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(Message.objects.get(pk=res.data['id']).attachment, 'https://cdn.x/messages/image/a.png')
        self.assertEqual(put.call_args[0][1], b'\x89PNG fake')
        self.assertEqual(put.call_args[0][2], 'image/png')

    def test_delete_for_everyone_removes_the_stored_file(self, notify):
        m = Message.objects.create(conversation_id=self.conv, sender=self.a, message_type='image',
                                   attachment='https://cdn.x/messages/image/b.jpg')
        with mock.patch('songs.r2.is_r2_url', return_value=True), mock.patch('songs.r2.delete') as delete:
            self.client.post(f'/api/conversations/{self.conv}/messages/{m.id}/delete/', {'scope': 'everyone'},
                             format='json')
        delete.assert_called_once_with('https://cdn.x/messages/image/b.jpg')

    def test_a_file_another_message_still_uses_is_kept(self, notify):
        url = 'https://cdn.x/messages/image/c.jpg'
        m = Message.objects.create(conversation_id=self.conv, sender=self.a, message_type='image', attachment=url)
        Message.objects.create(conversation_id=self.conv, sender=self.a, message_type='image', attachment=url)
        with mock.patch('songs.r2.is_r2_url', return_value=True), mock.patch('songs.r2.delete') as delete:
            self.client.post(f'/api/conversations/{self.conv}/messages/{m.id}/delete/', {'scope': 'everyone'},
                             format='json')
        delete.assert_not_called()


@mock.patch('songs.views.messaging.notify_user')
class RequestRulesTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.me = User.objects.create_user('host', 'h@x.com', 'x')

    def write_to_me(self, who, text='hi'):
        self.client.force_authenticate(who)
        c = self.client.post('/api/conversations/', {'user_id': self.me.id}, format='json').data['id']
        self.client.post(f'/api/conversations/{c}/send_message/', {'content': text}, format='json')
        return c

    def test_requests_from_followers_come_first(self, notify):
        fan = User.objects.create_user('fan', 'f@x.com', 'x')
        stranger = User.objects.create_user('str', 's2@x.com', 'x')
        self.me.followers.add(fan)                 # fan follows me (I don't follow back)
        from_fan = self.write_to_me(fan)
        from_stranger = self.write_to_me(stranger)  # newer
        self.client.force_authenticate(self.me)
        rows = self.client.get('/api/conversations/?folder=requests').data['results']
        self.assertEqual([r['id'] for r in rows], [from_fan, from_stranger])

    def test_a_spam_run_of_requests_is_stopped(self, notify):
        from songs.views import messaging as views
        spammer = User.objects.create_user('spam', 'sp@x.com', 'x')
        self.client.force_authenticate(spammer)
        codes = []
        with mock.patch.object(views, 'REQUESTS_PER_DAY', 3):   # under the hourly start limit
            for i in range(4):
                target = User.objects.create_user(f't{i}', f't{i}@x.com', 'x')
                c = self.client.post('/api/conversations/', {'user_id': target.id}, format='json').data['id']
                codes.append(self.client.post(f'/api/conversations/{c}/send_message/', {'content': 'buy'},
                                              format='json').status_code)
            # A chat already accepted is never held back.
            friend = User.objects.create_user('friend', 'fr@x.com', 'x')
            c = self.client.post('/api/conversations/', {'user_id': friend.id}, format='json').data['id']
            from songs.models import ConversationState
            ConversationState.objects.filter(conversation_id=c, user=friend).update(accepted=True)
            ok = self.client.post(f'/api/conversations/{c}/send_message/', {'content': 'hi'}, format='json')
        self.assertEqual(codes, [201, 201, 201, 429])
        self.assertEqual(ok.status_code, 201)


@mock.patch('songs.views.messaging.notify_user')
class UnreadCacheTests(APITestCase):
    """The menu's counts are kept a few seconds, and forgotten on any change."""

    def setUp(self):
        cache.clear()
        self.me = User.objects.create_user('reader', 'r@x.com', 'x')
        self.friend = User.objects.create_user('writer', 'w@x.com', 'x')
        self.me.followers.add(self.friend)
        self.friend.followers.add(self.me)
        self.client.force_authenticate(self.friend)
        self.conv = self.client.post('/api/conversations/', {'user_id': self.me.id}, format='json').data['id']

    def count(self):
        self.client.force_authenticate(self.me)
        return self.client.get('/api/conversations/unread_count/').data['unread_count']

    def send(self):
        self.client.force_authenticate(self.friend)
        self.client.post(f'/api/conversations/{self.conv}/send_message/', {'content': 'hi'}, format='json')

    def test_a_new_message_and_reading_it_show_at_once(self, notify):
        self.assertEqual(self.count(), 0)
        self.send()
        self.assertEqual(self.count(), 1)          # not the 0 kept a moment ago
        self.client.post(f'/api/conversations/{self.conv}/mark_read/')
        self.assertEqual(self.count(), 0)

    def test_muting_shows_at_once(self, notify):
        self.send()
        self.assertEqual(self.count(), 1)
        self.client.post(f'/api/conversations/{self.conv}/state/', {'muted': True}, format='json')
        self.assertEqual(self.count(), 0)

    def test_it_is_kept_between_changes(self, notify):
        self.count()
        with mock.patch('songs.views.messaging.ConversationViewSet._unread_counts') as heavy:
            self.count()
        heavy.assert_not_called()


@mock.patch('songs.views.messaging.notify_user')
class PresencePrivacyTests(APITestCase):
    """A message request is not an invitation to see when someone is online."""

    def setUp(self):
        cache.clear()
        self.me = User.objects.create_user('quietone', 'q@x.com', 'x')
        self.stranger = User.objects.create_user('nosy', 'n@x.com', 'x')
        self.client.force_authenticate(self.stranger)
        self.conv = self.client.post('/api/conversations/', {'user_id': self.me.id}, format='json').data['id']
        self.client.post(f'/api/conversations/{self.conv}/send_message/', {'content': 'hi'}, format='json')
        dm.went_online(self.me.id)

    def test_a_stranger_sees_nothing_until_accepted(self, notify):
        r = self.client.get(f'/api/conversations/{self.conv}/presence/').data
        self.assertEqual(r, {'online': False, 'last_seen': None})
        row = self.client.get('/api/conversations/').data['results'][0]
        self.assertNotIn('online', row)
        self.assertEqual(dm.partner_ids(self.me), [])            # not told when I come online
        # I accept: now they may.
        self.client.force_authenticate(self.me)
        self.client.post(f'/api/conversations/{self.conv}/state/', {'accepted': True}, format='json')
        self.client.force_authenticate(self.stranger)
        self.assertTrue(self.client.get(f'/api/conversations/{self.conv}/presence/').data['online'])
        self.assertEqual(dm.partner_ids(self.me), [self.stranger.id])

    def test_a_voice_note_length_is_within_reason(self, notify):
        r = self.client.post(f'/api/conversations/{self.conv}/send_message/',
                             {'content': 'x', 'duration': 10 ** 9}, format='json')
        self.assertEqual(Message.objects.get(pk=r.data['id']).duration, 3600)

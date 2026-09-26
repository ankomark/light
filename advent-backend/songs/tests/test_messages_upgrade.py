"""Direct messages, upgraded: live over a socket, safe to retry, message
requests, safety (suspended, deactivated, blocked, attachments, reports),
and the chat features (reply, react, edit, delete, mute, archive, clear,
search, presence).

    python manage.py test songs.tests.test_messages_upgrade --settings=music.settings_test
"""
from datetime import timedelta
from unittest import mock

from asgiref.sync import async_to_sync
from channels.testing import WebsocketCommunicator
from django.core.cache import cache
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase, APIClient
from rest_framework_simplejwt.tokens import AccessToken

from songs.models import User, Conversation, ConversationState, Message, Block, Report
from songs import messaging as dm


def follow(follower, followed):
    followed.followers.add(follower)


class Base(APITestCase):
    def setUp(self):
        cache.clear()
        self.ann = User.objects.create_user('ann', 'a@x.com', 'x')
        self.bob = User.objects.create_user('bob', 'b@x.com', 'x')
        follow(self.bob, self.ann)                    # bob follows ann: ann → bob isn't a request
        self.client.force_authenticate(self.ann)
        self.conv = self.client.post('/api/conversations/', {'user_id': self.bob.id}, format='json').data['id']
        self.url = f'/api/conversations/{self.conv}/'

    def send(self, content='hi', as_user=None, **extra):
        if as_user:
            self.client.force_authenticate(as_user)
        return self.client.post(self.url + 'send_message/', {'content': content, **extra}, format='json')

    def inbox(self, user, **params):
        self.client.force_authenticate(user)
        r = self.client.get('/api/conversations/', params)
        return r.data['results']


class SendingTests(Base):
    def test_a_retry_is_the_same_message(self):
        a = self.send('hello', client_id='c-1')
        b = self.send('hello', client_id='c-1')
        self.assertEqual((a.status_code, b.status_code), (201, 200))
        self.assertEqual(a.data['id'], b.data['id'])
        self.assertEqual(Message.objects.count(), 1)

    def test_attachments_are_our_uploads(self):
        with override_settings(R2_PUBLIC_BASE='https://pub-test.r2.dev'):
            self.assertEqual(self.send('', attachment='https://evil.example/x.jpg', message_type='image').status_code, 400)
            self.assertEqual(self.send('', attachment='https://pub-test.r2.dev/chat/x.jpg', message_type='image').status_code, 201)
            self.assertEqual(self.send('', attachment='https://res.cloudinary.com/x/image/upload/a.jpg',
                                       message_type='image').status_code, 201)

    def test_suspended_deactivated_and_blocked(self):
        User.objects.filter(pk=self.ann.pk).update(is_suspended=True)
        self.ann.refresh_from_db()
        self.assertEqual(self.send().status_code, 403)
        User.objects.filter(pk=self.ann.pk).update(is_suspended=False)
        User.objects.filter(pk=self.bob.pk).update(is_deactivated=True)
        self.ann.refresh_from_db()
        self.client.force_authenticate(self.ann)
        self.assertEqual(self.send().status_code, 403)
        User.objects.filter(pk=self.bob.pk).update(is_deactivated=False)
        Block.objects.create(blocker=self.bob, blocked=self.ann)
        self.assertEqual(self.send().status_code, 403)
        carl = User.objects.create_user('carl', 'c@x.com', 'x', is_deactivated=True)
        self.assertEqual(self.client.post('/api/conversations/', {'user_id': carl.id}, format='json').status_code, 404)

    def test_the_inbox_shows_no_empty_chats_and_nobody_blocked(self):
        self.assertEqual(self.inbox(self.ann), [])                   # started, nothing said yet
        self.send('hi', as_user=self.ann)
        self.assertEqual(len(self.inbox(self.ann)), 1)
        Block.objects.create(blocker=self.ann, blocked=self.bob)
        self.assertEqual(self.inbox(self.ann), [])


class RequestTests(Base):
    def test_a_stranger_s_first_message_is_a_request_until_accepted_or_answered(self):
        carl = User.objects.create_user('carl', 'c@x.com', 'x')     # ann doesn't follow carl
        self.client.force_authenticate(carl)
        conv = self.client.post('/api/conversations/', {'user_id': self.ann.id}, format='json').data['id']
        with mock.patch('songs.views.messaging.notify_user') as push:
            self.client.post(f'/api/conversations/{conv}/send_message/', {'content': 'Hello!'}, format='json')
            self.client.post(f'/api/conversations/{conv}/send_message/', {'content': 'Still there?'}, format='json')
        self.assertEqual(push.call_count, 1)                          # one "wants to send you a message"
        self.assertIn('wants to send you a message', push.call_args.args[2])
        self.assertEqual(self.inbox(self.ann), [])
        req = self.inbox(self.ann, folder='requests')
        self.assertEqual((len(req), req[0]['is_request']), (1, True))
        self.assertEqual(self.client.get('/api/conversations/unread_count/').data, {'unread_count': 0, 'requests': 1, 'groups': 0, 'communities': 0})
        self.client.post(f'/api/conversations/{conv}/state/', {'accepted': True}, format='json')
        self.assertEqual(len(self.inbox(self.ann)), 1)
        self.assertEqual(self.client.get('/api/conversations/unread_count/').data['unread_count'], 2)

    def test_declining_clears_it(self):
        carl = User.objects.create_user('carl', 'c@x.com', 'x')
        self.client.force_authenticate(carl)
        conv = self.client.post('/api/conversations/', {'user_id': self.ann.id}, format='json').data['id']
        self.client.post(f'/api/conversations/{conv}/send_message/', {'content': 'spam'}, format='json')
        self.client.force_authenticate(self.ann)
        self.client.post(f'/api/conversations/{conv}/state/', {'clear': True}, format='json')
        self.assertEqual(self.inbox(self.ann, folder='requests'), [])
        self.assertEqual(self.client.get(f'/api/conversations/{conv}/messages/').data, [])


class FeatureTests(Base):
    def test_reply_react_edit(self):
        first = self.send('Are you coming?').data
        r = self.send('Yes!', as_user=self.bob, reply_to=first['id']).data
        self.assertEqual(r['reply_to']['content'], 'Are you coming?')
        react = self.client.post(f"{self.url}messages/{first['id']}/react/", {'emoji': '👍'}, format='json').data
        self.assertEqual(react['reactions'], [{'emoji': '👍', 'count': 1, 'mine': True}])
        self.client.post(f"{self.url}messages/{first['id']}/react/", {'emoji': '👍'}, format='json')   # off again
        self.assertEqual(self.client.post(f"{self.url}messages/{first['id']}/react/", {'emoji': '🦖'},
                                          format='json').status_code, 400)
        # Edit: its sender, within 15 minutes, text only.
        self.assertEqual(self.client.patch(f"{self.url}messages/{first['id']}/", {'content': 'x'},
                                           format='json').status_code, 403)    # bob didn't send it
        self.client.force_authenticate(self.ann)
        e = self.client.patch(f"{self.url}messages/{first['id']}/", {'content': 'Are you coming at 6?'}, format='json')
        self.assertEqual(e.data['content'], 'Are you coming at 6?')
        self.assertIsNotNone(e.data['edited_at'])
        Message.objects.filter(pk=first['id']).update(created_at=timezone.now() - timedelta(minutes=20))
        self.assertEqual(self.client.patch(f"{self.url}messages/{first['id']}/", {'content': 'late'},
                                           format='json').data['code'], 'too_late')

    def test_delete_for_everyone_and_for_me(self):
        m = self.send('oops').data
        self.client.force_authenticate(self.bob)
        self.assertEqual(self.client.post(f"{self.url}messages/{m['id']}/delete/", {'scope': 'everyone'},
                                          format='json').status_code, 403)
        self.client.post(f"{self.url}messages/{m['id']}/delete/", {'scope': 'me'}, format='json')
        self.assertEqual(self.client.get(self.url + 'messages/').data, [])      # gone for bob only
        self.client.force_authenticate(self.ann)
        self.assertEqual(len(self.client.get(self.url + 'messages/').data), 1)
        self.client.post(f"{self.url}messages/{m['id']}/delete/", {'scope': 'everyone'}, format='json')
        row = self.client.get(self.url + 'messages/').data[0]
        self.assertEqual((row['is_deleted'], row['content']), (True, ''))
        self.assertEqual(Message.objects.get(pk=m['id']).content, '')          # truly gone, not hidden

    def test_mute_archive_and_search(self):
        self.send('The picnic is on Sunday')
        self.client.force_authenticate(self.bob)
        self.client.post(self.url + 'state/', {'muted': True}, format='json')
        self.assertEqual(self.client.get('/api/conversations/unread_count/').data['unread_count'], 0)
        self.client.post(self.url + 'state/', {'archived': True}, format='json')
        self.assertEqual(self.inbox(self.bob), [])
        self.assertEqual(len(self.inbox(self.bob, folder='archived')), 1)
        self.send('Bring bread', as_user=self.ann)                               # a new message brings it back
        self.assertEqual(len(self.inbox(self.bob)), 1)
        self.assertEqual(len(self.inbox(self.bob, q='picnic')), 1)
        self.assertEqual(len(self.inbox(self.bob, q='ann')), 1)
        self.assertEqual(self.inbox(self.bob, q='zebra'), [])
        self.client.force_authenticate(self.bob)
        hits = self.client.get(self.url + 'messages/', {'q': 'bread'}).data
        self.assertEqual([h['content'] for h in hits], ['Bring bread'])

    def test_reporting_a_message_is_for_those_in_the_chat(self):
        m = self.send('rude').data
        carl = User.objects.create_user('carl', 'c@x.com', 'x')
        self.client.force_authenticate(carl)
        body = {'content_type': 'message', 'object_id': m['id'], 'reason': 'spam'}
        self.assertEqual(self.client.post('/api/reports/', body, format='json').status_code, 404)
        self.client.force_authenticate(self.bob)
        self.assertEqual(self.client.post('/api/reports/', body, format='json').status_code, 201)
        self.assertTrue(Report.objects.filter(content_type='message').exists())

    def test_presence(self):
        self.assertEqual(self.client.get(self.url + 'presence/').data, {'online': False, 'last_seen': None})
        dm.went_online(self.bob.id)
        self.assertTrue(self.client.get(self.url + 'presence/').data['online'])
        dm.went_offline(self.bob.id)
        r = self.client.get(self.url + 'presence/').data
        self.assertEqual(r['online'], False)
        self.assertIsNotNone(r['last_seen'])


class LiveSocketTests(TransactionTestCase):
    """The socket itself: a token in, events out."""

    def setUp(self):
        cache.clear()
        self.ann = User.objects.create_user('ann', 'a@x.com', 'x')
        self.bob = User.objects.create_user('bob', 'b@x.com', 'x')
        follow(self.bob, self.ann)
        self.conv = dm.start_between(self.ann, self.bob)

    def connect(self, user):
        from music.asgi import application
        token = str(AccessToken.for_user(user)) if user else 'bad'
        return WebsocketCommunicator(application, f'/ws/dm/?token={token}')

    def test_live_messages_typing_and_reads(self):
        async def run():
            bob = self.connect(self.bob)
            ok, _ = await bob.connect()
            assert ok
            ann = self.connect(self.ann)
            ok, _ = await ann.connect()
            assert ok
            seen = await bob.receive_json_from(timeout=3)             # ann came online
            assert seen == {'type': 'presence', 'user_id': self.ann.id, 'online': True}, seen

            from channels.db import database_sync_to_async

            @database_sync_to_async
            def ann_sends():
                c = APIClient()
                c.force_authenticate(self.ann)
                return c.post(f'/api/conversations/{self.conv.id}/send_message/', {'content': 'Live!'}, format='json')
            await ann_sends()
            got = await bob.receive_json_from(timeout=3)
            assert got['type'] == 'message' and got['message']['content'] == 'Live!', got
            await ann.receive_json_from(timeout=3)                   # ann's other devices hear it too

            await ann.send_json_to({'type': 'typing', 'conversation_id': self.conv.id, 'is_typing': True})
            typing = await bob.receive_json_from(timeout=3)
            assert typing == {'type': 'typing', 'conversation_id': self.conv.id, 'user_id': self.ann.id,
                              'is_typing': True}, typing

            @database_sync_to_async
            def bob_reads():
                c = APIClient()
                c.force_authenticate(self.bob)
                return c.post(f'/api/conversations/{self.conv.id}/mark_read/')
            await bob_reads()
            read = await ann.receive_json_from(timeout=3)
            assert read == {'type': 'read', 'conversation_id': self.conv.id, 'reader_id': self.bob.id}, read
            await ann.disconnect()
            await bob.disconnect()
        async_to_sync(run)()

    def test_no_token_or_a_banned_account_is_turned_away(self):
        async def run():
            anon = self.connect(None)
            ok, _ = await anon.connect()
            assert not ok
            from channels.db import database_sync_to_async
            await database_sync_to_async(User.objects.filter(pk=self.bob.pk).update)(is_active=False)
            bob = self.connect(self.bob)
            ok, _ = await bob.connect()
            assert not ok
        async_to_sync(run)()

    def test_typing_only_to_the_other_person_in_that_chat(self):
        carl = User.objects.create_user('carl', 'c@x.com', 'x')

        async def run():
            c = self.connect(carl)
            ok, _ = await c.connect()
            assert ok
            ann = self.connect(self.ann)
            await ann.connect()
            # carl isn't in ann and bob's chat: nothing goes anywhere.
            await c.send_json_to({'type': 'typing', 'conversation_id': self.conv.id, 'is_typing': True})
            assert await ann.receive_nothing(timeout=0.5)
            await c.disconnect()
            await ann.disconnect()
        async_to_sync(run)()

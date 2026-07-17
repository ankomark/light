"""Inbox (conversation list): recency ordering + pagination.

    python manage.py test songs.tests.test_inbox --settings=music.settings_test
"""
from rest_framework.test import APITestCase

from songs.models import Conversation, Message, User


class InboxOrderingTests(APITestCase):
    def setUp(self):
        self.alice = User.objects.create_user('ia', 'ia@x.com', 'x')
        self.bob = User.objects.create_user('ib', 'ib@x.com', 'x')
        self.carol = User.objects.create_user('ic', 'ic@x.com', 'x')
        self.client.force_authenticate(self.alice)

    def _convo(self, other):
        c = Conversation.objects.create()
        c.participants.add(self.alice, other)
        return c

    def test_ordered_by_recent_activity(self):
        c_old = self._convo(self.bob)
        c_new = self._convo(self.carol)
        Message.objects.create(conversation=c_old, sender=self.bob, content='old')
        Message.objects.create(conversation=c_new, sender=self.carol, content='new')  # newer

        rows = self.client.get('/api/conversations/').json()['results']
        ids = [r['id'] for r in rows]
        self.assertLess(ids.index(c_new.id), ids.index(c_old.id))  # newest activity first

    def test_paginated_with_next(self):
        for i in range(25):  # > page_size (20)
            u = User.objects.create_user(f'p{i}', f'p{i}@x.com', 'x')
            c = self._convo(u)
            Message.objects.create(conversation=c, sender=u, content=f'm{i}')

        body = self.client.get('/api/conversations/').json()
        self.assertEqual(len(body['results']), 20)
        self.assertIsNotNone(body['next'])
        # Page 2 has the remainder, no overlap with page 1.
        page1_ids = {r['id'] for r in body['results']}
        page2 = self.client.get('/api/conversations/?page=2').json()
        page2_ids = {r['id'] for r in page2['results']}
        self.assertTrue(page1_ids.isdisjoint(page2_ids))

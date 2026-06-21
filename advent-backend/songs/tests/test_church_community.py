"""Tests for the church community layer (membership / requests / chat / reactions).

    python manage.py test songs.tests.test_church_community
"""
from unittest import mock

from rest_framework import status
from rest_framework.test import APITestCase

from songs.models import (
    User, Church, ChurchMembership, ChurchMessage, ChurchMessageReaction,
)


class ChurchCommunityTests(APITestCase):
    def setUp(self):
        self.creator = User.objects.create_user('ccreator', 'cc@x.com', 'x')
        self.fan = User.objects.create_user('cfan', 'cf@x.com', 'x')
        self.outsider = User.objects.create_user('coutsider', 'co@x.com', 'x')

    def _make_church(self):
        self.client.force_authenticate(self.creator)
        res = self.client.post('/api/churches/', {
            'name': 'Central SDA', 'country': 'Kenya', 'conference': 'CKC', 'location': 'Nairobi',
        }, format='json')
        assert res.status_code == status.HTTP_201_CREATED, res.content
        return res.json()['id']

    def test_creator_becomes_admin_member(self):
        cid = self._make_church()
        m = ChurchMembership.objects.get(church_id=cid, user=self.creator)
        self.assertEqual(m.role, 'admin')

    def test_request_then_approve_grants_chat_access(self):
        cid = self._make_church()
        # Outsider can't read the chat yet.
        self.client.force_authenticate(self.fan)
        self.assertEqual(self.client.get(f'/api/churches/{cid}/messages/').status_code, 403)
        # Request to join.
        with mock.patch('songs.views.directory.notify_user'):
            rq = self.client.post(f'/api/churches/{cid}/request-join/', {'message': 'bless me'}, format='json')
        self.assertEqual(rq.status_code, 201)
        req_id = rq.json()['id']
        # Creator approves.
        self.client.force_authenticate(self.creator)
        with mock.patch('songs.views.directory.notify_user'):
            ap = self.client.post(f'/api/churches/{cid}/approve-request/', {'request_id': req_id}, format='json')
        self.assertEqual(ap.status_code, 200)
        self.assertTrue(ChurchMembership.objects.filter(church_id=cid, user=self.fan, role='friend').exists())
        # Now the fan can read and post.
        self.client.force_authenticate(self.fan)
        self.assertEqual(self.client.get(f'/api/churches/{cid}/messages/').status_code, 200)
        post = self.client.post(f'/api/churches/{cid}/messages/', {'content': 'Praise God!'}, format='json')
        self.assertEqual(post.status_code, 201)
        self.assertEqual(post.json()['sender']['username'], 'cfan')

    def test_non_member_cannot_post(self):
        cid = self._make_church()
        self.client.force_authenticate(self.outsider)
        r = self.client.post(f'/api/churches/{cid}/messages/', {'content': 'hi'}, format='json')
        self.assertEqual(r.status_code, 403)
        self.assertEqual(ChurchMessage.objects.filter(church_id=cid).count(), 0)

    def test_community_snapshot_counts_members(self):
        cid = self._make_church()
        ChurchMembership.objects.create(church_id=cid, user=self.fan, role='friend')
        self.client.force_authenticate(self.creator)
        snap = self.client.get(f'/api/churches/{cid}/community/').json()
        self.assertTrue(snap['is_member'])
        self.assertTrue(snap['is_admin'])
        self.assertEqual(snap['members_count'], 2)

    def test_creator_cannot_leave(self):
        cid = self._make_church()
        self.client.force_authenticate(self.creator)
        self.assertEqual(self.client.post(f'/api/churches/{cid}/leave/').status_code, 400)

    def test_reply_and_reaction(self):
        cid = self._make_church()
        ChurchMembership.objects.create(church_id=cid, user=self.fan, role='friend')
        self.client.force_authenticate(self.creator)
        first = self.client.post(f'/api/churches/{cid}/messages/', {'content': 'Welcome!'}, format='json').json()
        reply = self.client.post(
            f'/api/churches/{cid}/messages/',
            {'content': 'Thanks', 'reply_to': first['id']}, format='json',
        ).json()
        self.assertEqual(reply['reply_to']['id'], first['id'])

        # Fan reacts, replaces, then clears.
        self.client.force_authenticate(self.fan)
        mid = first['id']
        r = self.client.post(f'/api/churches/{cid}/messages/{mid}/react/', {'emoji': '🙏'}, format='json')
        self.assertEqual(r.json()['reactions'], {'summary': [{'emoji': '🙏', 'count': 1}], 'mine': '🙏'})
        r = self.client.post(f'/api/churches/{cid}/messages/{mid}/react/', {'emoji': '🙏'}, format='json')
        self.assertEqual(r.json()['reactions'], {'summary': [], 'mine': None})
        self.assertFalse(ChurchMessageReaction.objects.filter(message_id=mid).exists())

    def test_non_member_cannot_react(self):
        cid = self._make_church()
        self.client.force_authenticate(self.creator)
        mid = self.client.post(f'/api/churches/{cid}/messages/', {'content': 'hi'}, format='json').json()['id']
        self.client.force_authenticate(self.outsider)
        r = self.client.post(f'/api/churches/{cid}/messages/{mid}/react/', {'emoji': '👍'}, format='json')
        self.assertEqual(r.status_code, 403)

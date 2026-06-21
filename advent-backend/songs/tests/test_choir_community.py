"""Tests for the choir community layer (membership / requests / chat).

    python manage.py test songs.tests.test_choir_community --settings=music.settings_test
"""
from rest_framework import status
from rest_framework.test import APITestCase
from unittest import mock

from songs.models import (
    User, Choir, ChoirMembership, ChoirJoinRequest, ChoirMessage, ChoirMessageReaction,
)


class ChoirCommunityTests(APITestCase):
    def setUp(self):
        self.creator = User.objects.create_user('creator', 'c@x.com', 'x')
        self.fan = User.objects.create_user('fan', 'f@x.com', 'x')
        self.outsider = User.objects.create_user('outsider', 'o@x.com', 'x')

    def _make_choir(self):
        self.client.force_authenticate(self.creator)
        res = self.client.post('/api/choirs/', {'name': 'Zion Voices', 'location': 'Nairobi'}, format='json')
        assert res.status_code == status.HTTP_201_CREATED, res.content
        return res.json()['id']

    def test_creator_becomes_admin_member(self):
        cid = self._make_choir()
        m = ChoirMembership.objects.get(choir_id=cid, user=self.creator)
        self.assertEqual(m.role, 'admin')

    def test_request_then_approve_grants_chat_access(self):
        cid = self._make_choir()
        # Outsider can't read the chat yet.
        self.client.force_authenticate(self.fan)
        self.assertEqual(self.client.get(f'/api/choirs/{cid}/messages/').status_code, 403)
        # Request to join.
        with mock.patch('songs.views.directory.notify_user'):
            rq = self.client.post(f'/api/choirs/{cid}/request-join/', {'message': 'love your music'}, format='json')
        self.assertEqual(rq.status_code, 201)
        req_id = rq.json()['id']
        # Creator approves.
        self.client.force_authenticate(self.creator)
        with mock.patch('songs.views.directory.notify_user'):
            ap = self.client.post(f'/api/choirs/{cid}/approve-request/', {'request_id': req_id}, format='json')
        self.assertEqual(ap.status_code, 200)
        self.assertTrue(ChoirMembership.objects.filter(choir_id=cid, user=self.fan, role='friend').exists())
        # Now the fan can read and post.
        self.client.force_authenticate(self.fan)
        self.assertEqual(self.client.get(f'/api/choirs/{cid}/messages/').status_code, 200)
        post = self.client.post(f'/api/choirs/{cid}/messages/', {'content': 'Hallelujah!'}, format='json')
        self.assertEqual(post.status_code, 201)
        self.assertEqual(post.json()['sender']['username'], 'fan')

    def test_non_member_cannot_post(self):
        cid = self._make_choir()
        self.client.force_authenticate(self.outsider)
        r = self.client.post(f'/api/choirs/{cid}/messages/', {'content': 'hi'}, format='json')
        self.assertEqual(r.status_code, 403)
        self.assertEqual(ChoirMessage.objects.filter(choir_id=cid).count(), 0)

    def test_only_admin_sees_and_approves_requests(self):
        cid = self._make_choir()
        self.client.force_authenticate(self.fan)
        with mock.patch('songs.views.directory.notify_user'):
            req_id = self.client.post(f'/api/choirs/{cid}/request-join/', {}, format='json').json()['id']
        # Non-admin can't list or approve.
        self.assertEqual(self.client.get(f'/api/choirs/{cid}/join-requests/').status_code, 403)
        self.assertEqual(
            self.client.post(f'/api/choirs/{cid}/approve-request/', {'request_id': req_id}, format='json').status_code,
            403,
        )
        # Admin can list.
        self.client.force_authenticate(self.creator)
        lst = self.client.get(f'/api/choirs/{cid}/join-requests/')
        self.assertEqual(lst.status_code, 200)
        self.assertEqual(len(lst.json()), 1)

    def test_admin_removes_member(self):
        cid = self._make_choir()
        ChoirMembership.objects.create(choir_id=cid, user=self.fan, role='friend')
        self.client.force_authenticate(self.creator)
        r = self.client.post(f'/api/choirs/{cid}/remove-member/', {'user_id': self.fan.id}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertFalse(ChoirMembership.objects.filter(choir_id=cid, user=self.fan).exists())

    def test_creator_cannot_be_removed_or_leave(self):
        cid = self._make_choir()
        self.client.force_authenticate(self.creator)
        self.assertEqual(
            self.client.post(f'/api/choirs/{cid}/remove-member/', {'user_id': self.creator.id}, format='json').status_code,
            400,
        )
        self.assertEqual(self.client.post(f'/api/choirs/{cid}/leave/').status_code, 400)

    def test_member_can_leave(self):
        cid = self._make_choir()
        ChoirMembership.objects.create(choir_id=cid, user=self.fan, role='friend')
        self.client.force_authenticate(self.fan)
        self.assertEqual(self.client.post(f'/api/choirs/{cid}/leave/').status_code, 200)
        self.assertFalse(ChoirMembership.objects.filter(choir_id=cid, user=self.fan).exists())

    def test_only_creator_deletes_choir(self):
        cid = self._make_choir()
        self.client.force_authenticate(self.fan)
        self.assertEqual(self.client.delete(f'/api/choirs/{cid}/').status_code, 403)
        self.client.force_authenticate(self.creator)
        self.assertEqual(self.client.delete(f'/api/choirs/{cid}/').status_code, 204)
        self.assertFalse(Choir.objects.filter(id=cid).exists())

    def test_sender_can_delete_own_message(self):
        cid = self._make_choir()
        self.client.force_authenticate(self.creator)
        mid = self.client.post(f'/api/choirs/{cid}/messages/', {'content': 'oops'}, format='json').json()['id']
        r = self.client.post(f'/api/choirs/{cid}/messages/{mid}/delete/')
        self.assertEqual(r.status_code, 200)
        self.assertFalse(ChoirMessage.objects.filter(id=mid).exists())

    def test_reply_threads_a_message(self):
        cid = self._make_choir()
        self.client.force_authenticate(self.creator)
        first = self.client.post(f'/api/choirs/{cid}/messages/', {'content': 'Welcome!'}, format='json').json()
        reply = self.client.post(
            f'/api/choirs/{cid}/messages/',
            {'content': 'Thank you!', 'reply_to': first['id']}, format='json',
        )
        self.assertEqual(reply.status_code, 201)
        body = reply.json()
        self.assertIsNotNone(body['reply_to'])
        self.assertEqual(body['reply_to']['id'], first['id'])
        self.assertEqual(body['reply_to']['sender'], 'creator')
        self.assertEqual(body['reply_to']['content'], 'Welcome!')

    def test_reaction_toggle_replace_and_clear(self):
        cid = self._make_choir()
        ChoirMembership.objects.create(choir_id=cid, user=self.fan, role='friend')
        self.client.force_authenticate(self.creator)
        mid = self.client.post(f'/api/choirs/{cid}/messages/', {'content': 'Amen'}, format='json').json()['id']

        # Fan adds ❤️.
        self.client.force_authenticate(self.fan)
        r = self.client.post(f'/api/choirs/{cid}/messages/{mid}/react/', {'emoji': '❤️'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['reactions'], {'summary': [{'emoji': '❤️', 'count': 1}], 'mine': '❤️'})

        # Re-reacting with a different emoji replaces (still one per user).
        r = self.client.post(f'/api/choirs/{cid}/messages/{mid}/react/', {'emoji': '🔥'}, format='json')
        self.assertEqual(r.json()['reactions'], {'summary': [{'emoji': '🔥', 'count': 1}], 'mine': '🔥'})
        self.assertEqual(ChoirMessageReaction.objects.filter(message_id=mid, user=self.fan).count(), 1)

        # Tapping the same emoji clears it.
        r = self.client.post(f'/api/choirs/{cid}/messages/{mid}/react/', {'emoji': '🔥'}, format='json')
        self.assertEqual(r.json()['reactions'], {'summary': [], 'mine': None})
        self.assertFalse(ChoirMessageReaction.objects.filter(message_id=mid).exists())

    def test_non_member_cannot_react(self):
        cid = self._make_choir()
        self.client.force_authenticate(self.creator)
        mid = self.client.post(f'/api/choirs/{cid}/messages/', {'content': 'hi'}, format='json').json()['id']
        self.client.force_authenticate(self.outsider)
        r = self.client.post(f'/api/choirs/{cid}/messages/{mid}/react/', {'emoji': '👍'}, format='json')
        self.assertEqual(r.status_code, 403)

    # A 1×1 transparent PNG, as the client would upload it.
    PNG_1PX = (
        'data:image/png;base64,'
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    )

    def test_list_serves_image_urls_not_base64(self):
        self.client.force_authenticate(self.creator)
        res = self.client.post(
            '/api/choirs/',
            {'name': 'Pixel Praise', 'location': 'Web', 'profile_image': self.PNG_1PX, 'cover_image': self.PNG_1PX},
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        cid = res.json()['id']

        # The list must NOT echo base64 — it returns small, cacheable URLs.
        lst = self.client.get('/api/choirs/')
        row = next(c for c in (lst.json().get('results') or lst.json()) if c['id'] == cid)
        self.assertNotIn('base64', row['profile_image'])
        self.assertIn(f'/choirs/{cid}/profile/', row['profile_image'])
        self.assertIn(f'/choirs/{cid}/cover/', row['cover_image'])

        # And the image endpoint streams real PNG bytes (public, no auth).
        self.client.force_authenticate(user=None)
        img = self.client.get(f'/api/choirs/{cid}/profile/')
        self.assertEqual(img.status_code, 200)
        self.assertEqual(img['Content-Type'], 'image/png')
        self.assertEqual(img.content[:8], b'\x89PNG\r\n\x1a\n')

    def test_image_endpoint_404_when_no_image(self):
        cid = self._make_choir()  # created without images
        self.assertEqual(self.client.get(f'/api/choirs/{cid}/cover/').status_code, 404)

"""Tests for live broadcasting (LiveKit control plane).

    python manage.py test songs.tests.test_live --settings=music.settings_test
"""
from unittest import mock

import jwt as pyjwt
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from songs.models import User, LiveBroadcast, CoHostRequest

SECRET = 'devsecret_devsecret_devsecret_0123'


@override_settings(LIVEKIT_API_KEY='devkey', LIVEKIT_API_SECRET=SECRET, LIVEKIT_URL='')
class LiveBroadcastTests(APITestCase):
    def setUp(self):
        self.host = User.objects.create_user('host', 'h@x.com', 'x')
        self.viewer = User.objects.create_user('viewer', 'v@x.com', 'x')
        self.fan = User.objects.create_user('fan', 'f@x.com', 'x')
        self.host.followers.add(self.fan)  # fan follows host

    def _grants(self, token):
        return pyjwt.decode(token, SECRET, algorithms=['HS256'])['video']

    def _go_live(self):
        self.client.force_authenticate(self.host)
        with mock.patch('songs.views.live.notify_user') as notify:
            res = self.client.post('/api/live/broadcasts/', {'kind': 'radio', 'title': 'Devotion'}, format='json')
        return res, notify

    def test_go_live_creates_broadcast_token_and_notifies_followers(self):
        res, notify = self._go_live()
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        body = res.json()
        self.assertTrue(body['token'])
        self.assertEqual(body['broadcast']['status'], 'live')
        # host token can publish, scoped to the room
        g = self._grants(body['token'])
        self.assertTrue(g['canPublish'])
        self.assertEqual(g['room'], LiveBroadcast.objects.get().room_name)
        # the one follower was notified
        self.assertEqual(notify.call_count, 1)
        self.assertEqual(notify.call_args[0][0], self.fan)

    def test_viewer_token_is_subscribe_only(self):
        res, _ = self._go_live()
        bid = res.json()['broadcast']['id']
        self.client.force_authenticate(self.viewer)
        r = self.client.get(f'/api/live/broadcasts/{bid}/token/')
        self.assertEqual(r.status_code, 200)
        g = self._grants(r.json()['token'])
        self.assertFalse(g.get('canPublish'))
        self.assertTrue(g.get('canSubscribe'))

    def test_cohost_request_approve_grants_publish(self):
        res, _ = self._go_live()
        bid = res.json()['broadcast']['id']
        # viewer requests
        self.client.force_authenticate(self.viewer)
        with mock.patch('songs.views.live.notify_user'):
            rq = self.client.post(f'/api/live/broadcasts/{bid}/request-cohost/', {}, format='json')
        self.assertEqual(rq.status_code, 201)
        req_id = rq.json()['id']
        # before approval, no publish token
        self.assertEqual(self.client.get(f'/api/live/broadcasts/{bid}/cohost-token/').status_code, 403)
        # host approves
        self.client.force_authenticate(self.host)
        with mock.patch('songs.views.live.notify_user'):
            ap = self.client.post(f'/api/live/broadcasts/{bid}/approve-cohost/', {'request_id': req_id}, format='json')
        self.assertEqual(ap.status_code, 200)
        # now the co-host can fetch a publish token
        self.client.force_authenticate(self.viewer)
        ct = self.client.get(f'/api/live/broadcasts/{bid}/cohost-token/')
        self.assertEqual(ct.status_code, 200)
        self.assertTrue(self._grants(ct.json()['token'])['canPublish'])

    def test_only_host_can_end_and_approve(self):
        res, _ = self._go_live()
        bid = res.json()['broadcast']['id']
        self.client.force_authenticate(self.viewer)
        self.assertEqual(self.client.post(f'/api/live/broadcasts/{bid}/end/').status_code, 403)
        self.assertEqual(
            self.client.post(f'/api/live/broadcasts/{bid}/approve-cohost/', {'request_id': 1}, format='json').status_code,
            403,
        )

    def test_end_marks_ended_and_drops_from_active_list(self):
        res, _ = self._go_live()
        bid = res.json()['broadcast']['id']
        self.client.force_authenticate(self.host)
        self.assertEqual(self.client.get('/api/live/broadcasts/').json()['count'], 1)
        self.assertEqual(self.client.post(f'/api/live/broadcasts/{bid}/end/').status_code, 200)
        self.assertEqual(LiveBroadcast.objects.get(id=bid).status, 'ended')
        self.assertEqual(self.client.get('/api/live/broadcasts/').json()['count'], 0)

    def test_anonymous_cannot_go_live(self):
        self.assertIn(
            self.client.post('/api/live/broadcasts/', {'kind': 'radio', 'title': 'x'}, format='json').status_code,
            (401, 403),
        )

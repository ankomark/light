"""Group chat rate-limiting (abuse guards).

    python manage.py test songs.tests.test_group_throttle --settings=music.settings_test
"""
from unittest import mock

from django.core.cache import cache
from rest_framework.test import APITestCase
from rest_framework.throttling import SimpleRateThrottle

from songs.models import User, Group, GroupMember


class GroupThrottleTests(APITestCase):
    def setUp(self):
        cache.clear()  # throttle counters live in the cache
        # DRF binds THROTTLE_RATES as a class attribute at import, so
        # override_settings can't reach it — patch the shared dict in place and
        # dial the group scopes down so the guard trips after a few requests.
        self._rates = mock.patch.dict(SimpleRateThrottle.THROTTLE_RATES, {
            'group_post': '3/min', 'group_join': '2/min',
        })
        self._rates.start()
        self.owner = User.objects.create_user('thrower', 't@x.com', 'x')
        self.group = Group.objects.create(creator=self.owner, name='Chatty', is_private=False)
        GroupMember.objects.create(group=self.group, user=self.owner, is_admin=True)

    def tearDown(self):
        self._rates.stop()
        cache.clear()

    def test_posting_is_rate_limited(self):
        self.client.force_authenticate(self.owner)
        url = f'/api/groups/{self.group.slug}/posts/'
        for i in range(3):
            r = self.client.post(url, {'content': f'msg {i}', 'message_type': 'text'}, format='json')
            self.assertEqual(r.status_code, 201, f'post {i} should succeed: {r.content[:120]}')
        # The 4th within the window is throttled.
        blocked = self.client.post(url, {'content': 'spam', 'message_type': 'text'}, format='json')
        self.assertEqual(blocked.status_code, 429, 'the 4th rapid post should be throttled')

    def test_reads_are_not_blocked_by_the_post_throttle(self):
        self.client.force_authenticate(self.owner)
        url = f'/api/groups/{self.group.slug}/posts/'
        for i in range(3):
            self.client.post(url, {'content': f'm{i}', 'message_type': 'text'}, format='json')
        # Reading the chat must still work even after the write cap is hit.
        for _ in range(3):
            r = self.client.get(url)
            self.assertEqual(r.status_code, 200)

    def test_join_requests_are_rate_limited(self):
        joiner = User.objects.create_user('joiner', 'j@x.com', 'x')
        self.client.force_authenticate(joiner)
        # Distinct public groups so each request is a fresh pending row.
        slugs = []
        for n in range(3):
            g = Group.objects.create(creator=self.owner, name=f'G{n}', is_private=False)
            GroupMember.objects.create(group=g, user=self.owner, is_admin=True)
            slugs.append(g.slug)
        r1 = self.client.post(f'/api/groups/{slugs[0]}/request-join/', {}, format='json')
        r2 = self.client.post(f'/api/groups/{slugs[1]}/request-join/', {}, format='json')
        r3 = self.client.post(f'/api/groups/{slugs[2]}/request-join/', {}, format='json')
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r2.status_code, 201)
        self.assertEqual(r3.status_code, 429, 'the 3rd join request in the window should be throttled')

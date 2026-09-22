"""Query budgets for the inbox, chat and follow lists.

These screens are opened constantly and the chat polls every 3 seconds, so a
per-row query or a heavyweight lookup is paid over and over. Each test pins a
fixed budget AND checks it doesn't grow with the number of rows — the growth
check is the one that catches an N+1 coming back.
"""
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from songs.models import Conversation, Message, User


def count_queries(fn):
    with CaptureQueriesContext(connection) as ctx:
        response = fn()
    return response, len(ctx.captured_queries)


class FollowListQueryTests(APITestCase):
    def setUp(self):
        self.me = User.objects.create_user('fl_me', 'fl_me@x.com', 'x')
        self.star = User.objects.create_user('fl_star', 'fl_star@x.com', 'x')
        self.client.force_authenticate(self.me)

    def _add_fans(self, start, n):
        fans = []
        for i in range(start, start + n):
            fan = User.objects.create_user(f'fl_fan{i:02d}', f'fl_fan{i}@x.com', 'x')
            self.star.followers.add(fan)
            fans.append(fan)
        return fans

    def test_followers_is_constant_in_rows(self):
        self._add_fans(0, 3)
        _, small = count_queries(lambda: self.client.get(f'/api/users/{self.star.id}/followers/'))
        self._add_fans(3, 12)
        _, large = count_queries(lambda: self.client.get(f'/api/users/{self.star.id}/followers/'))
        self.assertEqual(small, large, 'follow list grew a query per row (N+1 is back)')
        self.assertLessEqual(large, 3)

    def test_following_is_constant_in_rows(self):
        for i in range(3):
            self.star.followed_by.add(User.objects.create_user(f'fg{i}', f'fg{i}@x.com', 'x'))
        _, small = count_queries(lambda: self.client.get(f'/api/users/{self.star.id}/following/'))
        for i in range(3, 15):
            self.star.followed_by.add(User.objects.create_user(f'fg{i}', f'fg{i}@x.com', 'x'))
        _, large = count_queries(lambda: self.client.get(f'/api/users/{self.star.id}/following/'))
        self.assertEqual(small, large)

    def test_is_following_flag_is_per_row_and_correct(self):
        # The annotation replaced a per-row query; it must still answer "do I
        # follow this person" row by row, in the right direction.
        fans = self._add_fans(0, 4)
        fans[1].followers.add(self.me)   # I follow fan 1
        fans[3].followers.add(self.me)   # and fan 3
        fans[2].followed_by.add(self.me)  # fan 2 follows ME — must not count

        body = self.client.get(f'/api/users/{self.star.id}/followers/').json()
        rows = body['results'] if isinstance(body, dict) else body
        flags = {r['username']: r['is_following'] for r in rows}
        self.assertEqual(flags, {
            'fl_fan00': False, 'fl_fan01': True, 'fl_fan02': False, 'fl_fan03': True,
        })

    def test_logged_out_viewer_is_refused(self):
        # Follower lists are for signed-in members only (they used to be open).
        self._add_fans(0, 2)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(f'/api/users/{self.star.id}/followers/').status_code, 401)


class ChatQueryTests(APITestCase):
    def setUp(self):
        self.me = User.objects.create_user('cq_me', 'cq_me@x.com', 'x')
        self.other = User.objects.create_user('cq_o', 'cq_o@x.com', 'x')
        self.convo = Conversation.objects.create()
        self.convo.participants.add(self.me, self.other)
        for i in range(5):
            Message.objects.create(conversation=self.convo, sender=self.other, content=f'm{i}')
        self.last_id = self.convo.messages.order_by('-id').first().id
        self.client.force_authenticate(self.me)

    def test_poll_budget(self):
        # Runs every 3 s while a chat is open. It used to load the whole inbox
        # row (six subqueries plus participant profiles) just to find the
        # conversation.
        url = f'/api/conversations/{self.convo.id}/messages/?after={self.last_id}'
        response, n = count_queries(lambda: self.client.get(url))
        self.assertEqual(response.status_code, 200)
        self.assertLessEqual(n, 4)

    def test_open_budget(self):
        response, n = count_queries(
            lambda: self.client.get(f'/api/conversations/{self.convo.id}/messages/'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 5)
        self.assertLessEqual(n, 3)

    def test_mark_read_budget(self):
        response, n = count_queries(
            lambda: self.client.post(f'/api/conversations/{self.convo.id}/mark_read/'))
        self.assertEqual(response.status_code, 200)
        self.assertLessEqual(n, 2)
        self.assertFalse(self.convo.messages.filter(read=False).exists())

    def test_lean_lookup_still_refuses_outsiders(self):
        # The lean queryset is also the access check. Someone outside the
        # conversation must not read, post to, or mark it.
        stranger = User.objects.create_user('cq_x', 'cq_x@x.com', 'x')
        self.client.force_authenticate(stranger)
        base = f'/api/conversations/{self.convo.id}'
        self.assertIn(self.client.get(f'{base}/messages/').status_code, (403, 404))
        self.assertIn(self.client.get(f'{base}/messages/?after=0').status_code, (403, 404))
        self.assertIn(self.client.post(f'{base}/send_message/', {'content': 'hi'},
                                       format='json').status_code, (403, 404))
        self.assertIn(self.client.post(f'{base}/mark_read/').status_code, (403, 404))
        self.assertEqual(self.convo.messages.count(), 5)
        self.assertTrue(self.convo.messages.filter(read=False).exists())


class FollowListPaginationTests(APITestCase):
    def test_follow_lists_are_paginated(self):
        # A popular account must not ship every follower in one response.
        star = User.objects.create_user('pg_star', 'pg_star@x.com', 'x')
        self.client.force_authenticate(star)
        for i in range(35):
            u = User.objects.create_user(f'pg{i:02d}', f'pg{i}@x.com', 'x')
            star.followers.add(u)
            star.followed_by.add(u)
        for kind in ('followers', 'following'):
            first = self.client.get(f'/api/users/{star.id}/{kind}/?page=1&page_size=30').json()
            self.assertEqual(len(first['results']), 30)
            self.assertIsNotNone(first['next'])
            second = self.client.get(f'/api/users/{star.id}/{kind}/?page=2&page_size=30').json()
            self.assertEqual(len(second['results']), 5)
            self.assertIsNone(second['next'])
            names = [r['username'] for r in first['results'] + second['results']]
            self.assertEqual(len(set(names)), 35)

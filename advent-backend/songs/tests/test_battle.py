"""Live Bible Battle: a host's room, everyone on the same question at once.

    python manage.py test songs.tests.test_battle --settings=music.settings_test
"""
from datetime import timedelta
from unittest.mock import patch

from channels.testing import WebsocketCommunicator
from django.core.cache import cache
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from songs.models import Battle, BattleQuestion, User
from songs.tests.test_quiz import seed_corpus


class BattleBase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        seed_corpus()

    def setUp(self):
        cache.clear()
        self.host = User.objects.create_user('pastor', 'p@x.com', 'pw12345!')
        self.ann = User.objects.create_user('ann', 'a@x.com', 'pw12345!')
        self.ben = User.objects.create_user('ben', 'b@x.com', 'pw12345!')

    def as_(self, user):
        self.client.force_authenticate(user)
        return self.client

    def hosted(self, seconds=20):
        res = self.as_(self.host).post('/api/quiz-battles/', {'title': 'Youth night', 'seconds': seconds}, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content[:300])
        return res.data['code']

    def join(self, user, code):
        return self.as_(user).post('/api/quiz-battles/join/', {'code': code.lower()}, format='json')

    def q(self, code, index):
        return BattleQuestion.objects.get(battle__code=code, order=index)

    def answer(self, user, code, index, choice):
        return self.as_(user).post(f'/api/quiz-battles/{code}/answer/', {'index': index, 'choice': choice}, format='json')

    def later(self, seconds):
        """Pretend `seconds` have passed on the server's clock."""
        return patch('songs.battle.timezone.now', return_value=timezone.now() + timedelta(seconds=seconds))


class FlowTests(BattleBase):
    def test_host_starts_players_answer_the_board_ranks(self):
        code = self.hosted()
        self.assertEqual(len(code), 6)
        self.join(self.ann, code)
        self.join(self.ben, code)
        lobby = self.as_(self.host).get(f'/api/quiz-battles/{code}/').data
        self.assertEqual(sorted(lobby['lobby']), ['ann', 'ben'])
        self.assertTrue(lobby['is_host'])

        self.assertEqual(self.as_(self.host).post(f'/api/quiz-battles/{code}/start/').data['status'], 'question')
        seen = self.as_(self.ann).get(f'/api/quiz-battles/{code}/').data
        self.assertNotIn('answer_index', seen['question'])                 # never before the reveal
        right = self.q(code, 0).answer_index
        self.assertTrue(self.answer(self.ann, code, 0, right).data['accepted'])
        res = self.answer(self.ben, code, 0, (right + 1) % 4)
        self.assertTrue(res.data['all_in'])                                  # everyone in: shown at once

        shown = self.as_(self.ann).get(f'/api/quiz-battles/{code}/').data
        self.assertEqual(shown['status'], 'reveal')
        self.assertEqual(shown['reveal']['answer_index'], right)
        self.assertEqual(sum(shown['reveal']['counts']), 2)
        self.assertEqual(shown['reveal']['ranking'][0]['username'], 'ann')
        self.assertGreaterEqual(shown['reveal']['ranking'][0]['points'], 500)
        self.assertEqual(shown['me']['place'], 1)
        self.assertTrue(shown['me']['last']['correct'])

    def test_faster_is_worth_more(self):
        code = self.hosted(seconds=20)
        self.join(self.ann, code)
        self.join(self.ben, code)
        self.as_(self.host).post(f'/api/quiz-battles/{code}/start/')
        right = self.q(code, 0).answer_index
        self.answer(self.ann, code, 0, right)
        with self.later(15):
            self.answer(self.ben, code, 0, right)
        board = self.as_(self.host).get(f'/api/quiz-battles/{code}/').data['reveal']['ranking']
        self.assertEqual([r['username'] for r in board], ['ann', 'ben'])
        self.assertGreater(board[0]['points'], board[1]['points'])

    def test_the_last_answer_ends_it_with_the_ranking(self):
        code = self.hosted()
        self.join(self.ann, code)
        self.as_(self.host).post(f'/api/quiz-battles/{code}/start/')
        total = Battle.objects.get(code=code).questions.count()
        for i in range(total):
            self.answer(self.ann, code, i, self.q(code, i).answer_index)
            self.as_(self.host).post(f'/api/quiz-battles/{code}/next/', {'index': i}, format='json')
        final = self.as_(self.ann).get(f'/api/quiz-battles/{code}/').data
        self.assertEqual(final['status'], 'finished')
        self.assertEqual(final['ranking'][0]['correct'], total)


class RuleTests(BattleBase):
    def setUp(self):
        super().setUp()
        self.code = self.hosted()
        self.join(self.ann, self.code)
        self.join(self.ben, self.code)

    def start(self):
        return self.as_(self.host).post(f'/api/quiz-battles/{self.code}/start/')

    def test_only_the_host_starts_it_and_only_once(self):
        self.assertEqual(self.as_(self.ann).post(f'/api/quiz-battles/{self.code}/start/').status_code,
                         status.HTTP_403_FORBIDDEN)
        self.start()
        self.assertEqual(self.start().data['code'], 'started')

    def test_not_without_players(self):
        code = self.hosted()
        self.assertEqual(self.as_(self.host).post(f'/api/quiz-battles/{code}/start/').data['code'], 'no_players')

    def test_one_answer_each(self):
        self.start()
        self.answer(self.ann, self.code, 0, 0)
        self.assertEqual(self.answer(self.ann, self.code, 0, 1).data['code'], 'answered')

    def test_too_late_is_too_late(self):
        self.start()
        with self.later(25):
            self.assertEqual(self.answer(self.ann, self.code, 0, 0).data['code'], 'too_late')

    def test_a_question_no_longer_open(self):
        self.start()
        self.assertEqual(self.answer(self.ann, self.code, 3, 0).data['code'], 'closed')

    def test_players_may_show_the_answer_only_once_time_is_up(self):
        self.start()
        early = self.as_(self.ann).post(f'/api/quiz-battles/{self.code}/reveal/', {'index': 0}, format='json')
        self.assertEqual(early.data['code'], 'not_yet')
        with self.later(21):
            res = self.as_(self.ann).post(f'/api/quiz-battles/{self.code}/reveal/', {'index': 0}, format='json')
        self.assertEqual(res.data['status'], 'reveal')

    def test_many_asking_to_move_on_move_it_once(self):
        self.start()
        self.as_(self.host).post(f'/api/quiz-battles/{self.code}/reveal/', {'index': 0}, format='json')
        with self.later(10):
            for user in (self.host, self.ann, self.ben):
                self.as_(user).post(f'/api/quiz-battles/{self.code}/next/', {'index': 0}, format='json')
        self.assertEqual(Battle.objects.get(code=self.code).current, 1)

    def test_a_quiet_host_does_not_stall_it(self):
        self.start()
        with self.later(21):
            self.as_(self.ann).post(f'/api/quiz-battles/{self.code}/reveal/', {'index': 0}, format='json')
        early = self.as_(self.ann).post(f'/api/quiz-battles/{self.code}/next/', {'index': 0}, format='json')
        self.assertEqual(early.data['code'], 'not_yet')
        battle = Battle.objects.get(code=self.code)
        with patch('songs.battle.timezone.now', return_value=battle.revealed_at + timedelta(seconds=9)):
            self.as_(self.ann).post(f'/api/quiz-battles/{self.code}/next/', {'index': 0}, format='json')
        self.assertEqual(Battle.objects.get(code=self.code).current, 1)

    def test_the_host_cannot_play(self):
        self.assertEqual(self.join(self.host, self.code).data['code'], 'host')

    def test_an_unknown_code(self):
        self.assertEqual(self.as_(self.ann).post('/api/quiz-battles/join/', {'code': 'ZZZZZZ'}, format='json').status_code,
                         status.HTTP_404_NOT_FOUND)


class BattleSocketTests(TransactionTestCase):
    """The room hears each step; outsiders cannot listen in."""

    def setUp(self):
        seed_corpus()
        from songs.battle import create, join
        self.host = User.objects.create_user('pastor', 'p@x.com', 'pw12345!')
        self.ann = User.objects.create_user('ann', 'a@x.com', 'pw12345!')
        self.outsider = User.objects.create_user('zed', 'z@x.com', 'pw12345!')
        self.battle = create(self.host)
        join(self.battle, self.ann)

    async def _connect(self, user):
        from music.asgi import application
        comm = WebsocketCommunicator(application, f'/ws/battle/{self.battle.code}/?token={AccessToken.for_user(user)}')
        connected, _ = await comm.connect()
        return comm, connected

    async def test_a_player_hears_the_question_open(self):
        from channels.db import database_sync_to_async
        from songs.battle import start
        comm, connected = await self._connect(self.ann)
        self.assertTrue(connected)
        await database_sync_to_async(start)(self.battle, self.host)
        event = await comm.receive_json_from(timeout=3)
        self.assertEqual(event['type'], 'question')
        self.assertEqual(event['question']['index'], 0)
        self.assertNotIn('answer_index', event['question'])
        await comm.disconnect()

    async def test_an_outsider_cannot_listen(self):
        comm, connected = await self._connect(self.outsider)
        self.assertFalse(connected)

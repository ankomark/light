"""Duels: someone's Speed run, played on the very same questions.

    python manage.py test songs.tests.test_quiz_duel --settings=music.settings_test
"""
from unittest.mock import patch

from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APITestCase

from songs.models import QuizQuestion, QuizSession, User
from songs.streaks import forget_recorded_plays
from songs.tests.test_quiz import seed_corpus


class DuelTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        seed_corpus()

    def setUp(self):
        cache.clear()
        forget_recorded_plays()
        self.mark = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.ivy = User.objects.create_user('ivy', 'i@x.com', 'pw12345!')

    def play(self, user, run, right):
        """Answer every question: the first `right` correctly, the rest wrongly."""
        self.client.force_authenticate(user)
        for i, q in enumerate(run['questions']):
            choice = q['answer_index'] if i < right else (q['answer_index'] + 1) % len(q['choices'])
            self.client.post(f"/api/quiz-sessions/{run['id']}/answer/",
                             {'question_id': q['id'], 'choice': choice, 'seconds': 3, 'brief': True}, format='json')

    def marks_speed_run(self, right=6):
        self.client.force_authenticate(self.mark)
        run = self.client.post('/api/quiz-sessions/', {'mode': 'speed'}, format='json').data
        self.play(self.mark, run, right)
        return run

    def start_duel(self, of):
        self.client.force_authenticate(self.ivy)
        return self.client.post('/api/quiz-sessions/', {'mode': 'duel', 'of': of}, format='json')

    def test_the_same_questions_in_the_same_order(self):
        run = self.marks_speed_run()
        res = self.start_duel(run['id'])
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content[:200])
        mine = [(q['prompt'], q['choices'], q['answer_index']) for q in res.data['questions']]
        theirs = [(q.prompt, q.choices, q.answer_index)
                  for q in QuizQuestion.objects.filter(session_id=run['id']).order_by('order')]
        self.assertEqual(mine, theirs)
        self.assertEqual(res.data['mode'], 'duel')

    def test_the_comparison_answer_by_answer(self):
        run = self.marks_speed_run(right=6)
        duel = self.start_duel(run['id']).data
        with patch('songs.push.notify_user'):
            self.play(self.ivy, duel, right=8)
        res = self.client.get(f"/api/quiz-sessions/{duel['id']}/duel/")
        self.assertEqual(res.data['me']['username'], 'ivy')
        self.assertEqual(res.data['them']['username'], 'mark')
        self.assertEqual(res.data['me']['marks'], [True] * 8 + [False] * 2)
        self.assertEqual(res.data['them']['marks'], [True] * 6 + [False] * 4)
        self.assertEqual(res.data['verdict'], 'won')

    def test_the_challenger_hears_when_it_is_played(self):
        run = self.marks_speed_run(right=6)
        duel = self.start_duel(run['id']).data
        with patch('songs.push.notify_user') as push:
            self.play(self.ivy, duel, right=2)
        push.assert_called_once()
        self.assertEqual(push.call_args.args[0], self.mark)
        self.assertEqual(push.call_args.args[1], 'quiz_duel')
        self.assertIn('fell short of you', push.call_args.args[2])

    def test_not_your_own_run(self):
        run = self.marks_speed_run()
        self.client.force_authenticate(self.mark)
        res = self.client.post('/api/quiz-sessions/', {'mode': 'duel', 'of': run['id']}, format='json')
        self.assertEqual(res.data['code'], 'own_duel')

    def test_once_each(self):
        run = self.marks_speed_run()
        duel = self.start_duel(run['id']).data
        again = self.start_duel(run['id'])
        self.assertEqual(again.data['id'], duel['id'])          # unfinished: carry on
        with patch('songs.push.notify_user'):
            self.play(self.ivy, duel, right=5)
        self.assertEqual(self.start_duel(run['id']).data['code'], 'already_played')

    def test_gone_once_the_questions_are_pruned(self):
        run = self.marks_speed_run()
        QuizQuestion.objects.filter(session_id=run['id']).delete()
        self.assertEqual(self.start_duel(run['id']).data['code'], 'gone')

    def test_not_a_run_still_being_played(self):
        self.client.force_authenticate(self.mark)
        run = self.client.post('/api/quiz-sessions/', {'mode': 'speed'}, format='json').data
        self.assertEqual(self.start_duel(run['id']).data['code'], 'not_ready')

    def test_no_such_run(self):
        self.assertEqual(self.start_duel(999999).status_code, status.HTTP_404_NOT_FOUND)

    def test_only_the_player_sees_their_duel(self):
        run = self.marks_speed_run()
        duel = self.start_duel(run['id']).data
        self.client.force_authenticate(self.mark)
        self.assertEqual(self.client.get(f"/api/quiz-sessions/{duel['id']}/duel/").status_code,
                         status.HTTP_404_NOT_FOUND)

    def test_a_duel_is_not_a_personal_best(self):
        run = self.marks_speed_run()
        duel = self.start_duel(run['id']).data
        with patch('songs.push.notify_user'):
            self.play(self.ivy, duel, right=10)
        bests = self.client.get('/api/quiz-sessions/best/').data
        self.assertEqual(bests['speed']['played'], 0)
        self.assertEqual(QuizSession.objects.filter(user=self.ivy, mode='duel').count(), 1)

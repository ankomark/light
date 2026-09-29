"""The written question bank: mixed into the quiz, counted, and retired when
it tells nobody anything.

    python manage.py test songs.tests.test_quiz_bank --settings=music.settings_test
"""
import random
from datetime import date

from django.core.cache import cache
from django.core.exceptions import ValidationError
from rest_framework import status
from rest_framework.test import APITestCase

from songs.models import BankQuestion, DailyQuiz, User
from songs.quiz import (
    BANK_SHARE, RETIRE_AFTER, _from_bank, generate_for_date, record_bank_answers,
)
from songs.quiz_bank_seed import SEED
from songs.streaks import forget_recorded_plays
from songs.tests.test_quiz import seed_corpus


class SeedTests(APITestCase):
    def test_the_starting_set_is_loaded_and_sound(self):
        bank = BankQuestion.objects.filter(language='en')
        self.assertEqual(bank.count(), len(SEED))
        for b in bank:
            b.full_clean()                                        # choices and answer valid
            self.assertEqual(len(set(b.choices)), len(b.choices), b.prompt)
            self.assertTrue(b.explanation, b.prompt)

    def test_a_bad_question_cannot_be_saved_through_the_admin(self):
        b = BankQuestion(kind='true_false', difficulty='simple', prompt='x',
                         choices=['True', 'False', 'Maybe'], answer_index=0)
        with self.assertRaises(ValidationError):
            b.full_clean()
        b = BankQuestion(kind='fact', difficulty='simple', prompt='x', choices=['a', 'b'], answer_index=2)
        with self.assertRaises(ValidationError):
            b.full_clean()


class MixingTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        seed_corpus()

    def test_a_quarter_of_each_difficulty_is_written(self):
        quiz = generate_for_date(date(2026, 8, 8))
        for difficulty, total in (('simple', 7), ('moderate', 7), ('hard', 6)):
            written = quiz.questions.filter(difficulty=difficulty, bank_question__isnull=False).count()
            self.assertEqual(written, round(total * BANK_SHARE), difficulty)
        self.assertEqual(quiz.questions.count(), 20)

    def test_the_answer_survives_the_shuffle(self):
        for q in _from_bank(random.Random(3), 'simple', 10):
            bank = BankQuestion.objects.get(pk=q['bank_question_id'])
            self.assertEqual(q['choices'][q['answer_index']], bank.choices[bank.answer_index])

    def test_true_or_false_keeps_its_order(self):
        for seed in range(5):
            for q in _from_bank(random.Random(seed), 'simple', 20):
                if q['kind'] == 'true_false':
                    self.assertEqual(q['choices'], ['True', 'False'])

    def test_the_least_asked_come_first(self):
        BankQuestion.objects.filter(difficulty='hard').update(times_asked=100)
        fresh = BankQuestion.objects.filter(difficulty='hard').first()
        BankQuestion.objects.filter(pk=fresh.pk).update(times_asked=0)
        picked = _from_bank(random.Random(1), 'hard', 1)
        self.assertEqual(picked[0]['bank_question_id'], fresh.pk)

    def test_retired_questions_are_not_asked(self):
        BankQuestion.objects.update(is_active=False)
        quiz = generate_for_date(date(2026, 9, 9))
        self.assertFalse(quiz.questions.filter(bank_question__isnull=False).exists())
        self.assertEqual(quiz.questions.count(), 20)             # the verses make up the rest


class RecordTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        seed_corpus()

    def setUp(self):
        cache.clear()
        forget_recorded_plays()
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)

    def test_a_daily_attempt_counts_toward_each_written_question(self):
        questions = self.client.get('/api/quiz/today/').data['questions']
        quiz = DailyQuiz.objects.get()
        written = {q.id: q for q in quiz.questions.filter(bank_question__isnull=False)}
        answers = {str(q['id']): (written[q['id']].answer_index if q['id'] in written else 0) for q in questions}
        self.client.post('/api/quiz/submit/', {'answers': answers}, format='json')
        for q in written.values():
            b = BankQuestion.objects.get(pk=q.bank_question_id)
            self.assertEqual((b.times_asked, b.times_correct), (1, 1))

    def test_a_practice_answer_counts_too(self):
        res = self.client.post('/api/quiz-sessions/', {'mode': 'speed'}, format='json')
        session_id = res.data['id']
        from songs.models import QuizSession
        written = QuizSession.objects.get(pk=session_id).questions.filter(bank_question__isnull=False).first()
        self.assertIsNotNone(written)
        self.client.post(f'/api/quiz-sessions/{session_id}/answer/',
                         {'question_id': written.id, 'choice': written.answer_index, 'seconds': 3}, format='json')
        self.assertEqual(BankQuestion.objects.get(pk=written.bank_question_id).times_correct, 1)

    def test_nearly_everyone_right_retires_it_as_too_easy(self):
        b = BankQuestion.objects.first()
        record_bank_answers([(b.pk, True)] * RETIRE_AFTER)
        b.refresh_from_db()
        self.assertFalse(b.is_active)
        self.assertEqual(b.retired_reason, BankQuestion.TOO_EASY)

    def test_nearly_everyone_wrong_retires_it_to_check_the_answer(self):
        b = BankQuestion.objects.first()
        record_bank_answers([(b.pk, False)] * RETIRE_AFTER)
        b.refresh_from_db()
        self.assertEqual(b.retired_reason, BankQuestion.TOO_HARD)

    def test_a_question_that_divides_people_stays(self):
        b = BankQuestion.objects.first()
        record_bank_answers([(b.pk, i % 2 == 0) for i in range(RETIRE_AFTER * 2)])
        b.refresh_from_db()
        self.assertTrue(b.is_active)

    def test_too_few_answers_to_judge(self):
        b = BankQuestion.objects.first()
        record_bank_answers([(b.pk, True)] * (RETIRE_AFTER - 1))
        b.refresh_from_db()
        self.assertTrue(b.is_active)

    def test_the_review_teaches_and_points_to_the_verse(self):
        questions = self.client.get('/api/quiz/today/').data['questions']
        res = self.client.post('/api/quiz/submit/', {'answers': {str(q['id']): 0 for q in questions}}, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        quiz = DailyQuiz.objects.get()
        written_ids = set(quiz.questions.filter(bank_question__isnull=False).values_list('id', flat=True))
        for r in res.data['results']:
            if r['question_id'] in written_ids:
                self.assertTrue(r['explanation'])

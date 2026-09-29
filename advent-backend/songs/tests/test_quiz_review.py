"""Spaced review: misses come back on a schedule until they are known.

    python manage.py test songs.tests.test_quiz_review --settings=music.settings_test
"""
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from songs.models import DailyQuiz, QuizQuestion, ReviewItem, User
from songs.quiz_review import INTERVALS, note_miss, note_review
from songs.streaks import forget_recorded_plays
from songs.tests.test_quiz import seed_corpus


class ReviewBase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        seed_corpus()

    def setUp(self):
        cache.clear()
        forget_recorded_plays()
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)
        self.today = timezone.localdate()

    def play_daily_all_wrong(self):
        questions = self.client.get('/api/quiz/today/').data['questions']
        key = {q.id: q.answer_index for q in DailyQuiz.objects.get().questions.all()}
        answers = {str(q['id']): (key[q['id']] + 1) % len(q['choices']) for q in questions}
        self.client.post('/api/quiz/submit/', {'answers': answers}, format='json')
        return questions

    def make_due(self):
        ReviewItem.objects.update(due_on=self.today)


class ScheduleTests(ReviewBase):
    def test_a_miss_is_due_tomorrow(self):
        self.play_daily_all_wrong()
        items = ReviewItem.objects.filter(user=self.user)
        self.assertEqual(items.count(), 20)
        self.assertTrue(all(i.due_on == self.today + timedelta(days=1) and i.step == 0 for i in items))

    def test_each_right_answer_waits_longer_then_it_is_mastered(self):
        self.play_daily_all_wrong()
        item = ReviewItem.objects.first()
        for step, days in enumerate(INTERVALS[1:], start=1):
            note_review(item.pk, True)
            item.refresh_from_db()
            self.assertEqual(item.step, step)
            self.assertEqual(item.due_on, self.today + timedelta(days=days))
        note_review(item.pk, True)
        item.refresh_from_db()
        self.assertIsNotNone(item.mastered_at)

    def test_a_miss_in_review_starts_it_over(self):
        self.play_daily_all_wrong()
        item = ReviewItem.objects.first()
        note_review(item.pk, True)
        note_review(item.pk, True)
        note_review(item.pk, False)
        item.refresh_from_db()
        self.assertEqual((item.step, item.due_on), (0, self.today + timedelta(days=1)))

    def test_the_same_question_missed_twice_is_one_review(self):
        self.play_daily_all_wrong()
        q = DailyQuiz.objects.get().questions.first()
        note_miss(self.user, q)
        self.assertEqual(ReviewItem.objects.filter(user=self.user).count(), 20)

    def test_right_answers_are_not_reviewed(self):
        questions = self.client.get('/api/quiz/today/').data['questions']
        key = {q.id: q.answer_index for q in DailyQuiz.objects.get().questions.all()}
        self.client.post('/api/quiz/submit/', {'answers': {str(q['id']): key[q['id']] for q in questions}}, format='json')
        self.assertFalse(ReviewItem.objects.exists())

    def test_a_practice_miss_joins_the_review(self):
        run = self.client.post('/api/quiz-sessions/', {'mode': 'speed'}, format='json').data
        q = run['questions'][0]
        self.client.post(f"/api/quiz-sessions/{run['id']}/answer/",
                         {'question_id': q['id'], 'choice': (q['answer_index'] + 1) % len(q['choices']),
                          'seconds': 2, 'brief': True}, format='json')
        self.assertEqual(ReviewItem.objects.filter(user=self.user).count(), 1)


class ReviewRunTests(ReviewBase):
    def test_nothing_due_is_said_plainly(self):
        res = self.client.post('/api/quiz-sessions/', {'mode': 'review'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data['code'], 'nothing_due')

    def test_the_hub_hears_how_many_are_due(self):
        self.play_daily_all_wrong()
        self.assertEqual(self.client.get('/api/quiz/stats/').data['review_due'], 0)     # tomorrow
        self.make_due()
        self.assertEqual(self.client.get('/api/quiz/stats/').data['review_due'], 20)

    def test_a_review_run_asks_the_due_ones_again(self):
        self.play_daily_all_wrong()
        self.make_due()
        res = self.client.post('/api/quiz-sessions/', {'mode': 'review'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content[:200])
        self.assertEqual(len(res.data['questions']), 10)
        prompts = set(ReviewItem.objects.values_list('prompt', flat=True))
        for q in res.data['questions']:
            self.assertIn(q['prompt'], prompts)

    def test_answering_right_in_review_moves_it_on(self):
        self.play_daily_all_wrong()
        self.make_due()
        run = self.client.post('/api/quiz-sessions/', {'mode': 'review'}, format='json').data
        q = run['questions'][0]
        self.client.post(f"/api/quiz-sessions/{run['id']}/answer/",
                         {'question_id': q['id'], 'choice': q['answer_index'], 'seconds': 4, 'brief': True},
                         format='json')
        item = QuizQuestion.objects.get(pk=q['id']).review_item
        self.assertEqual(item.step, 1)
        self.assertEqual(item.due_on, self.today + timedelta(days=INTERVALS[1]))

    def test_the_review_outlives_the_practice_questions(self):
        """Practice questions are pruned after a week; the review keeps its own copy."""
        run = self.client.post('/api/quiz-sessions/', {'mode': 'speed'}, format='json').data
        q = run['questions'][0]
        self.client.post(f"/api/quiz-sessions/{run['id']}/answer/",
                         {'question_id': q['id'], 'choice': (q['answer_index'] + 1) % len(q['choices']),
                          'seconds': 2}, format='json')
        QuizQuestion.objects.filter(session_id=run['id']).delete()
        self.make_due()
        res = self.client.post('/api/quiz-sessions/', {'mode': 'review'}, format='json')
        self.assertEqual(res.data['questions'][0]['prompt'], q['prompt'])

    def test_reviews_come_back_in_the_language_they_were_missed_in(self):
        self.play_daily_all_wrong()
        self.make_due()
        res = self.client.post('/api/quiz-sessions/', {'mode': 'review', 'language': 'sw'}, format='json')
        self.assertEqual(res.data['code'], 'nothing_due')


class SectionPracticeTests(ReviewBase):
    """One part of the Bible at a time."""

    def test_a_section_run_asks_only_about_that_section(self):
        res = self.client.post('/api/quiz-sessions/', {'mode': 'section', 'category': 'gospels'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content[:200])
        self.assertEqual(len(res.data['questions']), 10)
        for q in QuizQuestion.objects.filter(session_id=res.data['id']):
            self.assertEqual(q.category, 'gospels', q.prompt)

    def test_the_wisdom_books_are_their_own_section(self):
        res = self.client.post('/api/quiz-sessions/', {'mode': 'section', 'category': 'wisdom'}, format='json')
        refs = {QuizQuestion.objects.get(pk=q['id']).reference.split(' ')[0]
                for q in res.data['questions'] if q['kind'] != 'order'}
        self.assertTrue(refs <= {'Psalms', 'Proverbs', 'Job', 'Ecclesiastes'}, refs)

    def test_a_section_must_be_named(self):
        res = self.client.post('/api/quiz-sessions/', {'mode': 'section', 'category': 'poetry'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('category', res.data)

    def test_the_books_of_each_section(self):
        from songs.quiz import books_in
        self.assertEqual(books_in('law'), (1, 5))
        self.assertEqual(books_in('gospels'), (40, 43))
        self.assertEqual(books_in('revelation'), (66, 66))
        self.assertIsNone(books_in('nothing'))

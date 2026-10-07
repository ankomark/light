"""Quiz progress: the streak freeze, badges, strengths and history.

    python manage.py test songs.tests.test_quiz_progress --settings=music.settings_test
"""
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from songs.models import CoinSpend, DailyQuiz, PlayDay, QuizAttempt, User
from songs.quiz_progress import CATEGORY_ORDER, FREEZE_COST, badges_for, freeze_offer
from songs.streaks import forget_recorded_plays, streak_for
from songs.tests.test_quiz import seed_corpus


class ProgressBase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        seed_corpus()

    def setUp(self):
        cache.clear()
        forget_recorded_plays()
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)
        self.today = timezone.localdate()

    def played(self, *days_back):
        for n in days_back:
            PlayDay.objects.get_or_create(user=self.user, date=self.today - timedelta(days=n))

    def coins(self, amount, days_back=30, score=10, total=20):
        """Coins earned the honest way: a daily attempt worth `amount`."""
        quiz = DailyQuiz.objects.get_or_create(date=self.today - timedelta(days=days_back))[0]
        return QuizAttempt.objects.create(user=self.user, quiz=quiz, score=score, total=total, points=amount)


class StreakFreezeTests(ProgressBase):
    def test_a_streak_broken_yesterday_can_be_bought_back(self):
        self.played(2, 3, 4, 5)                   # four days, then yesterday missed
        self.coins(500)
        offer = freeze_offer(self.user)
        self.assertTrue(offer['available'])
        self.assertEqual(offer['run'], 4)
        self.assertTrue(offer['affordable'])

        res = self.client.post('/api/quiz/freeze/')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content[:200])
        self.assertEqual(res.data['day_streak'], 5)               # the four, and yesterday
        day = PlayDay.objects.get(user=self.user, date=self.today - timedelta(days=1))
        self.assertTrue(day.frozen)
        self.assertEqual(CoinSpend.objects.get(user=self.user).amount, FREEZE_COST)

    def test_playing_today_after_a_freeze_carries_the_streak_on(self):
        self.played(2, 3)
        self.coins(500)
        self.client.post('/api/quiz/freeze/')
        self.played(0)
        self.assertEqual(streak_for(self.user)[0], 4)

    def test_it_is_not_offered_when_nothing_was_missed(self):
        self.played(1, 2)
        self.coins(500)
        self.assertEqual(freeze_offer(self.user)['reason'], 'not_needed')

    def test_it_is_not_offered_when_there_is_no_streak_to_save(self):
        self.played(5, 6)
        self.coins(500)
        self.assertEqual(freeze_offer(self.user)['reason'], 'nothing_to_save')

    def test_once_a_week_at_most(self):
        self.played(2, 3)
        self.coins(900)
        CoinSpend.objects.create(user=self.user, amount=FREEZE_COST, reason=CoinSpend.FREEZE)
        self.assertEqual(freeze_offer(self.user)['reason'], 'used_this_week')
        self.assertEqual(self.client.post('/api/quiz/freeze/').data['code'], 'not_available')

    def test_without_the_coins_it_is_refused_and_nothing_changes(self):
        self.played(2, 3)
        self.coins(FREEZE_COST - 1)
        res = self.client.post('/api/quiz/freeze/')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data['code'], 'not_enough_coins')
        self.assertFalse(PlayDay.objects.filter(user=self.user, frozen=True).exists())
        self.assertFalse(CoinSpend.objects.exists())

    def test_it_cannot_be_bought_twice(self):
        self.played(2, 3)
        self.coins(900)
        self.assertEqual(self.client.post('/api/quiz/freeze/').status_code, status.HTTP_201_CREATED)
        self.assertEqual(self.client.post('/api/quiz/freeze/').status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(CoinSpend.objects.count(), 1)

    def test_the_spend_comes_off_the_balance(self):
        self.played(2, 3)
        self.coins(500)
        self.client.post('/api/quiz/freeze/')
        self.assertEqual(self.client.get('/api/quiz/stats/').data['total_coins'], 500 - FREEZE_COST)

    def test_the_hub_hears_of_the_offer_with_its_stats(self):
        self.played(2, 3)
        self.coins(500)
        freeze = self.client.get('/api/quiz/stats/').data['freeze']
        self.assertTrue(freeze['available'])
        self.assertEqual(freeze['cost'], FREEZE_COST)


class BadgeTests(ProgressBase):
    def by_key(self):
        return {b['key']: b for b in badges_for(self.user)}

    def test_nothing_is_earned_before_playing(self):
        self.assertFalse(any(b['earned'] for b in badges_for(self.user)))

    def test_a_perfect_day_and_a_first_quiz(self):
        self.coins(200, score=20, total=20)
        badges = self.by_key()
        self.assertTrue(badges['first_quiz']['earned'])
        self.assertTrue(badges['perfect']['earned'])
        self.assertFalse(badges['coins_1000']['earned'])
        self.assertEqual(badges['coins_1000']['progress'], 200)

    def test_progress_never_passes_the_target(self):
        self.coins(5000)
        self.assertEqual(self.by_key()['coins_1000'],
                         {'key': 'coins_1000', 'earned': True, 'progress': 1000, 'target': 1000})

    def test_a_week_of_days_in_a_row(self):
        self.played(*range(0, 7))
        self.assertTrue(self.by_key()['week_streak']['earned'])
        self.assertFalse(self.by_key()['month_streak']['earned'])


class StrengthAndHistoryTests(ProgressBase):
    def _play_today(self):
        questions = self.client.get('/api/quiz/today/').data['questions']
        self.client.post('/api/quiz/submit/',
                         {'shuffled': False, 'answers': {str(q['id']): 0 for q in questions}}, format='json')
        return questions

    def test_strengths_cover_every_answer_in_canon_order(self):
        questions = self._play_today()
        strengths = self.client.get('/api/quiz/progress/').data['strengths']
        self.assertEqual(sum(s['answered'] for s in strengths), len(questions))
        order = [s['category'] for s in strengths]
        self.assertEqual(order, sorted(order, key=CATEGORY_ORDER.index))
        for s in strengths:
            self.assertAlmostEqual(s['accuracy'], round(s['correct'] / s['answered'], 3))

    def test_history_and_the_calendar(self):
        self._play_today()
        self.played(3)
        PlayDay.objects.create(user=self.user, date=self.today - timedelta(days=4), frozen=True)
        data = self.client.get('/api/quiz/progress/').data
        self.assertEqual(len(data['history']), 1)
        self.assertEqual(data['history'][0]['total'], 20)
        by_date = {d['date']: d for d in data['days']}
        self.assertTrue(by_date[self.today]['quiz'])
        self.assertFalse(by_date[self.today - timedelta(days=3)]['quiz'])
        self.assertTrue(by_date[self.today - timedelta(days=4)]['frozen'])
        self.assertIn('badges', data)
        self.assertIn('freeze', data)

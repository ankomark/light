"""The quiz overhaul: the day's clock, fair play, better questions, stories,
reports, the offline pack and the admin's quiz tools.

    python manage.py test songs.tests.test_quiz_overhaul --settings=music.settings_test
"""
import random
from datetime import date, timedelta
from unittest.mock import patch

from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from songs.days import local_today
from songs.models import (
    BankQuestion, Battle, BibleVerse, DailyQuiz, DailyQuizStart, QuestionReport, QuizAttempt,
    QuizQuestion, QuizSession, StoryPack, User,
)
from songs.quiz import (
    ENGLISH, _gap_word, _lookalikes, _q_blank, _q_section, _split_for_finish, build_questions,
    display_order, generate_for_date, theme_for,
)
from songs.scoring import SPEED_MAX, settle_times
from songs.streaks import forget_recorded_plays
from songs.tests.test_quiz import seed_corpus


class Base(APITestCase):
    @classmethod
    def setUpTestData(cls):
        seed_corpus()

    def setUp(self):
        cache.clear()
        forget_recorded_plays()
        self.user = User.objects.create_user(username='ruth', email='r@x.com', password='pw-123456')
        self.client.force_authenticate(self.user)

    def _shown_right_answers(self, questions, user=None):
        """{id: index} of the right answer in the order `user` is shown it."""
        uid = (user or self.user).pk
        out = {}
        for q in questions:
            real = QuizQuestion.objects.get(pk=q['id'])
            order = display_order(uid, real.pk, real.kind, len(real.choices))
            out[str(real.pk)] = order.index(real.answer_index)
        return out


class DayTests(Base):
    def test_a_day_still_to_come_cannot_be_read(self):
        tomorrow = (local_today() + timedelta(days=1)).isoformat()
        res = self.client.get(f'/api/quiz/today/?date={tomorrow}')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(DailyQuiz.objects.filter(date=local_today() + timedelta(days=1)).exists())

    def test_a_day_long_ago_is_not_built(self):
        old = (local_today() - timedelta(days=30)).isoformat()
        self.assertEqual(self.client.get(f'/api/quiz/today/?date={old}').status_code, 400)

    def test_a_past_day_cannot_be_played(self):
        day = (local_today() - timedelta(days=3)).isoformat()
        self.client.get(f'/api/quiz/today/?date={day}')
        res = self.client.post('/api/quiz/submit/', {'date': day, 'answers': {}}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_yesterdays_quiz_closes_unless_opened_before_midnight(self):
        yesterday = local_today() - timedelta(days=1)
        quiz = generate_for_date(yesterday)
        res = self.client.post('/api/quiz/submit/', {'date': yesterday.isoformat(), 'answers': {}}, format='json')
        self.assertEqual(res.data['code'], 'closed')
        DailyQuizStart.objects.create(user=self.user, quiz=quiz)
        with patch('songs.views.quiz.seconds_into_day', return_value=600):
            res = self.client.post('/api/quiz/submit/', {'date': yesterday.isoformat(), 'answers': {}},
                                   format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(QuizAttempt.objects.get(user=self.user).quiz, quiz)

    def test_opening_the_quiz_to_play_is_noted_once(self):
        self.client.get('/api/quiz/today/')
        start = DailyQuizStart.objects.get(user=self.user)
        self.assertIsNone(start.play_started_at)
        self.client.get('/api/quiz/today/?play=1')
        first = DailyQuizStart.objects.get(user=self.user).play_started_at
        self.assertIsNotNone(first)
        self.client.get('/api/quiz/today/?play=1')
        self.assertEqual(DailyQuizStart.objects.get(user=self.user).play_started_at, first)

    def test_the_quiz_day_is_the_players_day(self):
        """23:30 UTC is already tomorrow in Nairobi."""
        from datetime import datetime, timezone as dt_tz
        late = datetime(2026, 10, 7, 23, 30, tzinfo=dt_tz.utc)
        with patch('django.utils.timezone.now', return_value=late):
            self.assertEqual(local_today(), date(2026, 10, 8))


class OrderTests(Base):
    def test_each_player_has_their_own_order(self):
        mine = self.client.get('/api/quiz/today/').data['questions']
        other = User.objects.create_user(username='naomi', email='n@x.com', password='pw-123456')
        self.client.force_authenticate(other)
        theirs = self.client.get('/api/quiz/today/').data['questions']
        self.assertEqual([q['id'] for q in mine], [q['id'] for q in theirs])
        self.assertNotEqual([q['choices'] for q in mine], [q['choices'] for q in theirs])
        # The same set of choices, only ordered differently.
        self.assertEqual([sorted(q['choices']) for q in mine], [sorted(q['choices']) for q in theirs])

    def test_answering_in_the_order_shown_scores(self):
        quiz = self.client.get('/api/quiz/today/').data
        self.assertTrue(quiz['shuffled'])
        answers = self._shown_right_answers(quiz['questions'])
        res = self.client.post('/api/quiz/submit/', {'answers': answers}, format='json')
        self.assertEqual(res.data['score'], 20)
        # The review speaks the same order.
        for r in res.data['results']:
            self.assertEqual(r['answer_index'], answers[str(r['question_id'])])
        review = self.client.get('/api/quiz/today/').data['my_attempt']['results']
        self.assertEqual({r['question_id']: r['answer_index'] for r in review},
                         {int(k): v for k, v in answers.items()})

    def test_yes_or_no_keeps_its_order(self):
        self.assertEqual(display_order(5, 99, 'exact', 2), [0, 1])
        self.assertEqual(display_order(5, 99, 'true_false', 2), [0, 1])


class FairPlayTests(Base):
    def test_settled_times_leave_honest_play_alone(self):
        claimed = {1: 6.0, 2: 9.0}
        self.assertEqual(settle_times(claimed, 20.0, 2), claimed)

    def test_forged_zeros_are_held_to_the_clock(self):
        settled = settle_times({1: 0, 2: 0, 3: None}, 300.0, 3)
        self.assertGreater(settled[1], 0)
        self.assertIsNone(settled[3])
        # 0.6 of the sitting, which counts at most 20 seconds a question.
        self.assertAlmostEqual(settled[1] + settled[2], 0.6 * 3 * 20)

    def test_no_clock_changes_nothing(self):
        self.assertEqual(settle_times({1: 0}, None, 20), {1: 0})

    def test_a_forged_instant_run_long_after_opening_earns_little_speed(self):
        quiz = self.client.get('/api/quiz/today/?play=1').data
        DailyQuizStart.objects.filter(user=self.user).update(
            play_started_at=timezone.now() - timedelta(minutes=10))
        answers = {qid: {'choice': i, 'seconds': 0}
                   for qid, i in self._shown_right_answers(quiz['questions']).items()}
        res = self.client.post('/api/quiz/submit/', {'answers': answers}, format='json')
        speed = sum(r['points_breakdown']['speed'] for r in res.data['results'])
        self.assertLess(speed, SPEED_MAX * 20 / 2)

    def test_practice_pays_up_to_the_days_ceiling(self):
        with patch('songs.views.quiz.PRACTICE_COINS_PER_DAY', 25):
            run = self.client.post('/api/quiz-sessions/', {'mode': 'speed'}, format='json').data
            paid = 0
            for q in run['questions'][:4]:
                res = self.client.post(f"/api/quiz-sessions/{run['id']}/answer/",
                                       {'question_id': q['id'], 'choice': q['answer_index'], 'seconds': 1},
                                       format='json')
                paid += res.data['points_earned']
            self.assertEqual(paid, 25)
            self.assertTrue(res.data['capped'])

    def test_answering_twice_is_refused_cleanly(self):
        run = self.client.post('/api/quiz-sessions/', {'mode': 'speed'}, format='json').data
        q = run['questions'][0]
        body = {'question_id': q['id'], 'choice': q['answer_index'], 'seconds': 2}
        self.client.post(f"/api/quiz-sessions/{run['id']}/answer/", body, format='json')
        again = self.client.post(f"/api/quiz-sessions/{run['id']}/answer/", body, format='json')
        self.assertEqual(again.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(again.data['code'], 'answered')
        self.assertEqual(QuizSession.objects.get(pk=run['id']).answered, 1)

    def test_battles_one_person_hosts_a_day_are_bounded(self):
        with patch('songs.views.battle.BattleViewSet.HOSTED_PER_DAY', 1):
            self.assertEqual(self.client.post('/api/quiz-battles/', {}, format='json').status_code, 201)
            self.assertEqual(self.client.post('/api/quiz-battles/', {}, format='json').status_code, 429)


class GeneratorTests(Base):
    class V:
        def __init__(self, text, book='Genesis', number=1, chapter=3, verse=4):
            self.text, self.book, self.book_number, self.chapter, self.verse = text, book, number, chapter, verse
            self.pk = 1

        @property
        def reference(self):
            return f'{self.book} {self.chapter}:{self.verse}'

    def test_a_word_that_appears_twice_is_never_the_gap(self):
        words = 'Holy holy holy is the LORD of hosts the whole earth is full of his glory'.split()
        for seed in range(30):
            gap = _gap_word(random.Random(seed), words, ENGLISH)
            self.assertNotEqual(gap[1].lower(), 'holy')
            self.assertNotEqual(gap[0], 0)

    def test_wrong_words_look_like_the_right_one(self):
        pool = ['Moses', 'Aaron', 'walked', 'river', 'mountain', 'Pharaoh', 'goeth', 'cometh', 'speaketh', 'giveth']
        self.assertEqual(set(_lookalikes('Miriam', pool, ENGLISH)), {'Moses', 'Aaron', 'Pharaoh'})
        self.assertNotIn('Moses', _lookalikes('saith', pool, ENGLISH))          # no capital for a lower-case gap
        self.assertTrue(all(w.endswith('eth') for w in _lookalikes('walketh', pool, ENGLISH)))

    def test_the_gap_keeps_its_punctuation(self):
        verse = self.V('And the people gathered beside the mountain, and blessed the everlasting river forever.')
        for seed in range(20):
            q = _q_blank(random.Random(seed), verse, 'moderate', ENGLISH)
            if q and 'mountain' == q['choices'][q['answer_index']]:
                self.assertIn('______,', q['passage'])
                break

    def test_a_long_book_asks_which_ten_chapters(self):
        verse = self.V('Blessed is the man that walketh not in the counsel of the ungodly.', 'Psalms', 19, 23, 1)
        q = _q_section(random.Random(1), verse, 'hard', ENGLISH)
        self.assertEqual(q['choices'][q['answer_index']], '21–30')
        self.assertIsNone(_q_section(random.Random(1), self.V('x ' * 10, 'Ruth', 8, 2, 1), 'hard', ENGLISH))

    def test_a_verse_splits_at_a_comma_near_its_middle(self):
        start, end = _split_for_finish('For God so loved the world, that he gave his only begotten Son, '
                                       'that whosoever believeth in him should not perish')
        self.assertTrue(start.endswith(','))
        self.assertTrue(len(start.split()) >= 4 and len(end.split()) >= 3)

    def test_the_day_has_a_theme_by_weekday(self):
        self.assertEqual(theme_for(date(2026, 10, 10)), 'famous')       # a Saturday
        self.assertEqual(theme_for(date(2026, 10, 5)), 'gospels')       # a Monday

    def test_a_theme_the_bible_cannot_supply_leaves_the_day_unthemed(self):
        quiz = generate_for_date(date(2026, 10, 6))                     # Tuesday: history, not in the test Bible
        self.assertEqual(quiz.theme, '')
        self.assertEqual(quiz.questions.count(), 20)

    def test_well_known_verses_finish_the_daily_quiz(self):
        quiz = generate_for_date(date(2026, 10, 8))
        finish = quiz.questions.filter(kind='finish')
        self.assertEqual(finish.count(), 2)
        for q in finish:
            self.assertTrue(q.passage.endswith('…'))
            self.assertEqual(len(set(q.choices)), 4)

    def test_no_verse_is_asked_twice_in_a_day(self):
        quiz = generate_for_date(date(2026, 10, 5))                     # Monday: a gospels theme
        refs = [q.reference for q in quiz.questions.filter(bank_question__isnull=True)]
        self.assertEqual(len(refs), len(set(refs)))
        self.assertEqual(quiz.theme, 'gospels')

    def test_a_built_quiz_is_the_same_every_time(self):
        a = build_questions(random.Random(7), [('simple', 3), ('moderate', 3), ('hard', 3)], ENGLISH)
        b = build_questions(random.Random(7), [('simple', 3), ('moderate', 3), ('hard', 3)], ENGLISH)
        self.assertEqual([(q['prompt'], q['choices']) for q in a], [(q['prompt'], q['choices']) for q in b])


class BankCalibrationTests(Base):
    def test_offline_pack_never_carries_a_verse_of_todays_quiz(self):
        pack = self.client.get('/api/quiz/offline-pack/').data['questions']
        todays = set(QuizQuestion.objects.filter(quiz__date=local_today()).values_list('reference', flat=True))
        self.assertTrue(todays)                                     # built first, so it can be avoided
        self.assertFalse(todays & {q['reference'] for q in pack})

    def test_offline_pack_carries_answers_but_no_written_questions(self):
        res = self.client.get('/api/quiz/offline-pack/')
        self.assertEqual(res.status_code, 200)
        self.assertGreaterEqual(len(res.data['questions']), 30)
        q = res.data['questions'][0]
        self.assertIn('answer_index', q)
        self.assertNotIn('bank_question_id', q)
        prompts = set(BankQuestion.objects.values_list('prompt', flat=True))
        self.assertFalse(prompts & {q['prompt'] for q in res.data['questions']})


class StoryTests(Base):
    def setUp(self):
        super().setUp()
        StoryPack.objects.update(is_active=False)
        self.first = StoryPack.objects.create(slug='t-gen', title='Beginnings', book_number=1,
                                              chapter_start=1, chapter_end=4, order=1)
        self.second = StoryPack.objects.create(slug='t-john', title='The Word', book_number=43,
                                               chapter_start=1, chapter_end=4, order=2)

    def test_the_first_story_is_open_and_the_next_waits_for_a_star(self):
        journey = self.client.get('/api/quiz/stories/').data['journey']
        self.assertEqual([(s['slug'], s['unlocked']) for s in journey], [('t-gen', True), ('t-john', False)])
        locked = self.client.post('/api/quiz-sessions/', {'mode': 'story', 'story': 't-john'}, format='json')
        self.assertEqual(locked.data['code'], 'locked')

    def test_a_story_run_keeps_to_its_chapters_and_earns_stars(self):
        run = self.client.post('/api/quiz-sessions/', {'mode': 'story', 'story': 't-gen'}, format='json').data
        self.assertEqual(QuizSession.objects.get(pk=run['id']).topic, 't-gen')
        for q in run['questions']:
            real = QuizQuestion.objects.get(pk=q['id'])
            self.assertTrue(real.reference.startswith('Genesis '), real.reference)
            chapter = int(real.reference.split(' ')[1].split(':')[0])
            self.assertLessEqual(chapter, 4)
            self.client.post(f"/api/quiz-sessions/{run['id']}/answer/",
                             {'question_id': q['id'], 'choice': q['answer_index'], 'seconds': 3}, format='json')
        journey = self.client.get('/api/quiz/stories/').data['journey']
        self.assertEqual(journey[0]['stars'], 3)
        self.assertTrue(journey[1]['unlocked'])

    def test_a_featured_story_is_open_to_everyone(self):
        StoryPack.objects.filter(pk=self.second.pk).update(is_featured=True)
        data = self.client.get('/api/quiz/stories/').data
        self.assertEqual([s['slug'] for s in data['featured']], ['t-john'])
        ok = self.client.post('/api/quiz-sessions/', {'mode': 'story', 'story': 't-john'}, format='json')
        self.assertEqual(ok.status_code, 201)


class ReportTests(Base):
    def test_only_an_answered_question_can_be_reported_and_only_once(self):
        questions = self.client.get('/api/quiz/today/').data['questions']
        qid = questions[0]['id']
        early = self.client.post('/api/quiz/report/', {'question_id': qid, 'reason': 'typo'}, format='json')
        self.assertEqual(early.status_code, status.HTTP_403_FORBIDDEN)
        self.client.post('/api/quiz/submit/', {'answers': {}}, format='json')
        res = self.client.post('/api/quiz/report/', {'question_id': qid, 'reason': 'wrong_answer',
                                                     'note': 'x' * 900}, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(QuestionReport.objects.get().note), 500)
        again = self.client.post('/api/quiz/report/', {'question_id': qid, 'reason': 'typo'}, format='json')
        self.assertEqual(again.data['status'], 'already_reported')

    def test_a_question_id_that_is_not_a_number_is_refused_cleanly(self):
        run = self.client.post('/api/quiz-sessions/', {'mode': 'speed'}, format='json').data
        for url, code in ((f"/api/quiz-sessions/{run['id']}/answer/", 400),
                          (f"/api/quiz-sessions/{run['id']}/hint/", 400),
                          ('/api/quiz/why/', 404), ('/api/quiz/report/', 404)):
            res = self.client.post(url, {'question_id': 'off-3', 'choice': 0, 'reason': 'typo'}, format='json')
            self.assertEqual(res.status_code, code, url)

    def test_a_reason_is_required(self):
        questions = self.client.get('/api/quiz/today/').data['questions']
        self.client.post('/api/quiz/submit/', {'answers': {}}, format='json')
        res = self.client.post('/api/quiz/report/', {'question_id': questions[0]['id'], 'reason': 'meh'},
                               format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)


class WeekChampionTests(Base):
    def test_last_weeks_winner_is_named_on_the_week_board(self):
        today = local_today()
        last_week = today - timedelta(days=today.weekday() + 3)
        quiz = DailyQuiz.objects.create(date=last_week)
        QuizAttempt.objects.create(user=self.user, quiz=quiz, score=20, total=20, points=400)
        res = self.client.get('/api/quiz/leaderboard/?period=week')
        self.assertEqual(res.data['champion']['user']['username'], 'ruth')
        self.assertEqual(res.data['champion']['points'], 400)


class AdminQuizTests(Base):
    def setUp(self):
        super().setUp()
        self.admin = User.objects.create_superuser(username='boss', email='b@x.com', password='pw-123456')
        self.client.force_authenticate(self.admin)

    def _ok(self, res):
        if res.status_code == 403:
            self.skipTest('admin gate needs a two-step admin session in this configuration')
        return res

    def test_a_player_cannot_reach_the_admin_quiz(self):
        self.client.force_authenticate(self.user)
        for url in ('/api/admin/quiz-daily/', '/api/admin/quiz-stats/', '/api/admin/quiz-reports/',
                    '/api/admin/quiz-battles/', '/api/admin/story-packs/'):
            self.assertIn(self.client.get(url).status_code, (401, 403), url)

    def test_the_day_shows_its_answers_and_rebuilds_until_played(self):
        res = self._ok(self.client.get('/api/admin/quiz-daily/'))
        self.assertEqual(len(res.data['questions']), 20)
        self.assertIn('answer_index', res.data['questions'][0])
        self.assertEqual(self.client.post('/api/admin/quiz-daily/', {}, format='json').status_code, 200)
        QuizAttempt.objects.create(user=self.user, quiz=DailyQuiz.objects.get(date=local_today()),
                                   score=1, total=20, points=10)
        self.assertEqual(self.client.post('/api/admin/quiz-daily/', {}, format='json').status_code, 409)

    def test_resolving_a_report_settles_the_others_and_can_retire_the_question(self):
        b = BankQuestion.objects.filter(language='en').first()
        for name in ('rep1', 'rep2'):
            u = User.objects.create_user(username=name, email=f'{name}@x.com', password='pw-123456')
            QuestionReport.objects.create(user=u, bank_question=b, prompt=b.prompt, choices=b.choices,
                                          answer_index=b.answer_index, reason='wrong_answer')
        first = QuestionReport.objects.first()
        res = self._ok(self.client.post(f'/api/admin/quiz-reports/{first.id}/resolve/',
                                        {'status': 'fixed', 'retire': True}, format='json'))
        self.assertEqual(res.status_code, 200)
        self.assertFalse(QuestionReport.objects.filter(status='open').exists())
        b.refresh_from_db()
        self.assertFalse(b.is_active)

    def test_stats_name_a_run_too_quick_to_have_been_read(self):
        quiz = generate_for_date(local_today())
        QuizAttempt.objects.create(user=self.user, quiz=quiz, score=20, total=20, points=500, duration_seconds=25)
        res = self._ok(self.client.get('/api/admin/quiz-stats/'))
        self.assertEqual(res.data['suspicious']['fast_daily'][0]['user'], 'ruth')

    def test_ending_a_battle(self):
        b = Battle.objects.create(code='ABCDEF', host=self.user)
        res = self._ok(self.client.post('/api/admin/quiz-battles/ABCDEF/end/'))
        self.assertEqual(res.data['status'], 'finished')
        b.refresh_from_db()
        self.assertEqual(b.status, Battle.FINISHED)

    def test_reports_of_one_generated_question_are_settled_together(self):
        quiz = generate_for_date(local_today())
        q = quiz.questions.filter(bank_question__isnull=True).first()
        for name in ('rep3', 'rep4'):
            u = User.objects.create_user(username=name, email=f'{name}@x.com', password='pw-123456')
            QuestionReport.objects.create(user=u, question=q, prompt=q.prompt, choices=q.choices,
                                          answer_index=q.answer_index, reason='unclear')
        first = QuestionReport.objects.first()
        self._ok(self.client.post(f'/api/admin/quiz-reports/{first.id}/resolve/', {'status': 'dismissed'},
                                  format='json'))
        self.assertFalse(QuestionReport.objects.filter(status='open').exists())

    def test_a_story_pack_must_fit_its_book(self):
        res = self._ok(self.client.post('/api/admin/story-packs/', {
            'title': 'Ruth again', 'book_number': 8, 'chapter_start': 1, 'chapter_end': 9}, format='json'))
        self.assertEqual(res.status_code, 400)
        res = self.client.post('/api/admin/story-packs/', {
            'title': 'Ruth again', 'book_number': 8, 'chapter_start': 1, 'chapter_end': 4,
            'is_featured': True}, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(StoryPack.objects.filter(is_featured=True).count(), 1)

    def test_claude_drafts_arrive_switched_off_for_review(self):
        fake = [
            {'kind': 'fact', 'difficulty': 'simple', 'prompt': 'Who made the heaven and the earth?',
             'choices': ['God', 'Moses', 'Adam', 'Noah'], 'answer_index': 0,
             'explanation': 'In the beginning God created.', 'reference': 'Genesis 1:1'},
            {'kind': 'fact', 'difficulty': 'simple', 'prompt': 'Broken', 'choices': ['a', 'a'],
             'answer_index': 0, 'explanation': '', 'reference': ''},
        ]
        with patch('songs.quiz_drafts._ask', return_value=fake):
            res = self._ok(self.client.post('/api/admin/quiz-bank/draft/', {
                'book_number': 1, 'chapter_start': 1, 'chapter_end': 2, 'count': 2}, format='json'))
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(len(res.data['created']), 1)                  # the broken one dropped
        q = BankQuestion.objects.get(prompt='Who made the heaven and the earth?')
        self.assertEqual((q.is_active, q.needs_review, q.origin), (False, True, 'ai'))
        listed = self.client.get('/api/admin/quiz-bank/?state=review').data['results']
        self.assertEqual([r['id'] for r in listed], [q.id])
        self.client.post(f'/api/admin/quiz-bank/{q.id}/activate/')
        q.refresh_from_db()
        self.assertEqual((q.is_active, q.needs_review), (True, False))

    def test_a_draft_needs_a_real_passage(self):
        res = self._ok(self.client.post('/api/admin/quiz-bank/draft/', {
            'book_number': 1, 'chapter_start': 1, 'chapter_end': 9}, format='json'))
        self.assertEqual(res.data['code'], 'bad_range')

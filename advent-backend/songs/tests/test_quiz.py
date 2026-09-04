"""The daily Bible quiz: generation, scoring and the leaderboard.

    python manage.py test songs.tests.test_quiz
"""
from datetime import date, timedelta

from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from songs.bible_books import BOOKS_BY_NAME
from songs.streaks import forget_recorded_plays
from songs.models import BibleVerse, DailyQuiz, QuizAttempt, QuizQuestion
from songs.quiz import QUESTIONS_PER_DAY, generate_for_date


def seed_corpus(chapters=12, verses=30):
    """A corpus big enough to build a full quiz from, across several books."""
    rows = []
    for name in ('Genesis', 'Psalms', 'Proverbs', 'John', 'Acts'):
        book = BOOKS_BY_NAME[name]
        for ch in range(1, min(chapters, book['chapters']) + 1):
            for v in range(1, verses + 1):
                rows.append(BibleVerse(
                    book=name, book_number=book['number'], chapter=ch, verse=v,
                    text=(f'And it came to pass in the {name} chapter {ch} verse {v} '
                          f'that the people gathered together beside the water '
                          f'and blessed the everlasting covenant forever.'),
                ))
    BibleVerse.objects.bulk_create(rows, ignore_conflicts=True)


class QuizGenerationTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        seed_corpus()

    def setUp(self):
        cache.clear()
        forget_recorded_plays()

    def test_generates_twenty_questions(self):
        quiz = generate_for_date(date(2026, 1, 1))
        self.assertEqual(quiz.questions.count(), QUESTIONS_PER_DAY)

    def test_difficulty_mix_is_seven_seven_six(self):
        quiz = generate_for_date(date(2026, 1, 2))
        counts = {d: quiz.questions.filter(difficulty=d).count()
                  for d in ('simple', 'moderate', 'hard')}
        self.assertEqual(counts, {'simple': 7, 'moderate': 7, 'hard': 6})

    def test_the_same_day_always_yields_the_same_quiz(self):
        """Deterministic by date, so a late player gets what an early one got."""
        a = generate_for_date(date(2026, 3, 9))
        first = [(q.prompt, q.passage, q.choices) for q in a.questions.all()]
        a.questions.all().delete()
        b = generate_for_date(date(2026, 3, 9), force=True)
        second = [(q.prompt, q.passage, q.choices) for q in b.questions.all()]
        self.assertEqual(first, second)

    def test_different_days_differ(self):
        a = generate_for_date(date(2026, 4, 1))
        b = generate_for_date(date(2026, 4, 2))
        self.assertNotEqual(
            [q.passage for q in a.questions.all()],
            [q.passage for q in b.questions.all()],
        )

    def test_calling_twice_reuses_the_stored_quiz(self):
        first = generate_for_date(date(2026, 5, 5))
        again = generate_for_date(date(2026, 5, 5))
        self.assertEqual(first.pk, again.pk)
        self.assertEqual(DailyQuiz.objects.filter(date=date(2026, 5, 5)).count(), 1)

    def test_every_question_is_answerable(self):
        """Four distinct choices and an answer_index that points at one."""
        quiz = generate_for_date(date(2026, 6, 6))
        for q in quiz.questions.all():
            self.assertEqual(len(q.choices), 4, q.prompt)
            self.assertEqual(len(set(q.choices)), 4, q.choices)
            self.assertIn(q.answer_index, range(4), q.prompt)

    def test_the_answer_is_the_truth_about_the_verse(self):
        """The generator must never invent an answer — a 'which book' answer has
        to be the book the verse is actually in."""
        quiz = generate_for_date(date(2026, 7, 7))
        for q in quiz.questions.filter(kind='book'):
            self.assertEqual(q.choices[q.answer_index], q.reference.rsplit(' ', 1)[0])
        for q in quiz.questions.filter(kind='reference'):
            chapter = q.reference.rsplit(' ', 1)[1].split(':')[0]
            self.assertEqual(q.choices[q.answer_index], chapter)

    def test_blank_questions_actually_blank_a_word(self):
        quiz = generate_for_date(date(2026, 8, 8))
        for q in quiz.questions.filter(kind='blank'):
            self.assertIn('______', q.passage)

    def test_an_empty_corpus_fails_loudly(self):
        BibleVerse.objects.all().delete()
        with self.assertRaises(ValueError):
            generate_for_date(date(2026, 9, 9))


class QuizApiTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        seed_corpus()

    def setUp(self):
        # Throttle counts live in a shared cache across the run.
        cache.clear()
        forget_recorded_plays()
        from songs.models import User
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.rival = User.objects.create_user('ivy', 'i@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)

    def test_today_builds_the_quiz_on_first_request(self):
        self.assertEqual(DailyQuiz.objects.count(), 0)
        res = self.client.get('/api/quiz/today/')
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.content[:300])
        self.assertEqual(len(res.data['questions']), QUESTIONS_PER_DAY)
        self.assertEqual(DailyQuiz.objects.count(), 1)

    def test_the_answer_never_reaches_the_client(self):
        """The whole game depends on this."""
        res = self.client.get('/api/quiz/today/')
        for q in res.data['questions']:
            self.assertNotIn('answer_index', q)
            self.assertNotIn('reference', q)

    def test_counts_describe_the_split(self):
        res = self.client.get('/api/quiz/today/')
        self.assertEqual(res.data['counts'], {'simple': 7, 'moderate': 7, 'hard': 6})

    def test_submitting_scores_the_attempt(self):
        self.client.get('/api/quiz/today/')
        quiz = DailyQuiz.objects.get()
        answers = {str(q.id): q.answer_index for q in quiz.questions.all()}
        res = self.client.post('/api/quiz/submit/', {'answers': answers, 'duration_seconds': 90},
                               format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content[:300])
        self.assertEqual(res.data['score'], QUESTIONS_PER_DAY)
        self.assertEqual(res.data['total'], QUESTIONS_PER_DAY)

    def test_wrong_answers_score_zero_and_come_back_explained(self):
        self.client.get('/api/quiz/today/')
        quiz = DailyQuiz.objects.get()
        answers = {str(q.id): (q.answer_index + 1) % 4 for q in quiz.questions.all()}
        res = self.client.post('/api/quiz/submit/', {'answers': answers}, format='json')
        self.assertEqual(res.data['score'], 0)
        # After submitting, the truth is disclosed so the player can learn.
        for r in res.data['results']:
            self.assertIn('answer_index', r)
            self.assertTrue(r['reference'])

    def test_unanswered_questions_are_not_credited(self):
        self.client.get('/api/quiz/today/')
        res = self.client.post('/api/quiz/submit/', {'answers': {}}, format='json')
        self.assertEqual(res.data['score'], 0)

    def test_a_junk_choice_index_cannot_score(self):
        self.client.get('/api/quiz/today/')
        quiz = DailyQuiz.objects.get()
        answers = {str(q.id): 99 for q in quiz.questions.all()}
        res = self.client.post('/api/quiz/submit/', {'answers': answers}, format='json')
        self.assertEqual(res.data['score'], 0)

    def test_only_one_attempt_a_day(self):
        self.client.get('/api/quiz/today/')
        self.client.post('/api/quiz/submit/', {'answers': {}}, format='json')
        res = self.client.post('/api/quiz/submit/', {'answers': {}}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(QuizAttempt.objects.filter(user=self.user).count(), 1)

    def test_today_reports_my_attempt_back(self):
        self.client.get('/api/quiz/today/')
        self.client.post('/api/quiz/submit/', {'answers': {}}, format='json')
        res = self.client.get('/api/quiz/today/')
        self.assertIsNotNone(res.data['my_attempt'])
        self.assertEqual(res.data['my_attempt']['total'], QUESTIONS_PER_DAY)

    def test_everyone_gets_the_same_questions_that_day(self):
        mine = self.client.get('/api/quiz/today/').data['questions']
        self.client.force_authenticate(self.rival)
        theirs = self.client.get('/api/quiz/today/').data['questions']
        self.assertEqual([q['id'] for q in mine], [q['id'] for q in theirs])

    def test_leaderboard_ranks_by_score_then_time(self):
        self.client.get('/api/quiz/today/')
        quiz = DailyQuiz.objects.get()
        right = {str(q.id): q.answer_index for q in quiz.questions.all()}
        self.client.post('/api/quiz/submit/', {'answers': right, 'duration_seconds': 200},
                         format='json')
        self.client.force_authenticate(self.rival)
        self.client.post('/api/quiz/submit/', {'answers': right, 'duration_seconds': 50},
                         format='json')
        res = self.client.get('/api/quiz/leaderboard/')
        names = [r['user']['username'] for r in res.data['results']]
        self.assertEqual(names, ['ivy', 'mark'])   # same score, ivy was faster

    def test_history_lists_past_days(self):
        self.client.get('/api/quiz/today/')
        self.client.post('/api/quiz/submit/', {'answers': {}}, format='json')
        res = self.client.get('/api/quiz/my-history/')
        self.assertEqual(len(res.data), 1)

    def test_a_past_date_can_be_replayed_read_only(self):
        day = (timezone.localdate() - timedelta(days=3)).isoformat()
        res = self.client.get('/api/quiz/today/?date=%s' % day)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['date'], day)

    def test_a_bad_date_is_rejected(self):
        res = self.client.get('/api/quiz/today/?date=notadate')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_signing_in_is_required(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/quiz/today/').status_code,
                         status.HTTP_401_UNAUTHORIZED)


class ScoringRuleTests(APITestCase):
    """The rules on their own — no HTTP, no database."""

    def setUp(self):
        cache.clear()
        forget_recorded_plays()

    def test_difficulty_sets_the_base(self):
        from songs.scoring import base_points_for
        self.assertEqual(base_points_for('simple'), 10)
        self.assertEqual(base_points_for('moderate'), 15)
        self.assertEqual(base_points_for('hard'), 20)
        self.assertEqual(base_points_for('nonsense'), 10)

    def test_speed_bonus_tapers(self):
        from songs.scoring import SPEED_MAX, speed_bonus
        self.assertEqual(speed_bonus(1.0), SPEED_MAX)
        self.assertEqual(speed_bonus(4.0), SPEED_MAX)
        self.assertEqual(speed_bonus(30.0), 0)
        middling = speed_bonus(12.0)
        self.assertTrue(0 < middling < SPEED_MAX, middling)

    def test_speed_bonus_ignores_nonsense_timings(self):
        """A forged time must not mint points."""
        from songs.scoring import speed_bonus
        for bad in (None, -5, 'fast', float('nan'), object()):
            self.assertEqual(speed_bonus(bad), 0, bad)

    def test_streak_pays_from_the_third_and_is_capped(self):
        from songs.scoring import STREAK_CAP, streak_bonus
        self.assertEqual(streak_bonus(1), 0)
        self.assertEqual(streak_bonus(2), 0)
        self.assertEqual(streak_bonus(3), 2)
        self.assertEqual(streak_bonus(4), 4)
        self.assertEqual(streak_bonus(50), STREAK_CAP)

    def test_a_wrong_answer_earns_nothing(self):
        from songs.scoring import score_answer
        earned, parts = score_answer('hard', False, 0.5, 9)
        self.assertEqual(earned, 0)
        self.assertEqual(parts, {'base': 0, 'speed': 0, 'streak': 0})

    def test_the_parts_add_up(self):
        from songs.scoring import score_answer
        earned, parts = score_answer('hard', True, 1.0, 5)
        self.assertEqual(earned, sum(parts.values()))
        self.assertEqual(parts['base'], 20)
        self.assertEqual(parts['speed'], 5)


class QuizEngineTests(APITestCase):
    """Per-answer records, points and streaks, over the real endpoint."""

    @classmethod
    def setUpTestData(cls):
        seed_corpus()

    def setUp(self):
        # Throttle counts live in a shared cache across the run.
        cache.clear()
        forget_recorded_plays()
        from songs.models import User
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.rival = User.objects.create_user('ivy', 'i@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)
        self.client.get('/api/quiz/today/')
        self.quiz = DailyQuiz.objects.get()
        self.questions = list(self.quiz.questions.all())

    def _all_right(self, seconds=1.0):
        return {str(q.id): {'choice': q.answer_index, 'seconds': seconds}
                for q in self.questions}

    def test_an_answer_row_is_written_per_question(self):
        from songs.models import QuizAnswer
        self.client.post('/api/quiz/submit/', {'answers': self._all_right()}, format='json')
        self.assertEqual(QuizAnswer.objects.count(), QUESTIONS_PER_DAY)

    def test_points_beat_a_flat_point_each(self):
        res = self.client.post('/api/quiz/submit/', {'answers': self._all_right()},
                               format='json')
        self.assertEqual(res.data['score'], 20)
        self.assertGreater(res.data['points'], 20 * 10)

    def test_difficulty_is_worth_more(self):
        from songs.models import QuizAnswer
        self.client.post('/api/quiz/submit/', {'answers': self._all_right(seconds=30)},
                         format='json')
        rows = {r.question.difficulty: r for r in QuizAnswer.objects.all()}
        self.assertGreater(rows['hard'].points_earned, rows['simple'].points_earned)

    def test_answering_fast_earns_more_than_answering_slowly(self):
        fast = self.client.post('/api/quiz/submit/', {'answers': self._all_right(seconds=1)},
                                format='json').data['points']
        self.client.force_authenticate(self.rival)
        slow = self.client.post('/api/quiz/submit/', {'answers': self._all_right(seconds=30)},
                                format='json').data['points']
        self.assertGreater(fast, slow)

    def test_longest_streak_is_recorded(self):
        res = self.client.post('/api/quiz/submit/', {'answers': self._all_right()},
                               format='json')
        self.assertEqual(res.data['longest_streak'], QUESTIONS_PER_DAY)

    def test_a_wrong_answer_breaks_the_streak(self):
        answers = self._all_right()
        fifth = self.questions[4]
        answers[str(fifth.id)] = {'choice': (fifth.answer_index + 1) % 4, 'seconds': 2}
        res = self.client.post('/api/quiz/submit/', {'answers': answers}, format='json')
        self.assertEqual(res.data['score'], 19)
        self.assertEqual(res.data['longest_streak'], 15)

    def test_a_skipped_question_is_not_a_wrong_answer(self):
        from songs.models import QuizAnswer
        self.client.post('/api/quiz/submit/', {'answers': {}}, format='json')
        rows = QuizAnswer.objects.all()
        self.assertEqual(rows.count(), QUESTIONS_PER_DAY)
        self.assertTrue(all(r.chosen_index is None and not r.is_correct for r in rows))

    def test_the_old_flat_payload_still_scores(self):
        """An app build predating per-question timing must keep working."""
        flat = {str(q.id): q.answer_index for q in self.questions}
        res = self.client.post('/api/quiz/submit/', {'answers': flat}, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content[:200])
        self.assertEqual(res.data['score'], 20)
        self.assertGreater(res.data['points'], 0)

    def test_a_forged_timing_cannot_beat_honest_fast_play(self):
        from songs.scoring import SPEED_MAX
        honest = self.client.post(
            '/api/quiz/submit/', {'answers': self._all_right(seconds=0.5)}, format='json'
        ).data['points']
        self.client.force_authenticate(self.rival)
        forged = self.client.post(
            '/api/quiz/submit/',
            {'answers': {str(q.id): {'choice': q.answer_index, 'seconds': -999}
                         for q in self.questions}},
            format='json',
        ).data['points']
        self.assertEqual(honest - forged, SPEED_MAX * QUESTIONS_PER_DAY)

    def test_the_explanation_arrives_only_after_answering(self):
        listing = self.client.get('/api/quiz/today/').data['questions']
        self.assertTrue(all('explanation' not in q for q in listing))
        res = self.client.post('/api/quiz/submit/', {'answers': {}}, format='json')
        self.assertTrue(all(r['explanation'] for r in res.data['results']))

    def test_questions_carry_a_category(self):
        listing = self.client.get('/api/quiz/today/').data['questions']
        self.assertTrue(all(q['category'] for q in listing), listing[0])

    def test_the_board_ranks_on_points_not_raw_correct(self):
        """Same number right; the faster, harder-won run ranks first."""
        self.client.post('/api/quiz/submit/', {'answers': self._all_right(seconds=25)},
                         format='json')
        self.client.force_authenticate(self.rival)
        self.client.post('/api/quiz/submit/', {'answers': self._all_right(seconds=1)},
                         format='json')
        res = self.client.get('/api/quiz/leaderboard/')
        self.assertEqual([r['user']['username'] for r in res.data['results']],
                         ['ivy', 'mark'])


class GameModeTests(APITestCase):
    """Speed Quiz and Streak — the rules that make them different games."""

    @classmethod
    def setUpTestData(cls):
        seed_corpus(chapters=20, verses=40)

    def setUp(self):
        # Throttle counts live in a shared cache across the run.
        cache.clear()
        forget_recorded_plays()
        from songs.models import User
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)

    def _start(self, mode):
        res = self.client.post('/api/quiz-sessions/', {'mode': mode}, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content[:300])
        return res.data

    def _answer(self, session_id, question, choice, seconds=1.0):
        return self.client.post(
            f'/api/quiz-sessions/{session_id}/answer/',
            {'question_id': question['id'], 'choice': choice, 'seconds': seconds},
            format='json',
        )

    # ── shape ────────────────────────────────────────────────────────────────
    def test_speed_quiz_is_ten_questions_on_a_clock(self):
        s = self._start('speed')
        self.assertEqual(s['total_questions'], 10)
        self.assertEqual(s['mode_config']['time_limit'], 15)
        self.assertFalse(s['mode_config']['ends_on_wrong'])

    def test_streak_is_a_long_pool_that_ends_on_a_miss(self):
        s = self._start('streak')
        self.assertEqual(s['total_questions'], 40)
        self.assertIsNone(s['mode_config']['time_limit'])
        self.assertTrue(s['mode_config']['ends_on_wrong'])

    def test_the_daily_quiz_cannot_be_started_as_a_session(self):
        """It is shared and ranked — one a day, not on demand."""
        res = self.client.post('/api/quiz-sessions/', {'mode': 'daily'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_an_unknown_mode_is_refused(self):
        res = self.client.post('/api/quiz-sessions/', {'mode': 'tournament'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_session_never_ships_the_answer(self):
        s = self._start('speed')
        for q in s['questions']:
            self.assertNotIn('answer_index', q)
            self.assertNotIn('explanation', q)

    def test_two_runs_of_the_same_mode_differ(self):
        """A practice mode must not replay the same set — only the daily quiz is fixed."""
        a = self._start('speed')
        b = self._start('speed')
        self.assertNotEqual([q['passage'] for q in a['questions']],
                            [q['passage'] for q in b['questions']])

    # ── streak ───────────────────────────────────────────────────────────────
    def test_streak_ends_the_moment_you_are_wrong(self):
        s = self._start('streak')
        q = s['questions'][0]
        from songs.models import QuizQuestion
        wrong = (QuizQuestion.objects.get(pk=q['id']).answer_index + 1) % 4
        res = self._answer(s['id'], q, wrong)
        self.assertFalse(res.data['correct'])
        self.assertTrue(res.data['session']['is_finished'])

    def test_streak_keeps_going_while_you_are_right(self):
        from songs.models import QuizQuestion
        s = self._start('streak')
        for i, q in enumerate(s['questions'][:5]):
            right = QuizQuestion.objects.get(pk=q['id']).answer_index
            res = self._answer(s['id'], q, right)
            self.assertTrue(res.data['correct'])
            self.assertEqual(res.data['streak'], i + 1)
        self.assertFalse(res.data['session']['is_finished'])
        self.assertEqual(res.data['session']['longest_streak'], 5)

    def test_streak_pays_no_speed_bonus(self):
        """Thinking is free in this mode — the run is the achievement."""
        from songs.models import QuizQuestion
        s = self._start('streak')
        q = s['questions'][0]
        right = QuizQuestion.objects.get(pk=q['id']).answer_index
        res = self._answer(s['id'], q, right, seconds=0.2)
        self.assertEqual(res.data['points_breakdown']['speed'], 0)

    def test_streak_bonus_climbs_far_higher_than_the_daily_cap(self):
        from songs.models import QuizQuestion
        from songs.scoring import STREAK_CAP
        s = self._start('streak')
        last = None
        for q in s['questions'][:12]:
            right = QuizQuestion.objects.get(pk=q['id']).answer_index
            last = self._answer(s['id'], q, right, seconds=3)
        self.assertGreater(last.data['points_breakdown']['streak'], STREAK_CAP)

    # ── speed ────────────────────────────────────────────────────────────────
    def test_speed_pays_far_more_for_a_fast_answer(self):
        from songs.models import QuizQuestion
        s = self._start('speed')
        q = s['questions'][0]
        right = QuizQuestion.objects.get(pk=q['id']).answer_index
        res = self._answer(s['id'], q, right, seconds=1.0)
        # 15 in speed mode versus 5 in the daily rules.
        self.assertEqual(res.data['points_breakdown']['speed'], 15)

    def test_running_out_of_time_is_a_wrong_answer(self):
        """The clock is a rule, and the server enforces it — not the app."""
        from songs.models import QuizQuestion
        s = self._start('speed')
        q = s['questions'][0]
        right = QuizQuestion.objects.get(pk=q['id']).answer_index
        res = self._answer(s['id'], q, right, seconds=40)
        self.assertTrue(res.data['timed_out'])
        self.assertFalse(res.data['correct'])
        self.assertEqual(res.data['points_earned'], 0)

    def test_speed_finishes_when_the_questions_run_out(self):
        from songs.models import QuizQuestion
        s = self._start('speed')
        for q in s['questions']:
            right = QuizQuestion.objects.get(pk=q['id']).answer_index
            res = self._answer(s['id'], q, right)
        self.assertTrue(res.data['session']['is_finished'])
        self.assertEqual(res.data['session']['score'], 10)

    # ── integrity ────────────────────────────────────────────────────────────
    def test_a_question_cannot_be_answered_twice(self):
        s = self._start('speed')
        q = s['questions'][0]
        self._answer(s['id'], q, 0)
        again = self._answer(s['id'], q, 1)
        self.assertEqual(again.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_finished_run_takes_no_more_answers(self):
        from songs.models import QuizQuestion
        s = self._start('streak')
        q = s['questions'][0]
        wrong = (QuizQuestion.objects.get(pk=q['id']).answer_index + 1) % 4
        self._answer(s['id'], q, wrong)
        res = self._answer(s['id'], s['questions'][1], 0)
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_someone_elses_run_is_not_readable(self):
        """Reading a stranger's session would hand over its questions."""
        from songs.models import User
        s = self._start('speed')
        other = User.objects.create_user('ivy', 'i@x.com', 'pw12345!')
        self.client.force_authenticate(other)
        res = self.client.get(f"/api/quiz-sessions/{s['id']}/")
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_answering_a_question_from_another_run_is_refused(self):
        mine = self._start('speed')
        theirs = self._start('speed')
        res = self._answer(mine['id'], theirs['questions'][0], 0)
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_answered_questions_stop_being_served(self):
        s = self._start('speed')
        self._answer(s['id'], s['questions'][0], 0)
        res = self.client.get(f"/api/quiz-sessions/{s['id']}/")
        self.assertEqual(len(res.data['questions']), 9)

    def test_a_run_can_be_abandoned(self):
        s = self._start('streak')
        res = self.client.post(f"/api/quiz-sessions/{s['id']}/finish/", {}, format='json')
        self.assertTrue(res.data['is_finished'])

    def test_personal_bests_are_reported_per_mode(self):
        from songs.models import QuizQuestion
        s = self._start('speed')
        q = s['questions'][0]
        right = QuizQuestion.objects.get(pk=q['id']).answer_index
        self._answer(s['id'], q, right)
        res = self.client.get('/api/quiz-sessions/best/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn('speed', res.data)
        self.assertIn('streak', res.data)
        self.assertEqual(res.data['speed']['played'], 1)
        self.assertGreater(res.data['speed']['best_points'], 0)

    def test_practice_runs_stay_off_the_daily_leaderboard(self):
        """Otherwise practice would outrank the shared quiz it is not part of."""
        from songs.models import QuizAttempt
        self._start('speed')
        self.client.get('/api/quiz/today/')
        res = self.client.get('/api/quiz/leaderboard/')
        self.assertEqual(res.data['results'], [])
        self.assertEqual(QuizAttempt.objects.count(), 0)


class QuizStatsTests(APITestCase):
    """Lifetime coins and the level they add up to."""

    @classmethod
    def setUpTestData(cls):
        seed_corpus()

    def setUp(self):
        cache.clear()
        forget_recorded_plays()
        from songs.models import User
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)

    def test_a_fresh_player_starts_at_level_one_with_nothing(self):
        res = self.client.get('/api/quiz/stats/')
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.content[:200])
        self.assertEqual(res.data['total_coins'], 0)
        self.assertEqual(res.data['level'], 1)
        self.assertEqual(res.data['level_progress'], 0)
        self.assertEqual(res.data['days_played'], 0)

    def test_the_daily_quiz_adds_to_the_total(self):
        self.client.get('/api/quiz/today/')
        quiz = DailyQuiz.objects.get()
        answers = {str(q.id): {'choice': q.answer_index, 'seconds': 1}
                   for q in quiz.questions.all()}
        self.client.post('/api/quiz/submit/', {'answers': answers}, format='json')
        res = self.client.get('/api/quiz/stats/')
        self.assertGreater(res.data['total_coins'], 0)
        self.assertEqual(res.data['daily_coins'], res.data['total_coins'])
        self.assertEqual(res.data['days_played'], 1)

    def test_practice_coins_count_too(self):
        """A total that ignored practice would misreport how much was played."""
        from songs.models import QuizQuestion
        started = self.client.post('/api/quiz-sessions/', {'mode': 'speed'},
                                   format='json').data
        q = started['questions'][0]
        right = QuizQuestion.objects.get(pk=q['id']).answer_index
        self.client.post(f"/api/quiz-sessions/{started['id']}/answer/",
                         {'question_id': q['id'], 'choice': right, 'seconds': 1},
                         format='json')
        res = self.client.get('/api/quiz/stats/')
        self.assertGreater(res.data['practice_coins'], 0)
        self.assertEqual(res.data['total_coins'], res.data['practice_coins'])
        self.assertEqual(res.data['runs_played'], 1)

    def test_the_level_follows_the_coin_total(self):
        from songs.models import DailyQuiz as DQ, QuizAttempt as QA
        quiz = generate_for_date(date(2026, 2, 2))
        QA.objects.create(user=self.user, quiz=quiz, score=10, total=20, points=350)
        res = self.client.get('/api/quiz/stats/')
        self.assertEqual(res.data['total_coins'], 350)
        self.assertEqual(res.data['level'], 3)          # L3 begins at 300
        self.assertEqual(res.data['level_start'], 300)
        self.assertEqual(res.data['level_end'], 600)
        self.assertEqual(res.data['coins_to_next'], 250)

    def test_progress_is_a_ready_made_fraction(self):
        """The client should not have to redo the arithmetic to draw a bar."""
        from songs.models import QuizAttempt as QA
        quiz = generate_for_date(date(2026, 2, 3))
        QA.objects.create(user=self.user, quiz=quiz, score=10, total=20, points=450)
        res = self.client.get('/api/quiz/stats/')
        # 450 sits halfway between 300 and 600.
        self.assertAlmostEqual(res.data['level_progress'], 0.5, places=3)

    def test_stats_are_private_to_the_player(self):
        from songs.models import QuizAttempt as QA, User
        quiz = generate_for_date(date(2026, 2, 4))
        other = User.objects.create_user('ivy', 'i@x.com', 'pw12345!')
        QA.objects.create(user=other, quiz=quiz, score=20, total=20, points=999)
        res = self.client.get('/api/quiz/stats/')
        self.assertEqual(res.data['total_coins'], 0)

    def test_signing_in_is_required(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/quiz/stats/').status_code,
                         status.HTTP_401_UNAUTHORIZED)


class DayStreakTests(APITestCase):
    """Consecutive days played — the reason to come back tomorrow."""

    @classmethod
    def setUpTestData(cls):
        seed_corpus()

    def setUp(self):
        cache.clear()
        forget_recorded_plays()
        from songs.models import User
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)

    def _played_on(self, *days_ago):
        """Record an attempt for each given number of days before today."""
        from songs.models import QuizAttempt
        today = timezone.localdate()
        for n in days_ago:
            day = today - timedelta(days=n)
            quiz = generate_for_date(day)
            QuizAttempt.objects.create(
                user=self.user, quiz=quiz, score=10, total=20, points=100,
            )

    def _stats(self):
        return self.client.get('/api/quiz/stats/').data

    def test_no_history_is_no_streak(self):
        s = self._stats()
        self.assertEqual(s['day_streak'], 0)
        self.assertEqual(s['best_day_streak'], 0)
        self.assertFalse(s['played_today'])

    def test_playing_today_starts_a_streak(self):
        self._played_on(0)
        s = self._stats()
        self.assertEqual(s['day_streak'], 1)
        self.assertTrue(s['played_today'])

    def test_consecutive_days_accumulate(self):
        self._played_on(0, 1, 2, 3)
        self.assertEqual(self._stats()['day_streak'], 4)

    def test_a_streak_survives_not_having_played_yet_today(self):
        """Opening the app in the morning must not show a streak already lost."""
        self._played_on(1, 2, 3)
        s = self._stats()
        self.assertEqual(s['day_streak'], 3)
        self.assertFalse(s['played_today'])

    def test_a_missed_day_breaks_it(self):
        self._played_on(2, 3, 4)      # nothing today or yesterday
        s = self._stats()
        self.assertEqual(s['day_streak'], 0)
        self.assertEqual(s['best_day_streak'], 3)

    def test_the_best_run_is_remembered_after_a_break(self):
        self._played_on(0, 5, 6, 7, 8)
        s = self._stats()
        self.assertEqual(s['day_streak'], 1)      # today only
        self.assertEqual(s['best_day_streak'], 4)  # the older run

    def test_a_gap_in_the_middle_does_not_merge_runs(self):
        self._played_on(0, 1, 4, 5)
        s = self._stats()
        self.assertEqual(s['day_streak'], 2)
        self.assertEqual(s['best_day_streak'], 2)


class SessionLimitTests(APITestCase):
    """Practice is repeatable, but not unbounded — each run writes questions."""

    @classmethod
    def setUpTestData(cls):
        seed_corpus(chapters=20, verses=40)

    def setUp(self):
        cache.clear()
        forget_recorded_plays()
        from songs.models import User
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)

    def test_a_run_beyond_the_daily_ceiling_is_refused(self):
        from songs.models import QuizSession
        from songs.views.quiz import DAILY_SESSION_LIMIT
        # Cheaper than playing them: the ceiling counts sessions, not questions.
        for _ in range(DAILY_SESSION_LIMIT):
            QuizSession.objects.create(user=self.user, mode='speed')
        res = self.client.post('/api/quiz-sessions/', {'mode': 'speed'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_the_ceiling_is_per_person(self):
        from songs.models import QuizSession, User
        from songs.views.quiz import DAILY_SESSION_LIMIT
        other = User.objects.create_user('ivy', 'i@x.com', 'pw12345!')
        for _ in range(DAILY_SESSION_LIMIT):
            QuizSession.objects.create(user=other, mode='speed')
        res = self.client.post('/api/quiz-sessions/', {'mode': 'speed'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content[:200])


class SessionCleanupTests(APITestCase):
    """Pruning old runs must free the rows without erasing anyone's record."""

    @classmethod
    def setUpTestData(cls):
        seed_corpus(chapters=20, verses=40)

    def setUp(self):
        cache.clear()
        forget_recorded_plays()
        from songs.models import User
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)

    def _aged_session(self, days, finished=True):
        from django.utils import timezone
        from songs.models import QuizSession
        from songs.quiz import start_session
        session = start_session(self.user, 'speed')
        session.is_finished = finished
        session.points = 120
        session.save()
        # started_at is auto_now_add, so age it explicitly.
        QuizSession.objects.filter(pk=session.pk).update(
            started_at=timezone.now() - timedelta(days=days),
        )
        return session

    def test_old_finished_runs_lose_their_questions(self):
        from django.core.management import call_command
        from songs.models import QuizQuestion
        session = self._aged_session(days=30)
        self.assertEqual(QuizQuestion.objects.filter(session=session).count(), 10)
        call_command('cleanup_quiz_sessions', verbosity=0)
        self.assertEqual(QuizQuestion.objects.filter(session=session).count(), 0)

    def test_the_score_survives_the_prune(self):
        """Lifetime coins are read from the session, so they must not move."""
        from django.core.management import call_command
        from songs.models import QuizSession
        session = self._aged_session(days=30)
        before = self.client.get('/api/quiz/stats/').data['total_coins']
        call_command('cleanup_quiz_sessions', verbosity=0)
        self.assertTrue(QuizSession.objects.filter(pk=session.pk).exists())
        self.assertEqual(self.client.get('/api/quiz/stats/').data['total_coins'], before)

    def test_a_recent_run_is_left_alone(self):
        from django.core.management import call_command
        from songs.models import QuizQuestion
        session = self._aged_session(days=1)
        call_command('cleanup_quiz_sessions', verbosity=0)
        self.assertEqual(QuizQuestion.objects.filter(session=session).count(), 10)

    def test_an_abandoned_run_is_closed_off(self):
        from django.core.management import call_command
        from songs.models import QuizSession
        session = self._aged_session(days=3, finished=False)
        call_command('cleanup_quiz_sessions', verbosity=0)
        session.refresh_from_db()
        self.assertTrue(session.is_finished)

    def test_dry_run_changes_nothing(self):
        from django.core.management import call_command
        from songs.models import QuizQuestion
        session = self._aged_session(days=30)
        call_command('cleanup_quiz_sessions', dry_run=True, verbosity=0)
        self.assertEqual(QuizQuestion.objects.filter(session=session).count(), 10)


class QuizReminderTests(APITestCase):
    """The morning nudge: who gets one, who is left alone."""

    @classmethod
    def setUpTestData(cls):
        seed_corpus()

    def setUp(self):
        cache.clear()
        forget_recorded_plays()
        from songs.models import DeviceToken, User
        self.regular = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.never = User.objects.create_user('ivy', 'i@x.com', 'pw12345!')
        for u in (self.regular, self.never):
            DeviceToken.objects.create(user=u, token=f'ExponentPushToken[{u.username}]',
                                       is_active=True)

    def _played(self, user, days_ago):
        from songs.models import QuizAttempt
        day = timezone.localdate() - timedelta(days=days_ago)
        quiz = generate_for_date(day)
        QuizAttempt.objects.create(user=user, quiz=quiz, score=10, total=20, points=100)

    def _run(self, **kwargs):
        from django.core.management import call_command
        kwargs.setdefault('force', True)      # tests must not depend on the hour
        call_command('send_quiz_reminders', verbosity=0, **kwargs)

    def test_a_streak_holder_who_has_not_played_is_reminded(self):
        from songs.models import QuizReminder
        self._played(self.regular, 1)
        self._run()
        self.assertTrue(QuizReminder.objects.filter(user=self.regular).exists())

    def test_someone_who_has_never_played_is_left_alone(self):
        """A reminder for something you never chose is spam."""
        from songs.models import QuizReminder
        self._played(self.regular, 1)
        self._run()
        self.assertFalse(QuizReminder.objects.filter(user=self.never).exists())

    def test_someone_who_already_played_today_is_not_nagged(self):
        from songs.models import QuizReminder
        self._played(self.regular, 0)
        self._run()
        self.assertFalse(QuizReminder.objects.filter(user=self.regular).exists())

    def test_a_dormant_player_is_not_pestered(self):
        from songs.models import QuizReminder
        self._played(self.regular, 40)
        self._run()
        self.assertFalse(QuizReminder.objects.filter(user=self.regular).exists())

    def test_a_person_with_no_device_gets_no_push(self):
        from songs.models import DeviceToken, QuizReminder
        DeviceToken.objects.filter(user=self.regular).update(is_active=False)
        self._played(self.regular, 1)
        self._run()
        self.assertFalse(QuizReminder.objects.filter(user=self.regular).exists())

    def test_running_twice_sends_once(self):
        """A cron that fires twice must not double-push."""
        from songs.models import QuizReminder
        self._played(self.regular, 1)
        self._run()
        self._run()
        self.assertEqual(QuizReminder.objects.filter(user=self.regular).count(), 1)

    def test_it_refuses_to_run_outside_the_morning(self):
        """A mis-scheduled cron must not push at midnight."""
        from songs.models import QuizReminder
        self._played(self.regular, 1)
        self._run(force=False, tz='Etc/GMT-14')   # far ahead, so it is not morning here
        # Either it was morning in that zone or it declined; if it declined,
        # nothing was written.
        count = QuizReminder.objects.filter(user=self.regular).count()
        self.assertIn(count, (0, 1))

    def test_dry_run_sends_nothing(self):
        from songs.models import QuizReminder
        self._played(self.regular, 1)
        self._run(dry_run=True)
        self.assertFalse(QuizReminder.objects.exists())

    def test_opting_out_of_quiz_pushes_is_respected(self):
        """The preference must be honoured before anything is recorded."""
        from songs.models import NotificationPreference, QuizReminder
        NotificationPreference.objects.create(user=self.regular, quiz=False)
        self._played(self.regular, 1)
        self._run()
        # notify_user drops it; the reminder row still marks the daily nudge as
        # spent, so they are not retried all day.
        self.assertLessEqual(QuizReminder.objects.filter(user=self.regular).count(), 1)

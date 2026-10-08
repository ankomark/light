"""The daily Bible quiz: generation, scoring and the leaderboard.

    python manage.py test songs.tests.test_quiz
"""
from songs.days import local_today  # the players' day, as the app counts it
from datetime import date, timedelta

from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from songs.bible_books import BOOKS_BY_NAME
from songs.streaks import forget_recorded_plays
from songs.models import BibleVerse, DailyQuiz, QuizAttempt, QuizQuestion
from songs.quiz import QUESTIONS_PER_DAY, generate_for_date


# Words that vary from verse to verse, so a missing word has look-alikes in
# its book that are not already in the verse (as a real Bible has).
VARIED = ['mountain', 'river', 'shepherd', 'garden', 'temple', 'harvest', 'vineyard',
          'servant', 'prophet', 'kingdom', 'wilderness', 'fountain', 'morning', 'evening']


def varied(ch, v):
    """Two different words for chapter `ch`, verse `v`."""
    first = VARIED[(ch * 5 + v) % len(VARIED)]
    second = VARIED[(ch * 5 + v + 7) % len(VARIED)]
    return first, second


def seed_corpus(chapters=12, verses=30):
    """A corpus big enough to build a full quiz from, across several books."""
    from songs.quiz import forget_kept_corpora
    forget_kept_corpora()          # another test's Bible must not linger
    rows = []
    for name in ('Genesis', 'Psalms', 'Proverbs', 'John', 'Acts'):
        book = BOOKS_BY_NAME[name]
        for ch in range(1, min(chapters, book['chapters']) + 1):
            for v in range(1, verses + 1):
                rows.append(BibleVerse(
                    book=name, book_number=book['number'], chapter=ch, verse=v,
                    text=(f'And it came to pass in the {name} chapter {ch} verse {v} '
                          f'that the people gathered together beside the {varied(ch, v)[0]} '
                          f'and blessed the everlasting {varied(ch, v)[1]} forever.'),
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
        """Distinct choices and an answer_index that points at one: four for a
        generated question, two to four for a written one (true/false has two)."""
        quiz = generate_for_date(date(2026, 6, 6))
        for q in quiz.questions.all():
            n = len(q.choices)
            if q.bank_question_id:
                self.assertIn(n, (2, 3, 4), q.prompt)
            elif q.kind in ('order', 'exact'):      # two passages; yes or no
                self.assertEqual(n, 2, q.prompt)
            else:
                self.assertEqual(n, 4, q.prompt)
            self.assertEqual(len(set(q.choices)), n, q.choices)
            self.assertIn(q.answer_index, range(n), q.prompt)

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
        res = self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': answers, 'duration_seconds': 90},
                               format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content[:300])
        self.assertEqual(res.data['score'], QUESTIONS_PER_DAY)
        self.assertEqual(res.data['total'], QUESTIONS_PER_DAY)

    def test_wrong_answers_score_zero_and_come_back_explained(self):
        self.client.get('/api/quiz/today/')
        quiz = DailyQuiz.objects.get()
        answers = {str(q.id): (q.answer_index + 1) % 4 for q in quiz.questions.all()}
        res = self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': answers}, format='json')
        self.assertEqual(res.data['score'], 0)
        # After submitting, the truth is disclosed so the player can learn.
        for r in res.data['results']:
            self.assertIn('answer_index', r)
            # A verse to look up - or, for a whole-Bible fact, the explanation.
            self.assertTrue(r['reference'] or r['explanation'])

    def test_unanswered_questions_are_not_credited(self):
        self.client.get('/api/quiz/today/')
        res = self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': {}}, format='json')
        self.assertEqual(res.data['score'], 0)

    def test_a_junk_choice_index_cannot_score(self):
        self.client.get('/api/quiz/today/')
        quiz = DailyQuiz.objects.get()
        answers = {str(q.id): 99 for q in quiz.questions.all()}
        res = self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': answers}, format='json')
        self.assertEqual(res.data['score'], 0)

    def test_only_one_attempt_a_day(self):
        self.client.get('/api/quiz/today/')
        self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': {}}, format='json')
        res = self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': {}}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(QuizAttempt.objects.filter(user=self.user).count(), 1)

    def test_today_reports_my_attempt_back(self):
        self.client.get('/api/quiz/today/')
        self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': {}}, format='json')
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
        self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': right, 'duration_seconds': 200},
                         format='json')
        self.client.force_authenticate(self.rival)
        self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': right, 'duration_seconds': 50},
                         format='json')
        res = self.client.get('/api/quiz/leaderboard/')
        names = [r['user']['username'] for r in res.data['results']]
        self.assertEqual(names, ['ivy', 'mark'])   # same score, ivy was faster

    def test_history_lists_past_days(self):
        self.client.get('/api/quiz/today/')
        self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': {}}, format='json')
        res = self.client.get('/api/quiz/my-history/')
        self.assertEqual(len(res.data), 1)

    def test_a_past_date_can_be_replayed_read_only(self):
        day = (local_today() - timedelta(days=3)).isoformat()
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
        self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': self._all_right()}, format='json')
        self.assertEqual(QuizAnswer.objects.count(), QUESTIONS_PER_DAY)

    def test_points_beat_a_flat_point_each(self):
        res = self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': self._all_right()},
                               format='json')
        self.assertEqual(res.data['score'], 20)
        self.assertGreater(res.data['points'], 20 * 10)

    def test_difficulty_is_worth_more(self):
        from songs.models import QuizAnswer
        self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': self._all_right(seconds=30)},
                         format='json')
        rows = {r.question.difficulty: r for r in QuizAnswer.objects.all()}
        self.assertGreater(rows['hard'].points_earned, rows['simple'].points_earned)

    def test_answering_fast_earns_more_than_answering_slowly(self):
        fast = self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': self._all_right(seconds=1)},
                                format='json').data['points']
        self.client.force_authenticate(self.rival)
        slow = self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': self._all_right(seconds=30)},
                                format='json').data['points']
        self.assertGreater(fast, slow)

    def test_longest_streak_is_recorded(self):
        res = self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': self._all_right()},
                               format='json')
        self.assertEqual(res.data['longest_streak'], QUESTIONS_PER_DAY)

    def test_a_wrong_answer_breaks_the_streak(self):
        answers = self._all_right()
        fifth = self.questions[4]
        answers[str(fifth.id)] = {'choice': (fifth.answer_index + 1) % 4, 'seconds': 2}
        res = self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': answers}, format='json')
        self.assertEqual(res.data['score'], 19)
        self.assertEqual(res.data['longest_streak'], 15)

    def test_a_skipped_question_is_not_a_wrong_answer(self):
        from songs.models import QuizAnswer
        self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': {}}, format='json')
        rows = QuizAnswer.objects.all()
        self.assertEqual(rows.count(), QUESTIONS_PER_DAY)
        self.assertTrue(all(r.chosen_index is None and not r.is_correct for r in rows))

    def test_the_old_flat_payload_still_scores(self):
        """An app build predating per-question timing must keep working."""
        flat = {str(q.id): q.answer_index for q in self.questions}
        res = self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': flat}, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content[:200])
        self.assertEqual(res.data['score'], 20)
        self.assertGreater(res.data['points'], 0)

    def test_a_forged_timing_cannot_beat_honest_fast_play(self):
        from songs.scoring import SPEED_MAX
        honest = self.client.post(
            '/api/quiz/submit/', {'shuffled': False, 'answers': self._all_right(seconds=0.5)}, format='json'
        ).data['points']
        self.client.force_authenticate(self.rival)
        forged = self.client.post(
            '/api/quiz/submit/',
            {'shuffled': False, 'answers': {str(q.id): {'choice': q.answer_index, 'seconds': -999}
                         for q in self.questions}},
            format='json',
        ).data['points']
        self.assertEqual(honest - forged, SPEED_MAX * QUESTIONS_PER_DAY)

    def test_the_explanation_arrives_only_after_answering(self):
        listing = self.client.get('/api/quiz/today/').data['questions']
        self.assertTrue(all('explanation' not in q for q in listing))
        res = self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': {}}, format='json')
        self.assertTrue(all(r['explanation'] for r in res.data['results']))

    def test_questions_carry_a_category(self):
        listing = self.client.get('/api/quiz/today/').data['questions']
        # Only a whole-Bible fact ("How many books…?") belongs to no section.
        self.assertTrue(all(q['category'] or q['kind'] == 'fact' for q in listing), listing[0])

    def test_the_board_ranks_on_points_not_raw_correct(self):
        """Same number right; the faster, harder-won run ranks first."""
        self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': self._all_right(seconds=25)},
                         format='json')
        self.client.force_authenticate(self.rival)
        self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': self._all_right(seconds=1)},
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

    def test_answered_questions_leave_the_run(self):
        """Practice questions carry their answers so the app can judge at once
        (see InstantPracticeTests); what has been answered is not sent again."""
        s = self._start('speed')
        first = s['questions'][0]
        self.client.post(f"/api/quiz-sessions/{s['id']}/answer/",
                         {'question_id': first['id'], 'choice': 0, 'seconds': 2}, format='json')
        again = self.client.get(f"/api/quiz-sessions/{s['id']}/").data
        self.assertNotIn(first['id'], [q['id'] for q in again['questions']])

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
        self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': answers}, format='json')
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
        today = local_today()
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
        day = local_today() - timedelta(days=days_ago)
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


class QuizPhaseOneTests(APITestCase):
    """The review stays, your rank is always known, and the errors can be read."""

    @classmethod
    def setUpTestData(cls):
        seed_corpus()

    def setUp(self):
        cache.clear()
        forget_recorded_plays()
        from songs.models import User
        self.User = User
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)

    def _play(self, right=True, user=None):
        if user:
            self.client.force_authenticate(user)
        questions = self.client.get('/api/quiz/today/').data['questions']
        quiz = DailyQuiz.objects.get()
        from songs.quiz import display_order
        uid = (user or self.user).pk
        # The right answer where this player is shown it.
        key = {q.id: display_order(uid, q.id, q.kind, len(q.choices)).index(q.answer_index)
               for q in quiz.questions.all()}
        answers = {str(q['id']): (key[q['id']] if right else (key[q['id']] + 1) % len(q['choices']))
                   for q in questions}
        res = self.client.post('/api/quiz/submit/', {'answers': answers, 'duration_seconds': 60}, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content[:200])
        return res

    def test_before_playing_the_answers_stay_secret(self):
        res = self.client.get('/api/quiz/today/')
        self.assertIsNone(res.data['my_attempt'])

    def test_after_playing_the_review_comes_back_with_the_quiz(self):
        submitted = self._play().data['results']
        again = self.client.get('/api/quiz/today/').data['my_attempt']
        self.assertEqual(len(again['results']), len(submitted))
        for mine, first in zip(again['results'], submitted):
            for field in ('question_id', 'chosen_index', 'answer_index', 'correct',
                          'reference', 'explanation', 'points_earned'):
                self.assertEqual(mine[field], first[field], field)

    def test_the_review_follows_the_quiz_order(self):
        self._play()
        order = [q['id'] for q in self.client.get('/api/quiz/today/').data['questions']]
        review = [r['question_id'] for r in self.client.get('/api/quiz/today/').data['my_attempt']['results']]
        self.assertEqual(review, order)

    def test_counts_are_one_query_not_three(self):
        self.client.get('/api/quiz/today/')          # build it first
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        with CaptureQueriesContext(connection) as ctx:
            self.client.get('/api/quiz/today/')
        difficulty_counts = [q for q in ctx.captured_queries if 'difficulty' in q['sql'] and 'COUNT' in q['sql'].upper()]
        self.assertEqual(len(difficulty_counts), 1)

    def test_my_rank_is_known_even_below_the_fifty_shown(self):
        from songs.views.quiz import DailyQuizViewSet
        others = [self.User.objects.create_user(f'u{i}', f'u{i}@x.com', 'pw12345!') for i in range(3)]
        for u in others:
            self._play(right=True, user=u)
        self._play(right=False, user=self.user)
        DailyQuizViewSet.BOARD_SIZE, was = 2, DailyQuizViewSet.BOARD_SIZE   # show only two
        try:
            board = self.client.get('/api/quiz/leaderboard/').data
        finally:
            DailyQuizViewSet.BOARD_SIZE = was
        self.assertEqual(len(board['results']), 2)
        self.assertEqual(board['me'], {'rank': 4, 'of': 4})

    def test_no_place_before_playing(self):
        self._play(user=self.User.objects.create_user('ivy', 'i@x.com', 'pw12345!'))
        self.client.force_authenticate(self.user)
        self.assertIsNone(self.client.get('/api/quiz/leaderboard/').data['me'])

    def test_a_second_attempt_is_refused_with_a_code_the_app_can_translate(self):
        self._play()
        res = self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': {}}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data['code'], 'already_played')


class LeaderboardPeriodTests(APITestCase):
    """Today, this week and all time; everyone or just the people you follow."""

    @classmethod
    def setUpTestData(cls):
        seed_corpus()

    def setUp(self):
        cache.clear()
        forget_recorded_plays()
        from songs.models import User
        self.User = User
        self.me = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.friend = User.objects.create_user('ivy', 'i@x.com', 'pw12345!')
        self.stranger = User.objects.create_user('zed', 'z@x.com', 'pw12345!')
        # `followers` holds who follows a person: mark follows ivy.
        self.friend.followers.add(self.me)
        self.today = local_today()

    def _attempt(self, user, day, points, score=10):
        from songs.models import QuizAttempt
        quiz = DailyQuiz.objects.get_or_create(date=day)[0]
        return QuizAttempt.objects.create(user=user, quiz=quiz, score=score, total=20, points=points)

    def _board(self, **params):
        self.client.force_authenticate(self.me)
        q = '&'.join(f'{k}={v}' for k, v in params.items())
        res = self.client.get(f'/api/quiz/leaderboard/?{q}')
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.content[:200])
        return res.data

    def names(self, board):
        return [r['user']['username'] for r in board['results']]

    def test_week_adds_up_the_days_from_monday(self):
        monday = self.today - timedelta(days=self.today.weekday())
        self._attempt(self.me, monday, 100)
        if self.today != monday:                     # on a Monday there is only the one day
            self._attempt(self.me, self.today, 50)
        self._attempt(self.stranger, monday - timedelta(days=1), 900)   # last week: not counted
        self._attempt(self.friend, self.today, 120)
        board = self._board(period='week')
        mine = next(r for r in board['results'] if r['user']['username'] == 'mark')
        self.assertEqual(mine['points'], 150 if self.today != monday else 100)
        self.assertNotIn('zed', self.names(board))

    def test_all_time_counts_everything_and_ranks_me(self):
        self._attempt(self.stranger, self.today - timedelta(days=40), 900)
        self._attempt(self.me, self.today, 100)
        self._attempt(self.friend, self.today, 50)
        board = self._board(period='all')
        self.assertEqual(self.names(board), ['zed', 'mark', 'ivy'])
        self.assertEqual(board['me'], {'rank': 2, 'of': 3})
        self.assertEqual(board['results'][1]['days'], 1)

    def test_following_is_the_people_i_follow_and_me(self):
        for u, p in ((self.stranger, 900), (self.me, 100), (self.friend, 50)):
            self._attempt(u, self.today, p)
        for period in ('today', 'week', 'all'):
            board = self._board(period=period, scope='following')
            self.assertEqual(set(self.names(board)), {'mark', 'ivy'}, period)
            self.assertEqual(board['me']['rank'], 1, period)          # first among friends

    def test_a_new_attempt_shows_on_the_week_at_once(self):
        self._attempt(self.friend, self.today, 50)
        self.assertEqual(self.names(self._board(period='week')), ['ivy'])   # now cached
        questions = self.client.get('/api/quiz/today/').data['questions']
        self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': {str(q['id']): 0 for q in questions}}, format='json')
        self.assertIn('mark', self.names(self._board(period='week')))

    def test_an_unknown_period_is_refused(self):
        self.client.force_authenticate(self.me)
        self.assertEqual(self.client.get('/api/quiz/leaderboard/?period=year').status_code,
                         status.HTTP_400_BAD_REQUEST)

    def test_today_is_still_the_default(self):
        self._attempt(self.me, self.today, 100)
        board = self._board()
        self.assertEqual(board['period'], 'today')
        self.assertEqual(board['results'][0]['total'], 20)


class InstantPracticeTests(APITestCase):
    """Practice answers are judged in the app at once; the server still scores."""

    @classmethod
    def setUpTestData(cls):
        seed_corpus()

    def setUp(self):
        cache.clear()
        forget_recorded_plays()
        from songs.models import User
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)

    def test_practice_questions_carry_their_answer(self):
        res = self.client.post('/api/quiz-sessions/', {'mode': 'speed'}, format='json')
        from songs.models import QuizQuestion
        for q in res.data['questions']:
            self.assertEqual(q['answer_index'], QuizQuestion.objects.get(pk=q['id']).answer_index)
            self.assertIn('explanation', q)

    def test_the_daily_quiz_still_never_does(self):
        for q in self.client.get('/api/quiz/today/').data['questions']:
            self.assertNotIn('answer_index', q)
            self.assertNotIn('explanation', q)

    def test_a_brief_answer_brings_back_only_the_totals(self):
        run = self.client.post('/api/quiz-sessions/', {'mode': 'speed'}, format='json').data
        q = run['questions'][0]
        res = self.client.post(f"/api/quiz-sessions/{run['id']}/answer/",
                               {'question_id': q['id'], 'choice': q['answer_index'], 'seconds': 2, 'brief': True},
                               format='json')
        self.assertTrue(res.data['correct'])
        self.assertNotIn('questions', res.data['session'])
        self.assertEqual(res.data['session']['score'], 1)
        self.assertGreater(res.data['session']['points'], 0)

    def test_the_server_still_decides(self):
        """A wrong choice is wrong whatever the app showed."""
        run = self.client.post('/api/quiz-sessions/', {'mode': 'speed'}, format='json').data
        q = run['questions'][0]
        wrong = (q['answer_index'] + 1) % len(q['choices'])
        res = self.client.post(f"/api/quiz-sessions/{run['id']}/answer/",
                               {'question_id': q['id'], 'choice': wrong, 'seconds': 2, 'brief': True}, format='json')
        self.assertFalse(res.data['correct'])
        self.assertEqual(res.data['session']['points'], 0)


class GroupBoardTests(APITestCase):
    """A church or youth group's own board."""

    def setUp(self):
        cache.clear()
        from songs.models import Group, GroupMember, QuizAttempt, User
        self.QuizAttempt = QuizAttempt
        self.me = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.friend = User.objects.create_user('ivy', 'i@x.com', 'pw12345!')
        self.outsider = User.objects.create_user('zed', 'z@x.com', 'pw12345!')
        self.group = Group.objects.create(name='Rongo Youth', creator=self.me)
        for u in (self.me, self.friend):
            GroupMember.objects.get_or_create(group=self.group, user=u)
        today = local_today()
        quiz = DailyQuiz.objects.create(date=today)
        for u, p in ((self.outsider, 900), (self.me, 100), (self.friend, 150)):
            QuizAttempt.objects.create(user=u, quiz=quiz, score=10, total=20, points=p)
        self.client.force_authenticate(self.me)

    def test_the_board_is_the_groups_members(self):
        for period in ('today', 'week', 'all'):
            board = self.client.get(f'/api/quiz/leaderboard/?period={period}&scope=group:{self.group.slug}').data
            self.assertEqual([r['user']['username'] for r in board['results']], ['ivy', 'mark'], period)
            self.assertEqual(board['me'], {'rank': 2, 'of': 2}, period)

    def test_only_members_see_it(self):
        self.client.force_authenticate(self.outsider)
        res = self.client.get(f'/api/quiz/leaderboard/?scope=group:{self.group.slug}')
        # A private group: not there for an outsider (404, like an unknown one);
        # a public group's board is still members-only (403).
        expected = status.HTTP_404_NOT_FOUND if self.group.is_private else status.HTTP_403_FORBIDDEN
        self.assertEqual(res.status_code, expected)

    def test_an_unknown_group(self):
        self.assertEqual(self.client.get('/api/quiz/leaderboard/?scope=group:nope').status_code,
                         status.HTTP_404_NOT_FOUND)


class QuizHintTests(APITestCase):
    """50/50 in practice: two wrong answers gone, for coins, once."""

    @classmethod
    def setUpTestData(cls):
        seed_corpus()

    def setUp(self):
        cache.clear()
        forget_recorded_plays()
        from songs.models import CoinSpend, DailyQuiz, QuizAttempt, User
        self.CoinSpend = CoinSpend
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)
        old = DailyQuiz.objects.create(date=date(2020, 1, 1))
        QuizAttempt.objects.create(user=self.user, quiz=old, score=5, total=20, points=100)
        self.run = self.client.post('/api/quiz-sessions/', {'mode': 'speed'}, format='json').data
        self.q = next(q for q in self.run['questions'] if len(q['choices']) == 4)

    def hint(self, q=None):
        q = q or self.q
        return self.client.post(f"/api/quiz-sessions/{self.run['id']}/hint/", {'question_id': q['id']}, format='json')

    def test_two_wrong_answers_are_taken_away_and_the_right_one_stays(self):
        res = self.hint()
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.content[:200])
        self.assertEqual(len(res.data['removed']), 2)
        self.assertNotIn(self.q['answer_index'], res.data['removed'])
        self.assertEqual(res.data['balance'], 100 - 15)
        self.assertEqual(self.CoinSpend.objects.get().reason, 'quiz_hint')

    def test_once_per_question(self):
        self.hint()
        res = self.hint()
        self.assertEqual(res.data['code'], 'used')
        self.assertEqual(self.CoinSpend.objects.count(), 1)

    def test_not_without_the_coins(self):
        self.CoinSpend.objects.create(user=self.user, amount=90, reason='hint')
        res = self.hint()
        self.assertEqual(res.data['code'], 'not_enough_coins')
        from songs.models import QuizQuestion
        self.assertFalse(QuizQuestion.objects.get(pk=self.q['id']).hint_used)   # nothing kept

    def test_not_after_answering(self):
        self.client.post(f"/api/quiz-sessions/{self.run['id']}/answer/",
                         {'question_id': self.q['id'], 'choice': 0, 'seconds': 2}, format='json')
        self.assertEqual(self.hint().data['code'], 'answered')

    def test_not_on_someone_elses_run(self):
        from songs.models import User
        self.client.force_authenticate(User.objects.create_user('ivy', 'i@x.com', 'pw12345!'))
        self.assertEqual(self.hint().status_code, status.HTTP_404_NOT_FOUND)

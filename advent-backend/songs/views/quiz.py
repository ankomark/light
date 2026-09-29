"""The daily Bible quiz.

There is no scheduler on this deploy, so the day's quiz is built on first
request and then kept — everyone who plays that date gets the same twenty
questions, which is what makes the leaderboard comparable.
"""
from datetime import date as date_cls, timedelta

from django.db.models import Count, Max, Sum

from .common import *  # noqa: F401,F403
from ..models import (
    DailyQuiz, PuzzleProgress, QuizAnswer, QuizAttempt, QuizQuestion, QuizSession,
    VerseDay,
)
from ..modes import DAILY, MODES, config
from ..quiz import generate_for_date, record_bank_answers, start_session
from ..scoring import coin_balance, level_for, score_answer
from ..streaks import day_streaks, streak_for
from ..serializers.quiz import (
    DailyQuizSerializer, QuizAttemptSerializer, QuizSessionSerializer,
)


# How many practice runs one person may start in a day. Generous — this is a
# guard on runaway row growth, not a limit anyone should feel.
DAILY_SESSION_LIMIT = 40


def _as_float(value):
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        return None
    # Store only a sane reading; the scorer ignores nonsense anyway.
    return seconds if 0 <= seconds < 86400 else None


def _quiz_for(day):
    """The stored quiz for `day`, generating it the first time it is asked for."""
    quiz = DailyQuiz.objects.filter(date=day).first()
    if quiz:
        return quiz
    try:
        return generate_for_date(day)
    except ValueError as exc:
        # The corpus is empty or too thin — a real 503, not a broken quiz.
        raise APIException(str(exc))


def _read_answer(answers, question):
    """(chosen_index, response_seconds) from either payload shape.

    The app used to send {question_id: choice_index}; it now sends
    {question_id: {"choice": n, "seconds": s}} so the speed bonus has something
    to work with. Both are accepted — an older build must keep scoring.
    """
    raw = answers.get(str(question.id), answers.get(question.id))
    chosen = seconds = None
    if isinstance(raw, bool):
        return None, None                     # bool is an int in Python; reject it
    if isinstance(raw, int):
        chosen = raw
    elif isinstance(raw, dict):
        value = raw.get('choice')
        if isinstance(value, int) and not isinstance(value, bool):
            chosen = value
        seconds = raw.get('seconds')
    if chosen is None or not (0 <= chosen < len(question.choices)):
        chosen = None
    return chosen, seconds


BOARD_VERSION_KEY = 'quiz-board:version'


def _board_version():
    return cache.get(BOARD_VERSION_KEY) or 0


def _bump_board_version():
    """A new attempt changes the week and all-time boards: move every cached
    one aside rather than finding and deleting each."""
    cache.set(BOARD_VERSION_KEY, _board_version() + 1, None)


class DailyQuizViewSet(viewsets.GenericViewSet):
    """Read today's quiz, submit an attempt, read the board."""
    permission_classes = [IsAuthenticated]
    serializer_class = DailyQuizSerializer
    throttle_scope = 'quiz'

    def _day(self, request):
        raw = request.query_params.get('date')
        if not raw:
            return timezone.localdate()
        try:
            return date_cls.fromisoformat(raw)
        except ValueError:
            raise ValidationError({'date': 'Use YYYY-MM-DD.'})

    @action(detail=False, methods=['get'])
    def today(self, request):
        quiz = _quiz_for(self._day(request))
        return Response(self.get_serializer(quiz).data)

    @action(detail=False, methods=['post'])
    def submit(self, request):
        """Score an attempt. One per person per day — the score has to mean
        something on the board, so a second run is refused rather than
        overwriting a worse (or better) first try."""
        day = self._day(request)
        quiz = _quiz_for(day)

        if QuizAttempt.objects.filter(quiz=quiz, user=request.user).exists():
            return Response(
                {'error': 'You have already played today. Come back tomorrow.',
                 'code': 'already_played'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        answers = request.data.get('answers') or {}
        if not isinstance(answers, dict):
            raise ValidationError({'answers': 'Expected {question_id: choice_index}.'})

        duration = request.data.get('duration_seconds')
        try:
            duration = int(duration) if duration is not None else None
        except (TypeError, ValueError):
            duration = None

        questions = list(quiz.questions.all())
        score = points = streak = longest = 0
        results, cleaned, rows = [], {}, []

        for q in questions:
            chosen, seconds = _read_answer(answers, q)
            correct = chosen is not None and chosen == q.answer_index

            # A streak is consecutive correct answers in question order; a wrong
            # or skipped one ends it.
            streak = streak + 1 if correct else 0
            longest = max(longest, streak)

            earned, parts = score_answer(q.difficulty, correct, seconds, streak)
            if correct:
                score += 1
            points += earned
            if chosen is not None:
                cleaned[str(q.id)] = chosen

            rows.append(QuizAnswer(
                question=q, chosen_index=chosen, is_correct=correct,
                points_earned=earned, response_seconds=seconds, streak_after=streak,
            ))
            results.append({
                'question_id': q.id,
                'chosen_index': chosen,
                'answer_index': q.answer_index,
                'correct': correct,
                'reference': q.reference,
                'explanation': q.explanation,
                'points_earned': earned,
                'points_breakdown': parts,
                'streak_after': streak,
            })

        with transaction.atomic():
            attempt = QuizAttempt.objects.create(
                user=request.user, quiz=quiz, score=score, total=len(questions),
                points=points, longest_streak=longest,
                answers=cleaned, duration_seconds=duration,
            )
            for row in rows:
                row.attempt = attempt
            QuizAnswer.objects.bulk_create(rows)
        _bump_board_version()
        # Written questions keep a record of how they are answered.
        record_bank_answers((r.question.bank_question_id, r.is_correct) for r in rows)

        return Response({
            'attempt': QuizAttemptSerializer(attempt).data,
            'score': score,
            'total': len(questions),
            'points': points,
            'longest_streak': longest,
            'results': results,
        }, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'])
    def leaderboard(self, request):
        """A board of the daily quiz.

        `period`: `today` (the default) ranks the day's attempts on points —
        difficulty and speed are part of the achievement, so a careful 17 can
        outrank a lucky 17; ties fall back to correct answers, then time, then
        who finished first. `week` (Monday to today) and `all` rank each
        person's summed daily points, then correct answers, then days played.

        `scope=following` narrows any of them to the people you follow, and
        you: a board you can actually climb.

        `me` is your own place on it, even below the fifty shown.
        """
        period = request.query_params.get('period') or 'today'
        if period not in self.PERIODS:
            raise ValidationError({'period': 'Use today, week or all.'})
        day = self._day(request)
        circle = None
        if request.query_params.get('scope') == 'following':
            circle = set(request.user.followed_by.values_list('id', flat=True)) | {request.user.pk}

        if period == 'today':
            quiz = DailyQuiz.objects.filter(date=day).first()
            if not quiz:
                return Response({'date': day, 'period': period, 'results': [], 'me': None})
            ranked = quiz.attempts.order_by(*self.BOARD_ORDER)
            if circle is not None:
                ranked = ranked.filter(user_id__in=circle)
            attempts = ranked.select_related('user', 'user__profile')[:self.BOARD_SIZE]
            return Response({
                'date': quiz.date,
                'period': period,
                'results': QuizAttemptSerializer(attempts, many=True).data,
                'me': self._my_place(ranked, request.user),
            })

        rows = self._totals(period, day)
        if circle is not None:
            rows = [r for r in rows if r['user_id'] in circle]
        top = rows[:self.BOARD_SIZE]
        users = User.objects.select_related('profile').in_bulk([r['user_id'] for r in top])
        mine = next((i for i, r in enumerate(rows) if r['user_id'] == request.user.pk), None)
        return Response({
            'date': day,
            'period': period,
            'results': [
                {
                    'id': f"{period}-{r['user_id']}",
                    'user': SimpleUserSerializer(users[r['user_id']]).data,
                    'points': r['points'], 'score': r['score'], 'days': r['days'],
                }
                for r in top if r['user_id'] in users
            ],
            'me': None if mine is None else {'rank': mine + 1, 'of': len(rows)},
        })

    PERIODS = ('today', 'week', 'all')
    BOARD_ORDER = ('-points', '-score', 'duration_seconds', 'completed_at')
    BOARD_SIZE = 50
    # The week and all-time boards add up many attempts: kept for a few
    # minutes, and dropped the moment anyone submits (see _board_version).
    BOARD_CACHE_SECONDS = 300

    @classmethod
    def _totals(cls, period, day):
        """Everyone's summed daily results for the period, best first, as
        [{user_id, points, score, days}]."""
        start = day - timedelta(days=day.weekday()) if period == 'week' else None
        key = 'quiz-board:%s:%s:%s:%s' % (_board_version(), period, start or 'all', day)
        rows = cache.get(key)
        if rows is None:
            qs = QuizAttempt.objects.filter(quiz__date__lte=day)
            if start:
                qs = qs.filter(quiz__date__gte=start)
            rows = list(
                qs.values('user_id')
                .annotate(points=Sum('points'), score=Sum('score'), days=Count('id'))
                .order_by('-points', '-score', '-days', 'user_id')
            )
            cache.set(key, rows, cls.BOARD_CACHE_SECONDS)
        return rows

    @staticmethod
    def _my_place(ranked, user):
        users = list(ranked.values_list('user_id', flat=True))
        if user.pk not in users:
            return None
        return {'rank': users.index(user.pk) + 1, 'of': len(users)}


    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Lifetime progress: every coin ever earned, and what it adds up to.

        Coins come from both places a person plays — the daily quiz and the
        practice modes — because a total that ignored half of them would be a
        lie about how much someone has played.
        """
        attempts = QuizAttempt.objects.filter(user=request.user)
        sessions = QuizSession.objects.filter(user=request.user)

        daily = attempts.aggregate(
            coins=Sum('points'), days=Count('id'),
            best_day=Max('points'), best_run=Max('longest_streak'),
        )
        practice = sessions.aggregate(
            coins=Sum('points'), runs=Count('id'), best_run=Max('longest_streak'),
        )
        puzzle_coins = (PuzzleProgress.objects.filter(user=request.user)
                        .aggregate(n=Sum('coins_earned'))['n'] or 0)

        current_days, best_days, played_today = streak_for(request.user)

        # One purse across quiz and puzzle, minus what hints have spent.
        earned, spent, balance = coin_balance(request.user)

        # The level follows what was EARNED, never the balance. Spending coins
        # on a hint must not demote someone — a level is a record of play, not
        # of savings.
        level, this_level, next_level = level_for(earned)
        span = max(1, next_level - this_level)

        from ..quiz_progress import freeze_offer

        return Response({
            # What they have to spend.
            'total_coins': balance,
            # A streak broken yesterday that coins can still buy back.
            'freeze': freeze_offer(request.user),
            'coins_earned': earned,
            'coins_spent': spent,
            'daily_coins': daily['coins'] or 0,
            'practice_coins': practice['coins'] or 0,
            'puzzle_coins': puzzle_coins,
            'level': level,
            'level_start': this_level,
            'level_end': next_level,
            # Ready to render as a bar without the client redoing the maths.
            'level_progress': round(min(1.0, max(0.0, (earned - this_level) / span)), 4),
            'coins_to_next': max(0, next_level - earned),
            'day_streak': current_days,
            'best_day_streak': best_days,
            'played_today': played_today,
            'days_played': daily['days'] or 0,
            'runs_played': practice['runs'] or 0,
            'best_day': daily['best_day'] or 0,
            'best_run': max(daily['best_run'] or 0, practice['best_run'] or 0),
        })

    @action(detail=False, methods=['get'])
    def progress(self, request):
        """History, the calendar, badges, strengths and the freeze offer — the
        progress screen in one request."""
        from ..quiz_progress import progress_for
        return Response(progress_for(request.user))

    @action(detail=False, methods=['post'])
    def freeze(self, request):
        """Buy back yesterday: coins spent, the day streak restored."""
        from ..quiz_progress import FreezeRefused, buy_freeze
        try:
            streak = buy_freeze(request.user)
        except FreezeRefused as refused:
            return Response({'code': refused.code}, status=status.HTTP_400_BAD_REQUEST)
        return Response(streak, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], url_path='my-history')
    def my_history(self, request):
        # Order before slicing — a sliced queryset cannot be reordered.
        attempts = (QuizAttempt.objects.filter(user=request.user)
                    .select_related('quiz')
                    .order_by('-quiz__date')[:30])
        return Response([
            {
                'date': a.quiz.date, 'score': a.score, 'total': a.total,
                'points': a.points, 'longest_streak': a.longest_streak,
                'completed_at': a.completed_at,
            }
            for a in attempts
        ])


class QuizSessionViewSet(viewsets.GenericViewSet):
    """Speed Quiz and Streak — personal practice runs.

    Unlike the daily quiz these are answered one question at a time. Streak has
    to know the moment you are wrong, and Speed has to time each question
    separately, so a single submission at the end would not do.
    """
    permission_classes = [IsAuthenticated]
    serializer_class = QuizSessionSerializer
    throttle_scope = 'quiz'

    def get_queryset(self):
        # A session is private to whoever is playing it — otherwise its
        # questions (and the answers behind them) would be readable by anyone.
        return QuizSession.objects.filter(user=self.request.user)

    def create(self, request):
        """Start a run. POST {"mode": "speed" | "streak"}."""
        mode = request.data.get('mode')
        if mode not in MODES or mode == DAILY:
            raise ValidationError({
                'mode': 'Choose one of: %s.' % ', '.join(m for m in MODES if m != DAILY),
            })

        # Every run generates its own questions (10 for Speed, 40 for Streak),
        # so unlimited practice is unlimited rows. Far above anyone's honest
        # appetite for a day, and it bounds the table.
        today = timezone.localdate()
        played_today = QuizSession.objects.filter(
            user=request.user, started_at__date=today,
        ).count()
        if played_today >= DAILY_SESSION_LIMIT:
            return Response(
                {'error': 'That is %d practice runs today. Come back tomorrow.'
                          % DAILY_SESSION_LIMIT},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        try:
            session = start_session(request.user, mode)
        except ValueError as exc:
            raise APIException(str(exc))
        return Response(self.get_serializer(session).data, status=status.HTTP_201_CREATED)

    def retrieve(self, request, pk=None):
        return Response(self.get_serializer(self.get_object()).data)

    @action(detail=True, methods=['post'])
    def answer(self, request, pk=None):
        """Answer one question and be told immediately.

        POST {"question_id": n, "choice": i, "seconds": s}
        """
        session = self.get_object()
        cfg = config(session.mode)

        if session.is_finished:
            return Response({'error': 'This run is already over.'},
                            status=status.HTTP_400_BAD_REQUEST)

        question = session.questions.filter(pk=request.data.get('question_id')).first()
        if not question:
            raise ValidationError({'question_id': 'Not a question in this run.'})
        if QuizAnswer.objects.filter(session=session, question=question).exists():
            return Response({'error': 'You have already answered that one.'},
                            status=status.HTTP_400_BAD_REQUEST)

        raw = request.data.get('choice')
        chosen = raw if isinstance(raw, int) and not isinstance(raw, bool) else None
        if chosen is not None and not (0 <= chosen < len(question.choices)):
            chosen = None

        seconds = request.data.get('seconds')
        # A per-question clock is part of the rules, not decoration: running out
        # of time is a wrong answer, and the server decides that, not the app.
        limit = cfg.get('time_limit')
        timed_out = False
        if limit is not None:
            try:
                timed_out = seconds is not None and float(seconds) > limit
            except (TypeError, ValueError):
                timed_out = False

        correct = (not timed_out) and chosen is not None and chosen == question.answer_index

        streak = session.streak + 1 if correct else 0
        earned, parts = score_answer(
            question.difficulty, correct, seconds, streak, profile=cfg,
        )

        with transaction.atomic():
            QuizAnswer.objects.create(
                session=session, question=question, chosen_index=chosen,
                is_correct=correct, points_earned=earned,
                response_seconds=_as_float(seconds), streak_after=streak,
            )
            session.answered += 1
            session.points += earned
            session.streak = streak
            session.longest_streak = max(session.longest_streak, streak)
            if correct:
                session.score += 1
            # Streak mode ends on the first miss; every mode ends when the
            # questions run out.
            if (cfg['ends_on_wrong'] and not correct) or session.answered >= session.questions.count():
                session.is_finished = True
                session.finished_at = timezone.now()
            session.save()
        record_bank_answers([(question.bank_question_id, correct)])

        return Response({
            'correct': correct,
            'timed_out': timed_out,
            'answer_index': question.answer_index,
            'reference': question.reference,
            'explanation': question.explanation,
            'points_earned': earned,
            'points_breakdown': parts,
            'streak': session.streak,
            'session': self.get_serializer(session).data,
        })

    @action(detail=True, methods=['post'])
    def finish(self, request, pk=None):
        """End a run early — walking away still records what was played."""
        session = self.get_object()
        if not session.is_finished:
            session.is_finished = True
            session.finished_at = timezone.now()
            session.save(update_fields=['is_finished', 'finished_at'])
        return Response(self.get_serializer(session).data)

    @action(detail=False, methods=['get'])
    def best(self, request):
        """Your personal bests, per mode — what a practice mode is played for."""
        out = {}
        for mode in MODES:
            if mode == DAILY:
                continue
            runs = QuizSession.objects.filter(user=request.user, mode=mode)
            top = runs.order_by('-points').first()
            out[mode] = {
                'played': runs.count(),
                'best_points': top.points if top else 0,
                'best_streak': max((r.longest_streak for r in runs), default=0),
                'best_score': top.score if top else 0,
            }
        return Response(out)


class DailyVerseView(APIView):
    """The verse of the day.

    Deterministic by date rather than stored: everyone opening the app on the
    same day gets the same verse, yesterday's is still yesterday's, and there
    is no table to keep in step. See songs/devotion.py for why the selection is
    curated rather than searched.
    """
    permission_classes = [IsAuthenticated]
    throttle_scope = 'quiz'

    # How far back the app may look. Enough for a week of catching up, bounded
    # so the endpoint cannot be walked through the whole rotation at once.
    HISTORY_DAYS = 14

    # A day's verse never changes; the bound only lets a re-import show through.
    CACHE_SECONDS = 24 * 60 * 60

    def get(self, request):
        from ..devotion import verse_for_date
        from ..verse_reflections import reflection_for

        today = timezone.localdate()
        raw = request.query_params.get('date')
        day = today
        if raw:
            try:
                day = date_cls.fromisoformat(raw)
            except ValueError:
                raise ValidationError({'date': 'Use YYYY-MM-DD.'})
            if day > today or (today - day).days > self.HISTORY_DAYS:
                raise ValidationError(
                    {'date': 'Only today and the last %d days.' % self.HISTORY_DAYS})

        # The same for everyone on a given day, and the morning push sends the
        # whole congregation here at once: look it up once per date, not once
        # per person. A missing corpus is not cached, so an import shows at once.
        key = 'daily-verse:%s' % day.isoformat()
        body = cache.get(key)
        if body is None:
            verse = verse_for_date(day)
            if not verse:
                raise APIException('The Bible text has not been imported yet.')
            body = {
                'date': day.isoformat(),
                'reference': verse.reference,
                'book': verse.book,
                'chapter': verse.chapter,
                'verse': verse.verse,
                'text': verse.text,
                'reflection': reflection_for(verse.book, verse.chapter, verse.verse),
            }
            cache.set(key, body, self.CACHE_SECONDS)

        out = {**body, 'is_today': day == today}
        # The home-screen widget refreshes on its own every few hours: that
        # is the phone fetching, not the person reading, so it is not a visit.
        if day == today and request.query_params.get('via') != 'widget':
            out['streak'] = self._streak(request.user, today)
        return Response(out)

    # Enough history for any streak worth showing; the best run is "best in
    # the last year or so", which is what anyone means by it.
    STREAK_WINDOW = 400

    def _streak(self, user, today):
        """Record today's visit and return the run it extends.

        Only today's verse counts: paging back through the fortnight is
        catching up, and a streak made of catching up would be a fiction.
        """
        VerseDay.objects.get_or_create(user=user, date=today)
        days = list(VerseDay.objects.filter(user=user)
                    .order_by('-date').values_list('date', flat=True)[:self.STREAK_WINDOW])
        current, best = day_streaks(days, today)
        return {'current': current, 'best': best}

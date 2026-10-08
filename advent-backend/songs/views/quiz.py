"""The daily Bible quiz.

There is no scheduler on this deploy, so the day's quiz is built on first
request and then kept — everyone who plays that date gets the same twenty
questions, which is what makes the leaderboard comparable.
"""
from datetime import date as date_cls, timedelta

from django.db import IntegrityError
from django.db.models import Count, Max, Sum

from .common import *  # noqa: F401,F403
from rest_framework.exceptions import NotFound
from ..days import local_day_start, local_today, seconds_into_day
from ..models import (
    DailyQuiz, DailyQuizStart, PuzzleProgress, QuestionReport, QuizAnswer, QuizAttempt,
    QuizQuestion, QuizSession, StoryPack, VerseDay,
)
from ..modes import BEST_MODES, DAILY, DUEL, MODES, REVIEW, SECTION, STORY, config
from ..quiz import display_order, generate_for_date, record_bank_answers, start_session
from ..scoring import (
    PRACTICE_COINS_PER_DAY, coin_balance, level_for, score_answer, settle_times,
)
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


QUIZ_LANGUAGES = ('en', 'sw')


def _language(request):
    """The language asked for (`lang` in the query or the body), `en` if none
    or one the quiz is not played in."""
    raw = request.query_params.get('lang') or (request.data.get('language') if hasattr(request, 'data') else None)
    return raw if raw in QUIZ_LANGUAGES else 'en'


# How far back a past day's quiz can be read (never played: see _day). Far
# enough for a week's catching up; bounded, because reading a day that was
# never built builds it.
PAST_DAYS = 7
# A quiz opened before midnight may still be handed in this long after it.
SUBMIT_GRACE_SECONDS = 2 * 60 * 60


def _question_id(request):
    """The `question_id` sent, as a number — None for anything else (an
    offline pack's "off-3", a typo), so a lookup answers 400/404, not 500."""
    raw = request.data.get('question_id')
    if isinstance(raw, bool):
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _lock_player(user):
    """Hold this person's row for the rest of the transaction: two requests
    of theirs that must not both pass a check (one attempt a day, a balance
    that must cover a spend) take turns."""
    User.objects.select_for_update().filter(pk=user.pk).first()


def _quiz_for(day, language='en'):
    """The stored quiz for `day` in `language`, generating it the first time
    it is asked for (in English when that language's Bible is not imported)."""
    quiz = DailyQuiz.objects.filter(date=day, language=language).first()
    if quiz:
        return quiz
    try:
        return generate_for_date(day, language=language)
    except ValueError as exc:
        # The corpus is empty or too thin — a real 503, not a broken quiz.
        raise ContentNotReady(str(exc))


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


def _tell_challenger(session):
    """The one who sent a duel hears how it went."""
    from ..push import notify_user
    original = session.duel_of
    verdict = ('beat you' if session.points > original.points
               else 'fell short of you' if session.points < original.points else 'tied with you')
    try:
        notify_user(original.user, 'quiz_duel',
                    f'{session.user.username} {verdict}: {session.score} right, {session.points} coins.',
                    data={'type': 'quiz_duel', 'session': session.pk})
    except Exception:  # noqa: BLE001 — a push never undoes an answer
        pass


def _review_due(user):
    from ..quiz_review import due_count
    return due_count(user)


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

    def _day(self, request, past_days=PAST_DAYS):
        """The day asked about (`date`, in the query or the body), today where
        the players are when none. Never a day still to come — reading one
        would build it early — and no further back than `past_days`."""
        today = local_today()
        raw = request.query_params.get('date') or (
            request.data.get('date') if request.method == 'POST' else None)
        if not raw:
            return today
        try:
            day = date_cls.fromisoformat(str(raw))
        except ValueError:
            raise ValidationError({'date': 'Use YYYY-MM-DD.'})
        if day > today:
            raise ValidationError({'date': 'That day has not come yet.', 'code': 'future'})
        if past_days is not None and (today - day).days > past_days:
            raise ValidationError({'date': 'Too long ago.', 'code': 'too_old'})
        return day

    @action(detail=False, methods=['get'])
    def today(self, request):
        """Today's quiz in the language asked for — unless today has already
        been played, in which case the quiz that was played, with its review:
        one attempt a day, whichever language it was in."""
        day = self._day(request)
        played = (QuizAttempt.objects.filter(user=request.user, quiz__date=day)
                  .select_related('quiz').first())
        quiz = played.quiz if played else _quiz_for(day, _language(request))
        if not played and day == local_today():
            self._note_start(request, quiz)
        return Response(self.get_serializer(quiz).data)

    @staticmethod
    def _note_start(request, quiz):
        """When this person first saw today's quiz, and first opened it to
        play (`play=1`, from the quiz screen) — the clock the speed bonus is
        held to."""
        start, _ = DailyQuizStart.objects.get_or_create(user=request.user, quiz=quiz)
        if request.query_params.get('play') and not start.play_started_at:
            DailyQuizStart.objects.filter(pk=start.pk, play_started_at__isnull=True).update(
                play_started_at=timezone.now())

    @action(detail=False, methods=['post'])
    def submit(self, request):
        """Score an attempt. One per person per day — the score has to mean
        something on the board, so a second run is refused rather than
        overwriting a worse (or better) first try.

        `date` is the day of the quiz that was played: today, or yesterday's
        when it was opened before midnight and is handed in just after.
        `shuffled` (default true) says the choices were answered in the
        order this person was shown them; an app holding a copy from before
        that order existed sends false.
        """
        day = self._day(request, past_days=1)
        if day != local_today():
            opened = DailyQuizStart.objects.filter(user=request.user, quiz__date=day).exists()
            if not (opened and seconds_into_day() <= SUBMIT_GRACE_SECONDS):
                return Response({'error': "That day's quiz has closed.", 'code': 'closed'},
                                status=status.HTTP_400_BAD_REQUEST)
        quiz = _quiz_for(day, _language(request))

        # Once a day, in whichever language: the board counts both.
        if QuizAttempt.objects.filter(quiz__date=day, user=request.user).exists():
            return self._already_played()

        answers = request.data.get('answers') or {}
        if not isinstance(answers, dict):
            raise ValidationError({'answers': 'Expected {question_id: choice_index}.'})
        shuffled = request.data.get('shuffled', True) not in (False, 'false', '0', 0)

        duration = request.data.get('duration_seconds')
        try:
            duration = int(duration) if duration is not None else None
        except (TypeError, ValueError):
            duration = None
        if duration is not None and not 0 <= duration < 86400:
            duration = None

        questions = list(quiz.questions.all())
        read = {q.id: _read_answer(answers, q) for q in questions}
        # The app's times, held to the server's clock (songs/scoring.py).
        start = DailyQuizStart.objects.filter(user=request.user, quiz=quiz).first()
        wall = None
        if start:
            wall = (timezone.now() - (start.play_started_at or start.first_seen)).total_seconds()
        times = settle_times({qid: seconds for qid, (_c, seconds) in read.items()},
                             wall, len(questions))

        score = points = streak = longest = 0
        results, cleaned, rows = [], {}, []
        uid = request.user.pk
        for q in questions:
            shown, _seconds = read[q.id]
            order = (display_order(uid, q.pk, q.kind, len(q.choices)) if shuffled
                     else list(range(len(q.choices))))
            chosen = order[shown] if shown is not None else None
            seconds = times.get(q.id)
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
                points_earned=earned, response_seconds=_as_float(_seconds), streak_after=streak,
            ))
            # In the order the app answered in — the order it is showing.
            results.append({
                'question_id': q.id,
                'chosen_index': shown,
                'answer_index': order.index(q.answer_index),
                'correct': correct,
                'reference': q.reference,
                'explanation': q.explanation,
                'points_earned': earned,
                'points_breakdown': parts,
                'streak_after': streak,
            })

        try:
            with transaction.atomic():
                # Two submits at once (a double tap, or English and Swahili
                # from two phones) take turns here; the second finds the first.
                _lock_player(request.user)
                if QuizAttempt.objects.filter(quiz__date=day, user=request.user).exists():
                    return self._already_played()
                attempt = QuizAttempt.objects.create(
                    user=request.user, quiz=quiz, score=score, total=len(questions),
                    points=points, longest_streak=longest,
                    answers=cleaned, duration_seconds=duration,
                )
                for row in rows:
                    row.attempt = attempt
                QuizAnswer.objects.bulk_create(rows)
        except IntegrityError:
            return self._already_played()
        DailyQuizStart.objects.filter(user=request.user, quiz=quiz).delete()
        _bump_board_version()
        # Written questions keep a record of how they are answered.
        record_bank_answers((r.question.bank_question_id, r.is_correct) for r in rows)
        # And each miss comes back for review.
        from ..quiz_review import note_miss
        for r in rows:
            if not r.is_correct:
                note_miss(request.user, r.question, quiz.language)

        return Response({
            'attempt': QuizAttemptSerializer(attempt).data,
            'score': score,
            'total': len(questions),
            'points': points,
            'longest_streak': longest,
            'results': results,
        }, status=status.HTTP_201_CREATED)

    @staticmethod
    def _already_played():
        return Response(
            {'error': 'You have already played today. Come back tomorrow.',
             'code': 'already_played'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    @action(detail=False, methods=['get'])
    def leaderboard(self, request):
        """A board of the daily quiz.

        `period`: `today` (the default) ranks the day's attempts on points —
        difficulty and speed are part of the achievement, so a careful 17 can
        outrank a lucky 17; ties fall back to correct answers, then time, then
        who finished first. `week` (Monday to today) and `all` rank each
        person's summed daily points, then correct answers, then days played.

        `scope=following` narrows any of them to the people you follow, and
        you: a board you can actually climb. `scope=group:<slug>` is a group's
        members (a church, a youth group), for members only.

        `me` is your own place on it, even below the fifty shown.
        """
        period = request.query_params.get('period') or 'today'
        if period not in self.PERIODS:
            raise ValidationError({'period': 'Use today, week or all.'})
        # Reading a board builds nothing, so any past day may be read.
        day = self._day(request, past_days=None)
        circle = None
        scope = request.query_params.get('scope') or ''
        if scope == 'following':
            circle = set(request.user.followed_by.values_list('id', flat=True)) | {request.user.pk}
        elif scope.startswith('group:'):
            # A church, a youth group, a choir: its members' board — for its
            # members only, as the group's own posts are.
            group = Group.objects.filter(slug=scope[len('group:'):], is_removed=False).first()
            if not group:
                raise NotFound('No such group.')
            members = set(group.members.values_list('user_id', flat=True))
            if request.user.pk not in members:
                # A private group isn't there for an outsider at all.
                if group.is_private:
                    raise NotFound('No such group.')
                raise PermissionDenied("Only members can see this group's board.")
            circle = members

        if period == 'today':
            # Every language's quiz for the day, on one board.
            ranked = QuizAttempt.objects.filter(quiz__date=day).order_by(*self.BOARD_ORDER)
            if circle is not None:
                ranked = ranked.filter(user_id__in=circle)
            attempts = ranked.select_related('user', 'user__profile')[:self.BOARD_SIZE]
            return Response({
                'date': day,
                'period': period,
                'results': QuizAttemptSerializer(attempts, many=True).data,
                'me': self._my_place(ranked, request.user),
            })

        rows = self._totals(period, day)
        if circle is not None:
            rows = [r for r in rows if r['user_id'] in circle]
        champion = self._champion(day, circle) if period == 'week' else None
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
            'champion': champion,
        })

    @classmethod
    def _champion(cls, day, circle=None):
        """Last week's winner on this board — a church's, the people you
        follow, or everyone's: the trophy a week of play is for."""
        last_week = day - timedelta(days=day.weekday() + 1)
        rows = cls._totals('week', last_week)
        if circle is not None:
            rows = [r for r in rows if r['user_id'] in circle]
        if not rows:
            return None
        user = User.objects.select_related('profile').filter(pk=rows[0]['user_id']).first()
        if not user:
            return None
        return {'user': SimpleUserSerializer(user).data, 'points': rows[0]['points'],
                'week_of': (last_week - timedelta(days=last_week.weekday())).isoformat()}

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
            'freeze': freeze_offer(request.user, balance=balance),
            # Questions once missed, due to be asked again (Review).
            'review_due': _review_due(request.user),
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

    @action(detail=False, methods=['post'])
    def why(self, request):
        """Why an answer is right, explained by Claude from the Scripture
        behind it. POST {question_id, level: why|simple|children, language}.
        Only for a question you have already answered."""
        from .. import quiz_ai
        question = QuizQuestion.objects.filter(pk=_question_id(request)).first()
        if not question:
            raise NotFound('No such question.')
        try:
            out = quiz_ai.explain(request.user, question, request.data.get('level') or 'why',
                                  _language(request))
        except ValueError:
            raise ValidationError({'level': 'Use why, simple or children.'})
        except PermissionError:
            return Response({'error': 'Answer the question first.', 'code': 'not_answered'},
                            status=status.HTTP_403_FORBIDDEN)
        except quiz_ai.AiOff:
            return Response({'error': 'AI is not available.', 'code': 'ai_off'},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except quiz_ai.AiLimit:
            return Response({'error': "You've used today's AI answers.", 'code': 'ai_limit'},
                            status=status.HTTP_429_TOO_MANY_REQUESTS)
        except quiz_ai.AiFailed:
            return Response({'error': 'AI could not answer just now.', 'code': 'ai_failed'},
                            status=status.HTTP_502_BAD_GATEWAY)
        return Response(out)

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

    @action(detail=False, methods=['post'])
    def report(self, request):
        """"This question is wrong": POST {question_id, reason, note}. Only for
        a question you have answered — reporting is for what you were asked.
        Once per question per person; a copy is kept for the admin queue."""
        from ..quiz_ai import has_answered
        question = (QuizQuestion.objects.filter(pk=_question_id(request))
                    .select_related('quiz', 'session').first())
        if not question:
            raise NotFound('No such question.')
        if not has_answered(request.user, question):
            return Response({'error': 'Answer the question first.', 'code': 'not_answered'},
                            status=status.HTTP_403_FORBIDDEN)
        reason = request.data.get('reason')
        if reason not in dict(QuestionReport.REASON_CHOICES):
            raise ValidationError({'reason': 'Choose one of: %s.' % ', '.join(dict(QuestionReport.REASON_CHOICES))})
        owner = question.quiz or question.session
        try:
            QuestionReport.objects.create(
                user=request.user, question=question, bank_question_id=question.bank_question_id,
                kind=question.kind, language=getattr(owner, 'language', 'en') or 'en',
                prompt=question.prompt, passage=question.passage, choices=question.choices,
                answer_index=question.answer_index, reference=question.reference,
                reason=reason, note=str(request.data.get('note') or '')[:500],
            )
        except IntegrityError:
            return Response({'status': 'already_reported'})
        return Response({'status': 'reported'}, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'])
    def stories(self, request):
        """The story journey: {featured: [...], journey: [...]}, each story
        with its stars (best run) and whether it is open yet."""
        from ..bible_books import BIBLE_BOOKS
        from ..quiz import corpus_for
        sw = _language(request) == 'sw'
        names = {b['number']: b['name'] for b in BIBLE_BOOKS}
        if sw:
            names.update(dict(corpus_for('sw').book_names()))
        stars = _story_stars(request.user)
        packs = list(StoryPack.objects.filter(is_active=True))

        def row(pack, unlocked):
            span = (str(pack.chapter_start) if pack.chapter_start == pack.chapter_end
                    else f'{pack.chapter_start}–{pack.chapter_end}')
            return {
                'slug': pack.slug,
                'title': (pack.title_sw if sw and pack.title_sw else pack.title),
                'summary': (pack.summary_sw if sw and pack.summary_sw else pack.summary),
                'passage': f'{names.get(pack.book_number, "")} {span}'.strip(),
                'icon': pack.icon, 'stars': stars.get(pack.slug, 0), 'unlocked': unlocked,
            }

        journey, open_next = [], True
        for pack in packs:
            if pack.is_featured:
                continue
            journey.append(row(pack, open_next))
            open_next = stars.get(pack.slug, 0) >= 1
        return Response({
            'featured': [row(p, True) for p in packs if p.is_featured],
            'journey': journey,
        })

    OFFLINE_MIX = [('simple', 15), ('moderate', 15), ('hard', 10)]
    OFFLINE_CACHE_SECONDS = 26 * 60 * 60

    @action(detail=False, methods=['get'], url_path='offline-pack')
    def offline_pack(self, request):
        """Practice to carry: forty questions with their answers, to play with
        no connection. The same pack for everyone each day (built once, kept),
        never from the written bank and never a verse of today's quiz, so it
        gives nothing away — and it pays no coins: it is played on the phone,
        where nothing is checked."""
        import random as _random
        from ..quiz import _seed_for, build_questions, corpus_for
        lang = _language(request)
        day = local_today()
        key = f'quiz-offline:{lang}:{day.isoformat()}'
        body = cache.get(key)
        if body is None:
            corpus = corpus_for(lang)
            try:
                built = build_questions(_random.Random(_seed_for(day) + 104729), self.OFFLINE_MIX,
                                        corpus, famous=4, bank=False)
            except ValueError as exc:
                raise ContentNotReady(str(exc))
            # Today's quiz exists before the pack is made, so none of its
            # verses can travel in the pack with their answers.
            for language in ('en', 'sw'):
                try:
                    generate_for_date(day, language=language)
                except ValueError:
                    pass
            todays = set(QuizQuestion.objects.filter(quiz__date=day).values_list('reference', flat=True))
            fields = ('kind', 'difficulty', 'category', 'prompt', 'passage', 'choices',
                      'answer_index', 'reference', 'explanation')
            body = {
                'date': day.isoformat(), 'language': corpus.language,
                'questions': [{'id': f'off-{i}', **{f: q.get(f, '') for f in fields}}
                              for i, q in enumerate(built) if q.get('reference') not in todays],
            }
            cache.set(key, body, self.OFFLINE_CACHE_SECONDS)
        return Response(body)

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


def _practice_coins_today(user):
    """What practice runs have paid this person today."""
    return (QuizSession.objects.filter(user=user, started_at__gte=local_day_start())
            .exclude(mode=DAILY).aggregate(n=Sum('points'))['n'] or 0)


def _story_stars(user):
    """{story slug: stars} from each story's best run — three for ten right,
    two for eight, one for six."""
    best = dict(QuizSession.objects.filter(user=user, mode=STORY)
                .values_list('topic').annotate(best=Max('score')))
    return {slug: (3 if n >= 10 else 2 if n >= 8 else 1 if n >= 6 else 0) for slug, n in best.items()}


def _story_open(user, pack, stars=None):
    """The first story is open; each after it opens with a star on the one
    before. A featured story (this week's study) is open to everyone."""
    if pack.is_featured:
        return True
    packs = list(StoryPack.objects.filter(is_active=True, is_featured=False).values_list('slug', flat=True))
    if pack.slug not in packs:
        return False
    i = packs.index(pack.slug)
    if i == 0:
        return True
    stars = _story_stars(user) if stars is None else stars
    return stars.get(packs[i - 1], 0) >= 1


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
        """Start a run. POST {"mode": "speed" | "streak", "language": "en" | "sw"}."""
        mode = request.data.get('mode')
        if mode not in MODES or mode == DAILY:
            raise ValidationError({
                'mode': 'Choose one of: %s.' % ', '.join(m for m in MODES if m != DAILY),
            })

        # Every run generates its own questions (10 for Speed, 40 for Streak),
        # so unlimited practice is unlimited rows. Far above anyone's honest
        # appetite for a day, and it bounds the table.
        played_today = QuizSession.objects.filter(
            user=request.user, started_at__gte=local_day_start(),
        ).count()
        if played_today >= DAILY_SESSION_LIMIT:
            return Response(
                {'error': 'That is %d practice runs today. Come back tomorrow.'
                          % DAILY_SESSION_LIMIT},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        try:
            if mode == DUEL:
                from ..quiz_duel import DuelRefused, start_duel
                try:
                    with transaction.atomic():
                        _lock_player(request.user)       # one copy of a duel, however many taps
                        session = start_duel(request.user, request.data.get('of'))
                except DuelRefused as refused:
                    code = status.HTTP_404_NOT_FOUND if refused.code == 'not_found' else status.HTTP_400_BAD_REQUEST
                    return Response({'error': 'This duel cannot be played.', 'code': refused.code}, status=code)
            elif mode == REVIEW:
                from ..quiz_review import NothingDue, start_review
                try:
                    session = start_review(request.user, _language(request))
                except NothingDue:
                    return Response({'error': 'Nothing is due for review.', 'code': 'nothing_due'},
                                    status=status.HTTP_400_BAD_REQUEST)
            elif mode == STORY:
                pack = StoryPack.objects.filter(slug=request.data.get('story') or '', is_active=True).first()
                if not pack:
                    raise ValidationError({'story': 'No such story.'})
                if not _story_open(request.user, pack):
                    return Response({'error': 'Finish the story before this one first.', 'code': 'locked'},
                                    status=status.HTTP_400_BAD_REQUEST)
                session = start_session(request.user, mode, _language(request), story=pack)
            else:
                category = None
                if mode == SECTION:
                    from ..quiz_progress import CATEGORY_ORDER
                    category = request.data.get('category')
                    if category not in CATEGORY_ORDER:
                        raise ValidationError({'category': 'Choose one of: %s.' % ', '.join(CATEGORY_ORDER)})
                session = start_session(request.user, mode, _language(request), category)
        except ValueError as exc:
            raise ContentNotReady(str(exc))
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

        raw = request.data.get('choice')
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

        try:
            with transaction.atomic():
                # One answer at a time per run: a double tap, or the retry of
                # an answer whose reply was lost, finds the first one here
                # instead of adding its points a second time.
                session = QuizSession.objects.select_for_update().get(pk=session.pk)
                if session.is_finished:
                    return Response({'error': 'This run is already over.', 'code': 'finished'},
                                    status=status.HTTP_400_BAD_REQUEST)
                question = session.questions.filter(pk=_question_id(request)).first()
                if not question:
                    raise ValidationError({'question_id': 'Not a question in this run.'})
                if QuizAnswer.objects.filter(session=session, question=question).exists():
                    return self._answered()

                chosen = raw if isinstance(raw, int) and not isinstance(raw, bool) else None
                if chosen is not None and not (0 <= chosen < len(question.choices)):
                    chosen = None
                correct = (not timed_out) and chosen is not None and chosen == question.answer_index

                streak = session.streak + 1 if correct else 0
                earned, parts = score_answer(
                    question.difficulty, correct, seconds, streak, profile=cfg,
                )
                # What practice may still pay today (songs/scoring.py).
                capped = False
                if earned:
                    # Two runs at once must not both fit under one day's ceiling.
                    _lock_player(request.user)
                    room = max(0, PRACTICE_COINS_PER_DAY - _practice_coins_today(request.user))
                    if earned > room:
                        # What it is still worth today, said as what it pays.
                        earned, capped = room, True
                        parts = {'base': room, 'speed': 0, 'streak': 0}

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
        except IntegrityError:
            return self._answered()
        record_bank_answers([(question.bank_question_id, correct)])
        if session.is_finished and session.mode == DUEL and session.duel_of_id:
            _tell_challenger(session)
        from ..quiz_review import note_miss, note_review
        if question.review_item_id:
            note_review(question.review_item_id, correct)
        elif not correct:
            note_miss(request.user, question, session.language)

        return Response({
            'correct': correct,
            'timed_out': timed_out,
            'answer_index': question.answer_index,
            'reference': question.reference,
            'explanation': question.explanation,
            'points_earned': earned,
            'points_breakdown': parts,
            # Today's practice has paid all it can: still played, still
            # counted, no more coins until tomorrow.
            'capped': capped,
            'streak': session.streak,
            # `brief`: the app already holds the questions, so only the
            # totals come back — re-sending the whole run on every tap was
            # most of an answer's wait. Older builds get the full run.
            'session': (self._totals(session) if request.data.get('brief')
                        else self.get_serializer(session).data),
        })

    @staticmethod
    def _answered():
        return Response({'error': 'You have already answered that one.', 'code': 'answered'},
                        status=status.HTTP_400_BAD_REQUEST)

    @staticmethod
    def _totals(session):
        return {
            'id': session.id, 'score': session.score, 'answered': session.answered,
            'points': session.points, 'streak': session.streak,
            'longest_streak': session.longest_streak, 'is_finished': session.is_finished,
        }

    @action(detail=True, methods=['get'])
    def duel(self, request, pk=None):
        """A duel side by side: {me, them, verdict} — each with the score,
        coins and a mark per question."""
        from ..quiz_duel import comparison
        session = self.get_object()
        if session.mode != DUEL:
            raise NotFound('Not a duel.')
        return Response(comparison(session))

    # A 50/50 costs enough to be a choice, not a habit.
    HINT_COST = 15

    @action(detail=True, methods=['post'])
    def hint(self, request, pk=None):
        """50/50: two wrong answers taken away, for coins. Practice only (the
        ranked daily quiz has none), once per question, before answering.
        POST {"question_id": n} → {removed: [i, j], cost, balance}."""
        import random as _random
        from ..scoring import coin_balance

        session = self.get_object()
        if session.is_finished:
            return Response({'error': 'This run is already over.', 'code': 'finished'},
                            status=status.HTTP_400_BAD_REQUEST)
        question = session.questions.filter(pk=_question_id(request)).first()
        if not question:
            raise ValidationError({'question_id': 'Not a question in this run.'})
        if QuizAnswer.objects.filter(session=session, question=question).exists():
            return Response({'error': 'Already answered.', 'code': 'answered'},
                            status=status.HTTP_400_BAD_REQUEST)
        if len(question.choices) < 3:
            return Response({'error': 'Nothing to take away.', 'code': 'no_hint'},
                            status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            # Hints on two questions at once must not both spend one balance.
            _lock_player(request.user)
            # Marked first, conditionally: two taps at once buy it once.
            claimed = QuizQuestion.objects.filter(pk=question.pk, hint_used=False).update(hint_used=True)
            if not claimed:
                return Response({'error': 'Already used on this question.', 'code': 'used'},
                                status=status.HTTP_400_BAD_REQUEST)
            _earned, _spent, balance = coin_balance(request.user)
            if balance < self.HINT_COST:
                transaction.set_rollback(True)
                return Response({'error': 'Not enough coins.', 'code': 'not_enough_coins',
                                 'cost': self.HINT_COST, 'balance': balance},
                                status=status.HTTP_400_BAD_REQUEST)
            CoinSpend.objects.create(user=request.user, amount=self.HINT_COST, reason=CoinSpend.QUIZ_HINT)
        wrong = [i for i in range(len(question.choices)) if i != question.answer_index]
        removed = sorted(_random.sample(wrong, len(question.choices) - 2))
        return Response({'removed': removed, 'cost': self.HINT_COST,
                         'balance': balance - self.HINT_COST})

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
        for mode in BEST_MODES:
            runs = QuizSession.objects.filter(user=request.user, mode=mode)
            top = runs.order_by('-points').first()
            summary = runs.aggregate(played=Count('id'), best_streak=Max('longest_streak'))
            out[mode] = {
                'played': summary['played'] or 0,
                'best_points': top.points if top else 0,
                'best_streak': summary['best_streak'] or 0,
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

        # The players' day, as the quiz's: the verse turns at their midnight.
        today = local_today()
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
                raise ContentNotReady('The Bible text has not been imported yet.')
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

"""What a person's play adds up to: history, badges, strengths, and the one
thing coins can buy back — a broken day streak.

Everything here is read from what is already recorded (attempts, runs,
answers, play days, coin spends): a badge or a strength is a view of play, not
a second record of it that could drift away from the first.
"""
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import Count, F, Max, Q
from django.utils import timezone

from .models import CoinSpend, PlayDay, QuizAnswer, QuizAttempt, QuizSession
from .modes import STREAK
from .quiz import CATEGORY_RANGES
from .scoring import coin_balance
from .streaks import day_streaks, streak_for

# ── streak freeze ─────────────────────────────────────────────────────────────
# A missed day can be bought back the day after, for coins — enough to be a
# decision, not so much that a streak is out of reach. Once a week at most: a
# streak is a record of showing up, and a freeze every day would make it a
# record of paying.
FREEZE_COST = 150
FREEZE_EVERY_DAYS = 7


def freeze_offer(user, today=None, balance=None):
    """Whether yesterday can be bought back, and what it restores.

    {available, cost, run, balance, affordable, reason}. `run` is the streak
    that ended the day before yesterday — what a freeze saves. Offered only
    when yesterday was missed, the day before was played, and no freeze was
    used in the last week.
    """
    today = today or timezone.localdate()
    yesterday = today - timedelta(days=1)
    days = set(PlayDay.objects.filter(user=user, date__gte=today - timedelta(days=400))
               .values_list('date', flat=True))
    # The caller may already know the balance (the stats endpoint does): four
    # aggregate queries not repeated.
    if balance is None:
        _earned, _spent, balance = coin_balance(user)
    offer = {'available': False, 'cost': FREEZE_COST, 'run': 0, 'balance': balance,
             'affordable': balance >= FREEZE_COST, 'reason': ''}

    if yesterday in days:
        offer['reason'] = 'not_needed'
        return offer
    if (yesterday - timedelta(days=1)) not in days:
        offer['reason'] = 'nothing_to_save'
        return offer
    recent = CoinSpend.objects.filter(
        user=user, reason=CoinSpend.FREEZE,
        created_at__gte=timezone.now() - timedelta(days=FREEZE_EVERY_DAYS),
    ).exists()
    if recent:
        offer['reason'] = 'used_this_week'
        return offer

    run, _best = day_streaks(sorted(days, reverse=True), yesterday)
    offer.update(available=True, run=run)
    return offer


class FreezeRefused(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def buy_freeze(user, today=None):
    """Spend the coins and record yesterday as a frozen play day.

    Raises FreezeRefused(code) — `not_available` or `not_enough_coins` — and
    changes nothing when it cannot be bought. Two taps at once cannot buy it
    twice: the play day is unique per person and date.
    """
    today = today or timezone.localdate()
    offer = freeze_offer(user, today)
    if not offer['available']:
        raise FreezeRefused('not_available')
    if not offer['affordable']:
        raise FreezeRefused('not_enough_coins')
    try:
        with transaction.atomic():
            PlayDay.objects.create(user=user, date=today - timedelta(days=1), frozen=True)
            CoinSpend.objects.create(user=user, amount=FREEZE_COST, reason=CoinSpend.FREEZE)
    except IntegrityError:
        raise FreezeRefused('not_available')
    current, best, played_today = streak_for(user, today)
    return {'day_streak': current, 'best_day_streak': best, 'played_today': played_today}


# ── badges ────────────────────────────────────────────────────────────────────
# (key, what is counted, target). The counts come from one pass below; a badge
# is earned once its count reaches the target, and shows progress until then.
BADGES = (
    ('first_quiz', 'days_played', 1),
    ('perfect', 'perfect_days', 1),
    ('week_streak', 'best_day_streak', 7),
    ('month_streak', 'best_day_streak', 30),
    ('run_10', 'best_streak_run', 10),
    ('run_25', 'best_streak_run', 25),
    ('coins_1000', 'coins_earned', 1000),
    ('scholar', 'correct_answers', 500),
)


def _counts(user):
    daily = QuizAttempt.objects.filter(user=user).aggregate(
        days=Count('id'),
        perfect=Count('id', filter=Q(total__gt=0) & Q(score=F('total'))),
    )
    best_run = (QuizSession.objects.filter(user=user, mode=STREAK)
                .aggregate(n=Max('longest_streak'))['n'] or 0)
    correct = _answers(user).filter(is_correct=True).count()
    earned, _spent, _balance = coin_balance(user)
    _current, best_days, _played = streak_for(user)
    return {
        'days_played': daily['days'] or 0,
        'perfect_days': daily['perfect'] or 0,
        'best_day_streak': best_days,
        'best_streak_run': best_run,
        'coins_earned': earned,
        'correct_answers': correct,
    }


def badges_for(user):
    """[{key, earned, progress, target}] in a fixed order."""
    counts = _counts(user)
    out = []
    for key, counted, target in BADGES:
        have = counts[counted]
        out.append({'key': key, 'earned': have >= target,
                    'progress': min(have, target), 'target': target})
    return out


# ── strengths ─────────────────────────────────────────────────────────────────
CATEGORY_ORDER = [name for _upper, name in CATEGORY_RANGES]


def _answers(user):
    """Every question a person has answered, daily and practice alike."""
    return QuizAnswer.objects.filter(Q(attempt__user=user) | Q(session__user=user))


def strengths_for(user):
    """[{category, answered, correct, accuracy}] per section of scripture, in
    canon order — only the sections someone has actually been asked about."""
    rows = (_answers(user).exclude(question__category='')
            .values('question__category')
            .annotate(answered=Count('id'), correct=Count('id', filter=Q(is_correct=True))))
    found = {r['question__category']: r for r in rows}
    out = []
    for cat in CATEGORY_ORDER:
        r = found.get(cat)
        if not r or not r['answered']:
            continue
        out.append({
            'category': cat, 'answered': r['answered'], 'correct': r['correct'],
            'accuracy': round(r['correct'] / r['answered'], 3),
        })
    return out


# ── history ───────────────────────────────────────────────────────────────────
HISTORY_DAYS = 60
CALENDAR_DAYS = 84     # twelve weeks


def progress_for(user, today=None):
    """Everything the progress screen shows, in one answer."""
    today = today or timezone.localdate()
    attempts = (QuizAttempt.objects.filter(user=user, quiz__date__gte=today - timedelta(days=HISTORY_DAYS))
                .select_related('quiz').order_by('quiz__date'))
    days = (PlayDay.objects.filter(user=user, date__gte=today - timedelta(days=CALENDAR_DAYS))
            .order_by('date').values('date', 'frozen'))
    quiz_days = {a.quiz.date for a in attempts}
    return {
        'history': [
            {'date': a.quiz.date, 'score': a.score, 'total': a.total, 'points': a.points}
            for a in attempts
        ],
        'days': [
            {'date': d['date'], 'frozen': d['frozen'], 'quiz': d['date'] in quiz_days}
            for d in days
        ],
        'badges': badges_for(user),
        'strengths': strengths_for(user),
        'freeze': freeze_offer(user, today),
    }

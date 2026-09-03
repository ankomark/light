"""How a Bible-quiz answer becomes points.

Kept apart from the views and the generator so a future game mode (speed run,
streak run, a category practice round) can change the rules without touching
the engine that runs a quiz. One flat point per correct answer is a test; points
that respond to difficulty, speed and a run of correct answers are a game.

Nothing here trusts the client. `response_seconds` arrives from the app and only
ever shapes the speed bonus, clamped at both ends, so a forged time can win at
most SPEED_MAX extra points — never a correct answer, and never unbounded.
"""

# What a correct answer is worth before any bonus.
BASE_POINTS = {
    'simple': 10,
    'moderate': 15,
    'hard': 20,
}
DEFAULT_BASE = 10

# Answer inside FAST_SECONDS for the full bonus; nothing after SLOW_SECONDS.
# Between the two it tapers, so thinking hard costs a little but not the answer.
SPEED_MAX = 5
FAST_SECONDS = 4.0
SLOW_SECONDS = 20.0

# A run only starts paying from the third correct answer, and stops growing at
# STREAK_CAP — otherwise one lucky run decides the whole leaderboard.
STREAK_STARTS_AT = 3
STREAK_STEP = 2
STREAK_CAP = 10


def base_points_for(difficulty):
    return BASE_POINTS.get(difficulty, DEFAULT_BASE)


def speed_bonus(response_seconds, profile=None):
    """Full bonus under the fast threshold, tapering to nothing by the slow one.

    `profile` lets a game mode change the dials (Speed Quiz pays far more for a
    quick answer; Streak pays nothing, so thinking is free). Without one, the
    daily rules apply.
    """
    max_bonus = SPEED_MAX if profile is None else profile.get('speed_max', SPEED_MAX)
    fast = FAST_SECONDS if profile is None else profile.get('speed_fast', FAST_SECONDS)
    slow = SLOW_SECONDS if profile is None else profile.get('speed_slow', SLOW_SECONDS)
    if not max_bonus or slow <= fast:
        return 0
    if response_seconds is None:
        return 0
    try:
        seconds = float(response_seconds)
    except (TypeError, ValueError):
        return 0
    # A negative or absurd time is treated as no information, not as instant.
    if seconds < 0 or seconds != seconds:      # NaN-safe
        return 0
    if seconds <= fast:
        return max_bonus
    if seconds >= slow:
        return 0
    return int(round(max_bonus * (slow - seconds) / (slow - fast)))


def streak_bonus(streak, profile=None):
    """`streak` counts this answer — the third in a row earns the first bonus.

    Streak mode raises the cap sharply: there, a long run IS the achievement.
    """
    cap = STREAK_CAP if profile is None else profile.get('streak_cap', STREAK_CAP)
    if streak < STREAK_STARTS_AT:
        return 0
    return min(cap, (streak - STREAK_STARTS_AT + 1) * STREAK_STEP)


def score_answer(difficulty, is_correct, response_seconds, streak, profile=None):
    """Points for one answer, and the parts that made it up.

    A wrong or skipped answer scores nothing — no consolation points, because
    they would make the leaderboard reward volume over knowledge.
    """
    if not is_correct:
        return 0, {'base': 0, 'speed': 0, 'streak': 0}
    parts = {
        'base': base_points_for(difficulty),
        'speed': speed_bonus(response_seconds, profile),
        'streak': streak_bonus(streak, profile),
    }
    return sum(parts.values()), parts


def perfect_score(difficulties):
    """The most a day's quiz can pay — useful for showing 'x of y possible'."""
    return sum(
        base_points_for(d) + SPEED_MAX + min(STREAK_CAP, max(0, (i + 1 - STREAK_STARTS_AT + 1)) * STREAK_STEP)
        for i, d in enumerate(difficulties)
    )


# ── Progress ─────────────────────────────────────────────────────────────────
# Coins accumulate across every quiz ever played; levels are the readable shape
# put on that number. A triangular curve, so early levels come quickly and later
# ones take real play: level L begins at 50 * L * (L - 1) coins.
#
#   L1 0 · L2 100 · L3 300 · L4 600 · L5 1000 · L6 1500 · L10 4500
LEVEL_BASE = 50


def level_begins_at(level):
    """Coins needed to reach `level`."""
    return LEVEL_BASE * level * (level - 1)


def level_for(coins):
    """(level, coins_at_this_level, coins_at_next_level) for a lifetime total."""
    coins = max(0, int(coins or 0))
    level = 1
    # Bounded: the curve is quadratic, so this converges in a few dozen steps
    # even for an implausible fortune.
    while level_begins_at(level + 1) <= coins and level < 500:
        level += 1
    return level, level_begins_at(level), level_begins_at(level + 1)


# ── Puzzle rewards and the coin balance ──────────────────────────────────────
# Finding a word pays a little; finishing a level pays properly, and pays more
# the further in you are. A hint costs more than a single word is worth, so it
# is a real decision rather than a free reveal.
COINS_PER_WORD = 5
COMPLETION_BASE = 20
COMPLETION_PER_LEVEL = 5
HINT_COST = 15


def completion_bonus(level):
    return COMPLETION_BASE + COMPLETION_PER_LEVEL * max(0, int(level) - 1)


def coin_balance(user):
    """(earned, spent, balance) across everything a person has played.

    Coins used to only accumulate, so a total was a sum. Hints spend them, so
    the number people see has to be a balance — and both sides are stored, not
    inferred, so it can always be reconciled.
    """
    from django.db.models import Sum
    from .models import CoinSpend, PuzzleProgress, QuizAttempt, QuizSession

    def total(qs, field):
        return qs.filter(user=user).aggregate(n=Sum(field))['n'] or 0

    earned = (
        total(QuizAttempt.objects, 'points')
        + total(QuizSession.objects, 'points')
        + total(PuzzleProgress.objects, 'coins_earned')
    )
    spent = total(CoinSpend.objects, 'amount')
    return earned, spent, max(0, earned - spent)


# A bonus word is a real word the wheel can spell that the board never asked
# for. It pays less than an answer on purpose: it is a reward for exploring,
# not a second way to earn the same coins.
COINS_PER_BONUS_WORD = 2

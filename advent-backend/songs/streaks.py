"""One streak, across every game.

A streak used to be counted from quiz attempts, which quietly made it a quiz
streak: a day spent entirely on the word puzzle broke it. That is the wrong
promise to make to someone who played. A streak here means *you showed up*, so
every game records the day it was played on and the streak is read from that.

Recording is a `get_or_create` on (user, date) — at most one row a day, and
safe to call on every move rather than trying to guess the first one.
"""
from django.utils import timezone

from .models import PlayDay


def record_play(user, when=None):
    """Note that this person played on a day. Idempotent within that day.

    Takes a user or a user id — signals have the id in hand and looking the
    row back up to record a date would be a query for nothing.
    """
    user_id = getattr(user, 'pk', user)
    if not user_id:
        return
    PlayDay.objects.get_or_create(user_id=user_id, date=when or timezone.localdate())


def day_streaks(dates_desc, today):
    """(current, best) run of consecutive days played.

    The current run survives not having played *today* — it only breaks once
    yesterday is missed too, so opening the app in the morning does not show a
    streak already lost. It breaks the moment a whole day is skipped.
    """
    if not dates_desc:
        return 0, 0

    unique = []
    for d in dates_desc:
        if d and (not unique or unique[-1] != d):
            unique.append(d)

    # Longest run anywhere in the history.
    best = run = 1
    for earlier, later in zip(unique[1:], unique):
        if (later - earlier).days == 1:
            run += 1
            best = max(best, run)
        else:
            run = 1

    # The current run, counted back from today or yesterday.
    if (today - unique[0]).days > 1:
        return 0, best
    current = 1
    for earlier, later in zip(unique[1:], unique):
        if (later - earlier).days == 1:
            current += 1
        else:
            break
    return current, max(best, current)


def streak_for(user, today=None):
    """(current, best, played_today) for one person, across all games."""
    today = today or timezone.localdate()
    days = list(PlayDay.objects.filter(user=user)
                .order_by('-date').values_list('date', flat=True))
    current, best = day_streaks(days, today)
    return current, best, bool(days and days[0] == today)

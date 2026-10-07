"""Which calendar day it is for the people playing.

The server keeps UTC, but the congregation lives in East Africa: on UTC the
quiz day turned over at three in the morning there, so someone playing
through 02:59 was scored against the next day's questions, and a game played
at one in the morning counted toward yesterday's streak. Every game day — the
daily quiz, practice limits, streaks, reviews — is read from here instead.
"""
from zoneinfo import ZoneInfo

from django.conf import settings
from django.utils import timezone


def game_zone():
    return ZoneInfo(getattr(settings, 'QUIZ_TZ', 'Africa/Nairobi'))


def local_today():
    """Today, where the players are."""
    return timezone.localdate(timezone=game_zone())


def local_day_start(day=None):
    """The moment `day` (default today) began there, as an aware datetime."""
    from datetime import datetime, time
    day = day or local_today()
    return datetime.combine(day, time.min, tzinfo=game_zone())


def seconds_into_day():
    """How long today has been going there — for the grace after midnight."""
    return (timezone.now() - local_day_start()).total_seconds()

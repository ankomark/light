"""Game modes — the rules that sit on top of the quiz engine.

The engine knows about questions, answers, time, streaks and points. A mode is
only a set of dials on top of it: how many questions, which difficulties, how
much a fast answer is worth, and whether a wrong answer ends the run. Keeping
them here means a new mode is a dictionary, not a new subsystem.

    daily   the shared twenty everyone gets, once a day, on the leaderboard
    speed   ten questions against a fifteen-second clock; speed is the point
    streak  keep going until you get one wrong; the run itself is the score
"""
from .models import QuizQuestion

DAILY = 'daily'
SPEED = 'speed'
STREAK = 'streak'

S, M, H = QuizQuestion.SIMPLE, QuizQuestion.MODERATE, QuizQuestion.HARD

MODES = {
    DAILY: {
        'label': 'Daily Quiz',
        'questions': 20,
        'mix': [(S, 7), (M, 7), (H, 6)],
        # No per-question clock: the daily quiz is meant to be thought about.
        'time_limit': None,
        'speed_max': 5,
        'speed_fast': 4.0,
        'speed_slow': 20.0,
        'streak_cap': 10,
        'ends_on_wrong': False,
        # One attempt a day, and it is what the leaderboard ranks.
        'repeatable': False,
        'ranked': True,
    },
    SPEED: {
        'label': 'Speed Quiz',
        'questions': 10,
        # Weighted easier — you cannot read a hard passage in fifteen seconds.
        'mix': [(S, 5), (M, 4), (H, 1)],
        'time_limit': 15,
        # Speed is the whole point here, so it can outweigh the base points.
        'speed_max': 15,
        'speed_fast': 2.0,
        'speed_slow': 15.0,
        'streak_cap': 5,
        'ends_on_wrong': False,
        'repeatable': True,
        'ranked': False,
    },
    STREAK: {
        'label': 'Streak',
        # A pool, not a target — the run ends when you miss, not when you finish.
        'questions': 40,
        'mix': [(S, 12), (M, 14), (H, 14)],
        'time_limit': None,
        # No speed bonus: this mode rewards not being wrong, so thinking is free.
        'speed_max': 0,
        'speed_fast': 0.0,
        'speed_slow': 0.0,
        # A long run is the achievement, so the bonus keeps growing much further.
        'streak_cap': 40,
        'ends_on_wrong': True,
        'repeatable': True,
        'ranked': False,
    },
}

MODE_CHOICES = tuple((key, cfg['label']) for key, cfg in MODES.items())


def config(mode):
    """The dials for `mode`, falling back to the daily rules for anything
    unknown so a bad value degrades rather than crashes."""
    return MODES.get(mode, MODES[DAILY])

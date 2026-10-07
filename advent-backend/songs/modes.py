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
# Questions once missed, asked again on a spaced schedule (songs/quiz_review.py).
REVIEW = 'review'
# One part of the Bible at a time — the Law, the Gospels… — for practice
# where it is needed (the progress screen names the weakest).
SECTION = 'section'
# Another player's Speed run, played on the same questions.
DUEL = 'duel'
# One Bible story at a time — Joseph, Daniel, the Passion week (StoryPack);
# the packs in order are the journey.
STORY = 'story'
# The modes played for a personal best (the hub's cards).
BEST_MODES = (SPEED, STREAK)

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

MODES[REVIEW] = {
    'label': 'Review',
    # Up to ten of what is due; the questions come from the review, not the mix.
    'questions': 10,
    'mix': [],
    'time_limit': None,
    # Remembering is the point, not speed.
    'speed_max': 0,
    'speed_fast': 0.0,
    'speed_slow': 0.0,
    'streak_cap': 5,
    'ends_on_wrong': False,
    'repeatable': True,
    'ranked': False,
}

MODES[SECTION] = {
    'label': 'Section practice',
    'questions': 10,
    'mix': [(S, 4), (M, 4), (H, 2)],
    'time_limit': None,
    'speed_max': 3,
    'speed_fast': 4.0,
    'speed_slow': 20.0,
    'streak_cap': 5,
    'ends_on_wrong': False,
    'repeatable': True,
    'ranked': False,
}

MODES[DUEL] = {**MODES[SPEED], 'label': 'Duel', 'mix': []}

MODES[STORY] = {**MODES[SECTION], 'label': 'Story'}

# "How does this verse end?": how many of a run's simple questions are drawn
# from the verses people know by heart. Not in Speed (long choices against
# a clock) nor in a Section or Story, which keep to their own chapters.
MODES[DAILY]['famous'] = 2
MODES[STREAK]['famous'] = 2

MODE_CHOICES = tuple((key, cfg['label']) for key, cfg in MODES.items())


def config(mode):
    """The dials for `mode`, falling back to the daily rules for anything
    unknown so a bad value degrades rather than crashes."""
    return MODES.get(mode, MODES[DAILY])

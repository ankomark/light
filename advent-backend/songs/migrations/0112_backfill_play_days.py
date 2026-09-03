"""Seed the shared streak from the history that already exists.

`PlayDay` is new, but the playing is not. Without this, everyone's streak would
read zero on the day this ships — the one thing a streak must never do to
someone who has been turning up. Quiz attempts carry the day they were for;
sessions and puzzle progress carry when they were started.

Reversible in the only sense that matters: the table is dropped by the previous
migration's reverse, so this one has nothing of its own to undo.
"""
from django.db import migrations
from django.utils import timezone


def seed(apps, schema_editor):
    PlayDay = apps.get_model('songs', 'PlayDay')
    QuizAttempt = apps.get_model('songs', 'QuizAttempt')
    QuizSession = apps.get_model('songs', 'QuizSession')
    PuzzleProgress = apps.get_model('songs', 'PuzzleProgress')

    days = set()

    for user_id, day in QuizAttempt.objects.values_list('user_id', 'quiz__date'):
        if day:
            days.add((user_id, day))

    # Sessions and puzzles are stamped with a moment, not a day. Convert in the
    # active timezone so a late-evening game lands on the day it was played.
    for model in (QuizSession, PuzzleProgress):
        for user_id, started in model.objects.values_list('user_id', 'started_at'):
            if started:
                days.add((user_id, timezone.localtime(started).date()))

    PlayDay.objects.bulk_create(
        [PlayDay(user_id=u, date=d) for u, d in sorted(days)],
        ignore_conflicts=True,
        batch_size=1000,
    )


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0111_puzzleprogress_bonus_wordpuzzle_bonus_words_and_more'),
    ]

    operations = [
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]

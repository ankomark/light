"""Prune old practice-quiz sessions.

Speed and Streak are repeatable, and every run generates its own questions —
10 rows for a Speed round, 40 for a Streak one. Those are the highest-volume
rows the quiz produces and they have no value once the run is over: the score
that matters is already summarised on the session, and lifetime coins are read
from that summary, not from the questions.

So the questions and answers age out while the session row (and therefore the
player's totals and personal bests) stays. Abandoned runs go sooner — a session
someone walked away from mid-question is not worth keeping for a week.

Run on a schedule (daily) via a cron service or external scheduler:

    python manage.py cleanup_quiz_sessions
    python manage.py cleanup_quiz_sessions --days 30 --dry-run
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from songs.models import QuizAnswer, QuizQuestion, QuizSession

BATCH = 2000  # delete in chunks so a big backlog can't lock the table


class Command(BaseCommand):
    help = "Drop the questions of finished practice sessions older than N days (default 7)."

    def add_arguments(self, parser):
        parser.add_argument(
            '--days', type=int, default=7,
            help='Prune finished sessions older than this many days (default 7).',
        )
        parser.add_argument(
            '--abandoned-hours', type=int, default=24,
            help='Also prune runs left unfinished for this long (default 24).',
        )
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Report what would be pruned without changing anything.',
        )

    def handle(self, *args, **options):
        now = timezone.now()
        finished_cutoff = now - timedelta(days=options['days'])
        abandoned_cutoff = now - timedelta(hours=options['abandoned_hours'])

        stale = QuizSession.objects.filter(
            is_finished=True, started_at__lt=finished_cutoff,
        )
        abandoned = QuizSession.objects.filter(
            is_finished=False, started_at__lt=abandoned_cutoff,
        )
        session_ids = list(stale.values_list('id', flat=True)) + \
            list(abandoned.values_list('id', flat=True))

        questions = QuizQuestion.objects.filter(session_id__in=session_ids)
        answers = QuizAnswer.objects.filter(session_id__in=session_ids)

        if options['dry_run']:
            self.stdout.write(self.style.SUCCESS(
                'Would prune %d sessions (%d finished, %d abandoned): '
                '%d questions, %d answers. Session rows and totals are kept.'
                % (len(session_ids), stale.count(), abandoned.count(),
                   questions.count(), answers.count())
            ))
            return

        # Answers reference questions, so they go first.
        removed_answers = self._delete_in_batches(answers)
        removed_questions = self._delete_in_batches(questions)

        # An abandoned run is closed off so it stops looking playable and its
        # score settles into the player's totals.
        closed = abandoned.update(is_finished=True, finished_at=now)

        self.stdout.write(self.style.SUCCESS(
            'Pruned %d sessions: %d questions, %d answers removed, %d abandoned runs closed. '
            'Scores and personal bests are untouched.'
            % (len(session_ids), removed_questions, removed_answers, closed)
        ))

    @staticmethod
    def _delete_in_batches(queryset):
        model = queryset.model
        deleted = 0
        while True:
            ids = list(queryset.values_list('id', flat=True)[:BATCH])
            if not ids:
                break
            deleted += model.objects.filter(id__in=ids).delete()[0]
        return deleted

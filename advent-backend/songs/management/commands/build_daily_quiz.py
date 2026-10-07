"""Build today's and tomorrow's daily quizzes ahead of the players.

Without it, the first person to open the quiz each day waits while twenty
questions are built — and the morning push sends many people at once. Run it
from the same scheduler as the morning pushes, a little before they go:

    python manage.py build_daily_quiz
"""
from datetime import timedelta

from django.core.management.base import BaseCommand

from songs.days import local_today
from songs.quiz import generate_for_date


class Command(BaseCommand):
    help = "Build today's and tomorrow's daily quiz in every language that has a Bible."

    def handle(self, *args, **options):
        today = local_today()
        for day in (today, today + timedelta(days=1)):
            for language in ('en', 'sw'):
                try:
                    quiz = generate_for_date(day, language=language)
                except ValueError as exc:
                    self.stderr.write(f'{day} {language}: {exc}')
                    continue
                self.stdout.write(f'{day} {language}: quiz {quiz.pk} ({quiz.language}, theme {quiz.theme or "none"})')

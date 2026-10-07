"""Forget sign-in records older than 90 days and blocks that have run out.

    python manage.py cleanup_security        (daily, with the other cleanups)
"""
from django.core.management.base import BaseCommand

from songs.security import KEEP_DAYS, prune


class Command(BaseCommand):
    help = f'Delete sign-in records older than {KEEP_DAYS} days and expired address blocks.'

    def handle(self, *args, **options):
        gone = prune()
        self.stdout.write(self.style.SUCCESS(f'Removed {gone} old sign-in record(s).'))

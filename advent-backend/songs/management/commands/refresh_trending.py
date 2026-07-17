"""Recompute the global trending list into cache.

Trending refreshes lazily on the first request after its cache expires, so this
command is OPTIONAL — it just pre-warms the cache so no user request ever pays
the compute. Wire it to a scheduler (e.g. Railway cron, every ~15 min) if you
want that:

    python manage.py refresh_trending
"""
from django.core.management.base import BaseCommand

from songs import feed


class Command(BaseCommand):
    help = "Recompute the global trending feed list into cache."

    def handle(self, *args, **options):
        trending = feed.compute_trending()
        self.stdout.write(self.style.SUCCESS(f'Trending refreshed: {len(trending)} posts.'))

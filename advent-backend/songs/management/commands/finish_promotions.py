"""Close promotions whose days are up (and flag refunds for any short of
their views). Serving the feed does this too; this catches quiet hours.
Schedule hourly or daily."""
from django.core.management.base import BaseCommand

from songs.promotions import finish_expired


class Command(BaseCommand):
    help = 'Finish promotions whose days are up.'

    def handle(self, *args, **options):
        finish_expired()

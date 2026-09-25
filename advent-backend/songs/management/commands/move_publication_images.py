"""Queue the move of chapters' old base64 pictures to R2 (run once after
deploying; the `run_worker` service does the moving).

    python manage.py move_publication_images
"""
from django.core.management.base import BaseCommand

from songs.publishing import queue_inline_image_moves


class Command(BaseCommand):
    help = "Queue moving publications' inline base64 pictures to R2."

    def handle(self, *args, **options):
        n = queue_inline_image_moves()
        self.stdout.write(f'Queued {n} chapter(s). The worker (run_worker) moves them.')

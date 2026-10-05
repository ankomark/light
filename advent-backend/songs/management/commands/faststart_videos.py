"""Queue every video post for the faststart check (songs/video_processing.py):
the ones uploaded before it existed start playing at once too. Safe to run
again — a video already rewritten, or already fine, is skipped quickly.

    python manage.py faststart_videos
"""
from django.core.management.base import BaseCommand

from songs.models import SocialPost
from songs.video_processing import queue_faststart


class Command(BaseCommand):
    help = 'Queue video posts so their files start playing at once (index first).'

    def handle(self, *args, **options):
        n = 0
        for post in SocialPost.objects.filter(content_type='video', is_removed=False).only('pk').iterator():
            queue_faststart(post)
            n += 1
        self.stdout.write(f'Queued {n} video posts.')

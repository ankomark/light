"""Queue every photo post without a grid still (songs/image_thumbs.py), so
grids made of older posts load fast too. Safe to run again.

    python manage.py image_thumbnails
"""
from django.core.management.base import BaseCommand
from django.db.models import Q

from songs.image_thumbs import queue_thumbnail
from songs.models import SocialPost


class Command(BaseCommand):
    help = 'Queue photo posts that have no small grid thumbnail yet.'

    def handle(self, *args, **options):
        n = 0
        posts = (SocialPost.objects.filter(content_type='image', is_removed=False)
                 .filter(Q(thumbnail__isnull=True) | Q(thumbnail='')).only('pk'))
        for post in posts.iterator():
            queue_thumbnail(post)
            n += 1
        self.stdout.write(f'Queued {n} photo posts.')

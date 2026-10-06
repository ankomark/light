"""Small stills for photo posts, so grids load fast.

A photo post had no thumbnail of its own: every grid tile (profiles, Explore,
hashtags, Favourites) downloaded the full-size photo — a few hundred KB to a
few MB each — to fill a square a few hundred pixels wide. A profile's first
30 tiles could be ten megabytes on a slow connection.

    enqueue('image_thumbnail', key=f'post:{id}', post_id=id)

The job reads the post's first photo once, shrinks it to GRID_EDGE on its
long side (EXIF rotation applied, JPEG), stores it beside the uploads and
sets post.thumbnail — which grids already prefer (thumbnail_url). The photo
itself is untouched; the feed and the post page keep showing it full size.
Runs on the same worker as the song and video jobs (no FFmpeg needed).
"""
import hashlib
import io
import logging

from django.db.models import Q

from . import media, r2
from .jobs import handler
from .models import SocialPost

logger = logging.getLogger(__name__)

GRID_EDGE = 640                 # long side: crisp in a 3-6 column grid on a dense screen
QUALITY = 78
MAX_SOURCE_BYTES = 30 * 1024 * 1024
FETCH_TIMEOUT = 60


def make_thumbnail(data):
    """JPEG bytes of `data` (an image) at most GRID_EDGE on its long side, or
    None for something that isn't a picture Pillow can read (HEIC, broken)."""
    from PIL import Image, ImageOps, UnidentifiedImageError
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img)
        img.thumbnail((GRID_EDGE, GRID_EDGE))
        if img.mode not in ('RGB', 'L'):
            # Transparency on white, not black, as a phone would show it.
            canvas = Image.new('RGB', img.size, (255, 255, 255))
            rgba = img.convert('RGBA')
            canvas.paste(rgba, mask=rgba.split()[-1])
            img = canvas
        out = io.BytesIO()
        img.save(out, 'JPEG', quality=QUALITY, optimize=True, progressive=True)
        return out.getvalue()
    except (UnidentifiedImageError, OSError, ValueError):
        return None


@handler('image_thumbnail')
def image_thumbnail(post_id):
    post = SocialPost.objects.filter(pk=post_id, content_type='image').first()
    if post is None or post.is_removed or post.thumbnail or not post.media_file:
        return
    url = media.resolve(post.media_file)
    # Only our own storage is fetched server-side.
    if not url or not r2.is_r2_url(url) or not r2.is_configured():
        return
    from .audio_tags import _fetch
    try:
        data, _ = _fetch(url, MAX_SOURCE_BYTES)
    except ValueError:
        return                  # too large: the tile keeps the photo
    thumb = make_thumbnail(data)
    if thumb is None:
        logger.info('image_thumbnail: post %s is not a picture Pillow reads', post.pk)
        return
    version = hashlib.sha1(post.media_file.encode('utf-8')).hexdigest()[:10]
    thumb_url = r2.put_bytes(f'thumbs/posts/{post.pk}/{version}.jpg', thumb, 'image/jpeg')
    # Only if nothing changed meanwhile (an edit, a poster set by hand).
    # (thumbnail__in=('', None) would never match NULL: SQL's IN skips it.)
    SocialPost.objects.filter(pk=post.pk, media_file=post.media_file) \
        .filter(Q(thumbnail__isnull=True) | Q(thumbnail='')).update(thumbnail=thumb_url)


def queue_thumbnail(post):
    from .jobs import enqueue
    return enqueue('image_thumbnail', key=f'post:{post.pk}', post_id=post.pk)

"""A deleted account's files leave storage with it.

Deleting a user removes their rows (the database cascades), but the pictures,
songs, videos and attachments those rows pointed at stayed in R2 for good:
someone who asked to be gone was still in the bucket.

The files are found the way the deletion itself finds the rows: Django's own
collector says exactly what a delete will remove, and every one of our
storage URLs in those rows is a candidate. Only then, once the account is
gone, each candidate still used by anyone else is kept — another person's post
can carry a song's audio (song_audio_url) and a forwarded message can carry
an attachment — and the rest is deleted.

Legacy Cloudinary references (not R2 URLs) are left alone: there is no
delete for them here.
"""
import logging

from django.db import router
from django.db.models import CharField, JSONField, TextField
from django.db.models.deletion import Collector

from . import r2

logger = logging.getLogger(__name__)

# Fields where a file can be shared with someone else's rows: checked after
# the delete, and a file still named there is kept.
SHARED = (
    ('SocialPost', 'song_audio_url'),
    ('SocialPost', 'media_file'),
    ('SocialPost', 'thumbnail'),
    ('Story', 'media_url'),
    ('Message', 'attachment'),
    ('GroupPost', 'attachment'),
    ('Track', 'audio_file'),
)


def _walk(value, out):
    """Our storage URLs in a field's value (a string, or JSON holding them)."""
    if isinstance(value, str):
        v = value.strip()
        if v and ' ' not in v and r2.is_r2_url(v):
            out.add(v.split('?')[0])
    elif isinstance(value, dict):
        for x in value.values():
            _walk(x, out)
    elif isinstance(value, (list, tuple)):
        for x in value:
            _walk(x, out)


def _text_fields(model):
    return [f.attname for f in model._meta.concrete_fields
            if isinstance(f, (CharField, TextField, JSONField))]


def files_of(user):
    """Every R2 URL in the rows that deleting `user` will remove."""
    if not r2.is_configured():
        return set()
    collector = Collector(using=router.db_for_write(type(user)))
    collector.collect([user])
    urls = set()
    for model, instances in collector.data.items():
        fields = _text_fields(model)
        for obj in instances:
            for name in fields:
                _walk(getattr(obj, name, None), urls)
    for qs in collector.fast_deletes:
        fields = _text_fields(qs.model)
        if fields:
            for row in qs.values_list(*fields).iterator(chunk_size=2000):
                for value in row:
                    _walk(value, urls)
    return urls


def still_used(urls):
    """Of `urls`, those someone else's rows still name."""
    from django.apps import apps
    urls = list(urls)
    used = set()
    for i in range(0, len(urls), 500):
        chunk = urls[i:i + 500]
        for model_name, field in SHARED:
            try:
                model = apps.get_model('songs', model_name)
                used.update(model.objects.filter(**{f'{field}__in': chunk}).values_list(field, flat=True))
            except Exception:  # noqa: BLE001 — a field renamed: keep rather than delete
                logger.exception('purge: could not check %s.%s', model_name, field)
                return set(urls)
    return used


def purge(urls):
    """Delete the files no one else uses. Never raises. Returns how many."""
    try:
        keep = still_used(urls)
        gone = 0
        for url in urls:
            if url not in keep:
                r2.delete(url)
                gone += 1
        return gone
    except Exception:  # noqa: BLE001 — storage clean-up never fails a deletion
        logger.exception('purge of a deleted account failed')
        return 0

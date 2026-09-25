"""Chapter.word_count: the book page's "N min read" without loading bodies.

Existing chapters are counted here, a chapter at a time (bodies can carry
large base64 images, so they're never all loaded at once).
"""
import re

from django.db import migrations, models

# A copy of Chapter.count_words as it was written, so this migration keeps
# working whatever later happens to the model.
_IMAGE = re.compile(r'!\[[^\]]*\]\([^)]*\)')
_LINK = re.compile(r'\[([^\]]*)\]\([^)]*\)')
_WORD = re.compile(r"[^\W_]+(?:['’-][^\W_]+)*")


def _count(body):
    return len(_WORD.findall(_LINK.sub(r'\1', _IMAGE.sub(' ', body or ''))))


def count_existing(apps, schema_editor):
    Chapter = apps.get_model('songs', 'Chapter')
    for pk in list(Chapter.objects.values_list('pk', flat=True)):
        body = Chapter.objects.filter(pk=pk).values_list('body', flat=True).first() or ''
        Chapter.objects.filter(pk=pk).update(word_count=_count(body))


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0131_track_spectrum'),
    ]

    operations = [
        migrations.AddField(
            model_name='chapter',
            name='word_count',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.RunPython(count_existing, migrations.RunPython.noop),
    ]

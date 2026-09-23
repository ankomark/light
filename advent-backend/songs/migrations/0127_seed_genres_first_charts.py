"""Seed the starter genres (admins can add, rename or reorder them in the
admin) and queue the first chart refresh — the job then reschedules itself
every hour (songs/charts.py)."""
from django.db import migrations
from django.utils import timezone

GENRES = [
    ('gospel', 'Gospel'),
    ('worship', 'Worship'),
    ('hymns', 'Hymns'),
    ('choir', 'Choir'),
    ('praise', 'Praise'),
    ('acapella', 'A cappella'),
    ('afro-gospel', 'Afro Gospel'),
    ('contemporary', 'Contemporary Christian'),
    ('instrumental', 'Instrumental'),
    ('kids', 'Children'),
]


def seed(apps, schema_editor):
    Category = apps.get_model('songs', 'Category')
    Job = apps.get_model('songs', 'Job')
    for position, (slug, name) in enumerate(GENRES):
        cat = Category.objects.filter(name__iexact=name).first() or Category.objects.filter(slug=slug).first()
        if cat is None:
            Category.objects.create(slug=slug, name=name, position=position)
        else:
            cat.slug = cat.slug or slug
            cat.position = position
            cat.save(update_fields=['slug', 'position'])
    if not Job.objects.filter(kind='refresh_charts', status='queued').exists():
        Job.objects.create(kind='refresh_charts', key='charts', payload={}, run_after=timezone.now())


def unseed(apps, schema_editor):
    apps.get_model('songs', 'Job').objects.filter(kind='refresh_charts', status='queued').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0126_genres_charts_country'),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]

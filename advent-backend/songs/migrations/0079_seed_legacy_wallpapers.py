from django.db import migrations

R2 = 'https://pub-9c5a2f0a7a2244be84e39a116c2dc4d5.r2.dev/wallpapers'

# The wallpapers that used to be hardcoded in the app: five general backdrops in
# RotatingBackground and five music-tab ones in App.js. Seeding them as ordinary
# rows is what puts them under admin control — before this they could not be
# reordered, hidden or deleted, because they only existed in the bundle.
LEGACY = [
    ('general', 's366jodfjqsiikqn39ps.jpg'),
    ('general', 'f0y17m0ksh6a2tbq33f6.jpg'),
    ('general', 'jyd6lms0aunhdjo68xuw.jpg'),
    ('general', 'cvw0s1bab1zxoy024zg6.jpg'),
    ('general', 'run4ngtxwlslhn0ontn9.jpg'),
    ('music', 'wg19rbjnqphztrcsan0b.jpg'),
    ('music', 'fjcbdllwljh0dvglousp.jpg'),
    ('music', 'jxggwl3ltobv4l0o8sqq.jpg'),
    ('music', 'ikinna96rzqdle0ztcoy.jpg'),
    ('music', 'gvwuacmn04nq1b25axs1.jpg'),
]


def seed(apps, schema_editor):
    Wallpaper = apps.get_model('songs', 'Wallpaper')
    # Only seed an empty table. If an admin has already curated a set (e.g. this
    # migration is re-run after a squash), don't resurrect the old images.
    if Wallpaper.objects.exists():
        return
    order = {'general': 0, 'music': 0}
    for scope, filename in LEGACY:
        Wallpaper.objects.create(
            image=f'{R2}/{filename}',
            title='',
            scope=scope,
            is_active=True,
            sort_order=order[scope],
        )
        order[scope] += 1


def unseed(apps, schema_editor):
    """Reverse: drop only the rows this migration created, matched by URL, and
    only those still untouched — a wallpaper an admin renamed or deactivated is
    theirs now, not ours to remove."""
    Wallpaper = apps.get_model('songs', 'Wallpaper')
    urls = [f'{R2}/{name}' for _scope, name in LEGACY]
    Wallpaper.objects.filter(image__in=urls, title='', is_active=True).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0078_wallpaper_scope'),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]

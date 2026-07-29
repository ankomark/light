"""Add User.total_likes (lifetime likes on everything a user published) and
backfill it from the existing like tables so the new profile stat is correct
for accounts that already have content."""
from django.db import migrations, models
from django.db.models import Count, Sum


def backfill(apps, schema_editor):
    User = apps.get_model('songs', 'User')
    LiveBroadcast = apps.get_model('songs', 'LiveBroadcast')

    users = User.objects.annotate(
        post_likes=Count('social_posts__likes', distinct=True),
        track_likes=Count('tracks__likes', distinct=True),
        pub_likes=Count('publications__likes', distinct=True),
    )
    # Live hearts are a stored tally, so they need a SUM — which would be
    # inflated if it shared the joins above. Grouped separately.
    live_likes = dict(
        LiveBroadcast.objects.values_list('host_id')
        .annotate(n=Sum('like_count'))
        .values_list('host_id', 'n')
    )

    batch = []
    for user in users:
        total = (
            user.post_likes + user.track_likes + user.pub_likes
            + (live_likes.get(user.id) or 0)
        )
        if total:
            user.total_likes = total
            batch.append(user)
        if len(batch) >= 500:
            User.objects.bulk_update(batch, ['total_likes'])
            batch = []
    if batch:
        User.objects.bulk_update(batch, ['total_likes'])


def noop(apps, schema_editor):
    """Reversing drops the column, so there is nothing to undo."""


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0094_livebroadcast_overlay'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='total_likes',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.RunPython(backfill, noop),
    ]

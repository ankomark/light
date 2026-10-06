# Profile phases 2 and 4: a display name and a link on the profile; posts
# pinned to the top of their author's grid.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0177_takedown_albums_playlists'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='display_name',
            field=models.CharField(blank=True, default='', max_length=50),
        ),
        migrations.AddField(
            model_name='profile',
            name='website',
            field=models.CharField(blank=True, default='', max_length=200),
        ),
        migrations.AddField(
            model_name='socialpost',
            name='pinned_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]

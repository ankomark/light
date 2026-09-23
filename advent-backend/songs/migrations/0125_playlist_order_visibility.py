"""Playlists: an order, a description, a cover and a visibility.

The songs in a playlist lived in Django's automatic many-to-many table
(songs_playlist_tracks: id, playlist_id, track_id). Rather than copy them to a
new table, that table is adopted as the PlaylistTrack model (state only), then
given `position` and `added_at`. Existing songs keep the order they were
added in (their row id)."""
import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


def number_existing(apps, schema_editor):
    PlaylistTrack = apps.get_model('songs', 'PlaylistTrack')
    rows = PlaylistTrack.objects.order_by('playlist_id', 'id').values_list('id', 'playlist_id')
    updates, last, pos = [], None, 0
    for pk, playlist_id in rows:
        pos = pos + 1 if playlist_id == last else 0
        last = playlist_id
        updates.append(PlaylistTrack(pk=pk, position=pos))
    PlaylistTrack.objects.bulk_update(updates, ['position'], batch_size=500)


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0124_queue_existing_tracks'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.CreateModel(
                    name='PlaylistTrack',
                    fields=[
                        ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                        ('playlist', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='items', to='songs.playlist')),
                        ('track', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='playlist_items', to='songs.track')),
                    ],
                    options={
                        'db_table': 'songs_playlist_tracks',
                        'unique_together': {('playlist', 'track')},
                    },
                ),
                migrations.AlterField(
                    model_name='playlist',
                    name='tracks',
                    field=models.ManyToManyField(blank=True, related_name='playlists', through='songs.PlaylistTrack', to='songs.track'),
                ),
            ],
            database_operations=[],
        ),
        migrations.AddField(
            model_name='playlisttrack',
            name='position',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='playlisttrack',
            name='added_at',
            field=models.DateTimeField(default=django.utils.timezone.now),
        ),
        migrations.AlterModelOptions(
            name='playlisttrack',
            options={'ordering': ['position', 'id']},
        ),
        migrations.AddIndex(
            model_name='playlisttrack',
            index=models.Index(fields=['playlist', 'position'], name='playlisttrack_order_idx'),
        ),
        migrations.AddField(
            model_name='playlist',
            name='description',
            field=models.CharField(blank=True, default='', max_length=300),
        ),
        migrations.AddField(
            model_name='playlist',
            name='cover_image',
            field=models.CharField(blank=True, default='', max_length=500),
        ),
        migrations.AddField(
            model_name='playlist',
            name='visibility',
            field=models.CharField(choices=[('private', 'Private'), ('unlisted', 'Unlisted'), ('public', 'Public')], default='private', max_length=10),
        ),
        migrations.RunPython(number_existing, migrations.RunPython.noop),
    ]

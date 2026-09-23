"""Turn the album names typed on songs into albums: one per artist and name
(case-insensitive), its songs numbered in the order they were uploaded, and
its cover the first song's."""
from django.db import migrations


def build(apps, schema_editor):
    Track = apps.get_model('songs', 'Track')
    Album = apps.get_model('songs', 'Album')
    groups = {}
    for t in (Track.objects.filter(album_ref__isnull=True).exclude(album__isnull=True).exclude(album='')
              .order_by('created_at', 'id').only('id', 'artist_id', 'album', 'cover_image')):
        name = t.album.strip()
        if name:
            groups.setdefault((t.artist_id, name.lower()), []).append(t)
    for (artist_id, _), tracks in groups.items():
        album = Album.objects.create(
            artist_id=artist_id, title=tracks[0].album.strip()[:100],
            cover_image=next((t.cover_image for t in tracks if t.cover_image), '') or '',
        )
        for n, t in enumerate(tracks, start=1):
            Track.objects.filter(pk=t.pk).update(album_ref=album, track_number=n)


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0128_artists_albums'),
    ]

    operations = [
        migrations.RunPython(build, migrations.RunPython.noop),
    ]

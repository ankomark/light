"""Repair SocialPost.media_file values corrupted by re-saving the row.

Editing a post used to re-save the whole model, which made the CloudinaryField
prepend an 'auto/upload/' segment to the stored public_id (e.g.
'social_media/abc' -> 'auto/upload/social_media/abc'). That 404s the image after
the next reload. The serializer's update() no longer re-saves media_file, so no
new rows get corrupted; this migration heals the ones already affected.

We use raw SQL on purpose: assigning through the ORM/CloudinaryField would just
re-introduce the same 'auto/upload/' prefix.
"""
from django.db import migrations


PREFIX = 'auto/upload/'


def heal(apps, schema_editor):
    SocialPost = apps.get_model('songs', 'SocialPost')
    table = SocialPost._meta.db_table
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            f"SELECT id, media_file FROM {table} WHERE media_file LIKE %s",
            [PREFIX + '%'],
        )
        rows = cursor.fetchall()
        for pk, media_file in rows:
            cleaned = media_file
            while cleaned.startswith(PREFIX):  # strip one or more leading prefixes
                cleaned = cleaned[len(PREFIX):]
            if cleaned != media_file:
                cursor.execute(
                    f"UPDATE {table} SET media_file = %s WHERE id = %s",
                    [cleaned, pk],
                )


def noop(apps, schema_editor):
    # Irreversible by design — we don't want to re-corrupt healed rows.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0025_socialpost_song_artist_socialpost_song_audio_url_and_more'),
    ]

    operations = [
        migrations.RunPython(heal, noop),
    ]

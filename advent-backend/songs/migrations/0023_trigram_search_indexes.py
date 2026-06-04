"""Enable pg_trgm and add trigram GIN indexes on searched text columns.

These accelerate the existing `icontains` (ILIKE '%...%') search/filter queries
on Postgres. Postgres-only: the extension op is a no-op off Postgres and the
index creation is guarded by vendor, so the SQLite test database is unaffected.
"""
from django.contrib.postgres.operations import TrigramExtension
from django.db import migrations

# (index_name, table, column) — Django default table names (app_label_model).
TRGM_INDEXES = [
    ('songs_user_username_trgm', 'songs_user', 'username'),
    ('songs_socialpost_caption_trgm', 'songs_socialpost', 'caption'),
    ('songs_socialpost_location_trgm', 'songs_socialpost', 'location'),
    ('songs_socialpost_tags_trgm', 'songs_socialpost', 'tags'),
    ('songs_track_title_trgm', 'songs_track', 'title'),
    ('songs_track_album_trgm', 'songs_track', 'album'),
    ('songs_group_name_trgm', 'songs_group', 'name'),
    ('songs_group_description_trgm', 'songs_group', 'description'),
]


def create_indexes(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    for name, table, col in TRGM_INDEXES:
        schema_editor.execute(
            f'CREATE INDEX IF NOT EXISTS {name} ON {table} USING gin ({col} gin_trgm_ops);'
        )


def drop_indexes(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    for name, _table, _col in TRGM_INDEXES:
        schema_editor.execute(f'DROP INDEX IF EXISTS {name};')


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0022_remove_socialpost_song_end_time_and_more'),
    ]

    operations = [
        TrigramExtension(),
        migrations.RunPython(create_indexes, drop_indexes),
    ]

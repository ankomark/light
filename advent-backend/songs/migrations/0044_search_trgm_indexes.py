"""GIN trigram indexes so the feed's `icontains` search uses an index instead
of a full sequential scan.

With the pg_trgm extension, Postgres can satisfy `column ILIKE '%term%'` from a
GIN trigram index — turning search from O(rows) into an index lookup. This is a
no-op on SQLite (local dev): the existing icontains queries keep working there,
just unindexed.
"""
from django.db import migrations


PG_STATEMENTS = [
    "CREATE EXTENSION IF NOT EXISTS pg_trgm;",
    "CREATE INDEX IF NOT EXISTS socialpost_caption_trgm "
    "ON songs_socialpost USING gin (caption gin_trgm_ops);",
    "CREATE INDEX IF NOT EXISTS socialpost_tags_trgm "
    "ON songs_socialpost USING gin (tags gin_trgm_ops);",
    "CREATE INDEX IF NOT EXISTS socialpost_location_trgm "
    "ON songs_socialpost USING gin (location gin_trgm_ops);",
    "CREATE INDEX IF NOT EXISTS user_username_trgm "
    "ON songs_user USING gin (username gin_trgm_ops);",
]

PG_REVERSE = [
    "DROP INDEX IF EXISTS socialpost_caption_trgm;",
    "DROP INDEX IF EXISTS socialpost_tags_trgm;",
    "DROP INDEX IF EXISTS socialpost_location_trgm;",
    "DROP INDEX IF EXISTS user_username_trgm;",
]


def create_indexes(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    for sql in PG_STATEMENTS:
        schema_editor.execute(sql)


def drop_indexes(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    for sql in PG_REVERSE:
        schema_editor.execute(sql)


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0043_backfill_engagement_counts'),
    ]

    operations = [
        migrations.RunPython(create_indexes, drop_indexes),
    ]

"""Trigram indexes for search (Postgres only).

Search finds rows whose names, titles and descriptions *contain* the typed
words or three-letter pieces of them (songs/search.py) - Django writes that as
UPPER(col) LIKE UPPER('%piece%'), which an ordinary index cannot serve, so
every search read whole tables. A GIN trigram index on UPPER(col) can: the
same queries, answered from the index as the tables grow.

On SQLite (tests, local) this does nothing. On Postgres each step runs in its
own savepoint: if the pg_trgm extension cannot be created (a database without
the privilege), search keeps working exactly as before - only slower - and the
deploy is not blocked.
"""
from django.db import migrations, transaction

# (model, field) pairs searched with icontains.
FIELDS = [
    ('User', 'username'), ('Profile', 'bio'),
    ('Track', 'title'), ('Track', 'album'),
    ('Album', 'title'),
    ('Playlist', 'name'), ('Playlist', 'description'),
    ('Group', 'name'), ('Group', 'description'),
    ('Publication', 'title'), ('Publication', 'summary'),
    ('Videostudio', 'name'), ('Videostudio', 'location'), ('Videostudio', 'description'),
    # Post search matches caption OR location: an OR uses the indexes only
    # when both sides have one (else it reads every post).
    ('SocialPost', 'location'),
    ('SocialPost', 'caption'), ('SocialPost', 'tags'), ('Product', 'title'), ('Product', 'description'),
]


def _index_name(table, column):
    return f'trgm_{table}_{column}'[:63]


def forwards(apps, schema_editor):
    conn = schema_editor.connection
    if conn.vendor != 'postgresql':
        return
    with conn.cursor() as cur:
        try:
            with transaction.atomic(using=conn.alias):
                cur.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm')
        except Exception:  # noqa: BLE001 - no privilege: search stays as it was
            return
        for model_name, field_name in FIELDS:
            try:
                model = apps.get_model('songs', model_name)
                field = model._meta.get_field(field_name)
            except LookupError:
                continue
            table, column = model._meta.db_table, field.column
            try:
                with transaction.atomic(using=conn.alias):
                    cur.execute(
                        f'CREATE INDEX IF NOT EXISTS "{_index_name(table, column)}" ON "{table}" '
                        f'USING gin (UPPER("{column}"::text) gin_trgm_ops)'
                    )
            except Exception:  # noqa: BLE001 - one index failing must not stop the rest
                continue


def backwards(apps, schema_editor):
    conn = schema_editor.connection
    if conn.vendor != 'postgresql':
        return
    with conn.cursor() as cur:
        for model_name, field_name in FIELDS:
            try:
                model = apps.get_model('songs', model_name)
                field = model._meta.get_field(field_name)
            except LookupError:
                continue
            cur.execute(f'DROP INDEX IF EXISTS "{_index_name(model._meta.db_table, field.column)}"')


class Migration(migrations.Migration):
    dependencies = [('songs', '0188_live_pinned_muted')]
    operations = [migrations.RunPython(forwards, backwards)]

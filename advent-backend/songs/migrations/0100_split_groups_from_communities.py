"""Separate groups from communities again.

Merging Choir and Church onto the Group engine was right — they were the same
machinery twice. But sharing the engine is not the same as being the same
feature: a group is a private circle you make with people you know, a community
is a public place anyone can start and browse by category. This marks which is
which, so each gets its own list, its own create flow and its own menu entry.

Rows that came from a Church or Choir (they carry one of those categories)
become communities; everything that existed as a group stays a group and loses
the placeholder category it was backfilled with.
"""
from django.db import migrations


def split(apps, schema_editor):
    Group = apps.get_model('songs', 'Group')

    # The migrated churches/choirs are exactly the rows carrying those two
    # categories — nothing else could have had one yet.
    Group.objects.filter(category__slug__in=['church', 'choir']).update(kind='community')
    # Everything else predates communities and is a real group; the 'General'
    # backfill was a bookkeeping step that no longer applies to them.
    Group.objects.exclude(category__slug__in=['church', 'choir']).update(
        kind='group', category=None,
    )


def unsplit(apps, schema_editor):
    apps.get_model('songs', 'Group').objects.update(kind='group')


class Migration(migrations.Migration):

    dependencies = [('songs', '0099_group_kind')]

    operations = [migrations.RunPython(split, unsplit)]

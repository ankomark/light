from django.db import migrations


def backfill_admins(apps, schema_editor):
    """Make every existing choir's creator an admin member of its community."""
    Choir = apps.get_model('songs', 'Choir')
    ChoirMembership = apps.get_model('songs', 'ChoirMembership')
    for choir in Choir.objects.all().iterator():
        if choir.created_by_id:
            ChoirMembership.objects.get_or_create(
                choir=choir, user_id=choir.created_by_id,
                defaults={'role': 'admin'},
            )


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0054_choirjoinrequest_choirmembership_choirmessage'),
    ]

    operations = [
        migrations.RunPython(backfill_admins, noop),
    ]

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0060_group_only_admins_can_post'),
    ]

    operations = [
        migrations.AddField(
            model_name='group',
            name='invite_code',
            field=models.UUIDField(blank=True, db_index=True, null=True, unique=True),
        ),
    ]

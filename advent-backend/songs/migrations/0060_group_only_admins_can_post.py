from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0059_publication_theme'),
    ]

    operations = [
        migrations.AddField(
            model_name='group',
            name='only_admins_can_post',
            field=models.BooleanField(default=False),
        ),
    ]

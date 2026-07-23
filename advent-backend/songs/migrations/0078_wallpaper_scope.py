from django.db import migrations, models


class Migration(migrations.Migration):
    """Adds Wallpaper.scope as its own step.

    It deliberately is NOT folded into 0077: that migration has already been
    applied, so Django would never re-run it and the column would never appear.
    """

    dependencies = [
        ('songs', '0077_wallpaper'),
    ]

    operations = [
        migrations.AddField(
            model_name='wallpaper',
            name='scope',
            field=models.CharField(
                choices=[('general', 'General (most screens)'), ('music', 'Music')],
                db_index=True, default='general', max_length=20,
            ),
        ),
    ]

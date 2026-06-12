from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0036_alter_grouppost_options_groupmember_last_read_at_and_more'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='church',
            name='continent',
        ),
    ]

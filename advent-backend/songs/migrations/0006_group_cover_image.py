# Generated by Django 5.2.1 on 2025-06-18 17:56

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0005_grouppostattachment'),
    ]

    operations = [
        migrations.AddField(
            model_name='group',
            name='cover_image',
            field=models.ImageField(blank=True, null=True, upload_to='group_covers/'),
        ),
    ]

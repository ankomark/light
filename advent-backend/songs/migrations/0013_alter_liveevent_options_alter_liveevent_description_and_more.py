# Generated by Django 5.2 on 2025-07-07 21:01

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0012_liveevent'),
    ]

    operations = [
        migrations.AlterModelOptions(
            name='liveevent',
            options={'ordering': ['-start_time'], 'verbose_name': 'Live Event', 'verbose_name_plural': 'Live Events'},
        ),
        migrations.AlterField(
            model_name='liveevent',
            name='description',
            field=models.TextField(blank=True, help_text='Detailed description of the event', null=True),
        ),
        migrations.AlterField(
            model_name='liveevent',
            name='end_time',
            field=models.DateTimeField(blank=True, help_text='When the event ended', null=True),
        ),
        migrations.AlterField(
            model_name='liveevent',
            name='is_live',
            field=models.BooleanField(default=True, help_text='Whether the event is currently live'),
        ),
        migrations.AlterField(
            model_name='liveevent',
            name='start_time',
            field=models.DateTimeField(auto_now_add=True, help_text='When the event started'),
        ),
        migrations.AlterField(
            model_name='liveevent',
            name='thumbnail',
            field=models.URLField(blank=True, help_text='Thumbnail image URL for the event', null=True),
        ),
        migrations.AlterField(
            model_name='liveevent',
            name='title',
            field=models.CharField(help_text='Title of the live event', max_length=200),
        ),
        migrations.AlterField(
            model_name='liveevent',
            name='user',
            field=models.ForeignKey(help_text='The user who created this live event', on_delete=django.db.models.deletion.CASCADE, related_name='live_events', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AlterField(
            model_name='liveevent',
            name='viewers_count',
            field=models.PositiveIntegerField(default=0, help_text='Number of viewers who watched this event'),
        ),
        migrations.AlterField(
            model_name='liveevent',
            name='youtube_url',
            field=models.URLField(help_text='URL of the YouTube live stream', max_length=500),
        ),
    ]

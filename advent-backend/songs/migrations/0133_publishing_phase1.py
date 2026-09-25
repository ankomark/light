"""Publishing phase 1: chapters edited in place with a version and a history,
draft chapters, chapter takedowns, reading activity, and where in a chapter a
reader is."""
import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0132_chapter_word_count'),
    ]

    operations = [
        migrations.AddField(
            model_name='chapter',
            name='status',
            field=models.CharField(choices=[('draft', 'Draft'), ('published', 'Published')], default='published', max_length=10),
        ),
        migrations.AddField(
            model_name='chapter',
            name='version',
            field=models.PositiveIntegerField(default=1),
        ),
        migrations.AddField(
            model_name='chapter',
            name='updated_at',
            field=models.DateTimeField(auto_now=True, default=django.utils.timezone.now),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='chapter',
            name='is_removed',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='readingprogress',
            name='position',
            field=models.FloatField(default=0),
        ),
        migrations.CreateModel(
            name='ChapterRevision',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('version', models.PositiveIntegerField()),
                ('title', models.CharField(blank=True, max_length=200)),
                ('body', models.TextField(blank=True)),
                ('word_count', models.PositiveIntegerField(default=0)),
                ('reason', models.CharField(default='edit', max_length=10)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('chapter_ref', models.PositiveIntegerField()),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('publication', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='revisions', to='songs.publication')),
            ],
            options={
                'ordering': ['-created_at', '-id'],
                'indexes': [models.Index(fields=['publication', 'chapter_ref', '-created_at'], name='chrev_pub_ch_idx')],
            },
        ),
        migrations.CreateModel(
            name='ReadingActivity',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('chapter_index', models.PositiveIntegerField()),
                ('day', models.DateField()),
                ('seconds', models.PositiveIntegerField(default=0)),
                ('furthest', models.FloatField(default=0)),
                ('finished', models.BooleanField(default=False)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('chapter', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='songs.chapter')),
                ('publication', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='reading_activity', to='songs.publication')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='reading_activity', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'unique_together': {('user', 'publication', 'chapter_index', 'day')},
                'indexes': [
                    models.Index(fields=['publication', 'day'], name='readact_pub_day_idx'),
                    models.Index(fields=['user', 'day'], name='readact_user_day_idx'),
                ],
            },
        ),
    ]

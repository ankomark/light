from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0018_user_is_email_verified_emailverification'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Story',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('media_file', models.CharField(blank=True, max_length=500)),
                ('media_url', models.URLField(blank=True, max_length=1000)),
                ('content_type', models.CharField(
                    choices=[('image', 'Image'), ('video', 'Video')],
                    default='image',
                    max_length=10,
                )),
                ('caption', models.CharField(blank=True, max_length=200)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('expires_at', models.DateTimeField()),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='stories',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'ordering': ['-created_at'], 'verbose_name_plural': 'stories'},
        ),
        migrations.CreateModel(
            name='StoryView',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('viewed_at', models.DateTimeField(auto_now_add=True)),
                ('story', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='views',
                    to='songs.story',
                )),
                ('viewer', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='story_views',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'unique_together': {('story', 'viewer')}},
        ),
        migrations.CreateModel(
            name='Report',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('content_type', models.CharField(max_length=20)),
                ('object_id', models.PositiveIntegerField()),
                ('reason', models.CharField(
                    choices=[
                        ('spam', 'Spam'),
                        ('hate', 'Hate Speech'),
                        ('violence', 'Violence or Threats'),
                        ('inappropriate', 'Inappropriate Content'),
                        ('misinformation', 'Misinformation'),
                        ('copyright', 'Copyright Violation'),
                        ('other', 'Other'),
                    ],
                    max_length=20,
                )),
                ('description', models.TextField(blank=True)),
                ('status', models.CharField(
                    choices=[
                        ('pending', 'Pending Review'),
                        ('reviewed', 'Under Review'),
                        ('resolved', 'Resolved'),
                        ('dismissed', 'Dismissed'),
                    ],
                    default='pending',
                    max_length=20,
                )),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('reporter', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='reports_filed',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['-created_at'],
                'unique_together': {('reporter', 'content_type', 'object_id')},
            },
        ),
    ]

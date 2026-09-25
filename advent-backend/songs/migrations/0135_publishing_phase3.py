"""Publishing phase 3: editor's picks, reviews, chapter discussions, and a
notification switch for new books and chapters."""
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0134_publishing_phase2'),
    ]

    operations = [
        migrations.AddField(
            model_name='publication',
            name='featured_at',
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name='notificationpreference',
            name='books',
            field=models.BooleanField(default=True),
        ),
        migrations.CreateModel(
            name='BookReview',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('rating', models.PositiveSmallIntegerField()),
                ('body', models.TextField(blank=True, default='', max_length=4000)),
                ('is_removed', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('publication', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='reviews', to='songs.publication')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='book_reviews', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-updated_at', '-id'],
                'unique_together': {('publication', 'user')},
            },
        ),
        migrations.CreateModel(
            name='ChapterComment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('body', models.TextField(max_length=2000)),
                ('is_removed', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('chapter', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='comments', to='songs.chapter')),
                ('parent', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='replies', to='songs.chaptercomment')),
                ('publication', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='chapter_comments', to='songs.publication')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='chapter_comments', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['created_at', 'id'],
                'indexes': [models.Index(fields=['chapter', 'created_at'], name='chcomment_chapter_idx')],
            },
        ),
    ]

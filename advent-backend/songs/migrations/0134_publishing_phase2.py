"""Publishing phase 2: how far through a book a reader is and when they
finished it, and highlights / notes in books."""
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0133_publishing_phase1'),
    ]

    operations = [
        migrations.AddField(
            model_name='readingprogress',
            name='percent',
            field=models.FloatField(default=0),
        ),
        migrations.AddField(
            model_name='readingprogress',
            name='finished_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name='BookHighlight',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('client_id', models.CharField(max_length=40)),
                ('block', models.PositiveIntegerField(default=0)),
                ('quote', models.TextField(max_length=2000)),
                ('color', models.CharField(blank=True, default='', max_length=10)),
                ('note', models.TextField(blank=True, default='', max_length=4000)),
                ('deleted', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField()),
                ('updated_at', models.DateTimeField()),
                ('chapter', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='songs.chapter')),
                ('publication', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='highlights', to='songs.publication')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='book_highlights', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-updated_at', '-id'],
                'indexes': [models.Index(fields=['user', 'publication', '-updated_at'], name='bookhl_user_pub_idx')],
                'unique_together': {('user', 'client_id')},
            },
        ),
    ]

"""Publishing phase 5: book clubs (a group reading a book on a plan)."""
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0136_publishing_phase4'),
    ]

    operations = [
        migrations.CreateModel(
            name='BookClub',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('starts_on', models.DateField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('group', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='book_club', to='songs.group')),
                ('publication', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='clubs', to='songs.publication')),
            ],
        ),
        migrations.CreateModel(
            name='BookClubMilestone',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('through_chapter', models.PositiveIntegerField()),
                ('due', models.DateField()),
                ('club', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='milestones', to='songs.bookclub')),
            ],
            options={
                'ordering': ['due', 'through_chapter'],
            },
        ),
    ]

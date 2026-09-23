"""Queue every existing song for processing (loudness, AAC versions, waveform,
cover sizes). The job worker works through them after deploy; until each is
done, it keeps playing its original file."""
from django.db import migrations
from django.utils import timezone


def queue_all(apps, schema_editor):
    Track = apps.get_model('songs', 'Track')
    Job = apps.get_model('songs', 'Job')
    now = timezone.now()
    queued = set(Job.objects.filter(kind='process_track', status='queued').values_list('key', flat=True))
    rows = [
        Job(kind='process_track', key=f'track:{pk}', payload={'track_id': pk}, run_after=now)
        for pk in Track.objects.filter(is_removed=False).order_by('-created_at').values_list('pk', flat=True)
        if f'track:{pk}' not in queued
    ]
    Job.objects.bulk_create(rows, batch_size=500)


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0123_track_processing_jobs'),
    ]

    operations = [
        migrations.RunPython(queue_all, migrations.RunPython.noop),
    ]

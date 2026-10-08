"""Database backups in the private R2 bucket (BACKUP_R2_BUCKET).

pg_dump runs in the database container (matching version); this command only
moves the bytes, streaming - a large dump never sits in memory:

    pg_dump ... | python manage.py db_backup upload            (deploy/app/backup.sh)
    python manage.py db_backup list
    python manage.py db_backup download <name> --to /tmp/dump.pgc  (deploy/app/restore.sh)
    python manage.py db_backup prune --keep 14

Refuses to use the public media bucket: a dump holds every account.
"""
import sys

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from songs import r2

PREFIX = 'db/'


class Command(BaseCommand):
    help = 'Upload, list, download and prune database backups in the private R2 bucket.'

    def add_arguments(self, parser):
        sub = parser.add_subparsers(dest='action', required=True)
        sub.add_parser('upload')
        sub.add_parser('list')
        dl = sub.add_parser('download')
        dl.add_argument('name')
        # To a file, not stdout: the app logs to stdout, and one log line in
        # the stream would corrupt the dump.
        dl.add_argument('--to', required=True)
        pr = sub.add_parser('prune')
        pr.add_argument('--keep', type=int, default=14)

    def _bucket(self):
        bucket = getattr(settings, 'BACKUP_R2_BUCKET', '')
        if not bucket:
            raise CommandError('Set BACKUP_R2_BUCKET (a private bucket) first.')
        if bucket == settings.R2_BUCKET:
            raise CommandError('BACKUP_R2_BUCKET is the public media bucket: use a separate private one.')
        if not r2.is_configured():
            raise CommandError('R2 is not configured (R2_ENDPOINT / keys).')
        return bucket

    def handle(self, *args, action, **opts):
        bucket = self._bucket()
        client = r2._client()
        if action == 'upload':
            name = f'{PREFIX}{timezone.now():%Y-%m-%d_%H%M}.pgc'
            client.upload_fileobj(sys.stdin.buffer, bucket, name)
            head = client.head_object(Bucket=bucket, Key=name)
            size = head['ContentLength']
            if size < 1024:
                raise CommandError(f'{name} is only {size} bytes - the dump failed.')
            self.stdout.write(f'uploaded {name} ({size / 1024 / 1024:.1f} MB)')
        elif action == 'list':
            for obj in self._objects(client, bucket):
                self.stdout.write(f'{obj["Key"][len(PREFIX):]}  {obj["Size"] / 1024 / 1024:8.1f} MB  {obj["LastModified"]:%Y-%m-%d %H:%M}')
        elif action == 'download':
            name = opts['name'] if opts['name'].startswith(PREFIX) else PREFIX + opts['name']
            with open(opts['to'], 'wb') as fh:
                client.download_fileobj(bucket, name, fh)
            self.stderr.write(f'downloaded {name} to {opts["to"]}')
        elif action == 'prune':
            objs = self._objects(client, bucket)
            old = objs[:-opts['keep']] if len(objs) > opts['keep'] else []
            for obj in old:
                client.delete_object(Bucket=bucket, Key=obj['Key'])
            self.stdout.write(f'kept {len(objs) - len(old)}, removed {len(old)}')

    @staticmethod
    def _objects(client, bucket):
        out, token = [], None
        while True:
            kw = {'Bucket': bucket, 'Prefix': PREFIX, **({'ContinuationToken': token} if token else {})}
            page = client.list_objects_v2(**kw)
            out += page.get('Contents', [])
            if not page.get('IsTruncated'):
                break
            token = page['NextContinuationToken']
        return sorted(out, key=lambda o: o['Key'])

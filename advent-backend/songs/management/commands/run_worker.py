"""The background job worker (songs/jobs.py): runs queued jobs until stopped.

    python manage.py run_worker            # forever (a systemd service)
    python manage.py run_worker --once     # drain what's ready, then exit

Stops cleanly on SIGTERM / Ctrl-C after the job in hand. One worker is enough
to start with; more can run side by side (jobs are claimed with SKIP LOCKED).
"""
import signal
import time

from django.core.management.base import BaseCommand

from songs import jobs
# Importing registers the handlers.
from songs import audio_processing, charts  # noqa: F401


class Command(BaseCommand):
    help = 'Run background jobs (song processing, ...).'

    def add_arguments(self, parser):
        parser.add_argument('--once', action='store_true', help='Run what is ready, then exit.')
        parser.add_argument('--sleep', type=float, default=5.0, help='Seconds to wait when idle.')

    def handle(self, *args, once=False, sleep=5.0, **options):
        stopping = {'now': False}

        def stop(*_):
            stopping['now'] = True
        signal.signal(signal.SIGINT, stop)
        if hasattr(signal, 'SIGTERM'):
            signal.signal(signal.SIGTERM, stop)

        self.stdout.write('Worker started.')
        last_sweep = 0.0
        ran = 0
        while not stopping['now']:
            if time.monotonic() - last_sweep > 60:
                jobs.requeue_stale()
                last_sweep = time.monotonic()
            if jobs.run_next():
                ran += 1
                continue
            if once:
                break
            time.sleep(sleep)
        self.stdout.write(f'Worker stopped after {ran} job(s).')

"""Durable background jobs: a queue in Postgres, run by `manage.py run_worker`.

    enqueue('process_track', key=f'track:{id}', track_id=id)

A handler is registered per kind with @handler('kind'). The worker claims one
ready job at a time (SELECT ... FOR UPDATE SKIP LOCKED, so several workers
never take the same job), runs it, and marks it done — or, when it raises,
puts it back with a growing delay until `max_attempts`, then marks it failed
and calls the handler's on_failure hook. A job whose worker died mid-run (a
crash, a deploy) is picked up again once its lock is stale.

For quick fire-and-forget work that may be lost on restart (push, email),
songs/tasks.py's thread pool is still the tool.
"""
import logging
import traceback
from datetime import timedelta

from django.db import close_old_connections, connection, transaction
from django.utils import timezone

from .models import Job

logger = logging.getLogger(__name__)

# Waits before retry 1, 2, ... (the last repeats).
RETRY_DELAYS = [timedelta(minutes=1), timedelta(minutes=5), timedelta(minutes=30)]
# A running job untouched this long is presumed orphaned by a dead worker.
STALE_LOCK = timedelta(minutes=30)

_HANDLERS = {}


def handler(kind, on_failure=None):
    """Register `fn(**payload)` as the runner for jobs of `kind`.
    `on_failure(payload, error)` runs once when the last attempt fails."""
    def register(fn):
        _HANDLERS[kind] = (fn, on_failure)
        return fn
    return register


def enqueue(kind, key='', run_after=None, max_attempts=3, **payload):
    """Queue a job. With a `key`, a job of the same kind and key that's still
    queued is reused (its payload refreshed) instead of adding a second."""
    if key:
        existing = Job.objects.filter(kind=kind, key=key, status=Job.QUEUED).first()
        if existing:
            existing.payload = payload
            existing.save(update_fields=['payload'])
            return existing
    return Job.objects.create(
        kind=kind, key=key, payload=payload, max_attempts=max_attempts,
        run_after=run_after or timezone.now(),
    )


def requeue_stale(now=None):
    """Put back jobs left 'running' by a worker that died."""
    now = now or timezone.now()
    return Job.objects.filter(status=Job.RUNNING, locked_at__lt=now - STALE_LOCK).update(
        status=Job.QUEUED, locked_at=None, run_after=now)


def claim(now=None):
    """Take the next ready job (marked running), or None."""
    now = now or timezone.now()
    with transaction.atomic():
        qs = Job.objects.filter(status=Job.QUEUED, run_after__lte=now).order_by('run_after', 'id')
        if connection.features.has_select_for_update_skip_locked:
            qs = qs.select_for_update(skip_locked=True)
        job = qs.first()
        if job is None:
            return None
        job.status = Job.RUNNING
        job.locked_at = now
        job.attempts += 1
        job.save(update_fields=['status', 'locked_at', 'attempts'])
        return job


def run(job):
    """Run a claimed job and record the outcome. Never raises."""
    fn, on_failure = _HANDLERS.get(job.kind, (None, None))
    try:
        if fn is None:
            raise LookupError(f'no handler for job kind {job.kind!r}')
        fn(**job.payload)
    except Exception as exc:
        job.last_error = traceback.format_exc()[-4000:]
        job.locked_at = None
        if job.attempts < job.max_attempts:
            delay = RETRY_DELAYS[min(job.attempts - 1, len(RETRY_DELAYS) - 1)]
            job.status = Job.QUEUED
            job.run_after = timezone.now() + delay
            logger.warning('job %s failed (attempt %s), retrying in %s: %s', job, job.attempts, delay, exc)
        else:
            job.status = Job.FAILED
            job.finished_at = timezone.now()
            logger.error('job %s failed for good: %s', job, exc)
            if on_failure:
                try:
                    on_failure(job.payload, exc)
                except Exception:
                    logger.exception('on_failure hook for %s raised', job)
        job.save(update_fields=['status', 'run_after', 'locked_at', 'last_error', 'finished_at'])
        return False
    job.status = Job.DONE
    job.locked_at = None
    job.finished_at = timezone.now()
    job.last_error = ''
    job.save(update_fields=['status', 'locked_at', 'finished_at', 'last_error'])
    return True


def _tidy_connections():
    # The worker's housekeeping between jobs: drop stale / broken connections.
    # Never inside a transaction — there Django would close the connection
    # mid-transaction (Postgres; SQLite's in-memory test database hides it).
    if not connection.in_atomic_block:
        close_old_connections()


def run_next():
    """Claim and run one job. Returns True if there was one."""
    _tidy_connections()
    job = claim()
    if job is None:
        return False
    run(job)
    _tidy_connections()
    return True

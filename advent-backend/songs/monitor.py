"""How the server is doing, for the admins' Monitor (admin phase 7).

Counted as requests pass (MonitorMiddleware), in the cache only — never a
database write on the request path:

  per minute, the last hour:  requests, server errors (5xx), refusals (4xx),
                              total time (for the average);
  per hour:                   each endpoint's count and total time (the slow
                              ones are worth knowing), notifications sent and
                              failed.

With a shared cache (Redis, REDIS_URL) the numbers are the whole server's;
with the per-process memory cache each worker counts its own — still the
right shape, a part of the whole.

health() adds what is checked when an admin looks: the database and cache
answering (and how fast), the background-job queue, storage set up, the
server itself.
"""
import os
import re
import time
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone

MINUTES = 60
STARTED = time.time()
_NUMBER = re.compile(r'/\d+(?=/|$)')
_SLUG = re.compile(r'/[0-9a-f]{16,}(?=/|$)')
KEEP = 2 * 60 * 60


def _minute(at=None):
    return (at or timezone.now()).strftime('%Y%m%d%H%M')


def _hour(at=None):
    return (at or timezone.now()).strftime('%Y%m%d%H')


def _bump(key, by=1):
    cache.add(key, 0, KEEP)
    try:
        cache.incr(key, by)
    except ValueError:
        cache.set(key, by, KEEP)


def endpoint_of(path):
    """/api/groups/12/posts/ → /api/groups/{id}/posts/: one row per route,
    not per object."""
    return _SLUG.sub('/{key}', _NUMBER.sub('/{id}', path))[:80]


def record_request(path, status_code, ms):
    m = _minute()
    _bump(f'mon:{m}:req')
    _bump(f'mon:{m}:ms', int(ms))
    if status_code >= 500:
        _bump(f'mon:{m}:5xx')
    elif status_code >= 400:
        _bump(f'mon:{m}:4xx')
    # The endpoint's hour: kept as one small dict per hour, read and written
    # back (two workers at once may lose a count — fine for a picture).
    key = f'mon:ep:{_hour()}'
    eps = cache.get(key) or {}
    ep = endpoint_of(path)
    if ep in eps or len(eps) < 400:
        row = eps.get(ep) or [0, 0, 0]
        row[0] += 1
        row[1] += int(ms)
        row[2] += 1 if status_code >= 500 else 0
        eps[ep] = row
        cache.set(key, eps, KEEP)


def record_push(sent, failed):
    h = _hour()
    if sent:
        _bump(f'mon:push:{h}:sent', sent)
    if failed:
        _bump(f'mon:push:{h}:failed', failed)


class MonitorMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not request.path.startswith('/api/'):
            return self.get_response(request)
        start = time.monotonic()
        response = self.get_response(request)
        try:
            record_request(request.path, response.status_code, (time.monotonic() - start) * 1000)
        except Exception:  # noqa: BLE001 — counting never breaks a request
            pass
        return response


def minutes(now=None):
    """The last hour, minute by minute: [{'at', 'requests', 'errors', 'refused', 'avg_ms'}]."""
    now = now or timezone.now()
    keys = []
    stamps = [now - timedelta(minutes=i) for i in range(MINUTES - 1, -1, -1)]
    for at in stamps:
        m = _minute(at)
        keys += [f'mon:{m}:req', f'mon:{m}:5xx', f'mon:{m}:4xx', f'mon:{m}:ms']
    got = cache.get_many(keys)
    out = []
    for at in stamps:
        m = _minute(at)
        req = got.get(f'mon:{m}:req', 0)
        out.append({'at': at.strftime('%H:%M'), 'requests': req, 'errors': got.get(f'mon:{m}:5xx', 0),
                    'refused': got.get(f'mon:{m}:4xx', 0),
                    'avg_ms': round(got.get(f'mon:{m}:ms', 0) / req) if req else 0})
    return out


def endpoints(limit=12):
    """This hour's and last hour's endpoints, slowest first (by average)."""
    now = timezone.now()
    merged = {}
    for h in (_hour(now - timedelta(hours=1)), _hour(now)):
        for ep, (n, ms, errors) in (cache.get(f'mon:ep:{h}') or {}).items():
            row = merged.setdefault(ep, [0, 0, 0])
            row[0] += n
            row[1] += ms
            row[2] += errors
    rows = [{'endpoint': ep, 'requests': n, 'avg_ms': round(ms / n) if n else 0, 'errors': e}
            for ep, (n, ms, e) in merged.items() if n >= 3]
    slow = sorted(rows, key=lambda r: -r['avg_ms'])[:limit]
    failing = sorted([r for r in rows if r['errors']], key=lambda r: -r['errors'])[:limit]
    return slow, failing


def _timed(fn):
    start = time.monotonic()
    try:
        fn()
        return True, round((time.monotonic() - start) * 1000, 1)
    except Exception:  # noqa: BLE001 — a failed check is the answer
        return False, None


def health():
    from django.conf import settings
    from django.db import connection
    from . import r2
    from .models import Job

    def db():
        with connection.cursor() as cur:
            cur.execute('SELECT 1')
            cur.fetchone()

    def cache_check():
        cache.set('mon:ping', 1, 10)
        if cache.get('mon:ping') != 1:
            raise RuntimeError('cache did not keep a value')

    db_ok, db_ms = _timed(db)
    cache_ok, cache_ms = _timed(cache_check)
    now = timezone.now()
    jobs = {'queued': 0, 'running': 0, 'failed_day': 0, 'oldest_waiting_minutes': None, 'stuck': 0}
    if db_ok:
        queued = Job.objects.filter(status=Job.QUEUED, run_after__lte=now)
        jobs['queued'] = queued.count()
        oldest = queued.order_by('run_after').values_list('run_after', flat=True).first()
        jobs['oldest_waiting_minutes'] = int((now - oldest).total_seconds() // 60) if oldest else None
        jobs['running'] = Job.objects.filter(status=Job.RUNNING).count()
        # Running for over an hour: a worker that died holding it.
        jobs['stuck'] = Job.objects.filter(status=Job.RUNNING, locked_at__lt=now - timedelta(hours=1)).count()
        jobs['failed_day'] = Job.objects.filter(status=Job.FAILED, finished_at__gte=now - timedelta(days=1)).count()
    h_now, h_before = _hour(now), _hour(now - timedelta(hours=1))
    push = cache.get_many([f'mon:push:{h}:{k}' for h in (h_now, h_before) for k in ('sent', 'failed')])
    return {
        'checked_at': now,
        'database': {'ok': db_ok, 'ms': db_ms, 'engine': connection.vendor},
        'cache': {'ok': cache_ok, 'ms': cache_ms,
                  'shared': 'redis' in str(getattr(settings, 'CACHES', {}).get('default', {}).get('BACKEND', '')).lower()},
        'jobs': jobs,
        'push': {'sent': push.get(f'mon:push:{h_now}:sent', 0) + push.get(f'mon:push:{h_before}:sent', 0),
                 'failed': push.get(f'mon:push:{h_now}:failed', 0) + push.get(f'mon:push:{h_before}:failed', 0)},
        'storage': {'configured': r2.is_configured()},
        'server': {'debug': bool(settings.DEBUG), 'uptime_minutes': int((time.time() - STARTED) // 60),
                   'pid': os.getpid(), 'version': getattr(settings, 'APP_VERSION', '')},
    }


def daily_summary():
    """One line for the super admins each morning: yesterday at a glance."""
    from .models import Appeal, LoginAttempt, Report, SecurityEvent, User
    day = timezone.now() - timedelta(days=1)
    signups = User.objects.filter(date_joined__gte=day).count()
    reports = Report.objects.filter(status='pending').count()
    appeals = Appeal.objects.filter(status='pending').count()
    events = SecurityEvent.objects.filter(resolved_at__isnull=True).count()
    failed = LoginAttempt.objects.filter(created_at__gte=day).exclude(outcome='ok').count()
    jobs_failed = health()['jobs']['failed_day']
    parts = [f'{signups} new accounts', f'{reports} reports waiting', f'{appeals} appeals waiting',
             f'{failed} failed sign-ins']
    if events:
        parts.append(f'{events} security events open')
    if jobs_failed:
        parts.append(f'{jobs_failed} background jobs failed')
    return 'Yesterday: ' + ', '.join(parts) + '.'

"""Lightweight fire-and-forget background execution.

Railway has no Redis, so rather than a full Celery/RQ broker we offload
non-critical, I/O-bound work (push notifications, transactional email) onto a
small bounded thread pool. This keeps blocking SMTP/HTTP calls out of the
request/response path without adding infrastructure.

Trade-off: tasks are not durable — if the process is killed mid-task the work
is lost. That is acceptable for notifications/email. Anything that must not be
lost (e.g. payment side effects) should stay synchronous or move to a real
queue later.
"""
import logging
from concurrent.futures import ThreadPoolExecutor

from django.db import close_old_connections

logger = logging.getLogger(__name__)

# Bounded so a burst can't spawn unlimited threads. Work queues if all busy.
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix='bg-task')


def run_in_background(fn, *args, **kwargs):
    """Schedule ``fn(*args, **kwargs)`` on the background pool.

    Exceptions are logged, never propagated. DB connections opened by the task
    are reaped afterwards so pooled threads don't hold stale connections.
    """
    def _wrapped():
        try:
            fn(*args, **kwargs)
        except Exception:
            logger.exception("Background task %s failed", getattr(fn, '__name__', repr(fn)))
        finally:
            close_old_connections()

    try:
        _executor.submit(_wrapped)
    except RuntimeError:
        # Executor already shut down (e.g. during process teardown) — run inline.
        _wrapped()

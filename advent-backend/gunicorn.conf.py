"""Gunicorn for the HTTP API (the websockets stay on Daphne: `ws` in the
deploy/app/docker-compose.yml, routed /ws/* by Caddy).

Why not Daphne for everything: under ASGI, Django runs ordinary (sync) views
one after another on a single thread per process. Every API view here is
sync, so one Daphne process served one request at a time - the load test saw
~3 requests a second and 8-12 s waits with 25 people on. Gunicorn runs
several processes, each with threads, and the database connections are kept
between requests (CONN_MAX_AGE).

Tune with environment variables:
    WEB_CONCURRENCY   worker processes (default: CPUs, at most 4)
    WEB_THREADS       threads per worker (default 4)
"""
import multiprocessing
import os

import gunicorn

# No server name or version in every response (a free hint for attackers).
gunicorn.SERVER = 'server'
gunicorn.SERVER_SOFTWARE = 'server'

bind = f"0.0.0.0:{os.getenv('PORT', '8000')}"
workers = int(os.getenv('WEB_CONCURRENCY', min(multiprocessing.cpu_count(), 4)))
worker_class = 'gthread'
threads = int(os.getenv('WEB_THREADS', '4'))
# A request still running after this is stuck (a slow outside call): the
# worker is restarted rather than kept hostage.
timeout = 60
graceful_timeout = 30
keepalive = 5
# Restarted now and then, a little apart: any slow memory growth never adds up.
max_requests = 2000
max_requests_jitter = 200
# Behind the proxy on the same box.
forwarded_allow_ips = os.getenv('FORWARDED_ALLOW_IPS', '127.0.0.1')
accesslog = '-'
errorlog = '-'
loglevel = os.getenv('GUNICORN_LOG_LEVEL', 'info')

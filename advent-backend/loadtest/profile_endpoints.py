"""Inside the container: queries and time per endpoint, slowest queries first.

    docker compose -f loadtest/docker-compose.yml exec -T web python manage.py shell < loadtest/profile_endpoints.py
"""
import time

from django.db import connection, reset_queries
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from songs.models import User

me = User.objects.get(username='loadtester')
c = APIClient()
c.force_authenticate(me)
ENDPOINTS = [
    '/api/notifications/', '/api/music/home/', '/api/explore/search/?q=grace',
    '/api/explore/search/?q=gracce%20choir', '/api/conversations/', '/api/social-posts/',
    '/api/groups/', '/api/explore/trending_posts/',
]
for url in ENDPOINTS:
    c.get(url, HTTP_HOST='localhost')                     # warm
    with CaptureQueriesContext(connection) as ctx:
        t0 = time.perf_counter()
        r = c.get(url, HTTP_HOST='localhost')
        total = (time.perf_counter() - t0) * 1000
    qs = sorted(ctx.captured_queries, key=lambda q: -float(q['time']))
    db = sum(float(q['time']) for q in qs) * 1000
    print(f'\n== {url}  {r.status_code}  total {total:.0f} ms  db {db:.0f} ms  queries {len(qs)}')
    for q in qs[:3]:
        print(f'   {float(q["time"]) * 1000:6.0f} ms  {q["sql"][:230]}')

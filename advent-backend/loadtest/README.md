# Load and security testing on this machine

A production-like stack in Docker (Postgres 17, Redis 7, the API on Gunicorn,
websockets on Daphne, `DEBUG` off) with its **own** database: it never touches
the shared Supabase one (`.dockerignore` keeps `.env` out of the image).

```bash
cd advent-backend
docker compose -f loadtest/docker-compose.yml up -d --build
docker compose -f loadtest/docker-compose.yml exec -T web python manage.py migrate --noinput   # ~3 min
docker compose -f loadtest/docker-compose.yml exec -T web python manage.py seed_loadtest        # ~12 min
# 40 sessions for the "many people at once" part (25 sign-ins in a row from
# one address would - rightly - hit the sign-in limit):
docker compose -f loadtest/docker-compose.yml exec -T web python manage.py shell -c "
from rest_framework_simplejwt.tokens import RefreshToken
from songs.models import User
for u in User.objects.filter(username__startswith='user').order_by('id')[:40]:
    print(str(RefreshToken.for_user(u).access_token))" | grep -E '^ey' > loadtest/results/tokens.txt
.venv/Scripts/python loadtest/measure.py --json loadtest/results/run.json   # speed per screen + 25 at once
.venv/Scripts/python loadtest/security_probe.py                             # attacks; prints OK / FLAG
docker compose -f loadtest/docker-compose.yml down -v                       # throw it all away
```

Inside the container, per-endpoint queries: `profile_endpoints.py`,
`profile_search.py`, `explain_notifications.py` (copy in with
`docker compose cp`, run with `manage.py shell -c "exec(open('/tmp/x.py').read())"`;
on Git Bash set `MSYS_NO_PATHCONV=1` first).

Seeded volumes: 3,001 people, 120k follows, 30k posts, 300k post likes, 60k
comments, 4k songs (80k likes), 3k playlists, 150 groups (30k group posts),
1.5k conversations (30k messages), 100k notifications. Sign in as
`loadtester` / `Load-test-1234`.

## Results, 2026-10-08 (8-CPU laptop, everything in one Docker VM)

| | before | after |
|---|---|---|
| Groups list | **25-27 s** | 0.23-0.27 s |
| Search "grace" | 1.2-2.3 s, 137 queries | 0.45-0.55 s, 22 queries |
| Search with a typo | 1.8-2.1 s | 0.6 s |
| Feed (warm) | 263 ms | 60 ms |
| 25 people at once, feed | 9.8 req/s, p95 4 s | 22.8 req/s |
| 25 at once, notifications | 3.0 req/s, p50 7.9 s | 12.4 req/s, p50 1.5 s |
| 25 at once, music home | 3.1 req/s, p50 8.7 s | 10.6 req/s, p50 1.7 s |

What made the difference: Gunicorn for HTTP (Daphne ran every sync view on one
thread), group visibility by EXISTS instead of a member join, search's groups
annotated in one query, a trigram index on post locations.

Security probe: 0 flagged after the fixes (it found outside media links,
server-side fetches of any URL, 12 MB bodies and the server version header).

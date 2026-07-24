# Realtime group chat — deployment (Railway)

Group chat is realtime over WebSockets (Django Channels). The app now serves
HTTP **and** WebSockets through one ASGI process (`daphne`), backed by a Redis
channel layer.

## What changed
- `Procfile` now runs **daphne** (ASGI) instead of gunicorn (WSGI):
  `web: daphne -b 0.0.0.0 -p $PORT music.asgi:application`
- New deps: `channels`, `channels-redis`, `daphne` (in `requirements.txt`).
- Channel layer = Redis when `REDIS_URL` is set, else an in-process layer
  (local dev / tests need no Redis).

## Railway steps
1. **Add a Redis service** to the project (Railway → New → Database → Redis).
2. Expose it to the web service as **`REDIS_URL`**. Railway's Redis plugin
   provides a connection string variable (e.g. `REDIS_URL` or
   `REDIS_PRIVATE_URL`) — set the web service's `REDIS_URL` to it (reference the
   variable so it stays in sync). The same `REDIS_URL` already powers the cache.
3. Redeploy. Railway supports WebSockets natively on the normal HTTPS domain —
   the client connects to `wss://<your-domain>/ws/groups/<slug>/` automatically
   (derived from the API base URL). No extra port or config.

## Verifying
- Logs should show daphne starting and accepting `WSCONNECT /ws/groups/...`.
- Two devices in the same group: a message from one appears on the other
  instantly (no 4s wait); typing shows a live indicator.
- If Redis is missing in production, WebSockets still connect but messages only
  fan out within a single process — add Redis for multi-instance correctness.

## Scaling notes
- One daphne process handles many idle sockets fine. To scale out, run multiple
  replicas — the Redis channel layer fans messages across them.
- Throttle counters (rate limits) also use the cache; with Redis set they become
  cluster-wide instead of per-process.

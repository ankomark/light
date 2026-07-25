# Deployment & Ops — Adventist Life backend

Django 5.2 + DRF, deployed on Railway with Postgres (Supabase) and Cloudinary.
This file lists the environment variables and operational steps the app needs.
Pin Python to **3.12** (Django 5.2 does not support 3.14).

## Environment variables

### Required in production (app refuses to boot or misbehaves without them)

| Variable | Purpose | Notes |
|---|---|---|
| `DJANGO_SECRET_KEY` | Django secret key | **App raises `ImproperlyConfigured` on startup if unset when `DEBUG` is off.** Generate: `python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"`. Rotating it invalidates all JWTs (everyone re-logs in). |
| `DATABASE_URL` | Postgres connection string | If unset, the app falls back to local SQLite (dev only). |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Media storage + signed uploads | |

### Required for specific features

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` | Marketplace payments |
| `STRIPE_WEBHOOK_SECRET` | **Payment confirmation.** Without it the webhook returns 503 and orders never move to PAID / inventory is never committed. |
| `EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend` + `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD` | Real email (verification, password reset). Defaults to console backend. |
| `SENTRY_DSN` | Backend crash reporting |

### Optional / tuning

| Variable | Default | Purpose |
|---|---|---|
| `DJANGO_DEBUG` | `True` locally (no `DATABASE_URL`), else `False` | Auto-on for local dev, off in production. Override explicitly with `True`/`False`. **Never `True` in production** (set `DJANGO_DEBUG=False` there if you want it explicit). |
| `LOG_LEVEL` | `INFO` | Root log level (stdout). |
| `DB_USE_PGBOUNCER` | `False` | Set `True` when `DATABASE_URL` points at a transaction-mode pooler (see below). |
| `DB_CONN_MAX_AGE` | `600` | Persistent-connection lifetime (seconds) when not pooling. |

## Deploy steps

1. **Set the env vars above** in Railway (at minimum `DJANGO_SECRET_KEY`, `DATABASE_URL`, Cloudinary, Stripe).
2. **Run migrations** on every deploy: `python manage.py migrate`.
   - `migrate` applies **all** pending migrations; you don't list them by hand. The
     entries below are just call-outs for the notable ones so you know what a deploy
     changes.
   - Earlier call-outs: `0021` (Order.payment_status), `0022` (indexes + drops two
     unused columns), `0023` (pg_trgm search indexes — see below), and the
     `token_blacklist` tables.
   - **Choir/church community chat** (all **additive and safe** — nullable columns +
     one new table, no data backfill, no locks that matter, zero-downtime):
     - `0090` — `attachment_blurhash` on `ChoirMessage` + `ChurchMessage` (image placeholders).
     - `0091` — `edited_at` on both message models, and a `pinned_message` FK on `Choir` + `Church` (pinned-banner).
     - `0092` — `is_moderator` on `ChoirMembership` + `ChurchMembership`, and the new `CommunityAuditLog` table (moderation trail).
   - After deploy, confirm nothing is pending: `python manage.py migrate --check`
     (exits non-zero if a migration is unapplied) or `python manage.py showmigrations songs`.
   - Run `migrate` against the **direct** Postgres connection (port 5432), not the pooler.
3. **Collect static** if serving admin assets: `python manage.py collectstatic --noinput` (Whitenoise serves them).
4. Start: **daphne** (ASGI) per the `Procfile` — `daphne -b 0.0.0.0 -p $PORT music.asgi:application`. Realtime chat (groups + choir/church communities) rides WebSockets through this process, so it needs Redis; see **`REALTIME_DEPLOY.md`** for the Redis (`REDIS_URL`) setup. Without Redis the app still serves HTTP and WebSockets connect, but realtime only fans out within a single process.

## Stripe webhook (required for checkout to complete)

1. In the Stripe dashboard, add a webhook endpoint:
   `https://<your-domain>/api/marketplace/stripe-webhook/`
2. Subscribe to events: `payment_intent.succeeded`, `payment_intent.payment_failed`.
3. Copy the endpoint's signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.

The webhook is the **only** place an order is marked `PAID` and inventory is
decremented (atomically, idempotently). Checkout reserves nothing until payment.

## Connection pooling (recommended at scale)

Supabase provides a built-in pooler — you do not need to run PgBouncer yourself.

1. Set `DATABASE_URL` to the Supabase **Transaction pooler** string (port **6543**).
2. Set `DB_USE_PGBOUNCER=True` (this sets `CONN_MAX_AGE=0` + disables server-side
   cursors, required for transaction-mode pooling).
3. Keep a **direct** (5432) URL handy for running `migrate` (DDL/advisory locks
   don't work through a transaction pooler).

## Search (pg_trgm) — Postgres only

Text search/filtering uses `icontains` (`ILIKE '%...%'`). Migration `0023`
enables the `pg_trgm` extension and creates trigram **GIN indexes** on the
searched columns (usernames, post captions/location/tags, track title/album,
group name/description), which makes those `ILIKE` queries index-backed instead
of full table scans — no query changes needed.

- It's applied automatically by `migrate`. The extension + indexes are
  **Postgres-only**; on SQLite (local/CI) the migration is a no-op, so tests are
  unaffected.
- `migrate` runs `CREATE EXTENSION IF NOT EXISTS pg_trgm`, which needs a role
  allowed to create extensions. On Supabase this is normally permitted; if it
  fails on permissions, enable **pg_trgm** first via the Supabase dashboard
  (Database → Extensions), then re-run `migrate`.

## Scheduled jobs (cron)

Run on a schedule (e.g. hourly) via a Railway cron service or external scheduler:

```
python manage.py cleanup_expired_stories
```

Deletes expired stories and their Cloudinary assets. Use `--dry-run` to preview.

## Security follow-ups

- **Rotate leaked secrets.** The old `SECRET_KEY` and a `.env` are present in
  earlier git history (and on the remote). Treat as compromised and rotate:
  `DJANGO_SECRET_KEY`, Cloudinary API secret, Stripe keys, email password,
  `DATABASE_URL`. (`.env` and compiled/media files are now gitignored.)
- `CORS_ALLOW_ALL_ORIGINS` is off; add any web origins to `CORS_ALLOWED_ORIGINS`
  in `settings.py`. Native mobile requests are not subject to CORS.

## Local development

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

With no `DATABASE_URL` set, the app runs in DEBUG mode against a local SQLite
file and uses a throwaway dev secret key — no extra env setup needed.

Run the test suite (no external services needed — SQLite + eager tasks):

```
python manage.py test songs --settings=music.settings_test
```

CI runs the same suite on every backend push (`.github/workflows/backend-tests.yml`).

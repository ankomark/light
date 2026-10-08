# Deploying the app to Hetzner

Everything except live broadcasting, which gets its own server later
(`deploy/livekit/`). Until then, Go Live says "Live is unavailable right now"
and nothing else is affected.

```
                     api.adventistlife.app  (HTTPS, Let's Encrypt)
                            │
                ┌─────────── Caddy ───────────┐
                │ /ws/*                  else │
             Daphne (ws)             Gunicorn (web) ── worker
                └──────────┬───────────────┘
                     Postgres 17 · Redis 7         R2: media (public) · backups (private)
```

| File | What it is |
|---|---|
| `docker-compose.yml` | the stack: caddy, web, ws, worker, db, redis |
| `Caddyfile` | HTTPS, `/ws/*` to Daphne, security headers, body limit |
| `app.env.example` | every setting; copy to `.env` (never committed) |
| `setup.sh` | one-time server setup (root): Docker, `deploy` user, SSH keys only, firewall, swap, fail2ban |
| `first-run.sh` | one-time app steps: migrate, Bible, puzzle words, backfills, first super admin |
| `deploy.sh` | update to the latest code (GitHub Actions runs it); refuses when migrations wait |
| `backup.sh` / `restore.sh` | database to the private R2 bucket and back; `--test` proves a backup restores |
| `crontab` + `run-job.sh` | the schedule: trending, quiz, morning pushes, cleanups, backups |
| `../../.github/workflows/deploy-backend.yml`, `migrate.yml` | deploy on push to `main`; migrations by hand |
| `../../advent-backend/Dockerfile`, `gunicorn.conf.py` | the image and the web server |

Tested end to end on Docker Desktop (the same compose file, `localhost` as the
domain) before this was written; the load test (`advent-backend/loadtest/`)
measured the speed of this layout.

---

## 0. Before you start

- [ ] **A domain**, and a DNS provider you can add records at (Cloudflare is fine).
- [ ] **Cloudflare R2**: the media bucket (public, served from e.g.
      `media.adventistlife.app`), **and a second, private bucket for backups**, with an
      API token that can write to both.
- [ ] **Email sending** (SMTP): verification codes, password resets and security
      notices go by email. Any provider (Brevo, Mailgun, Zoho, SES…).
- [ ] **Sentry** project (optional, recommended) for error reports.
- [ ] Your **SSH public key** (`~/.ssh/id_ed25519.pub`; make one with
      `ssh-keygen -t ed25519` if you have none).

## 1. The server

Hetzner Cloud → **Add server**:

- Location: **Falkenstein, Nuremberg or Helsinki** (EU: 20 TB of traffic included,
  the best latency to Nairobi) - and the same one for the live box later.
- Image: **Ubuntu 24.04**. Type: **CX33** (4 vCPU, 8 GB). Add your SSH key.
- Networking: public IPv4 + IPv6.
- **Firewall** (Hetzner → Firewalls → Create, attach to the server), inbound:
  TCP 22, TCP 80, TCP 443, UDP 443. Nothing else.

## 2. DNS (Cloudflare, adventistlife.app)

Cloudflare → adventistlife.app → **DNS → Records → Add record**:

| Type | Name | Content | Proxy | When |
|---|---|---|---|---|
| A | `api` | the app server's IPv4 | **DNS only** (grey cloud) | now |
| AAAA | `api` | the app server's IPv6 | **DNS only** | now |
| A | `live` | the live server's IPv4 | **DNS only** | with deploy/livekit |
| A | `turn` | the live server's IPv4 | **DNS only** | with deploy/livekit |

**DNS only** matters: the servers get their own certificates (Caddy), and
Cloudflare's proxy does not carry websockets the way the app needs them, nor
any of the live server's traffic.

**Media** (`media.adventistlife.app`): Cloudflare → R2 → the media bucket →
Settings → **Custom Domains → Connect Domain** → `media.adventistlife.app`.
Cloudflare makes that record itself (proxied - right for R2). Then
`R2_PUBLIC_BASE=https://media.adventistlife.app` in `.env`. (The `r2.dev`
address is rate-limited and not meant for production.) Already uploaded files
keep their old `r2.dev` links, which go on working while the dev URL stays on.

**Email**:
- *Sending* (`noreply@adventistlife.app`): your SMTP provider (Brevo,
  Mailgun, Zoho, SES…) lists the records to add - SPF (TXT), DKIM (TXT or
  CNAME) and a DMARC TXT on `_dmarc`. Without them, codes land in spam.
- *Receiving* (optional, free): Cloudflare → **Email → Email Routing** →
  forward e.g. `support@adventistlife.app` to your Gmail. Then the app's
  support address (`content/legal.js`, `pages/About.js`, `pages/Help.js`) can
  become `support@adventistlife.app`.

`.app` domains are HTTPS-only in every browser (HSTS preload): fine - nothing
here is served over plain HTTP.

## 3. Set the server up (as root, once)

```bash
ssh root@<server-ip>
curl -fsSLO https://raw.githubusercontent.com/<you>/<repo>/main/deploy/app/setup.sh   # or scp it
bash setup.sh
```

It installs Docker, creates the **`deploy`** user with your key, turns password
and root logins off, opens only 22/80/443, adds swap and fail2ban. From now on:
`ssh deploy@<server-ip>`.

## 4. The code (as deploy)

The box reads the repository with its own **read-only** key:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_read -N ""
cat ~/.ssh/github_read.pub
#   GitHub → the repo → Settings → Deploy keys → Add (read-only, NOT write)
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/github_read
EOF
git clone git@github.com:<you>/<repo>.git /opt/adventlife/light
cd /opt/adventlife/light && git checkout main
sudo bash deploy/app/setup.sh        # again: now it installs the schedule (crontab)
```

## 5. Settings

```bash
cd /opt/adventlife/light/deploy/app
cp app.env.example .env && chmod 600 .env && nano .env
```

Fill every **REQUIRED** value: domain, secrets (`python3 -c "import secrets;
print(secrets.token_urlsafe(50))"`), database password (letters and digits -
it also goes into `DATABASE_URL`), R2, the backup bucket, SMTP. Leave
`LIVEKIT_*` empty for now.

## 6. Start

```bash
COMPOSE_BAKE=false docker compose up -d --build      # first build ~5 min
docker compose ps                                     # all "running"; web "healthy"
```

Then the one-time steps - **either** a fresh start:

```bash
./first-run.sh            # migrate, Bible (long, resumable), puzzle words, warm, first super admin
```

**or** bringing the existing database over (Supabase): stop at "migrate", restore
the old data, then do the rest:

```bash
# on your computer: a dump of the current database (custom format)
pg_dump "<current DATABASE_URL>" --format=custom --no-owner --no-privileges -f old.pgc
scp old.pgc deploy@<server-ip>:/tmp/
# on the server
docker compose stop web ws worker
docker compose exec -T db pg_restore -U adventlife -d adventlife --no-owner --clean --if-exists < /tmp/old.pgc
docker compose up -d
./first-run.sh migrate        # anything newer than the old database
./first-run.sh backfill       # the one-off jobs for content made before them
./first-run.sh words          # if the Swahili word index is not there yet
./first-run.sh warm
./first-run.sh admin          # if you are not already a super admin
rm /tmp/old.pgc
```

## 7. Check it works

```bash
curl -sI https://api.adventistlife.app/api/health/            # 200, and strict-transport-security
docker compose exec -T web python manage.py send_test_email adventistlight145@gmail.com  # first: the server IP approved in Brevo (below)
./backup.sh && ./restore.sh --test                   # a backup, and proof it restores
tail -f /var/log/adventlife/jobs.log                 # the schedule (next quarter hour: trending)
```

From a phone (a development build pointed at `https://api.adventistlife.app`, or the
release build of step 9): sign up, verify the email code, post a photo
(R2 upload), comment, like, open a group and chat (websockets), play a song,
open the Admin area (the authenticator code), get a push.

## 8. Automatic deploys (GitHub Actions)

```bash
# on your computer: a key used ONLY for deploying
ssh-keygen -t ed25519 -f deploy_key -N ""
ssh-copy-id -i deploy_key.pub deploy@<server-ip>
ssh-keyscan -t ed25519 <server-ip>                    # the host key, for pinning
```

GitHub → Settings → Secrets and variables → Actions → New secret:

| Secret | Value |
|---|---|
| `HETZNER_HOST` | the server's IP (or `api.adventistlife.app`) |
| `HETZNER_SSH_KEY` | the contents of `deploy_key` (the private half) |
| `HETZNER_KNOWN_HOSTS` | the `ssh-keyscan` line |

GitHub → Settings → Environments → **production** → Required reviewers: you.
Then every push to `main` that touches the backend runs the tests and, if they
pass, `deploy.sh`. When new migrations come with it, the deploy stops before
restarting and says so: run **Actions → migrate** (it backs up first).

## 9. The app

In `front/streams/eas.json`, `build.production.env` and `build.preview.env`:

```json
"EXPO_PUBLIC_API_BASE": "https://api.adventistlife.app",
"EXPO_PUBLIC_PUBLIC_BASE": "https://api.adventistlife.app"
```

A release build stops (`scripts/check-release-config.js`) while these are still
a placeholder (it is set: https://api.adventistlife.app). Over-the-air updates need the same values:
`EXPO_PUBLIC_API_BASE=https://api.adventistlife.app EXPO_PUBLIC_PUBLIC_BASE=https://api.adventistlife.app eas update --branch production`.

This release needs a **new native build** (not only an update): lock-screen
controls, the verse widget, camera/mic permissions for Live, and the packages
added since the last build.

## 10. Live, later

Until `deploy/livekit/` is up, Go Live answers "Live is unavailable". To hide it
completely meanwhile: Admin → App control → **Live** off. When the live box runs:
fill `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` here, then

```bash
docker compose up -d web ws worker
docker compose exec -T web python manage.py livekit_check
```

---

## Running it

| Task | Command (in `/opt/adventlife/light/deploy/app`) |
|---|---|
| Status | `docker compose ps` |
| Logs | `docker compose logs -f --tail 100 web` (or `ws`, `worker`, `caddy`, `db`) |
| Scheduled jobs | `tail -n 50 /var/log/adventlife/jobs.log` |
| Deploy by hand | `./deploy.sh` (`--migrate` when migrations wait) |
| Restart | `docker compose restart web ws worker` |
| A Django command | `docker compose exec -T web python manage.py <command>` |
| Backups | `docker compose exec -T web python manage.py db_backup list` |
| Restore | `./restore.sh <name>` (asks first; backs up what is there) |
| Disk | `df -h /` and `docker system df` |
| Postgres shell | `docker compose exec db psql -U adventlife` |

**Updates of the system**: security updates install themselves; reboot when
`/var/run/reboot-required` exists (`sudo reboot` at a quiet hour - everything
restarts by itself).

**Changing a setting**: edit `.env`, then `docker compose up -d` (only what
changed restarts).

**Rotating a secret**: `DJANGO_SECRET_KEY` signs everyone out;
`ADMIN_SECRET_KEY` resets every admin's authenticator; the R2 keys only need
the new values here.

**Bigger box**: Hetzner → the server → Rescale (minutes of downtime); then set
`WEB_CONCURRENCY` to the number of vCPUs (max 8) and raise Postgres'
`shared_buffers` to a quarter of the memory in `docker-compose.yml`.

## When something is wrong

| Symptom | Look at |
|---|---|
| `https://api.adventistlife.app` doesn't load | `docker compose logs caddy` - DNS must point here, ports 80/443 open (the certificate needs 80) |
| 502 from Caddy | `docker compose logs web` - usually a setting in `.env`; `docker compose ps` |
| "failed to execute bake: exit status 143" on build | build with `COMPOSE_BAKE=false` (deploy.sh does) |
| Deploy stopped: "New migrations are waiting" | Actions → migrate, or `./deploy.sh --migrate` |
| Uploads refused | `R2_PUBLIC_BASE` empty or wrong |
| No verification emails | `EMAIL_*`; `docker compose exec -T web python manage.py send_test_email <you>`. `525 Unauthorized IP address`: add the server's IPs at app.brevo.com/security/authorised_ips. `535 Authentication failed`: the key is wrong - a Standard SMTP key (`xsmtpsib-`), not the account password or a Short key |
| Morning pushes didn't come | `jobs.log`; the commands refuse outside 05:00-11:00 Nairobi |
| Disk filling | `docker system prune` (old images); logs are capped at 100 MB a service |

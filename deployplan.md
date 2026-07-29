# Deployment plan — Railway → Hetzner (self-hosted, incl. LiveKit)

Status: **draft / not started.** Written 2026-07-30.

Goal: move the Django backend and the LiveKit live-broadcast server off Railway
onto two small Hetzner Cloud VPSes, at startup budget, sized for ~5,000
registered users with room to grow.

---

## 1. Why self-host LiveKit

This is the decision that drives the whole plan, so the numbers are here first.

Projected live usage at 5k registered users — assume 10% watch live, ~30 min a
session, 3× a week → **~3,200 viewer-hours/month**. At ~1.5 Mbps per viewer one
viewer-hour ≈ 675 MB, so **~2.16 TB/month of egress**.

| | LiveKit Cloud | Self-host (Hetzner) |
|---|---|---|
| Plan | Ship $50/mo (Build's 5,000 min ≈ 83 viewer-hrs, unusable) | — |
| Participant minutes | 192,000 min; 150k incl., 42k × $0.0005 ≈ **$21** | included |
| **Egress** | 2,160 GB × **$0.10/GB** ≈ **$216** | ~€2 (inside 20 TB) |
| **Monthly** | **≈ $287** | **≈ €12–15 (whole stack)** |

Egress is the whole story: **$0.10/GB vs Hetzner's €1/TB (~$0.001/GB) — ~100×.**
Self-hosting is not a close call at this budget.

Trade-off accepted: we own TURN, upgrades, scaling and monitoring. See §8.

---

## 2. Cost

Hetzner Cloud, Germany/Finland (Falkenstein / Nuremberg / Helsinki). Prices are
**post-15-June-2026** and net of VAT — Hetzner raised prices twice in 2026, so
re-check before ordering ([official adjustment
notice](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/)).

### Launch (recommended)

| Item | Plan | Specs | €/mo |
|---|---|---|---|
| App box — Django/Daphne, Postgres, Redis, PgBouncer, Caddy | **CX33** | 4 vCPU / 8 GB / 80 GB | 8.49 |
| Live box — LiveKit + built-in TURN | **CX23** | 2 vCPU / 4 GB / 40 GB | 5.49 |
| IPv4 × 2 | | | 1.00 |
| | | **Total** | **≈ €15** |

### Absolute floor, if funds are tighter

Swap the app box to **CX23 (€5.49)** → **≈ €12/mo**. Workable at launch, but
4 GB is tight for Postgres + Redis + Daphne together; the app box is the first
thing to upgrade. Rescaling is in-place and takes minutes.

### Traffic allowances — why EU, not US/Singapore

| Region | Included | Overage |
|---|---|---|
| **EU (Falkenstein, Nuremberg, Helsinki)** | **20 TB** | €1/TB |
| US (Ashburn, Hillsboro) | 1 TB | €1/TB |
| Singapore | 0.5 TB | €7.40/TB |

EU wins on all three axes at once: best latency to Nairobi (~150–180 ms), the
only usable traffic allowance for video, and the only region with the cheap
CX/CAX tiers. 20 TB is ~9× our projected 2.16 TB.

### Reference: why CX and not CPX/CCX

The June 2026 increase was very uneven — CX/CAX rose ~33%, CPX ~144%, CCX ~169%
(some tiers to +209%). Same specs, wildly different price now:

| Plan | Specs | €/mo |
|---|---|---|
| **CX43** | 8 vCPU / 16 GB | **15.99** |
| CPX42 | 8 vCPU / 16 GB | 69.49 |
| CCX23 (dedicated vCPU) | 4 vCPU / 16 GB | 85.99 |

Stay on CX. Also prefer CX over CAX (ARM): CX33 €8.49 beats CAX21 €10.49 at
identical specs, and avoids ARM wheel issues with `psycopg2-binary`.

### Deliberate savings

- **No Hetzner Backups** (~20% surcharge, VM-level). Use `pg_dump` → R2 (§7.6).
- **No staging box** initially — snapshot before risky changes, roll back.
- **No volumes** — all media already lives in R2.
- **No managed DB/Redis** — Hetzner doesn't offer them; that's the trade.

---

## 3. ⚠️ Critical prerequisite: a custom domain, shipped first

**The app currently points at a Railway-owned hostname.**

`front/streams/services/api.js:6`
```js
const PROD_API_BASE = 'https://web-production-f266.up.railway.app';
```

We **cannot repoint `*.up.railway.app` at Hetzner** — Railway owns that DNS. So
every already-installed copy of the mobile app will keep calling Railway after
the migration. The same constant feeds `PUBLIC_BASE` (`api.js:37`, used in
already-shared public links) and the WebSocket base
(`services/groupSocket.js:11`, derived from `API_BASE`).

**Therefore the order is non-negotiable:**

1. Buy a domain and put the API on `api.yourdomain.com` **while still on
   Railway** (Railway supports custom domains).
2. Ship an app update with `PROD_API_BASE` = the custom domain. Wait for
   adoption.
3. *Only then* migrate the backend by repointing DNS.

Doing it in this order makes the actual cutover a DNS change with a clean
rollback. Skipping it breaks every installed app and every previously shared
link. Budget ~€10–15/yr for the domain.

---

## 4. Code changes required

### Backend — `advent-backend/music/settings.py`

| # | Location | Problem | Fix |
|---|---|---|---|
| 1 | `:79` `if os.getenv('RAILWAY_ENVIRONMENT'):` | **Security regression.** All HTTPS hardening (HSTS, SSL redirect, secure cookies) is gated on a Railway-only env var. On Hetzner it silently switches **off**, undoing commit `d8be8a2`. | Gate on a platform-neutral flag: `if os.getenv('DJANGO_PRODUCTION') or os.getenv('RAILWAY_ENVIRONMENT'):` and set `DJANGO_PRODUCTION=True` on the box. |
| 2 | `:286` `ssl_require=True` | Hardcoded. Postgres on the private Docker network doesn't speak TLS, so Django won't connect at all. | `ssl_require=os.getenv('DB_SSL_REQUIRE', 'True') == 'True'`, set `DB_SSL_REQUIRE=False`. |
| 3 | `:56` `ALLOWED_HOSTS` | Hardcoded Railway hostnames. | Add the custom domain; ideally read from env. |
| 4 | `:115` `CORS_ALLOWED_ORIGINS` | Hardcoded Railway origin — the web admin build will be blocked. | Add the custom domain / web-admin origin. |

Already done, no work needed: `DB_USE_PGBOUNCER` + `DISABLE_SERVER_SIDE_CURSORS`
(`:280–290`) — PgBouncer is config-only. Redis cache + channel layer already
switch on `REDIS_URL` (`:308`, `:334`).

### Frontend — `front/streams/services/api.js`

| # | Location | Change |
|---|---|---|
| 5 | `:6` `PROD_API_BASE` | Point at the custom domain. Covers `API_BASE`, `PUBLIC_BASE` and the WS base in one edit. **Must ship before the backend moves** — see §3. |

### New files to add (not yet written)

- `advent-backend/docker-compose.yml` — web, pgbouncer, postgres, redis, caddy
- `advent-backend/Caddyfile` — auto-TLS, static, reverse proxy
- `advent-backend/Dockerfile`
- `advent-backend/backup.sh` — `pg_dump` → R2
- `livekit.yaml` — live box config
- `HETZNER_DEPLOY.md` — runbook (supersedes the Railway parts of
  `DEPLOYMENT.md` / `REALTIME_DEPLOY.md`, which stay as history)

---

## 5. Target architecture

```
                      Cloudflare DNS
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
   api.yourdomain.com            live.yourdomain.com
   ── BOX A (CX33) ──            ── BOX B (CX23) ──
   Caddy  :443 TLS               LiveKit  :7880/:7881
     └─ Daphne :8000             TURN     :3478 udp / :5349 tls
        (HTTP + WebSockets)      media    :50000-60000 udp
     PgBouncer :6432             Redis (local)
     Postgres 17
     Redis (channels + cache)
              │
              └──────────► Cloudflare R2 (all media, unchanged)
```

**Why two boxes and not one.** The one pairing to avoid is an SFU sharing a host
with Postgres: media forwarding spikes CPU in bursts and Postgres is
latency-sensitive, so queries would stall exactly when a stream gets popular.
The split costs ~€3/mo more than a single CX43 and is much easier to do now than
mid-growth. LiveKit also wants its own firewall profile for the wide UDP range.

**Firewall — live box** (the UDP range is the one people forget):

| Proto | Port | Purpose |
|---|---|---|
| TCP | 443 | `wss://` signaling |
| TCP | 7881 | WebRTC-over-TCP fallback |
| **UDP** | **50000–60000** | media |
| UDP | 3478 | TURN |
| TCP | 5349 | TURNS (TLS) |

Two LiveKit config notes: set `use_external_ip: true` (on Hetzner Cloud,
LiveKit otherwise advertises the private IP in ICE candidates and connections
fail from outside), and use LiveKit's **built-in TURN** rather than a separate
coturn — fewer moving parts. **TURN is not optional:** many Kenyan mobile users
are behind carrier-grade NAT where direct UDP never establishes.

**Redis policy:** `--appendonly yes --maxmemory-policy allkeys-lru`. The LRU
choice is deliberate — under memory pressure it evicts cache keys, which for us
means view-dedupe keys expire early and a repeat view counts again. Graceful
degradation rather than breakage. `REDIS_URL` must be set in production or the
view-count dedupe becomes per-process (documented at `songs/views/social.py:33`).

---

## 6. Roadmap

### Phase 0 — Domain first (do this before anything else)
1. Buy domain. DNS on Cloudflare (free, and we already use R2).
2. Add `api.yourdomain.com` as a custom domain on **Railway**; verify the app
   works through it.
3. Code change #5 (+ #3, #4 for the new host/origin). Ship an app update.
4. Wait for adoption. Watch logs for traffic still arriving on the
   `*.up.railway.app` host — that's the signal it's safe to proceed.

### Phase 1 — Provision (~1 evening)
5. Create Hetzner account (**start ID verification early** — it can gate new
   accounts and you don't want it blocking a cutover).
6. Order Box A (CX33) + Box B (CX23), same region, attach a private network.
7. Baseline both: non-root sudo user, SSH keys only, password auth off,
   unattended-upgrades, fail2ban.
8. Configure Cloud Firewalls: Box A → 22/80/443; Box B → the table in §5.

### Phase 2 — Live box (do before the app box; it's independently testable)
9. Install Docker, LiveKit, local Redis. Write `livekit.yaml`.
10. TLS for `live.yourdomain.com`; point DNS at Box B.
11. Generate a fresh API key/secret pair (**don't reuse the Railway ones**).
12. **Test from a real mobile network, not office WiFi** — that is the only test
    that proves TURN works.

### Phase 3 — App box
13. Code changes #1–#4. Write Dockerfile, compose, Caddyfile.
14. Bring up Postgres/Redis/PgBouncer/Caddy; DNS still on Railway.
15. `migrate` on an empty DB, `collectstatic`, confirm the stack starts and
    Caddy issues a certificate.

### Phase 4 — Data migration
16. Announce a short maintenance window (low-traffic hour).
17. `pg_dump` from Railway → restore into Box A. Run `migrate`.
18. **Run `python manage.py recount_total_likes`** — still outstanding from
    commit `a816b56` (stored counters predate the "exclude removed content"
    rule), and post-restore is the natural moment.
19. Set up the backup cron (§7.6) **and test a restore** before cutover.

### Phase 5 — Cutover
20. Smoke test against Box A directly (hosts-file override): login, feed, post,
    like/unlike, **WebSocket group chat** (`wss://.../ws/groups/<slug>/`), view
    counts, R2 upload, Stripe webhook, live broadcast.
21. Repoint `api.yourdomain.com` DNS at Box A (low TTL beforehand).
22. `curl -I https://api.yourdomain.com` → confirm
    `Strict-Transport-Security` is present. This is the check that code change
    #1 actually took effect.
23. Confirm Sentry is receiving events; watch error rate for an hour.
24. **Keep Railway running ~48h** as rollback. Then tear down and cancel.

### Phase 6 — Harden (first week after)
25. Uptime monitoring with alerts (external, not on these boxes).
26. Verify the nightly backup ran, and restore one into a throwaway container.
27. Take a snapshot of the known-good state of both boxes.
28. Document anything that surprised us in `HETZNER_DEPLOY.md`.

---

## 7. Scaling triggers

Vertical first — Hetzner rescales in place with minutes of downtime.

| Signal | Action |
|---|---|
| App box CPU/RAM sustained high | CX33 → CX43 → CX53 |
| Postgres is the bottleneck | Move Postgres to its own box |
| Live concurrency > ~100 subscribers | CX23 → CX33 → CX43 |
| Live egress approaching ~25 TB/mo, or ~300 concurrent | Move LiveKit to an **auction dedicated server** (~€39–49/mo, **unlimited traffic on 1 Gbit**) — better value than cloud CCX post-June-2026 |
| Multiple app replicas needed | Already supported: Redis channel layer fans out across them (`REALTIME_DEPLOY.md`) |

At 5k users none of these should fire. A CX53 serves well past 50k users for
this workload, since all media is on R2.

---

## 8. What we take on, and the real risks

The €15/mo isn't the cost of this move — the ops time is. Ranked by how much
damage each can do:

1. **Backups.** No managed DB anymore. `pg_dump` to R2 nightly, **and test a
   restore**. An untested backup is not a backup. This is the single biggest
   risk in leaving Railway.
2. **The baked-in API URL** (§3). Get the ordering wrong and every installed app
   breaks. Mitigated entirely by doing Phase 0 first.
3. **Security regression on migration** (code change #1). HSTS/secure cookies
   silently disappear if we don't fix the Railway-only gate. Verified by step 22.
4. **TURN not working.** Broken live for a large share of mobile users, and it
   looks fine from an office network. Verified by step 12.
5. **Postgres connection exhaustion.** Daphne + workers each hold connections;
   PgBouncer in transaction mode plus `DB_USE_PGBOUNCER=True` is the fix, and
   the code already supports it.
6. **Ongoing:** OS patching, Postgres major upgrades, TLS (Caddy automates it),
   LiveKit upgrades, monitoring, incident response. Sentry is already wired in.

---

## 9. Open decisions

- [ ] Domain name — needed before Phase 0 can start.
- [ ] App box: CX33 (€8.49, recommended) or CX23 (€5.49, floor)?
- [ ] Region: Falkenstein / Nuremberg / Helsinki (any is fine; pick one and
      keep both boxes together for free private networking).
- [ ] Confirm current Hetzner prices at order time — two increases in 2026 already.
- [ ] Does the web admin dashboard get its own subdomain? Affects change #4.
- [ ] Keep Railway as a fallback beyond 48h, or cancel immediately?

---

## Sources (checked 2026-07-30)

- [Hetzner price adjustment, 15 June 2026 (official)](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/)
- [Hetzner Server Auction (official)](https://www.hetzner.com/sb/)
- [Hetzner Cloud pricing calculator, Jul 2026](https://costgoat.com/pricing/hetzner)
- [Better Stack — Hetzner Cloud review 2026](https://betterstack.com/community/guides/web-servers/hetzner-cloud-review/)
- [LiveKit pricing 2026 breakdown](https://trtc.io/blog/details/livekit-pricing-2026)

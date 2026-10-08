# The live box — self-hosted LiveKit on Hetzner

Live broadcasts (Go-Live video, Meet audio, Single & Searching rooms, book
club reading rooms) run on our own LiveKit server, on its own Hetzner box.
Django only mints join tokens and gives the occasional order (create room,
end room, remove someone); audio and video never pass through it.

Why our own server and why its own box: `deployplan.md` §1 and §5 (egress is
~100× cheaper than LiveKit Cloud; media forwarding must not share a CPU with
Postgres).

```
 phone ──wss:// live.<domain>:443──► Caddy ──► LiveKit :7880   signalling
 phone ──udp 50000-60000───────────────────► LiveKit           audio/video
 phone ──tcp 7881 ─────────────────────────► LiveKit           if UDP is blocked
 phone ──turn.<domain>:443 (TLS)──► Caddy ──► LiveKit TURN :5349   if only 443 works
 phone ──udp 3478 ─────────────────────────► LiveKit TURN      TURN over UDP
 LiveKit ──https webhook──► api.<domain>/api/live/webhook/     room ended, host left, viewer counts
 Django ──https api──► live.<domain>                           create/end rooms, remove people
```

## Files

| File | What it is |
|---|---|
| `livekit.env.example` | Settings to copy to `.env` (domains, key pair, webhook URL). `.env` is never committed. |
| `livekit.yaml.template` | LiveKit config. `setup.sh` renders it to `livekit.yaml`. |
| `caddy.yaml.template` | Caddy: TLS certificates, and port 443 split by hostname between signalling and TURN. |
| `docker-compose.yml` | LiveKit, Caddy (with layer4) and a local Redis, all on host networking. |
| `redis.conf` | Local-only Redis, no persistence. |
| `setup.sh` | Checks `.env` and DNS, renders the configs, starts everything. Safe to re-run. |

On the app box, `python manage.py livekit_check` confirms Django can reach and
control the live box.

## 1. The box

- Hetzner Cloud **CX23** (2 vCPU / 4 GB), **same EU region as the app box**
  (Falkenstein, Nuremberg or Helsinki — the only regions with the 20 TB
  traffic allowance; see `deployplan.md` §2). Ubuntu 24.04.
- Baseline it like the app box: a sudo user, SSH keys only, password login
  off, `unattended-upgrades`, `fail2ban`.
- Install Docker and envsubst:
  ```bash
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER      # log out and back in
  sudo apt install -y gettext-base
  ```

When it outgrows the CX23: watch `docker stats` during the biggest broadcasts.
Above ~70% CPU, rescale to CX33 (in place, minutes). Video costs far more than
audio Meets; how many viewers a box carries depends on resolution, so measure
it on ours rather than trusting a rule of thumb.

## 2. Firewall (Hetzner Cloud Firewall, attached to the live box)

Inbound only — everything else closed (including 6379 Redis, 6789 metrics,
7880 and 5349, which only Caddy reaches, locally).

| Proto | Port | Why |
|---|---|---|
| TCP | 22 | SSH (limit to your IP if you can) |
| TCP | 80 | Let's Encrypt HTTP challenge |
| TCP | 443 | signalling (`live.`) and TURN over TLS (`turn.`) |
| TCP | 7881 | WebRTC over TCP |
| UDP | 3478 | TURN over UDP |
| **UDP** | **50000–60000** | **audio and video — the one people forget** |

## 3. DNS

Two **A records** pointing at the live box's IPv4:

- `live.<domain>`
- `turn.<domain>`

If DNS is on Cloudflare: **DNS only (grey cloud), never proxied.** Cloudflare's
proxy does not carry WebRTC or TURN, and it would hide the box's address from
Let's Encrypt.

## 4. Keys

On the live box:

```bash
docker run --rm livekit/livekit-server generate-keys
```

Gives an API key and secret. A **fresh pair** — never one used elsewhere.
They go into this folder's `.env` *and* the app box's environment (step 6).

## 5. Start it

```bash
git clone <repo> && cd light/deploy/livekit
cp livekit.env.example .env
nano .env                 # domains, the key pair, WEBHOOK_URL, ACME_EMAIL
./setup.sh --check        # checks .env and DNS, renders configs, starts nothing
./setup.sh                # starts Caddy, LiveKit, Redis
docker compose logs -f caddy      # wait for both certificates to be issued
```

`https://live.<domain>` in a browser should answer `OK`.

## 6. Point Django at it (app box)

In the app box's environment:

```
LIVEKIT_URL=wss://live.<domain>
LIVEKIT_API_KEY=<the key>
LIVEKIT_API_SECRET=<the secret>
```

Restart Django, then:

```bash
python manage.py livekit_check
```

All four ticks, or it says what to fix. Then the webhook: start a broadcast in
the app and end it — the hub must drop it at once. If it only disappears
12 hours later, the live box can't reach `WEBHOOK_URL` (or its key differs).

## 7. Test from a phone — the only test of TURN

Office Wi-Fi proves nothing: it lets UDP through. Kenyan mobile networks put
phones behind carrier NAT and some block UDP, and those viewers depend on TURN.

1. Phone A on **Safaricom mobile data** (Wi-Fi off) goes live with video.
2. Phone B on **Airtel mobile data** joins and watches; heart, chat, request
   to join, get approved, speak.
3. Repeat with phone B on a restrictive Wi-Fi if you have one (a hotel, an
   office with a strict firewall).
4. On the live box during the test: `docker compose logs livekit | grep -i turn`
   shows relayed connections — that's TURN doing its job.

If B never connects on mobile data but does on Wi-Fi: check the UDP range in
the firewall, then that `turn.<domain>` resolves to this box and its
certificate is issued.

## Running it

| Task | Command |
|---|---|
| Status | `docker compose ps` |
| Logs | `docker compose logs -f livekit` (or `caddy`) |
| Change config | edit `.env` or a template, then `./setup.sh` |
| Upgrade | set `LIVEKIT_VERSION` to the new release in `.env`, `./setup.sh` — after reading its release notes, at a quiet hour (live rooms drop and reconnect) |
| Rotate keys | new pair in `.env` here and on the app box, `./setup.sh`, restart Django — live broadcasts in progress end |

Pin `LIVEKIT_VERSION` (e.g. `v1.9.1`) once a release has passed the phone test:
`latest` can change under you on a restart.

## What Django does with it

| Django | LiveKit |
|---|---|
| Go Live → `ensure_room` | creates the room (`auto_create` is off: only rooms we made can be joined, so an old token can't revive an ended one). If the live box can't be reached, Go Live answers 503 "Live is unavailable" instead of announcing a dead broadcast to every follower. |
| join → `create_access_token` | 4-hour token for that one room; viewers subscribe only |
| approve co-host → `grant_publish` | lets them publish without reconnecting |
| remove someone → `remove_participant` | out now; Django refuses them a new token for that broadcast |
| end / admin takedown → `end_room` | everyone is disconnected |
| webhook → `/api/live/webhook/` | room finished, host left (ends the broadcast), viewer counts |

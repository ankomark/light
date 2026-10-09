#!/usr/bin/env bash
# Bring up (or refresh) the live box. Run from this folder, as a sudo user:
#
#   ./setup.sh            check .env, render the configs, start everything
#   ./setup.sh --check    only check and render; start nothing
#
# Safe to run again after editing .env or a template.
set -euo pipefail
cd "$(dirname "$0")"

fail() { echo "✗ $*" >&2; exit 1; }
ok() { echo "✓ $*"; }

# ── .env ─────────────────────────────────────────────────────────────────────
[ -f .env ] || fail ".env missing: cp livekit.env.example .env, then fill it in."
set -a; . ./.env; set +a

for v in LIVE_DOMAIN TURN_DOMAIN LIVEKIT_API_KEY LIVEKIT_API_SECRET WEBHOOK_URL ACME_EMAIL; do
  [ -n "${!v:-}" ] || fail "$v is empty in .env"
done
case "$LIVE_DOMAIN$TURN_DOMAIN$WEBHOOK_URL" in *example.com*) fail "replace the example.com values in .env";; esac
[ "$LIVE_DOMAIN" != "$TURN_DOMAIN" ] || fail "LIVE_DOMAIN and TURN_DOMAIN must differ (443 is split by hostname)"
[ "${#LIVEKIT_API_SECRET}" -ge 32 ] || fail "LIVEKIT_API_SECRET must be at least 32 characters"
case "$WEBHOOK_URL" in https://*/api/live/webhook/) ;; *) fail "WEBHOOK_URL must be https://<api>/api/live/webhook/";; esac
ok ".env looks complete"

# ── DNS: both names must point here, or Let's Encrypt fails ─────────────────
me=$(curl -fsS -4 https://api.ipify.org || true)
for d in "$LIVE_DOMAIN" "$TURN_DOMAIN"; do
  ip=$(getent ahostsv4 "$d" | awk 'NR==1{print $1}' || true)
  if [ -z "$ip" ]; then
    echo "! $d does not resolve yet - add an A record for $me"
  elif [ -n "$me" ] && [ "$ip" != "$me" ]; then
    echo "! $d points at $ip, this box is $me (a Cloudflare proxy? set it to DNS only)"
  else
    ok "$d -> $ip"
  fi
done

# ── render ───────────────────────────────────────────────────────────────────
command -v envsubst >/dev/null || fail "envsubst missing: sudo apt install -y gettext-base"
vars='${LIVE_DOMAIN} ${TURN_DOMAIN} ${LIVEKIT_API_KEY} ${WEBHOOK_URL} ${ACME_EMAIL}'
envsubst "$vars" < livekit.yaml.template > livekit.yaml
envsubst "$vars" < caddy.yaml.template > caddy.yaml
mkdir -p caddy_data
ok "rendered livekit.yaml and caddy.yaml"

[ "${1:-}" = "--check" ] && { ok "check only - nothing started"; exit 0; }

# ── the box's own firewall ───────────────────────────────────────────────────
# deploy/app/setup.sh (used to harden this box too) opens only SSH and the web
# ports. Host networking means ufw filters LiveKit directly, so the media ports
# must be opened here as well as in the Hetzner firewall - else rooms connect
# and then carry no audio or video.
if command -v ufw >/dev/null && sudo ufw status | grep -q "Status: active"; then
  for rule in 80/tcp 443/tcp 7881/tcp 3478/udp 50000:60000/udp; do
    sudo ufw allow "$rule" >/dev/null
  done
  ok "ufw: 80, 443, 7881/tcp, 3478/udp, 50000-60000/udp open"
fi

# ── start ────────────────────────────────────────────────────────────────────
command -v docker >/dev/null || fail "Docker missing: curl -fsSL https://get.docker.com | sh"
docker compose up -d
ok "started - watch the first certificate with: docker compose logs -f caddy"

echo
echo "Django (app box) needs:"
echo "  LIVEKIT_URL=wss://$LIVE_DOMAIN"
echo "  LIVEKIT_API_KEY=$LIVEKIT_API_KEY"
echo "  LIVEKIT_API_SECRET=<the same secret>"
echo "then on the app box: python manage.py livekit_check"

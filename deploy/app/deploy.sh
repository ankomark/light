#!/usr/bin/env bash
# Put the latest code live on the app box (as deploy, from this folder):
#
#   ./deploy.sh                 pull, build, restart - refuses if migrations are waiting
#   ./deploy.sh --migrate       back the database up, migrate, then restart
#   ./deploy.sh --branch NAME   deploy another branch (default: main)
#
# GitHub Actions runs it on every push to main (.github/workflows/deploy-backend.yml);
# migrations are always a deliberate, separate step (--migrate, or the manual
# "Migrate" workflow), after a fresh backup.
set -euo pipefail
cd "$(dirname "$0")"

BRANCH=main
MIGRATE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --migrate) MIGRATE=1 ;;
    --branch) BRANCH="$2"; shift ;;
    *) echo "unknown option $1"; exit 2 ;;
  esac
  shift
done

[ -f .env ] || { echo ".env missing (cp app.env.example .env)"; exit 1; }
set -a; . ./.env; set +a
DC="docker compose"

echo "== code ($BRANCH)"
git -C ../.. fetch --quiet origin "$BRANCH"
git -C ../.. checkout --quiet "$BRANCH"
git -C ../.. pull --quiet --ff-only origin "$BRANCH"
git -C ../.. log -1 --format='   %h %s (%an, %ar)'

echo "== build"
$DC build --quiet web

echo "== migrations"
if ! $DC run --rm -T web python manage.py migrate --check >/dev/null 2>&1; then
  if [ "$MIGRATE" = 1 ]; then
    ./backup.sh
    $DC run --rm -T web python manage.py migrate --noinput
  else
    echo "!! New migrations are waiting. Nothing was restarted (the new code needs them)."
    $DC run --rm -T web python manage.py showmigrations --plan | grep '\[ \]' | sed 's/^/   /' || true
    echo "   Run:  ./deploy.sh --migrate   (backs the database up first)"
    exit 3
  fi
fi

echo "== restart"
$DC up -d --remove-orphans

echo "== health"
for i in $(seq 1 30); do
  if $DC exec -T web python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health/', timeout=5).status == 200 else 1)" 2>/dev/null; then
    echo "   web healthy"
    break
  fi
  [ "$i" = 30 ] && { echo "!! web did not come up healthy: $DC logs --tail 80 web"; exit 4; }
  sleep 3
done
code=$(curl -s -o /dev/null -w '%{http_code}' "https://${API_DOMAIN}/api/health/" || true)
echo "   https://${API_DOMAIN}/api/health/ -> ${code}"

# The job schedule follows the repository.
if [ -w /etc/cron.d ] || sudo -n true 2>/dev/null; then
  sudo install -m 644 crontab /etc/cron.d/adventlife
fi

docker image prune -f >/dev/null
echo "== deployed"

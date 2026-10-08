#!/usr/bin/env bash
# Restore a backup from the private R2 bucket.
#
#   ./restore.sh --test [NAME]   into a scratch database: proves the backup works,
#                                 then drops it. Monthly from the crontab.
#   ./restore.sh NAME            REPLACES the live database (asks first; the app
#                                 is stopped meanwhile)
#
# NAME as `db_backup list` shows it (e.g. 2026-10-09_0230.pgc); --test with no
# NAME takes the newest.
set -euo pipefail
cd "$(dirname "$0")"
# Only the values these scripts need, read as plain text: .env is not shell
# (a value like "Name <a@b.c>" or "https://<id>..." breaks `. ./.env`).
envval() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//'; }
API_DOMAIN=$(envval API_DOMAIN)
POSTGRES_USER=$(envval POSTGRES_USER)
POSTGRES_DB=$(envval POSTGRES_DB)
DC="docker compose"

# The backup's bytes on stdout - nothing else: the download goes to a file in
# a throwaway container (its logs to stderr), then only the file is printed.
fetch() {
  $DC run --rm -T --no-deps web sh -c "python manage.py db_backup download '$1' --to /tmp/r.pgc >&2 && cat /tmp/r.pgc"
}

TEST=0
if [ "${1:-}" = "--test" ]; then TEST=1; shift; fi
NAME="${1:-}"
if [ -z "$NAME" ]; then
  [ "$TEST" = 1 ] || { echo "Which backup? ($DC exec -T web python manage.py db_backup list)"; exit 2; }
  NAME=$($DC exec -T web python manage.py db_backup list | tail -1 | awk '{print $1}')
fi
echo "== backup: $NAME"

if [ "$TEST" = 1 ]; then
  SCRATCH=restore_test
  $DC exec -T db psql -U "$POSTGRES_USER" -d postgres -qc "DROP DATABASE IF EXISTS $SCRATCH" -c "CREATE DATABASE $SCRATCH"
  fetch "$NAME" | $DC exec -T db pg_restore -U "$POSTGRES_USER" -d "$SCRATCH" --no-owner --exit-on-error
  USERS=$($DC exec -T db psql -U "$POSTGRES_USER" -d "$SCRATCH" -tAc "SELECT count(*) FROM songs_user")
  POSTS=$($DC exec -T db psql -U "$POSTGRES_USER" -d "$SCRATCH" -tAc "SELECT count(*) FROM songs_socialpost")
  $DC exec -T db psql -U "$POSTGRES_USER" -d postgres -qc "DROP DATABASE $SCRATCH"
  echo "== restore test OK: $USERS accounts, $POSTS posts"
  exit 0
fi

read -r -p "This REPLACES the live database with $NAME. Type the domain ($API_DOMAIN) to go on: " answer
[ "$answer" = "$API_DOMAIN" ] || { echo "Stopped."; exit 1; }
./backup.sh                                    # what is there now, just in case
$DC stop web ws worker
fetch "$NAME" | $DC exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner
$DC up -d
echo "== restored $NAME"

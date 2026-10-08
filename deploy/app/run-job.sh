#!/usr/bin/env bash
# Run one scheduled job (from /etc/cron.d/adventlife):
#
#   run-job.sh manage <command> [args]   a Django management command in the web container
#   run-job.sh script <file> [args]      a script in this folder (backup.sh, restore.sh)
#
# One run of a job at a time (a lock per job), and every run in
# /var/log/adventlife/jobs.log with how long it took and how it ended.
set -uo pipefail
cd "$(dirname "$0")"
KIND="$1"; NAME="$2"; shift 2
LOG=/var/log/adventlife/jobs.log
LOCK="/tmp/adventlife-job-${NAME%.sh}.lock"

start=$(date +%s)
{
  echo "[$(date -u +%FT%TZ)] start $NAME $*"
  if [ "$KIND" = manage ]; then
    flock -n "$LOCK" docker compose exec -T web python manage.py "$NAME" "$@"
  else
    flock -n "$LOCK" "./$NAME" "$@"
  fi
  code=$?
  echo "[$(date -u +%FT%TZ)] end   $NAME exit=$code $(( $(date +%s) - start ))s"
} >> "$LOG" 2>&1
exit "${code:-0}"

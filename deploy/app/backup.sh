#!/usr/bin/env bash
# Dump the database to the private R2 bucket (BACKUP_R2_BUCKET), keep 14.
# Nightly from the crontab, and before every migration (deploy.sh --migrate).
#
#   ./backup.sh                 dump now
#   docker compose exec -T web python manage.py db_backup list
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

# pg_dump runs in the db container (the matching Postgres version); the bytes
# stream straight into the uploader in the web container - no copy on disk.
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=6 \
  | docker compose exec -T web python manage.py db_backup upload
docker compose exec -T web python manage.py db_backup prune --keep "${BACKUP_KEEP:-14}"

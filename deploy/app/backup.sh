#!/usr/bin/env bash
# Dump the database to the private R2 bucket (BACKUP_R2_BUCKET), keep 14.
# Nightly from the crontab, and before every migration (deploy.sh --migrate).
#
#   ./backup.sh                 dump now
#   docker compose exec -T web python manage.py db_backup list
set -euo pipefail
cd "$(dirname "$0")"
# Only the values these scripts need, read as plain text: .env is not shell
# (a value like "Name <a@b.c>" or "https://<id>..." breaks `. ./.env`).
envval() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//'; }
API_DOMAIN=$(envval API_DOMAIN)
POSTGRES_USER=$(envval POSTGRES_USER)
POSTGRES_DB=$(envval POSTGRES_DB)

# pg_dump runs in the db container (the matching Postgres version); the bytes
# stream straight into the uploader in the web container - no copy on disk.
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=6 \
  | docker compose exec -T web python manage.py db_backup upload
docker compose exec -T web python manage.py db_backup prune --keep "${BACKUP_KEEP:-14}"

#!/usr/bin/env bash
# The one-time steps after the stack first starts (as deploy, from this folder).
# Each is safe to run again; run one alone with  ./first-run.sh <step>.
#
#   ./first-run.sh            all of them, in order
#   ./first-run.sh admin      only make (or promote) the first super admin
#
#   migrate      the database's tables (a new database: ~3 minutes)
#   bible        the KJV and the Swahili Bible (thousands of requests to the
#                Bible sites - resumable; the quiz, verse and puzzles need it)
#   words        the puzzle's word lists, English and Swahili (after `bible`)
#   backfill     queue the worker's one-off jobs for content made before them
#                (song lengths and spectra, photo thumbnails, video fast-start,
#                book pictures to R2, like totals) - only matters when an old
#                database was restored
#   warm         the first daily quiz and trending, before anyone asks
#   admin        the first super admin
set -euo pipefail
cd "$(dirname "$0")"
M="docker compose exec -T web python manage.py"
STEP="${1:-all}"
run() { [ "$STEP" = all ] || [ "$STEP" = "$1" ]; }

if run migrate; then
  echo "== migrate"
  $M migrate --noinput
fi

if run bible; then
  echo "== bible (KJV, then Swahili) - this takes a while; it resumes if stopped"
  $M import_bible
  $M import_bible_version swh_bib
fi

if run words; then
  echo "== puzzle words"
  $M build_word_index
  $M build_word_index --language sw
fi

if run backfill; then
  echo "== backfills (queued for the worker)"
  for c in backfill_track_durations backfill_spectrum image_thumbnails faststart_videos move_publication_images; do
    $M "$c" || echo "   ($c: nothing to do or failed - see above)"
  done
  $M recount_total_likes
fi

if run warm; then
  echo "== warm"
  $M build_daily_quiz
  $M refresh_trending
fi

if run admin; then
  echo "== the first super admin"
  read -r -p "Username (an existing account is promoted; a new one is created): " U
  if $M shell -c "from songs.models import User; import sys; sys.exit(0 if User.objects.filter(username='$U').exists() else 1)"; then
    echo "   promoting $U"
  else
    docker compose exec web python manage.py createsuperuser --username "$U"
  fi
  $M shell -c "
from songs.models import User
u = User.objects.get(username='$U')
u.admin_role = 'super_admin'
u.is_email_verified = True
u.save(update_fields=['admin_role', 'is_email_verified'])
print('   super admin:', u.username, '- set up the authenticator app on first opening the Admin area')
"
fi
echo "== done"

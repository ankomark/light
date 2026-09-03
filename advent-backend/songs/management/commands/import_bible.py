"""Import the KJV into the local corpus, one chapter at a time.

The quiz generator needs the text locally: twenty questions a day would
otherwise be twenty round trips, and a hard question needs to draw its wrong
answers from the same book. bible-api.com is the same source the reader already
uses, and KJV is public domain.

Resumable by design — it skips chapters already stored, so an interrupted run
(or a rate limit) is fixed by running it again:

    python manage.py import_bible                 # everything missing
    python manage.py import_bible --books John,Acts
    python manage.py import_bible --limit 50      # stop after 50 chapters
"""
import time

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from songs.bible_books import BIBLE_BOOKS
from songs.models import BibleVerse

API = 'https://bible-api.com/{ref}?translation=kjv'


class Command(BaseCommand):
    help = 'Import the KJV Bible text used by the daily quiz generator.'

    def add_arguments(self, parser):
        parser.add_argument('--books', help='Comma-separated book names (default: all).')
        parser.add_argument('--limit', type=int, help='Stop after this many chapters.')
        parser.add_argument('--delay', type=float, default=0.6,
                            help='Seconds between requests (default 0.6 — be kind to a free API).')

    def handle(self, *args, **opts):
        try:
            import requests
        except ImportError:
            raise CommandError('requests is required: pip install requests')

        books = BIBLE_BOOKS
        if opts.get('books'):
            wanted = {b.strip().lower() for b in opts['books'].split(',')}
            books = [b for b in BIBLE_BOOKS if b['name'].lower() in wanted]
            missing = wanted - {b['name'].lower() for b in books}
            if missing:
                raise CommandError('Unknown book(s): %s' % ', '.join(sorted(missing)))

        # Chapters already stored are skipped, so re-running resumes.
        have = set(
            BibleVerse.objects.values_list('book', 'chapter').distinct()
        )

        todo = [
            (b, ch) for b in books
            for ch in range(1, b['chapters'] + 1)
            if (b['name'], ch) not in have
        ]
        if opts.get('limit'):
            todo = todo[:opts['limit']]

        if not todo:
            self.stdout.write(self.style.SUCCESS(
                'Nothing to do — %d verses already stored.' % BibleVerse.objects.count()))
            return

        self.stdout.write('%d chapters to fetch (~%d min at %.1fs each).'
                          % (len(todo), len(todo) * opts['delay'] / 60, opts['delay']))

        imported = failed = 0
        for i, (book, chapter) in enumerate(todo, 1):
            ref = '%s+%d' % (book['name'].replace(' ', '+'), chapter)
            try:
                res = requests.get(API.format(ref=ref), timeout=20)
                res.raise_for_status()
                verses = res.json().get('verses') or []
            except Exception as exc:                      # noqa: BLE001 - report and continue
                failed += 1
                self.stderr.write('  %s %d failed: %s' % (book['name'], chapter, exc))
                time.sleep(opts['delay'])
                continue

            rows = [
                BibleVerse(
                    book=book['name'], book_number=book['number'],
                    chapter=v.get('chapter', chapter), verse=v['verse'],
                    text=' '.join((v.get('text') or '').split()),
                )
                for v in verses if v.get('verse') and (v.get('text') or '').strip()
            ]
            with transaction.atomic():
                # ignore_conflicts: a re-run must never trip the unique constraint.
                BibleVerse.objects.bulk_create(rows, ignore_conflicts=True)
            imported += len(rows)

            if i % 25 == 0 or i == len(todo):
                self.stdout.write('  %d/%d chapters · %d verses' % (i, len(todo), imported))
            time.sleep(opts['delay'])

        self.stdout.write(self.style.SUCCESS(
            'Imported %d verses (%d chapters failed). Corpus now holds %d verses.'
            % (imported, failed, BibleVerse.objects.count())))
        if failed:
            self.stdout.write('Run the command again to retry the chapters that failed.')

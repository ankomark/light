"""Import a Bible version other than the KJV into BibleText, for the quiz.

    python manage.py import_bible_version swh_bib

From bible.helloao.org — the same source the app's Bible reader reads — one
request per chapter (1,189 for a whole Bible), a little apart so the source
is not hammered. Safe to stop and run again: chapters already imported are
skipped, so a second run finishes what the first did not.

swh_bib is "Neno: Bibilia Takatifu" © Biblica, Inc., under CC BY-SA 4.0; the
app names it (with its credit) wherever its text is shown.
"""
import json
import re
import time
import urllib.request

from django.core.management.base import BaseCommand, CommandError

from songs.models import BibleText

BASE = 'https://bible.helloao.org/api'

# The 66 books in canonical order, by the codes the source uses. Position + 1
# is the book number, which is how every verse here is keyed.
CODES = [
    'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI',
    '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER',
    'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP',
    'HAG', 'ZEC', 'MAL', 'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL',
    'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE',
    '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV',
]
NUMBER = {code: i + 1 for i, code in enumerate(CODES)}


def get_json(url):
    """One GET. A function of its own so tests can stand in for the network."""
    req = urllib.request.Request(url, headers={'User-Agent': 'AdventistLife/1.0 (quiz import)'})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode('utf-8'))


def verse_text(content):
    """A verse's content — strings, {text}, {lineBreak}, footnote markers — as
    one line of plain text."""
    parts = []
    for c in content or []:
        if isinstance(c, str):
            parts.append(c)
        elif isinstance(c, dict) and c.get('text'):
            parts.append(c['text'])
    text = ' '.join(parts).replace('¶', ' ')
    return re.sub(r'\s+', ' ', text).strip()


class Command(BaseCommand):
    help = 'Import a Bible version (e.g. swh_bib) from bible.helloao.org into BibleText.'

    def add_arguments(self, parser):
        parser.add_argument('version', help='The source\'s version id, e.g. swh_bib')
        parser.add_argument('--pause', type=float, default=0.2,
                            help='Seconds between chapter requests (default 0.2)')

    def handle(self, *args, version, pause, **options):
        try:
            books = get_json(f'{BASE}/{version}/books.json').get('books') or []
        except Exception as exc:
            raise CommandError(f'Could not read the book list for {version}: {exc}')
        books = [b for b in books if b.get('id') in NUMBER]
        if not books:
            raise CommandError(f'{version} lists none of the 66 books.')

        have = set(BibleText.objects.filter(version=version)
                   .values_list('book_number', 'chapter').distinct())
        added = skipped = failed = 0
        for book in sorted(books, key=lambda b: NUMBER[b['id']]):
            number = NUMBER[book['id']]
            name = book.get('commonName') or book.get('name') or book['id']
            for chapter in range(1, (book.get('numberOfChapters') or 0) + 1):
                if (number, chapter) in have:
                    skipped += 1
                    continue
                try:
                    data = get_json(f"{BASE}/{version}/{book['id']}/{chapter}.json")
                except Exception as exc:
                    failed += 1
                    self.stderr.write(f'  {name} {chapter}: {exc} — run again to retry')
                    continue
                rows = []
                for item in (data.get('chapter') or {}).get('content') or []:
                    if item.get('type') != 'verse':
                        continue
                    text = verse_text(item.get('content'))
                    if text:
                        rows.append(BibleText(
                            version=version, book=name, book_number=number,
                            chapter=chapter, verse=int(item['number']), text=text,
                        ))
                BibleText.objects.bulk_create(rows, ignore_conflicts=True)
                added += 1
                if pause:
                    time.sleep(pause)
            self.stdout.write(f'{name}: done')

        total = BibleText.objects.filter(version=version).count()
        self.stdout.write(self.style.SUCCESS(
            f'{version}: {added} chapters imported, {skipped} already there, {failed} failed; '
            f'{total} verses in all.'))
        if failed:
            raise CommandError(f'{failed} chapters failed — run the command again to fetch them.')

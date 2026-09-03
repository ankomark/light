"""Index scripture's vocabulary for the word puzzle.

The puzzle asks "which real words can be spelled from these letters?". Answering
that from the verse table would mean scanning 31,000 verses per level, so the
distinct words are extracted once into BibleWord with their letters sorted and
their frequency counted.

Using the KJV's own vocabulary as the dictionary is the point: every answer a
player finds is a word that actually appears in scripture.

    python manage.py build_word_index
    python manage.py build_word_index --min 3 --max 9
"""
import re
from collections import Counter

from django.core.management.base import BaseCommand
from django.db import transaction

from songs.models import BibleVerse, BibleWord

# Archaic forms that are common enough to survive the frequency filter but that
# no player would think to look for.
EXCLUDE = {
    'THEE', 'THOU', 'THY', 'THINE', 'HATH', 'HAST', 'DOTH', 'SHALT',
    'UNTO', 'SAITH', 'WHEREFORE', 'THEREUNTO', 'WHOSOEVER', 'YEA', 'NAY',
}


class Command(BaseCommand):
    help = 'Extract the distinct words of the corpus into the puzzle dictionary.'

    def add_arguments(self, parser):
        parser.add_argument('--min', type=int, default=3, help='Shortest word to keep (default 3).')
        parser.add_argument('--max', type=int, default=9, help='Longest word to keep (default 9).')
        parser.add_argument('--min-frequency', type=int, default=3,
                            help='Drop words rarer than this (default 3).')

    def handle(self, *args, **options):
        low, high = options['min'], options['max']
        floor = options['min_frequency']

        if not BibleVerse.objects.exists():
            self.stderr.write('The corpus is empty — run "manage.py import_bible" first.')
            return

        counts = Counter()
        total = BibleVerse.objects.count()
        self.stdout.write('Reading %d verses...' % total)

        # Streamed: the whole corpus does not need to be resident at once.
        for text in BibleVerse.objects.values_list('text', flat=True).iterator(chunk_size=2000):
            for raw in text.split():
                word = re.sub(r'[^A-Za-z]', '', raw).upper()
                if low <= len(word) <= high and word not in EXCLUDE:
                    counts[word] += 1

        keep = {w: n for w, n in counts.items() if n >= floor}
        self.stdout.write('%d distinct words, %d kept at frequency >= %d.'
                          % (len(counts), len(keep), floor))

        rows = [
            BibleWord(word=w, length=len(w), letters=''.join(sorted(w)), frequency=n)
            for w, n in keep.items()
        ]
        with transaction.atomic():
            BibleWord.objects.all().delete()
            BibleWord.objects.bulk_create(rows, batch_size=2000)

        self.stdout.write(self.style.SUCCESS(
            'Indexed %d words (%d-%d letters).' % (len(rows), low, high)
        ))

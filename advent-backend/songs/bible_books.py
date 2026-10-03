"""The 66 books of the KJV, in canonical order.

Mirrors the list the Bible reader ships (front/streams/components/BibleReader.js)
so the importer, the quiz generator and the reader agree on names and chapter
counts. Books 1-39 are the Old Testament.
"""

BIBLE_BOOKS = [
    {'number': 1, 'name': 'Genesis', 'chapters': 50},
    {'number': 2, 'name': 'Exodus', 'chapters': 40},
    {'number': 3, 'name': 'Leviticus', 'chapters': 27},
    {'number': 4, 'name': 'Numbers', 'chapters': 36},
    {'number': 5, 'name': 'Deuteronomy', 'chapters': 34},
    {'number': 6, 'name': 'Joshua', 'chapters': 24},
    {'number': 7, 'name': 'Judges', 'chapters': 21},
    {'number': 8, 'name': 'Ruth', 'chapters': 4},
    {'number': 9, 'name': '1 Samuel', 'chapters': 31},
    {'number': 10, 'name': '2 Samuel', 'chapters': 24},
    {'number': 11, 'name': '1 Kings', 'chapters': 22},
    {'number': 12, 'name': '2 Kings', 'chapters': 25},
    {'number': 13, 'name': '1 Chronicles', 'chapters': 29},
    {'number': 14, 'name': '2 Chronicles', 'chapters': 36},
    {'number': 15, 'name': 'Ezra', 'chapters': 10},
    {'number': 16, 'name': 'Nehemiah', 'chapters': 13},
    {'number': 17, 'name': 'Esther', 'chapters': 10},
    {'number': 18, 'name': 'Job', 'chapters': 42},
    {'number': 19, 'name': 'Psalms', 'chapters': 150},
    {'number': 20, 'name': 'Proverbs', 'chapters': 31},
    {'number': 21, 'name': 'Ecclesiastes', 'chapters': 12},
    {'number': 22, 'name': 'Song of Solomon', 'chapters': 8},
    {'number': 23, 'name': 'Isaiah', 'chapters': 66},
    {'number': 24, 'name': 'Jeremiah', 'chapters': 52},
    {'number': 25, 'name': 'Lamentations', 'chapters': 5},
    {'number': 26, 'name': 'Ezekiel', 'chapters': 48},
    {'number': 27, 'name': 'Daniel', 'chapters': 12},
    {'number': 28, 'name': 'Hosea', 'chapters': 14},
    {'number': 29, 'name': 'Joel', 'chapters': 3},
    {'number': 30, 'name': 'Amos', 'chapters': 9},
    {'number': 31, 'name': 'Obadiah', 'chapters': 1},
    {'number': 32, 'name': 'Jonah', 'chapters': 4},
    {'number': 33, 'name': 'Micah', 'chapters': 7},
    {'number': 34, 'name': 'Nahum', 'chapters': 3},
    {'number': 35, 'name': 'Habakkuk', 'chapters': 3},
    {'number': 36, 'name': 'Zephaniah', 'chapters': 3},
    {'number': 37, 'name': 'Haggai', 'chapters': 2},
    {'number': 38, 'name': 'Zechariah', 'chapters': 14},
    {'number': 39, 'name': 'Malachi', 'chapters': 4},
    {'number': 40, 'name': 'Matthew', 'chapters': 28},
    {'number': 41, 'name': 'Mark', 'chapters': 16},
    {'number': 42, 'name': 'Luke', 'chapters': 24},
    {'number': 43, 'name': 'John', 'chapters': 21},
    {'number': 44, 'name': 'Acts', 'chapters': 28},
    {'number': 45, 'name': 'Romans', 'chapters': 16},
    {'number': 46, 'name': '1 Corinthians', 'chapters': 16},
    {'number': 47, 'name': '2 Corinthians', 'chapters': 13},
    {'number': 48, 'name': 'Galatians', 'chapters': 6},
    {'number': 49, 'name': 'Ephesians', 'chapters': 6},
    {'number': 50, 'name': 'Philippians', 'chapters': 4},
    {'number': 51, 'name': 'Colossians', 'chapters': 4},
    {'number': 52, 'name': '1 Thessalonians', 'chapters': 5},
    {'number': 53, 'name': '2 Thessalonians', 'chapters': 3},
    {'number': 54, 'name': '1 Timothy', 'chapters': 6},
    {'number': 55, 'name': '2 Timothy', 'chapters': 4},
    {'number': 56, 'name': 'Titus', 'chapters': 3},
    {'number': 57, 'name': 'Philemon', 'chapters': 1},
    {'number': 58, 'name': 'Hebrews', 'chapters': 13},
    {'number': 59, 'name': 'James', 'chapters': 5},
    {'number': 60, 'name': '1 Peter', 'chapters': 5},
    {'number': 61, 'name': '2 Peter', 'chapters': 3},
    {'number': 62, 'name': '1 John', 'chapters': 5},
    {'number': 63, 'name': '2 John', 'chapters': 1},
    {'number': 64, 'name': '3 John', 'chapters': 1},
    {'number': 65, 'name': 'Jude', 'chapters': 1},
    {'number': 66, 'name': 'Revelation', 'chapters': 22},
]

BOOK_NAMES = [b['name'] for b in BIBLE_BOOKS]
BOOKS_BY_NAME = {b['name']: b for b in BIBLE_BOOKS}
OLD_TESTAMENT = [b for b in BIBLE_BOOKS if b['number'] <= 39]
NEW_TESTAMENT = [b for b in BIBLE_BOOKS if b['number'] > 39]
TOTAL_CHAPTERS = sum(b['chapters'] for b in BIBLE_BOOKS)


# ── Looking up a reference (Scripture cards in chats) ──────────────────────
import re as _re

_REF = _re.compile(r'^\s*((?:[1-3]\s*)?[A-Za-z][A-Za-z .]*?)\s*(\d{1,3})\s*:\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\s*$')
_ALIASES = {'ps': 'Psalms', 'psalm': 'Psalms', 'prov': 'Proverbs', 'song of songs': 'Song of Solomon',
            'eccl': 'Ecclesiastes', 'phil': 'Philippians', 'philemon': 'Philemon', 'jn': 'John', 'rev': 'Revelation',
            'revelations': 'Revelation', 'matt': 'Matthew', 'mt': 'Matthew', 'mk': 'Mark', 'lk': 'Luke',
            'rom': 'Romans', 'gen': 'Genesis', 'ex': 'Exodus', 'isa': 'Isaiah', 'jer': 'Jeremiah', 'heb': 'Hebrews'}
MAX_VERSES = 5


def book_named(name):
    """'Phil', 'philippians', '1 cor' → the book's canonical name, or None."""
    key = _re.sub(r'\s+', ' ', name.replace('.', ' ')).strip().lower()
    if key in _ALIASES:
        return _ALIASES[key]
    squashed = key.replace(' ', '')
    for b in BIBLE_BOOKS:
        if b['name'].lower().replace(' ', '') == squashed:
            return b['name']
    matches = [b['name'] for b in BIBLE_BOOKS if b['name'].lower().replace(' ', '').startswith(squashed)]
    return matches[0] if len(matches) == 1 else None


def lookup(ref):
    """'Philippians 4:13' or 'John 3:16-17' (up to five verses) from the KJV
    stored here → {ref, text, version}, or None."""
    m = _REF.match(str(ref or '')[:60])
    if not m:
        return None
    name = book_named(m.group(1))
    if name is None:
        return None
    chapter, first = int(m.group(2)), int(m.group(3))
    last = int(m.group(4) or first)
    if last < first or last - first >= MAX_VERSES:
        return None
    from .models import BibleVerse
    verses = list(BibleVerse.objects.filter(book=name, chapter=chapter, verse__gte=first, verse__lte=last)
                  .order_by('verse').values_list('text', flat=True))
    if not verses:
        return None
    label = f'{name} {chapter}:{first}' + (f'-{last}' if last != first else '')
    return {'ref': label, 'text': ' '.join(v.strip() for v in verses), 'version': 'KJV'}

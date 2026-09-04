"""The verse of the day.

The text comes from the KJV already imported here; only the *choice* is
curated, and that is deliberate. Two rules were tried first and both failed on
quality rather than on quantity:

  · keyword matching across the whole Bible returned 1,113 verses, most of them
    narrative — "Rebekah sent and called Jacob" contains the right words and is
    not an encouragement;
  · restricting to Psalms, Proverbs, Isaiah and the Epistles helped, but still
    surfaced laments ("my strength faileth me") and fragments ("Forbid him
    not"), because no keyword can tell tone from vocabulary.

Someone sees one verse a day. A lament or a half-sentence on that screen reads
as a bug, so the references below are chosen. There are enough for years before
one comes round again, and the order is shuffled once from a fixed seed so the
sequence is not simply Genesis to Revelation.

Deterministic by date: everyone opening the app on the same day sees the same
verse, and yesterday's is still yesterday's.
"""
import random
from datetime import date as date_cls

from .models import BibleVerse

# ── the selection ────────────────────────────────────────────────────────────
# (book, chapter, verse). Book names match how import_bible stores them.
REFERENCES = [
    ('Joshua', 1, 9), ('Deuteronomy', 31, 6), ('Deuteronomy', 31, 8),
    ('Exodus', 14, 14), ('Numbers', 6, 24), ('Numbers', 6, 25), ('Numbers', 6, 26),
    ('1 Chronicles', 16, 11), ('1 Chronicles', 16, 34), ('2 Chronicles', 7, 14),
    ('Nehemiah', 8, 10), ('Job', 19, 25),

    ('Psalms', 1, 1), ('Psalms', 4, 8), ('Psalms', 9, 9), ('Psalms', 16, 8),
    ('Psalms', 18, 2), ('Psalms', 19, 14), ('Psalms', 20, 4), ('Psalms', 23, 1),
    ('Psalms', 23, 4), ('Psalms', 23, 6), ('Psalms', 27, 1), ('Psalms', 27, 14),
    ('Psalms', 28, 7), ('Psalms', 29, 11), ('Psalms', 30, 5), ('Psalms', 31, 24),
    ('Psalms', 32, 8), ('Psalms', 34, 8), ('Psalms', 34, 17), ('Psalms', 34, 18),
    ('Psalms', 37, 4), ('Psalms', 37, 5), ('Psalms', 37, 23), ('Psalms', 40, 1),
    ('Psalms', 42, 11), ('Psalms', 46, 1), ('Psalms', 46, 10), ('Psalms', 51, 10),
    ('Psalms', 55, 22), ('Psalms', 56, 3), ('Psalms', 62, 1), ('Psalms', 63, 1),
    ('Psalms', 71, 14), ('Psalms', 73, 26), ('Psalms', 84, 11), ('Psalms', 86, 15),
    ('Psalms', 91, 1), ('Psalms', 91, 2), ('Psalms', 91, 11), ('Psalms', 94, 19),
    ('Psalms', 100, 4), ('Psalms', 103, 2), ('Psalms', 103, 8), ('Psalms', 107, 1),
    ('Psalms', 118, 24), ('Psalms', 119, 105), ('Psalms', 121, 1), ('Psalms', 121, 2),
    ('Psalms', 121, 8), ('Psalms', 126, 5), ('Psalms', 127, 1), ('Psalms', 133, 1),
    ('Psalms', 138, 8), ('Psalms', 139, 14), ('Psalms', 143, 8), ('Psalms', 145, 18),
    ('Psalms', 147, 3), ('Psalms', 150, 6),

    ('Proverbs', 3, 5), ('Proverbs', 3, 6), ('Proverbs', 4, 23), ('Proverbs', 11, 25),
    ('Proverbs', 15, 1), ('Proverbs', 16, 3), ('Proverbs', 16, 9), ('Proverbs', 16, 24),
    ('Proverbs', 17, 17), ('Proverbs', 18, 10), ('Proverbs', 19, 21), ('Proverbs', 22, 6),
    ('Proverbs', 27, 17), ('Proverbs', 31, 25),
    ('Ecclesiastes', 3, 1), ('Ecclesiastes', 4, 9), ('Ecclesiastes', 4, 12),

    ('Isaiah', 26, 3), ('Isaiah', 30, 21), ('Isaiah', 40, 29), ('Isaiah', 40, 31),
    ('Isaiah', 41, 10), ('Isaiah', 41, 13), ('Isaiah', 43, 2), ('Isaiah', 43, 19),
    ('Isaiah', 54, 17), ('Isaiah', 55, 8), ('Isaiah', 58, 11), ('Isaiah', 61, 1),
    ('Jeremiah', 29, 11), ('Jeremiah', 31, 3), ('Jeremiah', 32, 27), ('Jeremiah', 33, 3),
    ('Lamentations', 3, 22), ('Lamentations', 3, 23), ('Lamentations', 3, 25),
    ('Micah', 6, 8), ('Habakkuk', 3, 19), ('Zephaniah', 3, 17), ('Malachi', 3, 10),

    ('Matthew', 5, 14), ('Matthew', 5, 16), ('Matthew', 6, 33), ('Matthew', 6, 34),
    ('Matthew', 7, 7), ('Matthew', 11, 28), ('Matthew', 11, 29), ('Matthew', 17, 20),
    ('Matthew', 19, 26), ('Matthew', 28, 20), ('Mark', 9, 23), ('Mark', 10, 27),
    ('Mark', 11, 24), ('Luke', 1, 37), ('Luke', 6, 31), ('Luke', 6, 38),
    ('Luke', 12, 7), ('John', 1, 5), ('John', 3, 16), ('John', 8, 12),
    ('John', 14, 1), ('John', 14, 6), ('John', 14, 27), ('John', 15, 5),
    ('John', 16, 33),

    ('Romans', 5, 3), ('Romans', 8, 18), ('Romans', 8, 28), ('Romans', 8, 31),
    ('Romans', 8, 38), ('Romans', 12, 2), ('Romans', 12, 12), ('Romans', 15, 13),
    ('1 Corinthians', 10, 13), ('1 Corinthians', 13, 4), ('1 Corinthians', 13, 13),
    ('1 Corinthians', 15, 58), ('1 Corinthians', 16, 13), ('1 Corinthians', 16, 14),
    ('2 Corinthians', 1, 3), ('2 Corinthians', 4, 16), ('2 Corinthians', 4, 18),
    ('2 Corinthians', 5, 7), ('2 Corinthians', 5, 17), ('2 Corinthians', 9, 8),
    ('2 Corinthians', 12, 9), ('Galatians', 5, 22), ('Galatians', 6, 9),
    ('Ephesians', 2, 8), ('Ephesians', 3, 20), ('Ephesians', 4, 32), ('Ephesians', 6, 10),
    ('Philippians', 1, 6), ('Philippians', 2, 3), ('Philippians', 3, 13),
    ('Philippians', 4, 4), ('Philippians', 4, 6), ('Philippians', 4, 7),
    ('Philippians', 4, 8), ('Philippians', 4, 13), ('Philippians', 4, 19),
    ('Colossians', 3, 2), ('Colossians', 3, 15), ('Colossians', 3, 23),
    ('1 Thessalonians', 5, 11), ('1 Thessalonians', 5, 16), ('1 Thessalonians', 5, 18),
    ('2 Timothy', 1, 7), ('2 Timothy', 3, 16), ('Titus', 2, 11),
    ('Hebrews', 4, 16), ('Hebrews', 10, 23), ('Hebrews', 11, 1), ('Hebrews', 12, 1),
    ('Hebrews', 12, 2), ('Hebrews', 13, 5), ('Hebrews', 13, 8),
    ('James', 1, 2), ('James', 1, 5), ('James', 1, 12), ('James', 1, 17),
    ('James', 4, 8), ('1 Peter', 4, 10), ('1 Peter', 5, 6), ('1 Peter', 5, 7),
    ('2 Peter', 3, 9), ('1 John', 1, 9), ('1 John', 3, 1), ('1 John', 4, 18),
    ('1 John', 4, 19), ('1 John', 5, 14), ('Revelation', 21, 4),
]

# Shuffled once from a fixed seed, so the year does not read Genesis to
# Revelation, and the order is the same on every device and every deploy.
_ORDER = list(REFERENCES)
random.Random(20260101).shuffle(_ORDER)

# The day the rotation counts from. Any fixed date works; this one only has to
# never change, because moving it would reshuffle everyone's history.
EPOCH = date_cls(2026, 1, 1)


def reference_for_date(day):
    """The (book, chapter, verse) whose turn it is."""
    index = (day - EPOCH).days % len(_ORDER)
    return _ORDER[index]


def verse_for_date(day=None):
    """Today's verse, or None if the corpus has not been imported.

    Falls forward rather than failing: if a curated reference is missing from
    the database — a partial import, a book named differently — the next one in
    the rotation is used, so the screen always has something to show.
    """
    day = day or date_cls.today()
    for step in range(len(_ORDER)):
        book, chapter, verse = reference_for_date(day + _day(step))
        found = BibleVerse.objects.filter(
            book=book, chapter=chapter, verse=verse,
        ).first()
        if found:
            return found
    return None


def _day(n):
    from datetime import timedelta
    return timedelta(days=n)

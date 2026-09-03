"""Seed the word-puzzle themes.

Themes are data, not code: each says where to draw its words from, and the
generator reads the corpus. Three kinds — a group of books, a single passage,
and a topic searched across the whole Bible — so the set can grow without
anything here changing.
"""
from django.db import migrations

THEMES = [
    # ── by book ─────────────────────────────────────────────────────────────
    {
        'name': 'Books of the Law', 'slug': 'books-of-the-law', 'icon': 'library',
        'description': 'The first five books of the Bible.',
        'source': {'kind': 'books', 'first': 1, 'last': 5}, 'order': 1,
    },
    {
        'name': 'The Gospels', 'slug': 'the-gospels', 'icon': 'book',
        'description': 'Matthew, Mark, Luke and John.',
        'source': {'kind': 'books', 'first': 40, 'last': 43}, 'order': 2,
    },
    {
        'name': 'The Prophets', 'slug': 'the-prophets', 'icon': 'flame',
        'description': 'Isaiah through Malachi.',
        'source': {'kind': 'books', 'first': 23, 'last': 39}, 'order': 3,
    },
    # ── by passage ──────────────────────────────────────────────────────────
    {
        'name': 'Psalm 23', 'slug': 'psalm-23', 'icon': 'musical-notes',
        'description': 'The Lord is my shepherd.',
        'source': {'kind': 'passage', 'book': 'Psalms', 'chapter': 23}, 'order': 4,
    },
    {
        'name': 'Creation', 'slug': 'creation', 'icon': 'planet',
        'description': 'The first chapter of Genesis.',
        'source': {'kind': 'passage', 'book': 'Genesis', 'chapter': 1}, 'order': 5,
    },
    {
        'name': 'The Beatitudes', 'slug': 'the-beatitudes', 'icon': 'sunny',
        'description': 'The sermon on the mount, Matthew 5.',
        'source': {'kind': 'passage', 'book': 'Matthew', 'chapter': 5}, 'order': 6,
    },
    {
        'name': 'Proverbs', 'slug': 'proverbs-wisdom', 'icon': 'bulb',
        'description': 'Wisdom, from the book of Proverbs.',
        'source': {'kind': 'passage', 'book': 'Proverbs'}, 'order': 7,
    },
    # ── by topic ────────────────────────────────────────────────────────────
    {
        'name': 'Faith', 'slug': 'faith', 'icon': 'shield',
        'description': 'Words from the verses that speak of faith.',
        'source': {'kind': 'topic', 'term': 'faith'}, 'order': 8,
    },
    {
        'name': 'Love', 'slug': 'love', 'icon': 'heart',
        'description': 'Words from the verses that speak of love.',
        'source': {'kind': 'topic', 'term': 'love'}, 'order': 9,
    },
    {
        'name': 'Prayer', 'slug': 'prayer', 'icon': 'hand-left',
        'description': 'Words from the verses that speak of prayer.',
        'source': {'kind': 'topic', 'term': 'pray'}, 'order': 10,
    },
]


def seed(apps, schema_editor):
    PuzzleTheme = apps.get_model('songs', 'PuzzleTheme')
    for spec in THEMES:
        PuzzleTheme.objects.update_or_create(
            slug=spec['slug'],
            defaults={k: v for k, v in spec.items() if k != 'slug'},
        )


def unseed(apps, schema_editor):
    slugs = [s['slug'] for s in THEMES]
    apps.get_model('songs', 'PuzzleTheme').objects.filter(slug__in=slugs).delete()


class Migration(migrations.Migration):

    dependencies = [('songs', '0106_puzzletheme_wordpuzzle_puzzleprogress_coinspend')]

    operations = [migrations.RunPython(seed, unseed)]

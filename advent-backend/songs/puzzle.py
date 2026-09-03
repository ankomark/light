"""Build word-connect puzzles from scripture's own vocabulary.

A level is one set of letters and every word that can be spelled from them,
laid out so the words interlock like a crossword. The player is given the
letters on a wheel and finds the words.

Two rules hold the whole thing together:

  · the letters come from a word in the level's theme, so a Psalm 23 level is
    built from a Psalm 23 word;
  · every answer is a word that actually appears in the KJV — the dictionary is
    BibleWord, scripture's own vocabulary, not an English word list.

Deterministic per (theme, level): the seed is the theme slug and the level, so
a level is the same puzzle for everyone and rebuilding changes nothing.
"""
import hashlib
import random
import re
from collections import Counter

from django.db import transaction

from .bible_books import BIBLE_BOOKS
from .models import BibleVerse, BibleWord, PuzzleTheme, WordPuzzle

MIN_ANSWER = 3          # shortest word the wheel will accept
BASE_MIN, BASE_MAX = 5, 7   # letters on the wheel

# Answers per level, and how far the wheel grows.
def level_base_length(level):
    """5 letters for the first levels, 6 then 7 as they go on."""
    return min(BASE_MAX, BASE_MIN + (level - 1) // 4)


def level_answer_count(level):
    """Six answers at level 1, rising to twelve."""
    return min(12, 5 + (level + 1) // 2)


def _seed_for(theme_slug, level):
    return int(hashlib.sha256(f'{theme_slug}:{level}'.encode()).hexdigest()[:12], 16)


def _clean(word):
    return re.sub(r'[^A-Za-z]', '', word).upper()


# ── the letters, drawn from the theme ────────────────────────────────────────

def _theme_words(theme):
    """Candidate words for a theme, most characteristic first."""
    source = theme.source or {}
    kind = source.get('kind', PuzzleTheme.BOOKS)

    if kind == PuzzleTheme.BOOKS:
        first, last = int(source.get('first', 1)), int(source.get('last', 66))
        return [
            _clean(b['name'].split()[-1]) for b in BIBLE_BOOKS
            if first <= b['number'] <= last
        ]

    if kind == PuzzleTheme.PASSAGE:
        verses = BibleVerse.objects.filter(book=source.get('book', ''))
        if source.get('chapter'):
            verses = verses.filter(chapter=int(source['chapter']))
        texts = verses.values_list('text', flat=True)[:400]
    else:                                   # topic
        term = (source.get('term') or '').strip()
        if not term:
            return []
        texts = (BibleVerse.objects.filter(text__icontains=term)
                 .values_list('text', flat=True)[:300])

    counts = Counter()
    for text in texts:
        for raw in text.split():
            word = _clean(raw)
            if BASE_MIN <= len(word) <= BASE_MAX:
                counts[word] += 1
    return [w for w, _ in counts.most_common()]


def _theme_verses(theme):
    """Every verse inside a theme's scope."""
    source = theme.source or {}
    kind = source.get('kind', PuzzleTheme.BOOKS)
    verses = BibleVerse.objects.all()

    if kind == PuzzleTheme.BOOKS:
        first, last = int(source.get('first', 1)), int(source.get('last', 66))
        return verses.filter(book_number__gte=first, book_number__lte=last)

    if kind == PuzzleTheme.PASSAGE:
        verses = verses.filter(book=source.get('book', ''))
        if source.get('chapter'):
            verses = verses.filter(chapter=int(source['chapter']))
        return verses

    term = (source.get('term') or '').strip()
    return verses.filter(text__icontains=term) if term else verses.none()


# How many of a level's words to try before settling for any verse in scope.
VERSE_SEARCH_WORDS = 4


def _verse_for(theme, words, rng):
    """A verse from the theme that actually contains one of the level's words.

    This is the level's reward for finishing, so it has to be *the* verse the
    words came out of, not a decorative one: the words are searched in order,
    most characteristic first, and only a theme that yields nothing at all
    falls back to its opening verse.

    `icontains` finds candidates and a word-boundary match confirms them —
    without the second pass "ART" would match "heART" and the reveal would look
    like a mistake.
    """
    verses = _theme_verses(theme)
    for word in words[:VERSE_SEARCH_WORDS]:
        pool = list(verses.filter(text__icontains=word)[:40])
        hits = [v for v in pool
                if re.search(r'\b%s\b' % re.escape(word), v.text, re.I)]
        if hits:
            return rng.choice(hits)
    return verses.first()


# ── which words the letters can spell ────────────────────────────────────────

_DICTIONARY = None


# A word has to be common enough that a player could reasonably think of it.
# Scripture's vocabulary includes thousands of place and person names — ETHAM,
# BELA, GERA — which are real words in the text but miserable puzzle answers.
# Frequency separates them from ordinary language better than any name list
# could: HATE appears constantly, ETHAM four times.
ANSWER_MIN_FREQUENCY = 25


def dictionary():
    """(word, Counter) for every answerable word, loaded once per process.

    A few thousand words is small enough to hold and check in memory; the subset
    test cannot be done in SQL, and running it per level against the verse table
    would be far slower.
    """
    global _DICTIONARY
    if _DICTIONARY is None:
        _DICTIONARY = [
            (w, Counter(w))
            for w in BibleWord.objects
            .filter(length__gte=MIN_ANSWER, frequency__gte=ANSWER_MIN_FREQUENCY)
            .order_by('-frequency').values_list('word', flat=True)
        ]
    return _DICTIONARY


def reset_dictionary():
    """Drop the cache — used by tests, and after re-indexing."""
    global _DICTIONARY
    _DICTIONARY = None


def words_from(letters):
    """Every indexed word spellable from `letters`, longest first.

    A letter may be used only as often as it appears — two Ls need two Ls.
    """
    have = Counter(letters)
    out = []
    for word, need in dictionary():
        if len(word) <= len(letters) and not (need - have):
            out.append(word)
    return sorted(out, key=lambda w: (-len(w), w))


# ── laying the words out ─────────────────────────────────────────────────────

ACROSS, DOWN = 'across', 'down'


def _cells(word, row, col, direction):
    if direction == ACROSS:
        return [(row, col + i) for i in range(len(word))]
    return [(row + i, col) for i in range(len(word))]


def _can_place(board, word, row, col, direction):
    """True when the word fits without contradicting or crowding its neighbours.

    Crossword rules, not word-search rules: a word may cross another on a shared
    letter, but must not run alongside one, and must not butt up against a word
    at either end — both would read as words the puzzle never intended.
    """
    dr, dc = (0, 1) if direction == ACROSS else (1, 0)
    before = (row - dr, col - dc)
    after = (row + dr * len(word), col + dc * len(word))
    if before in board or after in board:
        return False

    crossings = 0
    for i, letter in enumerate(word):
        r, c = (row, col + i) if direction == ACROSS else (row + i, col)
        existing = board.get((r, c))
        if existing is not None:
            if existing != letter:
                return False
            crossings += 1
            continue
        # An empty cell must not have neighbours to either side, or the word
        # would run parallel to another and create nonsense across the pair.
        side = [(r - dc, c - dr), (r + dc, c + dr)]
        if any(n in board for n in side):
            return False
    return crossings > 0


def build_layout(words, rng):
    """Place words in an interlocking crossword. Returns (placements, board)."""
    if not words:
        return [], {}

    board = {}
    placements = []

    first = words[0]
    for i, letter in enumerate(first):
        board[(0, i)] = letter
    placements.append({'word': first, 'row': 0, 'col': 0, 'dir': ACROSS})

    for word in words[1:]:
        options = []
        for i, letter in enumerate(word):
            for (r, c), placed_letter in board.items():
                if placed_letter != letter:
                    continue
                # Cross the existing word at right angles to it.
                for direction in (ACROSS, DOWN):
                    row = r if direction == ACROSS else r - i
                    col = c - i if direction == ACROSS else c
                    if _can_place(board, word, row, col, direction):
                        options.append((row, col, direction))
        if not options:
            continue
        # Prefer placements that keep the board compact.
        rng.shuffle(options)
        row, col, direction = min(
            options,
            key=lambda o: abs(o[0]) + abs(o[1]) + len(word) // 2,
        )
        for r, c in _cells(word, row, col, direction):
            board[(r, c)] = word[_cells(word, row, col, direction).index((r, c))]
        placements.append({'word': word, 'row': row, 'col': col, 'dir': direction})

    return placements, board


def _normalise(placements, board):
    """Shift everything to start at (0, 0) and render the solution grid."""
    if not board:
        return [], []
    min_r = min(r for r, _ in board)
    min_c = min(c for _, c in board)
    max_r = max(r for r, _ in board)
    max_c = max(c for _, c in board)

    rows, cols = max_r - min_r + 1, max_c - min_c + 1
    grid = [['.' for _ in range(cols)] for _ in range(rows)]
    for (r, c), letter in board.items():
        grid[r - min_r][c - min_c] = letter

    shifted = [
        {**p, 'row': p['row'] - min_r, 'col': p['col'] - min_c}
        for p in placements
    ]
    return [''.join(row) for row in grid], shifted


def backfill(puzzle):
    """Fill in what a level built by an older version is missing.

    Levels are generated once and kept, so a puzzle someone is part-way through
    predates both the bonus list and the verse. Rebuilding it would move the
    board under them; deriving the missing pieces from the board they already
    have does not.
    """
    changed = []
    if not puzzle.bonus_words and puzzle.letters:
        on_board = {p['word'] for p in puzzle.placements}
        puzzle.bonus_words = [w for w in words_from(puzzle.letters) if w not in on_board]
        changed.append('bonus_words')
    if puzzle.verse_id is None:
        rng = random.Random(_seed_for(puzzle.theme.slug, puzzle.level))
        verse = _verse_for(puzzle.theme, [p['word'] for p in puzzle.placements], rng)
        if verse:
            puzzle.verse = verse
            changed.append('verse')
    if changed:
        puzzle.save(update_fields=changed)
    return puzzle


def generate(theme, level, force=False):
    """Build (or rebuild) one level. Returns the WordPuzzle.

    Raises ValueError when the theme cannot produce a workable set of letters —
    better than a level with two answers that still pays a completion bonus.
    """
    existing = WordPuzzle.objects.filter(theme=theme, level=level).first()
    if existing and not force:
        return backfill(existing)

    rng = random.Random(_seed_for(theme.slug, level))
    target_len = level_base_length(level)
    wanted = level_answer_count(level)

    # Try theme words of the right length until one yields enough answers.
    candidates = [w for w in _theme_words(theme) if len(w) == target_len] \
        or [w for w in _theme_words(theme) if BASE_MIN <= len(w) <= BASE_MAX]
    if not candidates:
        raise ValueError('Theme "%s" has no usable words.' % theme.name)

    # Later levels start further down the list, so they are not the same puzzle.
    start = min((level - 1) * 2, max(0, len(candidates) - 1))
    ordered = candidates[start:] + candidates[:start]

    for base in ordered[:25]:
        answers = words_from(base)
        if len(answers) < 5:
            continue
        chosen = answers[:wanted]
        if base not in chosen:
            chosen = [base] + chosen[:wanted - 1]
        placements, board = build_layout(chosen, rng)
        if len(placements) < 4:
            continue

        grid, shifted = _normalise(placements, board)
        letters = ''.join(rng.sample(list(base), len(base)))

        # Everything else the wheel can spell. `letters` is a shuffle of `base`,
        # so this is the same set of words, minus the ones on the board.
        on_board = {p['word'] for p in placements}
        bonus = [w for w in answers if w not in on_board]
        verse = _verse_for(theme, [p['word'] for p in placements], rng)

        with transaction.atomic():
            if existing:
                existing.grid = grid
                existing.placements = shifted
                existing.letters = letters
                existing.bonus_words = bonus
                existing.verse = verse
                existing.size = max(len(grid), len(grid[0]) if grid else 0)
                existing.save()
                return existing
            return WordPuzzle.objects.create(
                theme=theme, level=level, letters=letters,
                size=max(len(grid), len(grid[0]) if grid else 0),
                grid=grid, placements=shifted,
                bonus_words=bonus, verse=verse,
            )

    raise ValueError(
        'No word in "%s" yields a workable level %d.' % (theme.name, level)
    )

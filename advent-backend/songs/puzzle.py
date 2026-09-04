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

from django.db.models import Count

from .models import BibleVerse, BibleWord, PuzzleProgress, PuzzleTheme, WordPuzzle

MIN_ANSWER = 3          # shortest word the wheel will accept
BASE_MIN, BASE_MAX = 5, 8   # letters on the wheel

# There is no last level. Scripture's vocabulary is far larger than any run of
# levels will exhaust, so the game keeps going and gets harder instead of
# stopping. Three things climb with the level: the wheel grows, more of what it
# spells has to be found, and the words themselves get less worn.

def level_base_length(level):
    """5 letters to begin with, 8 once the levels are long past easy."""
    return min(BASE_MAX, BASE_MIN + (level - 1) // 5)


def level_answer_count(level):
    """Six answers at level 1, rising to fourteen."""
    return min(14, 5 + (level + 1) // 2)


# Bands, for the label a player sees. The curve underneath is continuous; these
# are just the names for stretches of it.
SIMPLE_UNTIL, MODERATE_UNTIL = 10, 25


def band_for(level):
    """'simple', 'moderate' or 'hard' — what this level calls itself."""
    if level <= SIMPLE_UNTIL:
        return 'simple'
    if level <= MODERATE_UNTIL:
        return 'moderate'
    return 'hard'


# A level's answers are drawn from words at least this common. Early boards use
# words nobody has to reach for; the floor comes down as levels rise, so later
# ones reach into the less worn vocabulary. It never falls below
# ANSWER_MIN_FREQUENCY — under that the corpus is mostly place and person
# names, which make miserable answers at any difficulty.
# Measured against the corpus rather than guessed: 1,847 words clear the
# standard floor, 564 clear 120, and only 130 clear 600. A floor much above
# this leaves too small a vocabulary to build a board from at all.
EARLY_FREQUENCY = 120
FLOOR_REACHED_AT = 25


def answer_floor(level):
    """How common a word must be to be an answer at this level."""
    reached = min(1.0, max(0, level - 1) / float(FLOOR_REACHED_AT))
    return int(round(EARLY_FREQUENCY + (ANSWER_MIN_FREQUENCY - EARLY_FREQUENCY) * reached))


def _seed_for(theme_slug, level):
    return int(hashlib.sha256(f'{theme_slug}:{level}'.encode()).hexdigest()[:12], 16)


def _clean(word):
    return re.sub(r'[^A-Za-z]', '', word).upper()


# ── the letters, drawn from the theme ────────────────────────────────────────

# How many verses to read for a theme's vocabulary. Enough that a broad theme
# is properly represented, bounded so a whole-testament theme is not a scan of
# the corpus. Generation is cached per level, so this is paid once.
THEME_VERSE_SAMPLE = 1500

def _thin(words):
    """True when some wheel size cannot be filled from these words.

    Judged per length, not on the total: The Beatitudes has 143 words, which
    looks ample until you notice only ten of them are eight letters long — and
    every level needing an eight-letter wheel would have been built from the
    corpus instead.
    """
    for length in range(BASE_MIN, BASE_MAX + 1):
        if sum(1 for w in words if len(w) == length) < MIN_BASE_POOL:
            return True
    return False


def _scope(theme, widen=False):
    """The verses a theme is built from.

    `widen` drops the narrowest part of the scope — a single chapter becomes
    its whole book — for themes too small to supply a game on their own. A
    Psalm 23 level built from words elsewhere in the Psalms is still a Psalms
    level; one built from the corpus at large is a theme in name only.
    """
    source = theme.source or {}
    kind = source.get('kind', PuzzleTheme.BOOKS)

    if kind == PuzzleTheme.BOOKS:
        first, last = int(source.get('first', 1)), int(source.get('last', 66))
        return BibleVerse.objects.filter(
            book_number__gte=first, book_number__lte=last,
        )

    if kind == PuzzleTheme.PASSAGE:
        verses = BibleVerse.objects.filter(book=source.get('book', ''))
        if source.get('chapter') and not widen:
            verses = verses.filter(chapter=int(source['chapter']))
        return verses

    term = (source.get('term') or '').strip()
    if not term:
        return BibleVerse.objects.none()
    return BibleVerse.objects.filter(text__icontains=term)


def _count_words(verses):
    counts = Counter()
    for text in verses.values_list('text', flat=True)[:THEME_VERSE_SAMPLE]:
        for raw in text.split():
            word = _clean(raw)
            if BASE_MIN <= len(word) <= BASE_MAX:
                counts[word] += 1
    return [w for w, _ in counts.most_common()]


_THEME_WORDS = {}


def _theme_words(theme):
    """Candidate words for a theme, most characteristic first.

    Read from the theme's own scripture. The book-range themes used to return
    the words of their book NAMES — five words for the whole Law — so every
    board they produced actually came from the fallback corpus and had nothing
    to do with the theme. They read their verses now, like everything else.
    """
    key = (theme.pk, theme.slug)
    if key in _THEME_WORDS:
        return _THEME_WORDS[key]

    words = _count_words(_scope(theme))
    if _thin(words):
        wider = _count_words(_scope(theme, widen=True))
        if len(wider) > len(words):
            words = wider

    if len(_THEME_WORDS) > 200:
        _THEME_WORDS.clear()
    _THEME_WORDS[key] = words
    return words


def reset_theme_words():
    """Drop the cached vocabularies — for tests, and after an import."""
    _THEME_WORDS.clear()


# A theme with fewer base words than this repeats itself within a few levels,
# which is what made the boards stop changing around level six.
MIN_BASE_POOL = 24


def base_pool(theme, length, min_frequency):
    """Candidate wheels of `length` for a theme, most characteristic first.

    A single chapter yields a handful of words of any one length, so a theme
    left to its own vocabulary runs out almost immediately and starts handing
    back the board it gave two levels ago. When that happens the pool is topped
    up from the wider corpus — the theme still leads, and its verse reveal is
    still drawn from its own text, but the game does not stall.
    """
    words = _theme_words(theme)
    if not words:
        # A theme with no vocabulary at all is misconfigured — a passage that
        # was never imported, a topic that matches nothing. Topping that up
        # from the corpus would paper over the mistake and serve a board with
        # no connection to its own name, so it is left to fail.
        return []

    own = [w for w in words if len(w) == length]
    if len(own) >= MIN_BASE_POOL:
        return own

    seen = set(own)
    wider = (BibleWord.objects
             .filter(length=length, frequency__gte=min_frequency)
             .order_by('-frequency')
             .values_list('word', flat=True)[:400])
    return own + [w for w in wider if w not in seen]


# Not a finish line — a bound on what the level query parameter will accept,
# so a malformed request cannot ask for level nine million.
LEVEL_LIMIT = 9999


def candidates_for(user):
    """Every (theme, level) this person could be given now, best first.

    Picking a subject is not a decision worth handing to the player. Left to
    choose, most people take the first row every time and never see the rest;
    and a list of themes is a menu to get through rather than a game to play.
    So the server decides, on two rules:

      · anything already opened and unfinished is resumed — being handed a new
        board while one sits half-done is the one thing this must never do;
      · otherwise the themes rotate, so consecutive levels change subject
        rather than marching through one theme to level fifty.

    A list rather than a single answer, because a theme can turn out not to
    build: `next_puzzle` walks it and takes the first that does. Deterministic
    given the same progress, so asking twice cannot skip a level.
    """
    themes = list(PuzzleTheme.objects.filter(is_active=True))
    if not themes:
        return []

    options = []
    started = (PuzzleProgress.objects
               .filter(user=user, is_complete=False)
               .select_related('puzzle', 'puzzle__theme')
               .order_by('-started_at')
               .first())
    if started and started.puzzle.theme.is_active:
        options.append((started.puzzle.theme, started.puzzle.level))

    done = PuzzleProgress.objects.filter(user=user, is_complete=True)
    per_theme = dict(
        done.values_list('puzzle__theme')
            .annotate(n=Count('id'))
            .values_list('puzzle__theme', 'n')
    )

    # Rotate the running order by how much has been finished overall.
    turn = sum(per_theme.values()) % len(themes)
    for theme in themes[turn:] + themes[:turn]:
        level = per_theme.get(theme.id, 0) + 1
        if (theme, level) not in options:
            options.append((theme, level))
    return options


def choose_for(user):
    """The single best (theme, level) — what `candidates_for` puts first."""
    options = candidates_for(user)
    if not options:
        raise ValueError('No puzzle themes are active.')
    return options[0]


def next_puzzle(user):
    """The level to play now: the first candidate that actually builds.

    A theme whose source cannot yield a workable level — too few words, a
    passage that was never imported — must not dead-end the player. The chooser
    moves past it rather than handing back an error, and only a set where
    nothing at all builds is a real failure.
    """
    failure = None
    for theme, level in candidates_for(user):
        try:
            return generate(theme, level)
        except ValueError as exc:
            failure = exc
    raise ValueError(str(failure) if failure else 'No puzzle themes are active.')


def _theme_verses(theme, widen=False):
    """Every verse inside a theme's scope — the same scope its words came from."""
    return _scope(theme, widen=widen)


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
    # The narrow scope first — a Psalm 23 level would rather reveal a verse of
    # Psalm 23 — then the wider one its words may have come from.
    for widen in (False, True):
        verses = _theme_verses(theme, widen=widen)
        for word in words[:VERSE_SEARCH_WORDS]:
            pool = list(verses.filter(text__icontains=word)[:40])
            hits = [v for v in pool
                    if re.search(r'\b%s\b' % re.escape(word), v.text, re.I)]
            if hits:
                return rng.choice(hits)
    return _theme_verses(theme).first()


# ── which words the letters can spell ────────────────────────────────────────

_DICTIONARY = None


# A word has to be common enough that a player could reasonably think of it.
# Scripture's vocabulary includes thousands of place and person names — ETHAM,
# BELA, GERA — which are real words in the text but miserable puzzle answers.
# Frequency separates them from ordinary language better than any name list
# could: HATE appears constantly, ETHAM four times.
ANSWER_MIN_FREQUENCY = 25


def dictionary():
    """(word, Counter, frequency) for every answerable word, loaded once.

    A few thousand words is small enough to hold and check in memory; the subset
    test cannot be done in SQL, and running it per level against the verse table
    would be far slower. The frequency rides along so a level can ask for only
    the common part of it without a second query.
    """
    global _DICTIONARY
    if _DICTIONARY is None:
        _DICTIONARY = [
            (w, Counter(w), f)
            for w, f in BibleWord.objects
            .filter(length__gte=MIN_ANSWER, frequency__gte=ANSWER_MIN_FREQUENCY)
            .order_by('-frequency').values_list('word', 'frequency')
        ]
    return _DICTIONARY


def reset_dictionary():
    """Drop the cache — used by tests, and after re-indexing."""
    global _DICTIONARY
    _DICTIONARY = None


def words_from(letters, min_frequency=ANSWER_MIN_FREQUENCY):
    """Every indexed word spellable from `letters`, longest first.

    A letter may be used only as often as it appears — two Ls need two Ls.
    `min_frequency` raises the bar for a level that wants only common words.
    """
    have = Counter(letters)
    out = []
    for word, need, freq in dictionary():
        if freq < min_frequency:
            continue
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
    floor = answer_floor(level)

    candidates = base_pool(theme, target_len, floor)
    if not candidates:
        raise ValueError('Theme "%s" has no usable words.' % theme.name)

    # Start somewhere different every level. The old rule walked two places
    # further down the list per level and then clamped at the end, so once a
    # thin theme ran out every later level rebuilt the same board. A seeded
    # start cannot run out, and stays deterministic for a given level.
    start = rng.randrange(len(candidates))
    ordered = candidates[start:] + candidates[:start]

    for base in ordered[:40]:
        answers = words_from(base, floor)
        if len(answers) < 5:
            # These letters cannot make five words that common. Take the wheel
            # anyway at the standard floor: an easy level built from slightly
            # rarer words beats a level that refuses to exist.
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
        bonus = [w for w in words_from(letters) if w not in on_board]
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

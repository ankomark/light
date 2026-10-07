"""Build a day's Bible quiz from the local corpus.

Twenty questions a day, split across three difficulties. Difficulty here is not
a label on the same question — it changes how the question is built, because
what makes a Bible question hard is how close the wrong answers sit to the right
one:

    simple    which book (mostly other-testament wrong answers), or how a
              well-known verse ends
    moderate  a missing word whose wrong answers look like it (same case,
              same ending, similar length), the book among its neighbours, or
              whether a verse is quoted word for word
    hard      the chapter (or, in a long book, which ten chapters), or which
              of two passages comes first in the book

Each weekday has a theme (DAY_THEMES): a share of the questions comes from
one part of scripture, and Saturday's from the verses people know by heart.

The generator is deterministic: the RNG is seeded from the date, so regenerating
a day rebuilds the same quiz rather than quietly handing a later player a
different set. It never invents text — every prompt is a real verse, and the
answer is the verse's own reference.
"""
import hashlib
import random
import re

from django.db import IntegrityError, transaction
from django.db.models import Q

from .bible_books import BIBLE_BOOKS
from .memory_verses import MEMORY_VERSES
from .models import BibleText, BibleVerse, DailyQuiz, QuizQuestion
from .scoring import base_points_for

# 20 a day: enough to be a sitting, not so many it becomes a chore.
QUESTIONS_PER_DAY = 20
MIX = [
    (QuizQuestion.SIMPLE, 7),
    (QuizQuestion.MODERATE, 7),
    (QuizQuestion.HARD, 6),
]
# Of the day's simple questions, how many are "how does this verse end?".
DAILY_FAMOUS = 2

# Verses too short to carry a question (or to blank a word out of), and too
# long to read on a phone before the clock matters.
MIN_WORDS = 8
MAX_WORDS = 60
# Words never blanked — removing "the" tests nothing.
STOPWORDS = {
    'the', 'and', 'of', 'to', 'in', 'that', 'he', 'shall', 'unto', 'for', 'i',
    'his', 'a', 'they', 'be', 'is', 'him', 'them', 'not', 'it', 'with', 'all',
    'thou', 'thy', 'was', 'which', 'my', 'me', 'but', 'ye', 'their', 'have',
    'we', 'this', 'as', 'are', 'when', 'so', 'said', 'from', 'were', 'you',
    'her', 'she', 'had', 'will', 'on', 'up', 'by', 'at', 'out', 'into', 'then',
}
# Capitalised for reverence or grammar, not because they name someone — they
# do not make a verse a list of names.
ALWAYS_CAPITAL = {
    'lord', 'god', 'i', 'o', 'jesus', 'christ', 'holy', 'spirit', 'ghost', 'father', 'son',
    'mungu', 'bwana', 'yesu', 'kristo', 'roho', 'mtakatifu', 'baba', 'mwana',
}
# Choices kept in the order written: "yes, word for word" before "no".
FIXED_ORDER_KINDS = ('true_false', 'exact')


# Canonical book number -> the part of scripture it belongs to. Derived rather
# than curated: the grouping is a property of the canon, not an editorial choice.
CATEGORY_RANGES = (
    (5, 'law'), (17, 'history'), (22, 'wisdom'), (27, 'major_prophets'),
    (39, 'minor_prophets'), (43, 'gospels'), (44, 'acts'), (65, 'epistles'),
    (66, 'revelation'),
)


def books_in(category):
    """(first, last) book number of a section of scripture, or None."""
    lower = 1
    for upper, name in CATEGORY_RANGES:
        if name == category:
            return lower, upper
        lower = upper + 1
    return None


def category_for(book_number):
    for upper, name in CATEGORY_RANGES:
        if book_number <= upper:
            return name
    return ''


# ── the day's theme ──────────────────────────────────────────────────────────
# Monday is 0. Saturday — the Sabbath — is the verses people know by heart.
DAY_THEMES = {0: 'gospels', 1: 'history', 2: 'prophets', 3: 'wisdom', 4: 'church',
              5: 'famous', 6: 'law'}
THEME_POOLS = {
    'law': {'books': (1, 5)}, 'history': {'books': (6, 17)}, 'wisdom': {'books': (18, 22)},
    'prophets': {'books': (23, 39)}, 'gospels': {'books': (40, 43)},
    'church': {'books': (44, 66)}, 'famous': {'famous': True},
}
# Two of each difficulty from the theme: six of the twenty.
THEME_PER_DIFFICULTY = 2


def theme_for(date):
    return DAY_THEMES.get(date.weekday(), '')


# ── languages ─────────────────────────────────────────────────────────────────
# Words never blanked in a Swahili verse: the small words that carry grammar,
# not meaning, as STOPWORDS does for the KJV.
SW_STOPWORDS = {
    'na', 'ya', 'wa', 'kwa', 'katika', 'la', 'za', 'cha', 'vya', 'ni', 'si', 'hii',
    'huu', 'hiyo', 'huo', 'huyo', 'yule', 'wale', 'hao', 'kama', 'lakini', 'au',
    'pia', 'tena', 'yeye', 'wao', 'sisi', 'ninyi', 'mimi', 'wewe', 'yako', 'yangu',
    'yake', 'yao', 'wetu', 'wenu', 'zake', 'zao', 'kila', 'bali', 'hata', 'kisha',
    'kwamba', 'ndipo', 'basi', 'ili', 'nao', 'naye', 'nami', 'kwake', 'kwao',
    'juu', 'chini', 'ndani', 'mbele', 'nyuma', 'pamoja', 'akasema', 'wakasema',
    'akamwambia', 'akawaambia', 'hivyo', 'hapo', 'huko', 'kule', 'sana', 'wote',
    'yote', 'zote', 'hilo', 'hayo', 'wala', 'ingawa', 'kwenye', 'ambaye', 'ambao',
    'ambayo', 'ambalo', 'ndiye', 'ndio', 'mpaka', 'hadi', 'baada', 'kabla',
}


class Corpus:
    """A Bible to build questions from, in the language they are asked in.

    English is the KJV (BibleVerse); Swahili is NENO (BibleText, imported
    with `import_bible_version swh_bib`). What differs is only where the
    verses live, what the books are called, how the prompts read, and which
    words are too small to blank out — the builders are the same.
    """

    def __init__(self, language, model, where, prompts, stopwords, word_re, import_hint,
                 suffixes=()):
        self.language = language
        self.model = model
        self.where = where
        self.prompts = prompts
        self.stopwords = stopwords
        self.word_re = re.compile(word_re)
        self.import_hint = import_hint
        # Endings that mark a word's grammar (-eth, -ed): a wrong answer with
        # another ending reads wrong in the gap and gives itself away.
        self.suffixes = suffixes

    def verses(self):
        return self.model.objects.filter(**self.where)

    def book_names(self):
        """[(number, name)] in canon order, in this Bible's own language."""
        if self.model is BibleVerse:
            return [(b['number'], b['name']) for b in BIBLE_BOOKS]
        return sorted(set(self.verses().values_list('book_number', 'book')))

    @staticmethod
    def chapters(book_number):
        book = next((b for b in BIBLE_BOOKS if b['number'] == book_number), None)
        return book['chapters'] if book else 0

    def clean_word(self, word):
        return self.word_re.sub('', word)

    def prompt(self, kind, **params):
        return self.prompts[kind].format(**params)


ENGLISH = Corpus(
    'en', BibleVerse, {},
    {'book': 'Which book is this verse from?',
     'blank': 'Which word completes this verse?',
     'reference': 'Which chapter of {book} is this verse from?',
     'section': 'Which chapters of {book} is this verse from?',
     'order': 'Which of these comes first in {book}?',
     'finish': 'How does this verse end?',
     'exact': 'Is this verse quoted word for word?',
     'exact_yes': 'Yes, word for word',
     'exact_no': 'No, a word has been changed',
     'exact_changed': '“{put}” was put in place of “{real}”.',
     'order_explained': '{first} comes before {second}.'},
    STOPWORDS, r"[^A-Za-z'-]", 'run "manage.py import_bible" first',
    suffixes=('eth', 'est', 'ing', 'ed', 'ly', 's'),
)
SWAHILI = Corpus(
    'sw', BibleText, {'version': 'swh_bib'},
    {'book': 'Mstari huu unatoka kitabu gani?',
     'blank': 'Ni neno gani linakamilisha mstari huu?',
     'reference': 'Mstari huu unatoka sura gani ya {book}?',
     'section': 'Mstari huu uko katika sura zipi za {book}?',
     'order': 'Kipi kati ya hivi kinatangulia katika kitabu cha {book}?',
     'finish': 'Mstari huu unaishaje?',
     'exact': 'Je, mstari huu umenukuliwa neno kwa neno?',
     'exact_yes': 'Ndiyo, neno kwa neno',
     'exact_no': 'Hapana, neno moja limebadilishwa',
     'exact_changed': '“{put}” liliwekwa badala ya “{real}”.',
     'order_explained': '{first} kinatangulia {second}.'},
    SW_STOPWORDS, r"[^\w'-]", 'run "manage.py import_bible_version swh_bib" first',
)
CORPORA = {'en': ENGLISH, 'sw': SWAHILI}


def corpus_for(language):
    """The Bible for `language`, or the KJV when that one has not been
    imported — a Swahili speaker gets an English quiz rather than none."""
    corpus = CORPORA.get(language) or ENGLISH
    if corpus is not ENGLISH and not corpus.verses().exists():
        return ENGLISH
    return corpus


def _seed_for(date):
    """A stable seed per day — same date, same quiz, on any machine."""
    return int(hashlib.sha256(date.isoformat().encode()).hexdigest()[:12], 16)


def display_order(user_id, question_id, kind, count):
    """The order one person sees a question's choices in: [original index
    shown first, second, …]. Seeded by person and question, so it is the
    same on every fetch and for the review — but not the same as a friend's,
    so "the answer to 4 is B" is no help to anyone."""
    order = list(range(count))
    if kind not in FIXED_ORDER_KINDS:
        random.Random(f'{user_id}:{question_id}').shuffle(order)
    return order


def _shuffled_choices(rng, correct, distractors, count=4):
    """Return (choices, answer_index) with the answer placed at random.

    Returns None when there are not enough distinct wrong answers — the caller
    skips rather than shipping a question with a giveaway short list. Two
    wrong answers that differ only in case ("Lord", "LORD") count as one.
    """
    pool, seen = [], {str(correct).lower()}
    for d in distractors:
        if str(d).lower() not in seen:
            seen.add(str(d).lower())
            pool.append(d)
    if len(pool) < count - 1:
        return None
    options = [correct] + rng.sample(pool, count - 1)
    rng.shuffle(options)
    return options, options.index(correct)


# ── what a verse is like ─────────────────────────────────────────────────────

def _worth_asking(text, corpus):
    """Long enough to carry a question, short enough to read, and not a list
    of names (a genealogy, a roll of the tribes) — those are fair questions
    nobody enjoys."""
    words = text.split()
    if not MIN_WORDS <= len(words) <= MAX_WORDS:
        return False
    names = sum(1 for w in words[1:]
                if w[:1].isupper() and corpus.clean_word(w).lower() not in ALWAYS_CAPITAL)
    if names / len(words) > 0.3:
        return False
    if corpus.language == 'en' and text.lower().count('begat') >= 2:
        return False
    return True


def _case(word):
    if len(word) > 1 and word.isupper():
        return 'upper'
    return 'title' if word[:1].isupper() else 'lower'


def _ending(word, corpus):
    w = word.lower()
    for s in corpus.suffixes:
        if w.endswith(s) and len(w) > len(s) + 2 and not (s == 's' and w.endswith('ss')):
            return s
    return ''


def _lookalikes(word, pool, corpus):
    """Wrong answers that could sit in the gap: the same case always (a
    capital gives a name away), then the same ending and a similar length as
    far as the book allows. [] when not even three share its case."""
    same_case = [w for w in pool if _case(w) == _case(word)]
    ending, n = _ending(word, corpus), len(word)
    tiers = (
        [w for w in same_case if _ending(w, corpus) == ending and abs(len(w) - n) <= 3],
        [w for w in same_case if _ending(w, corpus) == ending],
        [w for w in same_case if abs(len(w) - n) <= 3],
        same_case,
    )
    for tier in tiers:
        if len(tier) >= 3:
            return tier
    return []


def _gap_word(rng, words, corpus):
    """(index, word) to take out of a verse, or None. Never the first word
    (its capital is the sentence's, not the word's), never a small word, and
    never one that appears twice — the other would give it away."""
    clean, stop = corpus.clean_word, corpus.stopwords
    counts = {}
    for w in words:
        key = clean(w).lower()
        counts[key] = counts.get(key, 0) + 1
    candidates = [
        (i, clean(w)) for i, w in enumerate(words)
        if i > 0 and len(clean(w)) > 3 and clean(w).lower() not in stop
        and counts[clean(w).lower()] == 1
    ]
    return rng.choice(candidates) if candidates else None


def _excerpt(text, words=12):
    parts = text.split()
    return ' '.join(parts[:words]) + ('…' if len(parts) > words else '')


# ── question builders ────────────────────────────────────────────────────────
# Each returns a dict or None (None = this verse doesn't suit; try another).

def _q_book(rng, verse, difficulty, corpus=ENGLISH):
    """Which book is this verse from?

    Simple: two wrong answers from the other testament and one from the same,
    so the flavour of the text helps without settling it. Moderate: from the
    same part of scripture where it has enough books (a Gospel among the
    Gospels), else the same testament.
    """
    old = verse.book_number <= 39
    names = corpus.book_names()
    other_testament = [name for number, name in names if (number <= 39) != old]
    same_testament = [name for number, name in names if (number <= 39) == old and name != verse.book]
    if difficulty == QuizQuestion.SIMPLE:
        rng.shuffle(other_testament)
        rng.shuffle(same_testament)
        pool = other_testament[:2] + same_testament[:1]
    else:
        section = category_for(verse.book_number)
        pool = [name for number, name in names
                if category_for(number) == section and name != verse.book]
        if len(pool) < 3:
            pool = same_testament
        rng.shuffle(pool)
    built = _shuffled_choices(rng, verse.book, pool)
    if not built:
        return None
    choices, answer = built
    return {
        'kind': 'book',
        'prompt': corpus.prompt('book'),
        'passage': verse.text,
        'choices': choices,
        'answer_index': answer,
        'reference': verse.reference,
    }


def _q_blank(rng, verse, difficulty, corpus=ENGLISH):
    """A word removed from the verse; the wrong answers are real words from the
    same book that look like it, so only knowing the verse tells them apart."""
    words = verse.text.split()
    gap = _gap_word(rng, words, corpus)
    if not gap:
        return None
    idx, answer = gap
    in_verse = {corpus.clean_word(w).lower() for w in words}
    pool = [w for w in _book_words(corpus, verse.book_number) if w.lower() not in in_verse]
    pool = _lookalikes(answer, pool, corpus)
    rng.shuffle(pool)
    built = _shuffled_choices(rng, answer, pool)
    if not built:
        return None
    choices, answer_index = built

    blanked = list(words)
    # The punctuation around the word stays: "water," → "______,".
    blanked[idx] = words[idx].replace(answer, '______', 1)
    return {
        'kind': 'blank',
        'prompt': corpus.prompt('blank'),
        'passage': ' '.join(blanked),
        'choices': choices,
        'answer_index': answer_index,
        'reference': verse.reference,
    }


def _q_exact(rng, verse, difficulty, corpus=ENGLISH):
    """Is this the verse word for word — or has one word been swapped for one
    that fits? Half the time it is untouched: reading closely is the skill."""
    words = verse.text.split()
    gap = _gap_word(rng, words, corpus)
    if not gap:
        return None
    idx, real = gap
    in_verse = {corpus.clean_word(w).lower() for w in words}
    pool = _lookalikes(real, [w for w in _book_words(corpus, verse.book_number)
                              if w.lower() not in in_verse], corpus)
    if not pool:
        return None
    changed = rng.random() < 0.5
    explanation = f'{verse.text} — {verse.reference}'
    shown = verse.text
    if changed:
        put = rng.choice(pool)
        altered = list(words)
        altered[idx] = words[idx].replace(real, put, 1)
        shown = ' '.join(altered)
        explanation = f"{corpus.prompt('exact_changed', put=put, real=real)} {explanation}"
    return {
        'kind': 'exact',
        'prompt': corpus.prompt('exact'),
        'passage': shown,
        'choices': [corpus.prompt('exact_yes'), corpus.prompt('exact_no')],
        'answer_index': 1 if changed else 0,
        'reference': verse.reference,
        'explanation': explanation,
    }


# Above this many chapters, "which chapter" is a lottery: ask which ten.
CHAPTER_QUESTION_MAX = 30
SECTION_SPAN = 10


def _q_reference(rng, verse, difficulty, corpus=ENGLISH):
    """Which chapter of the (named) book is this from?

    Hard on purpose: knowing the passage is not enough, you have to place it.
    Only in books short enough for that to be knowledge, not luck.
    """
    chapters = corpus.chapters(verse.book_number)
    if not 4 <= chapters <= CHAPTER_QUESTION_MAX:
        return None
    others = [c for c in range(1, chapters + 1) if c != verse.chapter]
    # Prefer nearby chapters — a distant wrong answer is easy to dismiss.
    others.sort(key=lambda c: abs(c - verse.chapter))
    near = others[:8]
    rng.shuffle(near)
    built = _shuffled_choices(rng, str(verse.chapter), [str(c) for c in near])
    if not built:
        return None
    choices, answer_index = built
    return {
        'kind': 'reference',
        'prompt': corpus.prompt('reference', book=verse.book),
        'passage': verse.text,
        'choices': choices,
        'answer_index': answer_index,
        'reference': verse.reference,
    }


def _q_section(rng, verse, difficulty, corpus=ENGLISH):
    """In a long book (Psalms, Isaiah, Genesis): which ten chapters? Placing a
    psalm among its neighbours is knowledge; naming its number is a guess."""
    chapters = corpus.chapters(verse.book_number)
    if chapters <= CHAPTER_QUESTION_MAX:
        return None
    spans = [(a, min(a + SECTION_SPAN - 1, chapters)) for a in range(1, chapters + 1, SECTION_SPAN)]
    label = lambda s: f'{s[0]}–{s[1]}'  # noqa: E731
    mine = next(s for s in spans if s[0] <= verse.chapter <= s[1])
    near = sorted((s for s in spans if s != mine), key=lambda s: abs(s[0] - mine[0]))[:5]
    rng.shuffle(near)
    built = _shuffled_choices(rng, label(mine), [label(s) for s in near])
    if not built:
        return None
    choices, answer_index = built
    return {
        'kind': 'section',
        'prompt': corpus.prompt('section', book=verse.book),
        'passage': verse.text,
        'choices': choices,
        'answer_index': answer_index,
        'reference': verse.reference,
    }


def _q_order(rng, verse, difficulty, corpus=ENGLISH):
    """Two passages of one book: which comes first? Close enough to be the
    same stretch of the story (2 to 12 chapters apart), far enough that
    knowing the story — not the verse numbers — decides it."""
    index = _book_index(corpus, verse.book_number)
    near = [vid for vid, ch in index if 2 <= abs(ch - verse.chapter) <= 12]
    if not near:
        near = [vid for vid, ch in index if ch != verse.chapter]
    if not near:
        return None
    rng.shuffle(near)
    found = corpus.verses().in_bulk(near[:6])
    other = next((found[v] for v in near[:6]
                  if v in found and _worth_asking(found[v].text, corpus)), None)
    if not other:
        return None
    first, second = sorted((verse, other), key=lambda v: (v.chapter, v.verse))
    a, b = _excerpt(first.text), _excerpt(second.text)
    if a == b:
        return None
    choices = [a, b]
    rng.shuffle(choices)
    return {
        'kind': 'order',
        'prompt': corpus.prompt('order', book=verse.book),
        'passage': '',
        'choices': choices,
        'answer_index': choices.index(a),
        'reference': first.reference,
        'explanation': (f"{corpus.prompt('order_explained', first=first.reference, second=second.reference)} "
                        f'{first.reference}: {first.text}'),
    }


def _split_for_finish(text):
    """(start, end) of a verse cut near the middle — at a comma or semicolon
    when there is one there, so the start reads as a phrase. None if too short."""
    words = text.split()
    if len(words) < MIN_WORDS:
        return None
    lo, hi = max(4, int(len(words) * 0.35)), min(len(words) - 3, int(len(words) * 0.65))
    cut = next((i + 1 for i in range(lo - 1, hi) if words[i][-1:] in ',;:'), len(words) // 2)
    cut = min(max(cut, 4), len(words) - 3)
    return ' '.join(words[:cut]), ' '.join(words[cut:])


def _q_finish(rng, verse, others, corpus=ENGLISH):
    """How does this well-known verse end? The wrong endings are the ends of
    other well-known verses of about the same length."""
    split = _split_for_finish(verse.text)
    if not split:
        return None
    start, end = split
    endings = []
    for o in others:
        s = _split_for_finish(o.text) if o.pk != verse.pk else None
        if s:
            endings.append(s[1])
    endings.sort(key=lambda e: abs(len(e.split()) - len(end.split())))
    near = endings[:8]
    rng.shuffle(near)
    built = _shuffled_choices(rng, end, near)
    if not built:
        return None
    choices, answer_index = built
    return {
        'kind': 'finish',
        'prompt': corpus.prompt('finish'),
        'passage': f'{start} …',
        'choices': choices,
        'answer_index': answer_index,
        'reference': verse.reference,
    }


BUILDERS = {
    QuizQuestion.SIMPLE: [_q_book],
    QuizQuestion.MODERATE: [_q_blank, _q_book, _q_exact],
    QuizQuestion.HARD: [_q_reference, _q_section, _q_order, _q_blank],
}
# How often each is tried first for its difficulty — the blank is the best
# question a verse can make, so it leads; the others keep a day varied.
BUILDER_WEIGHTS = {
    _q_book: 1, _q_blank: 3, _q_exact: 1, _q_reference: 2, _q_section: 2, _q_order: 2,
}


def _builders_for(rng, difficulty):
    """The difficulty's builders, in an order drawn by weight: whichever
    comes first and suits the verse makes the question."""
    pool = list(BUILDERS[difficulty])
    out = []
    while pool:
        pick = rng.choices(pool, weights=[BUILDER_WEIGHTS[b] for b in pool])[0]
        out.append(pick)
        pool.remove(pick)
    return out


# ── kept between runs ─────────────────────────────────────────────────────────
# A Bible does not change between one quiz and the next, so what is costly to
# read from it — which verses are long enough to ask about, the words of each
# book to draw wrong answers from — is read once per process and kept. Every
# build checks the corpus's size first (one cheap query) and starts afresh if
# an import has changed it.
_KEPT = {}


def _refresh(corpus):
    from django.db.models import Count, Max
    found = corpus.verses().aggregate(n=Count('id'), top=Max('id'))
    signature = (found['n'], found['top'])
    kept = _KEPT.get(corpus.language)
    if not kept or kept['signature'] != signature:
        _KEPT[corpus.language] = {'signature': signature, 'words': {}, 'index': {}}
    return _KEPT[corpus.language]


def _kept(corpus):
    return _KEPT[corpus.language] if corpus.language in _KEPT else _refresh(corpus)


def forget_kept_corpora():
    """Drop what is kept — for tests, which build different Bibles."""
    _KEPT.clear()


def _famous_filter():
    q = Q(pk__in=[])
    for book, chapter, verse in MEMORY_VERSES:
        q |= Q(book_number=book, chapter=chapter, verse=verse)
    return q


def _pick_verses(rng, count, corpus=ENGLISH, books=None, pool=None):
    """Verses long enough to be worth asking about, in a shuffled order —
    across the corpus, the books (first, last) of one section, or a `pool`:
    {'books': (a, b), 'chapters': (s, e)} or {'famous': True}."""
    pool = dict(pool or {})
    if books:
        pool['books'] = books
    kept = _refresh(corpus)
    slot = 'ids:' + repr(sorted(pool.items()))
    if kept.get(slot) is None:
        verses = corpus.verses()
        if pool.get('famous'):
            verses = verses.filter(_famous_filter())
        if pool.get('books'):
            verses = verses.filter(book_number__range=pool['books'])
        if pool.get('chapters'):
            verses = verses.filter(chapter__range=pool['chapters'])
        verses = verses.order_by('id')           # the same order on any database
        ids = list(verses.filter(text__regex=r'(\S+\s+){%d,}' % MIN_WORDS).values_list('id', flat=True))
        if len(ids) < count:
            ids = list(verses.values_list('id', flat=True))
        kept[slot] = ids
    ids = list(kept[slot])
    rng.shuffle(ids)
    return ids


def _book_words(corpus, book_number):
    """The substantial words of a whole book, in the order they first appear —
    read once per book, then kept."""
    kept = _kept(corpus)
    words = kept['words'].get(book_number)
    if words is None:
        clean, stop = corpus.clean_word, corpus.stopwords
        seen = {}
        texts = (corpus.verses().filter(book_number=book_number)
                 .order_by('chapter', 'verse').values_list('text', flat=True))
        for text in texts:
            for w in text.split()[1:]:            # a first word's capital is the sentence's
                cw = clean(w)
                if len(cw) > 3 and cw.lower() not in stop:
                    seen.setdefault(cw, None)
        words = list(seen)
        kept['words'][book_number] = words
    return words


def _book_index(corpus, book_number):
    """[(id, chapter)] of a book's verses that can carry a question — for
    finding a second passage to set beside the first."""
    kept = _kept(corpus)
    index = kept['index'].get(book_number)
    if index is None:
        index = list(corpus.verses().filter(book_number=book_number)
                     .filter(text__regex=r'(\S+\s+){%d,}' % MIN_WORDS)
                     .order_by('chapter', 'verse').values_list('id', 'chapter'))
        kept['index'][book_number] = index
    return index


# ── the question bank ─────────────────────────────────────────────────────────
# About a quarter of each difficulty comes from the written bank (BankQuestion)
# when it has enough: the rest are generated from verses as before.
BANK_SHARE = 0.25
# A written question's record decides where it belongs: after this many
# answers, its accuracy says whether the difficulty it was written at is right.
RETIRE_AFTER = 40
# Too easy for where it is: down a level. Already simple and still nearly
# everyone gets it: it teaches nothing, retire it.
EASIER_AT = 0.85
TOO_EASY_AT = 0.97
# Too hard for where it is: up a level. Nearly nobody right: usually the
# wrong answer is marked — retire it for a person to check.
HARDER_AT = 0.35
TOO_HARD_AT = 0.10
LEVELS = [QuizQuestion.SIMPLE, QuizQuestion.MODERATE, QuizQuestion.HARD]


def _from_bank(rng, difficulty, count, language='en', bank=None):
    """Up to `count` written questions of `difficulty`, the least-asked first
    (ties broken by `rng`), as question dicts with their choices shuffled.
    `bank`: the language's active questions, when already read."""
    from .models import BankQuestion
    if count <= 0:
        return []
    if bank is None:
        bank = BankQuestion.objects.filter(is_active=True, language=language)
    pool = [b for b in bank if b.difficulty == difficulty]
    rng.shuffle(pool)
    pool.sort(key=lambda b: b.times_asked)          # stable: the shuffle breaks ties
    out = []
    for b in pool[:count]:
        order = list(range(len(b.choices)))
        if b.kind not in FIXED_ORDER_KINDS:         # "True, False" keeps its order
            rng.shuffle(order)
        out.append({
            'kind': b.kind,
            'prompt': b.prompt,
            'passage': '',
            'choices': [b.choices[i] for i in order],
            'answer_index': order.index(b.answer_index),
            'reference': b.reference,
            'explanation': b.explanation,
            'difficulty': difficulty,
            'category': b.category,
            'base_points': base_points_for(difficulty),
            'bank_question_id': b.pk,
        })
    return out


def _judge(b):
    """What a written question's record says to do with it: ('retire', reason),
    ('move', difficulty) or None to leave it."""
    from .models import BankQuestion
    accuracy = b.times_correct / b.times_asked
    level = LEVELS.index(b.difficulty) if b.difficulty in LEVELS else 1
    if accuracy <= TOO_HARD_AT:
        return 'retire', BankQuestion.TOO_HARD
    if accuracy >= EASIER_AT:
        if level == 0:
            return ('retire', BankQuestion.TOO_EASY) if accuracy >= TOO_EASY_AT else None
        return 'move', LEVELS[level - 1]
    if accuracy <= HARDER_AT and level < len(LEVELS) - 1:
        return 'move', LEVELS[level + 1]
    return None


def record_bank_answers(results):
    """Count answers to written questions and act on what they say: a question
    in the wrong difficulty moves (its count starting over there), one that
    tells nobody anything retires. `results`: iterable of (bank_question_id,
    is_correct)."""
    from collections import Counter
    from django.db.models import F
    from .models import BankQuestion

    asked, right = Counter(), Counter()
    for bank_id, correct in results:
        if bank_id:
            asked[bank_id] += 1
            right[bank_id] += 1 if correct else 0
    for bank_id, n in asked.items():
        BankQuestion.objects.filter(pk=bank_id).update(
            times_asked=F('times_asked') + n, times_correct=F('times_correct') + right[bank_id],
        )
    if not asked:
        return
    for b in BankQuestion.objects.filter(pk__in=list(asked), is_active=True, times_asked__gte=RETIRE_AFTER):
        verdict = _judge(b)
        if not verdict:
            continue
        action, value = verdict
        if action == 'retire':
            BankQuestion.objects.filter(pk=b.pk).update(is_active=False, retired_reason=value)
        else:
            BankQuestion.objects.filter(pk=b.pk).update(
                difficulty=value, calibrated_from=b.calibrated_from or b.difficulty,
                times_asked=0, times_correct=0,
            )


def _build_part(rng, mix, corpus, pool, used):
    """Generated questions for `mix` from the verses of `pool`, none on a
    verse in `used` (which it adds to). Raises ValueError when the pool
    cannot supply them."""
    wanted_total = sum(count for _, count in mix)
    if not wanted_total:
        return []
    verse_ids = [v for v in _pick_verses(rng, wanted_total, corpus, pool=pool) if v not in used]
    if len(verse_ids) < wanted_total:
        raise ValueError(
            'The Bible corpus holds %d usable verses — %s.' % (len(verse_ids), corpus.import_hint)
        )
    famous = bool(pool and pool.get('famous'))
    # Kept to some chapters (a story): "which comes first" looks for its
    # second passage across the whole book, so it would stray outside them.
    within = bool(pool and pool.get('chapters'))

    # Read the verses a batch at a time (most are used, a few are skipped).
    loaded = {}

    def verse_at(i):
        if verse_ids[i] not in loaded:
            loaded.update(corpus.verses().in_bulk(verse_ids[i:i + 60]))
        return loaded.get(verse_ids[i])

    built, cursor = [], 0
    for difficulty, wanted in mix:
        made = 0
        while made < wanted and cursor < len(verse_ids):
            verse = verse_at(cursor)
            cursor += 1
            if not verse:
                continue
            # A memory verse is asked about because it is known, not because
            # it is the right length.
            if not (len(verse.text.split()) >= MIN_WORDS if famous else _worth_asking(verse.text, corpus)):
                continue
            for builder in _builders_for(rng, difficulty):
                if within and builder is _q_order:
                    continue
                q = builder(rng, verse, difficulty, corpus)
                if q:
                    q['difficulty'] = difficulty
                    q['category'] = category_for(verse.book_number)
                    q['base_points'] = base_points_for(difficulty)
                    # Shown after answering. The restored verse is the teaching
                    # here — no invented commentary.
                    q.setdefault('explanation', f'{verse.text} — {verse.reference}')
                    built.append(q)
                    used.add(verse.pk)
                    made += 1
                    break
        if made < wanted:
            raise ValueError(
                'Could not build %d %s questions (got %d) — the corpus is too small.'
                % (wanted, difficulty, made)
            )
    return built


def _build_finish(rng, count, corpus, used):
    """`count` "how does it end" questions from the memory verses — [] when
    this Bible holds too few of them to make wrong endings from."""
    if count <= 0:
        return []
    verses = list(corpus.verses().filter(_famous_filter()).order_by('id'))
    if len(verses) < 4:
        return []
    order = list(verses)
    rng.shuffle(order)
    out = []
    for verse in order:
        if len(out) >= count:
            break
        if verse.pk in used:
            continue
        q = _q_finish(rng, verse, verses, corpus)
        if q:
            q.update(difficulty=QuizQuestion.SIMPLE, category=category_for(verse.book_number),
                     base_points=base_points_for(QuizQuestion.SIMPLE),
                     explanation=f'{verse.text} — {verse.reference}')
            out.append(q)
            used.add(verse.pk)
    return out


def build_questions(rng, mix, corpus=ENGLISH, category=None, theme=None, story=None, famous=0,
                    bank=True):
    """Build question dicts for `mix` — [(difficulty, count), ...].

    Shared by the daily quiz and every practice mode: what a question *is*
    doesn't change between modes, only how many of each and what they pay.

    `category`: every question from one part of scripture (Section practice).
    `story`: every question from a StoryPack's chapters (Story mode).
    `theme`: a DAY_THEMES key — THEME_PER_DIFFICULTY of each difficulty from
    it. `famous`: how many of the simple questions are "how does it end".
    `bank`: False to leave the written questions out (a pack played offline,
    whose answers travel with it, must not carry the daily quiz's).

    A share of each difficulty comes from the written bank; the rest are
    generated from verses. Raises ValueError when the corpus cannot supply them.
    """
    # The written ones first, so the verses are only asked to make up the rest.
    from .models import BankQuestion
    order = [d for d, _ in mix]
    if story or not bank:
        banked = {d: [] for d in order}     # a written question knows no chapter
    else:
        bank = BankQuestion.objects.filter(is_active=True, language=corpus.language)
        if category:
            bank = bank.filter(category=category)
        bank = list(bank)
        banked = {d: _from_bank(rng, d, round(n * BANK_SHARE), corpus.language, bank) for d, n in mix}
    left = {d: n - len(banked[d]) for d, n in mix}

    used, built = set(), []
    if story:
        pool = {'books': (story.book_number, story.book_number),
                'chapters': (story.chapter_start, story.chapter_end)}
        built += _build_part(rng, [(d, left[d]) for d in order], corpus, pool, used)
    elif category:
        built += _build_part(rng, [(d, left[d]) for d in order], corpus,
                             {'books': books_in(category)}, used)
    else:
        if theme in THEME_POOLS:
            themed = [(d, min(THEME_PER_DIFFICULTY, left[d])) for d in order]
            built += _build_part(rng, themed, corpus, THEME_POOLS[theme], used)
            for d, n in themed:
                left[d] -= n
        if famous and QuizQuestion.SIMPLE in left:
            finish = _build_finish(rng, min(famous, left[QuizQuestion.SIMPLE]), corpus, used)
            built += finish
            left[QuizQuestion.SIMPLE] -= len(finish)
        built += _build_part(rng, [(d, left[d]) for d in order], corpus, None, used)

    # Each difficulty's written questions mixed in among its generated ones.
    out = []
    for difficulty in order:
        block = [q for q in built if q['difficulty'] == difficulty] + banked[difficulty]
        rng.shuffle(block)
        out.extend(block)
    return out


def generate_for_date(date, force=False, language='en'):
    """Build (or rebuild) the quiz for `date` in `language`. Returns the
    DailyQuiz — the English one when that language's Bible is not imported.

    Raises ValueError when the corpus is too thin to build a full quiz — better
    than silently serving a five-question day.
    """
    corpus = corpus_for(language)
    existing = DailyQuiz.objects.filter(date=date, language=corpus.language).first()
    if existing and not force:
        return existing

    # Each language its own seed, so the two quizzes are not the same verses.
    seed = _seed_for(date) + (0 if corpus is ENGLISH else 7919)
    theme = theme_for(date)
    try:
        built = build_questions(random.Random(seed), MIX, corpus, theme=theme, famous=DAILY_FAMOUS)
    except ValueError:
        # A Bible without that part (a partial import): the day goes unthemed
        # rather than not at all.
        theme = ''
        built = build_questions(random.Random(seed), MIX, corpus, famous=DAILY_FAMOUS)

    try:
        with transaction.atomic():
            if existing:
                existing.questions.all().delete()
                existing.theme = theme
                existing.save(update_fields=['theme'])
                quiz = existing
            else:
                quiz = DailyQuiz.objects.create(date=date, language=corpus.language, theme=theme)
            QuizQuestion.objects.bulk_create([
                QuizQuestion(quiz=quiz, order=i, **q) for i, q in enumerate(built)
            ])
    except IntegrityError:
        # The first players of the day arrived together and another request
        # built it a moment ago: theirs is the quiz.
        return DailyQuiz.objects.get(date=date, language=corpus.language)
    from django.core.cache import cache
    cache.delete(questions_cache_key(quiz.pk))
    return quiz


def questions_cache_key(quiz_id):
    return f'quiz-questions:{quiz_id}'


def start_session(user, mode, language='en', category=None, story=None):
    """Open a practice run and generate the questions it will ask.

    Unseeded on purpose: the daily quiz must be the same for everyone, a
    practice run must be different every time you play it.
    """
    from .models import QuizSession
    from .modes import config

    cfg = config(mode)
    corpus = corpus_for(language)
    built = build_questions(random.Random(), cfg['mix'], corpus, category, story=story,
                            famous=cfg.get('famous', 0))

    with transaction.atomic():
        session = QuizSession.objects.create(
            user=user, mode=mode, language=corpus.language,
            topic=(story.slug if story else category or ''),
        )
        QuizQuestion.objects.bulk_create([
            QuizQuestion(session=session, order=i, **q) for i, q in enumerate(built)
        ])
    return session

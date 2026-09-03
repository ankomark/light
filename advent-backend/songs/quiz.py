"""Build a day's Bible quiz from the local corpus.

Twenty questions a day, split across three difficulties. Difficulty here is not
a label on the same question — it changes how the question is built, because
what makes a Bible question hard is how close the wrong answers sit to the right
one:

    simple    which book is this from, with distractors from the other testament
    moderate  a missing word, or the book with distractors from the same testament
    hard      the exact chapter, or which of two verses comes first — distractors
              drawn from the same book, so recognising the passage is not enough

The generator is deterministic: the RNG is seeded from the date, so regenerating
a day rebuilds the same quiz rather than quietly handing a later player a
different set. It never invents text — every prompt is a real verse, and the
answer is the verse's own reference.
"""
import hashlib
import random
import re

from django.db import transaction

from .bible_books import BIBLE_BOOKS, BOOKS_BY_NAME
from .models import BibleVerse, DailyQuiz, QuizQuestion
from .scoring import base_points_for

# 20 a day: enough to be a sitting, not so many it becomes a chore.
QUESTIONS_PER_DAY = 20
MIX = [
    (QuizQuestion.SIMPLE, 7),
    (QuizQuestion.MODERATE, 7),
    (QuizQuestion.HARD, 6),
]

# Verses too short to carry a question (or to blank a word out of).
MIN_WORDS = 8
# Words never blanked — removing "the" tests nothing.
STOPWORDS = {
    'the', 'and', 'of', 'to', 'in', 'that', 'he', 'shall', 'unto', 'for', 'i',
    'his', 'a', 'they', 'be', 'is', 'him', 'them', 'not', 'it', 'with', 'all',
    'thou', 'thy', 'was', 'which', 'my', 'me', 'but', 'ye', 'their', 'have',
    'we', 'this', 'as', 'are', 'when', 'so', 'said', 'from', 'were', 'you',
    'her', 'she', 'had', 'will', 'on', 'up', 'by', 'at', 'out', 'into', 'then',
}


# Canonical book number -> the part of scripture it belongs to. Derived rather
# than curated: the grouping is a property of the canon, not an editorial choice.
CATEGORY_RANGES = (
    (5, 'law'), (17, 'history'), (22, 'wisdom'), (27, 'major_prophets'),
    (39, 'minor_prophets'), (43, 'gospels'), (44, 'acts'), (65, 'epistles'),
    (66, 'revelation'),
)


def category_for(book_number):
    for upper, name in CATEGORY_RANGES:
        if book_number <= upper:
            return name
    return ''


def _seed_for(date):
    """A stable seed per day — same date, same quiz, on any machine."""
    return int(hashlib.sha256(date.isoformat().encode()).hexdigest()[:12], 16)


def _clean_word(word):
    return re.sub(r"[^A-Za-z'-]", '', word)


def _shuffled_choices(rng, correct, distractors, count=4):
    """Return (choices, answer_index) with the answer placed at random.

    Returns None when there are not enough distinct wrong answers — the caller
    skips rather than shipping a question with a giveaway short list.
    """
    pool = []
    for d in distractors:
        if d != correct and d not in pool:
            pool.append(d)
    if len(pool) < count - 1:
        return None
    options = [correct] + rng.sample(pool, count - 1)
    rng.shuffle(options)
    return options, options.index(correct)


# ── question builders ────────────────────────────────────────────────────────
# Each returns a dict or None (None = this verse doesn't suit; try another).

def _q_book(rng, verse, difficulty):
    """Which book is this verse from?

    Simple draws wrong answers from the other testament (a reader who knows the
    flavour of the text can rule them out); moderate keeps them in the same
    testament, where that shortcut stops working.
    """
    same_testament = verse.book_number <= 39
    if difficulty == QuizQuestion.SIMPLE:
        pool = [b['name'] for b in BIBLE_BOOKS if (b['number'] <= 39) != same_testament]
    else:
        pool = [b['name'] for b in BIBLE_BOOKS
                if (b['number'] <= 39) == same_testament and b['name'] != verse.book]
    rng.shuffle(pool)
    built = _shuffled_choices(rng, verse.book, pool)
    if not built:
        return None
    choices, answer = built
    return {
        'kind': 'book',
        'prompt': 'Which book is this verse from?',
        'passage': verse.text,
        'choices': choices,
        'answer_index': answer,
        'reference': verse.reference,
    }


def _q_blank(rng, verse, difficulty):
    """A word removed from the verse; the wrong answers are real words from the
    same book, so they read plausibly rather than obviously wrong."""
    words = verse.text.split()
    candidates = [
        (i, w) for i, w in enumerate(words)
        if len(_clean_word(w)) > 3 and _clean_word(w).lower() not in STOPWORDS
    ]
    if not candidates:
        return None
    idx, raw = rng.choice(candidates)
    answer = _clean_word(raw)

    # Distractors: other substantial words from the same book.
    neighbours = (BibleVerse.objects
                  .filter(book=verse.book).exclude(pk=verse.pk)
                  .values_list('text', flat=True)[:400])
    pool = []
    for text in neighbours:
        for w in text.split():
            cw = _clean_word(w)
            if (len(cw) > 3 and cw.lower() not in STOPWORDS
                    and cw.lower() != answer.lower() and cw not in pool):
                pool.append(cw)
    rng.shuffle(pool)
    built = _shuffled_choices(rng, answer, pool)
    if not built:
        return None
    choices, answer_index = built

    blanked = list(words)
    blanked[idx] = '______'
    return {
        'kind': 'blank',
        'prompt': 'Which word completes this verse?',
        'passage': ' '.join(blanked),
        'choices': choices,
        'answer_index': answer_index,
        'reference': verse.reference,
    }


def _q_reference(rng, verse, difficulty):
    """Which chapter of the (named) book is this from?

    Hard on purpose: knowing the passage is not enough, you have to place it.
    """
    book = BOOKS_BY_NAME.get(verse.book)
    if not book or book['chapters'] < 4:
        return None
    others = [c for c in range(1, book['chapters'] + 1) if c != verse.chapter]
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
        'prompt': f'Which chapter of {verse.book} is this verse from?',
        'passage': verse.text,
        'choices': choices,
        'answer_index': answer_index,
        'reference': verse.reference,
    }


BUILDERS = {
    QuizQuestion.SIMPLE: [_q_book],
    QuizQuestion.MODERATE: [_q_blank, _q_book],
    QuizQuestion.HARD: [_q_reference, _q_blank],
}


def _pick_verses(rng, count):
    """Verses long enough to be worth asking about, spread across the corpus."""
    ids = list(
        BibleVerse.objects.filter(text__regex=r'(\S+\s+){%d,}' % MIN_WORDS)
        .values_list('id', flat=True)
    )
    if len(ids) < count:
        ids = list(BibleVerse.objects.values_list('id', flat=True))
    rng.shuffle(ids)
    return ids


def build_questions(rng, mix):
    """Build question dicts for `mix` — [(difficulty, count), ...].

    Shared by the daily quiz and every practice mode: what a question *is*
    doesn't change between modes, only how many of each and what they pay.
    Raises ValueError when the corpus cannot supply them.
    """
    wanted_total = sum(count for _, count in mix)
    verse_ids = _pick_verses(rng, wanted_total)
    if len(verse_ids) < wanted_total:
        raise ValueError(
            'The Bible corpus holds %d usable verses — run "manage.py import_bible" first.'
            % len(verse_ids)
        )

    built, cursor = [], 0
    for difficulty, wanted in mix:
        made = 0
        while made < wanted and cursor < len(verse_ids):
            verse = BibleVerse.objects.filter(pk=verse_ids[cursor]).first()
            cursor += 1
            if not verse or len(verse.text.split()) < MIN_WORDS:
                continue
            for builder in BUILDERS[difficulty]:
                q = builder(rng, verse, difficulty)
                if q:
                    q['difficulty'] = difficulty
                    q['category'] = category_for(verse.book_number)
                    q['base_points'] = base_points_for(difficulty)
                    # Shown after answering. The restored verse is the teaching
                    # here — no invented commentary.
                    q['explanation'] = f'{verse.text} — {verse.reference}'
                    built.append(q)
                    made += 1
                    break
        if made < wanted:
            raise ValueError(
                'Could not build %d %s questions (got %d) — the corpus is too small.'
                % (wanted, difficulty, made)
            )
    return built


def generate_for_date(date, force=False):
    """Build (or rebuild) the quiz for `date`. Returns the DailyQuiz.

    Raises ValueError when the corpus is too thin to build a full quiz — better
    than silently serving a five-question day.
    """
    existing = DailyQuiz.objects.filter(date=date).first()
    if existing and not force:
        return existing

    built = build_questions(random.Random(_seed_for(date)), MIX)

    with transaction.atomic():
        if existing:
            existing.questions.all().delete()
            quiz = existing
        else:
            quiz = DailyQuiz.objects.create(date=date)
        QuizQuestion.objects.bulk_create([
            QuizQuestion(quiz=quiz, order=i, **q) for i, q in enumerate(built)
        ])
    return quiz


def start_session(user, mode):
    """Open a practice run and generate the questions it will ask.

    Unseeded on purpose: the daily quiz must be the same for everyone, a
    practice run must be different every time you play it.
    """
    from .models import QuizSession
    from .modes import config

    cfg = config(mode)
    built = build_questions(random.Random(), cfg['mix'])

    with transaction.atomic():
        session = QuizSession.objects.create(user=user, mode=mode)
        QuizQuestion.objects.bulk_create([
            QuizQuestion(session=session, order=i, **q) for i, q in enumerate(built)
        ])
    return session

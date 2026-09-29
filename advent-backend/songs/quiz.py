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

from .bible_books import BIBLE_BOOKS
from .models import BibleText, BibleVerse, DailyQuiz, QuizQuestion
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

    def __init__(self, language, model, where, prompts, stopwords, word_re, import_hint):
        self.language = language
        self.model = model
        self.where = where
        self.prompts = prompts
        self.stopwords = stopwords
        self.word_re = re.compile(word_re)
        self.import_hint = import_hint

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
     'reference': 'Which chapter of {book} is this verse from?'},
    STOPWORDS, r"[^A-Za-z'-]", 'run "manage.py import_bible" first',
)
SWAHILI = Corpus(
    'sw', BibleText, {'version': 'swh_bib'},
    {'book': 'Mstari huu unatoka kitabu gani?',
     'blank': 'Ni neno gani linakamilisha mstari huu?',
     'reference': 'Mstari huu unatoka sura gani ya {book}?'},
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

def _q_book(rng, verse, difficulty, corpus=ENGLISH):
    """Which book is this verse from?

    Simple draws wrong answers from the other testament (a reader who knows the
    flavour of the text can rule them out); moderate keeps them in the same
    testament, where that shortcut stops working.
    """
    same_testament = verse.book_number <= 39
    names = corpus.book_names()
    if difficulty == QuizQuestion.SIMPLE:
        pool = [name for number, name in names if (number <= 39) != same_testament]
    else:
        pool = [name for number, name in names
                if (number <= 39) == same_testament and name != verse.book]
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
    same book, so they read plausibly rather than obviously wrong."""
    words = verse.text.split()
    clean, stop = corpus.clean_word, corpus.stopwords
    candidates = [
        (i, w) for i, w in enumerate(words)
        if len(clean(w)) > 3 and clean(w).lower() not in stop
    ]
    if not candidates:
        return None
    idx, raw = rng.choice(candidates)
    answer = clean(raw)

    # Distractors: other substantial words from the same book.
    neighbours = (corpus.verses()
                  .filter(book_number=verse.book_number).exclude(pk=verse.pk)
                  .values_list('text', flat=True)[:400])
    pool = []
    for text in neighbours:
        for w in text.split():
            cw = clean(w)
            if (len(cw) > 3 and cw.lower() not in stop
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
        'prompt': corpus.prompt('blank'),
        'passage': ' '.join(blanked),
        'choices': choices,
        'answer_index': answer_index,
        'reference': verse.reference,
    }


def _q_reference(rng, verse, difficulty, corpus=ENGLISH):
    """Which chapter of the (named) book is this from?

    Hard on purpose: knowing the passage is not enough, you have to place it.
    """
    chapters = corpus.chapters(verse.book_number)
    if chapters < 4:
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


BUILDERS = {
    QuizQuestion.SIMPLE: [_q_book],
    QuizQuestion.MODERATE: [_q_blank, _q_book],
    QuizQuestion.HARD: [_q_reference, _q_blank],
}


def _pick_verses(rng, count, corpus=ENGLISH):
    """Verses long enough to be worth asking about, spread across the corpus."""
    ids = list(
        corpus.verses().filter(text__regex=r'(\S+\s+){%d,}' % MIN_WORDS)
        .values_list('id', flat=True)
    )
    if len(ids) < count:
        ids = list(corpus.verses().values_list('id', flat=True))
    rng.shuffle(ids)
    return ids


# ── the question bank ─────────────────────────────────────────────────────────
# About a quarter of each difficulty comes from the written bank (BankQuestion)
# when it has enough: the rest are generated from verses as before.
BANK_SHARE = 0.25
# A written question's record decides whether it stays: after this many
# answers, one that nearly everyone gets right teaches nothing, and one that
# nearly everyone gets wrong usually has the wrong answer marked.
RETIRE_AFTER = 40
TOO_EASY_AT = 0.97
TOO_HARD_AT = 0.10


def _from_bank(rng, difficulty, count, language='en'):
    """Up to `count` written questions of `difficulty`, the least-asked first
    (ties broken by `rng`), as question dicts with their choices shuffled."""
    from .models import BankQuestion
    if count <= 0:
        return []
    pool = list(BankQuestion.objects.filter(is_active=True, language=language, difficulty=difficulty))
    rng.shuffle(pool)
    pool.sort(key=lambda b: b.times_asked)          # stable: the shuffle breaks ties
    out = []
    for b in pool[:count]:
        order = list(range(len(b.choices)))
        if b.kind != 'true_false':                  # "True, False" keeps its order
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


def record_bank_answers(results):
    """Count answers to written questions and retire the ones that tell nobody
    anything. `results`: iterable of (bank_question_id, is_correct)."""
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
        accuracy = b.times_correct / b.times_asked
        reason = (BankQuestion.TOO_EASY if accuracy >= TOO_EASY_AT
                  else BankQuestion.TOO_HARD if accuracy <= TOO_HARD_AT else '')
        if reason:
            BankQuestion.objects.filter(pk=b.pk).update(is_active=False, retired_reason=reason)


def build_questions(rng, mix, corpus=ENGLISH):
    """Build question dicts for `mix` — [(difficulty, count), ...].

    Shared by the daily quiz and every practice mode: what a question *is*
    doesn't change between modes, only how many of each and what they pay.
    A share of each difficulty comes from the written bank; the rest are
    generated from verses. Raises ValueError when the corpus cannot supply them.
    """
    # The written ones first, so the verses are only asked to make up the rest.
    banked = {d: _from_bank(rng, d, round(n * BANK_SHARE), corpus.language) for d, n in mix}
    mix = [(d, n - len(banked[d])) for d, n in mix]
    wanted_total = sum(count for _, count in mix)
    verse_ids = _pick_verses(rng, wanted_total, corpus)
    if len(verse_ids) < wanted_total:
        raise ValueError(
            'The Bible corpus holds %d usable verses — %s.' % (len(verse_ids), corpus.import_hint)
        )

    built, cursor = [], 0
    for difficulty, wanted in mix:
        made = 0
        while made < wanted and cursor < len(verse_ids):
            verse = corpus.verses().filter(pk=verse_ids[cursor]).first()
            cursor += 1
            if not verse or len(verse.text.split()) < MIN_WORDS:
                continue
            for builder in BUILDERS[difficulty]:
                q = builder(rng, verse, difficulty, corpus)
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
    # Each difficulty's written questions mixed in among its generated ones.
    out = []
    for difficulty, _ in mix:
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
    built = build_questions(random.Random(seed), MIX, corpus)

    with transaction.atomic():
        if existing:
            existing.questions.all().delete()
            quiz = existing
        else:
            quiz = DailyQuiz.objects.create(date=date, language=corpus.language)
        QuizQuestion.objects.bulk_create([
            QuizQuestion(quiz=quiz, order=i, **q) for i, q in enumerate(built)
        ])
    return quiz


def start_session(user, mode, language='en'):
    """Open a practice run and generate the questions it will ask.

    Unseeded on purpose: the daily quiz must be the same for everyone, a
    practice run must be different every time you play it.
    """
    from .models import QuizSession
    from .modes import config

    cfg = config(mode)
    built = build_questions(random.Random(), cfg['mix'], corpus_for(language))

    with transaction.atomic():
        session = QuizSession.objects.create(user=user, mode=mode)
        QuizQuestion.objects.bulk_create([
            QuizQuestion(session=session, order=i, **q) for i, q in enumerate(built)
        ])
    return session

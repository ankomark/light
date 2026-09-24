"""Search that forgives typos and ranks by relevance.

    "amzing grce"  → Amazing Grace
    "kwaya ya"     → Kwaya ya Vijana (prefix of each word)
    "tenzi"        → songs in Tenzi za Rohoni (album)

Two steps, the same on SQLite (tests) and Postgres:

  1. candidates — the database finds rows containing the query, any of its
     words, or any three-letter piece of a longer word (so a typo still shares
     pieces with the right answer); capped, most popular first;
  2. score — each candidate is scored in Python against the query: exact >
     starts with > contains > each word matched closely (edit similarity),
     weighted per field (a title counts more than an album name), plus a small
     nudge for popularity. Weak matches are dropped.

Fine for this app's size. When the catalogue outgrows it, the candidate step
is what to replace (Postgres trigram indexes, or Meilisearch) — the scoring
and the API stay.
"""
import math
import re
import unicodedata
from difflib import SequenceMatcher
from functools import lru_cache

from django.db.models import Q

MIN_SCORE = 0.55
CANDIDATES = 200
MAX_PIECES = 16

_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)
_SPACES = re.compile(r'\s+')


# Titles and names reuse a small vocabulary, so the same words and texts are
# compared over and over within a search (and across searches): remembering
# the results is most of the speed.
@lru_cache(maxsize=50_000)
def _normalize(text):
    text = unicodedata.normalize('NFKD', text)
    text = ''.join(c for c in text if not unicodedata.combining(c)).lower()
    text = _PUNCT.sub(' ', text.replace('_', ' '))
    return _SPACES.sub(' ', text).strip()


def normalize(text):
    """lower case, accents and punctuation off, single spaces."""
    return _normalize(str(text or ''))


def words(text):
    return [w for w in normalize(text).split(' ') if w]


def pieces(query):
    """Search pieces for the database: the query, its words (2+ letters), and
    the three-letter pieces of words of 4+ letters (typo tolerance)."""
    q = normalize(query)
    out = [q] if q else []
    ws = [w for w in q.split(' ') if len(w) >= 2]
    out += [w for w in ws if w != q]
    grams = []
    for w in ws:
        if len(w) >= 4:
            grams += [w[i:i + 3] for i in range(len(w) - 2)]
    seen, res = set(), []
    for p in out + grams:
        if p not in seen:
            seen.add(p)
            res.append(p)
    return res[:MAX_PIECES]


def candidate_q(fields, query):
    """A Q matching rows where any field contains any search piece."""
    cond = Q()
    for p in pieces(query):
        for f in fields:
            cond |= Q(**{f'{f}__icontains': p})
    return cond


def _similar(a, b, floor=0.5):
    """Edit similarity of two strings, cheaply: the quick upper bounds first,
    the full comparison only when it could still reach `floor`."""
    m = SequenceMatcher(None, a, b, autojunk=False)
    if m.real_quick_ratio() < floor or m.quick_ratio() < floor:
        return m.quick_ratio() * 0.5          # clearly not close; any low value will do
    return m.ratio()


@lru_cache(maxsize=200_000)
def _word_sim(a, b):
    if a == b:
        return 1.0
    if b.startswith(a) and len(a) >= 2:          # typing the start of a word
        return 0.9 + 0.1 * len(a) / len(b)
    return _similar(a, b)


def text_score(query, text):
    """0..1: how well `text` answers `query`."""
    return _text_score(normalize(query), normalize(text))


@lru_cache(maxsize=100_000)
def _text_score(q, t):
    if not q or not t:
        return 0.0
    if t == q:
        return 1.0
    if t.startswith(q):
        return 0.95
    if f' {q}' in f' {t}':                        # a word of the text starts with it
        return 0.9
    if q in t:
        return 0.82
    qw, tw = q.split(' '), t.split(' ')
    per_word = [max(_word_sim(a, b) for b in tw) for a in qw]
    words_score = sum(per_word) / len(per_word)
    # Every word has to be reasonably close, not just most of them.
    if min(per_word) < 0.6:
        words_score *= 0.8
    whole = _similar(q, t, floor=0.6)
    return max(words_score * 0.88, whole * 0.8)


def score(query, weighted_texts, popularity=0):
    """Best weighted match over (text, weight) pairs, plus a popularity nudge
    (at most +0.05, so relevance always wins)."""
    q = query if getattr(query, 'normalized', False) else normalize(query)
    best = max((_text_score(q, normalize(t)) * w for t, w in weighted_texts if t), default=0.0)
    if best <= 0:
        return 0.0
    return best + min(0.05, 0.01 * math.log10(1 + max(0, popularity or 0)))


class _Normalized(str):
    normalized = True


def rank(query, rows, texts_of, popularity_of=lambda r: 0, limit=10, min_score=MIN_SCORE):
    """Score rows and keep the best `limit`: [(score, row)], best first."""
    query = _Normalized(normalize(query))   # once, not per row
    scored = []
    for r in rows:
        s = score(query, texts_of(r), popularity_of(r))
        if s >= min_score:
            scored.append((s, r))
    scored.sort(key=lambda sr: -sr[0])
    return scored[:limit]

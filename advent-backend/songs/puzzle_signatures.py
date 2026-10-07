"""The words a puzzle theme is *about*.

A theme's ordinary vocabulary comes from its verses (songs/puzzle.py), and
that is what keeps every answer honest to the text. But a player who opens
"The Gospels" expects to spell MATTHEW, MARK, LUKE and JOHN, and one who opens
"Books of the Law" expects MOSES and SINAI — words that say the theme's name
back to them. Those are the theme's signature words, and they come from three
places, merged in this order:

  · what an admin wrote on the theme (`source.words`, `source.words_sw`);
  · the names of the books a book-range theme covers, read from the Bible
    being played (so a Swahili board gets MATHAYO, MARKO, LUKA, YOHANA);
  · a short curated list for the themes the app ships with.

Signature words do not have to be in the frequency index: GENESIS never
appears in the KJV's own text, and it is still the first word anyone would
expect of the Law.
"""
import re

from .bible_books import BIBLE_BOOKS, BOOKS_BY_NAME

# Tokens of a book's name that are not words worth spelling.
_NAME_FILLER = {
    'OF', 'THE', 'SONG', 'YA', 'LA', 'WA', 'ULIO', 'BORA', 'MAMBO', 'KITABU',
}

# Curated, for the themes seeded with the app (migration 0107). Keyed by slug;
# English then Swahili.
CURATED = {
    'books-of-the-law': (
        ['MOSES', 'AARON', 'SINAI', 'EGYPT', 'PHARAOH', 'ISRAEL', 'ABRAHAM', 'ISAAC',
         'JACOB', 'JOSEPH', 'MANNA', 'COVENANT', 'ADAM', 'NOAH', 'EDEN', 'LAW', 'ARK'],
        ['MUSA', 'HARUNI', 'SINAI', 'MISRI', 'FARAO', 'ISRAELI', 'IBRAHIMU', 'ISAKA',
         'YAKOBO', 'YUSUFU', 'MANA', 'AGANO', 'ADAMU', 'NUHU', 'EDENI', 'SHERIA'],
    ),
    'the-gospels': (
        ['JESUS', 'CHRIST', 'PETER', 'ANDREW', 'JAMES', 'MARY', 'SIMON', 'GALILEE',
         'DISCIPLE', 'PARABLE', 'CROSS', 'LAZARUS', 'BETHANY', 'MESSIAH'],
        ['YESU', 'KRISTO', 'PETRO', 'ANDREA', 'YAKOBO', 'MARIAMU', 'SIMONI', 'GALILAYA',
         'MFANO', 'MSALABA', 'LAZARO', 'MASIHI'],
    ),
    'the-prophets': (
        ['PROPHET', 'VISION', 'ZION', 'JUDAH', 'BABYLON', 'EXILE', 'ELIJAH', 'ELISHA',
         'REPENT', 'ORACLE'],
        ['NABII', 'MAONO', 'SAYUNI', 'YUDA', 'BABELI', 'ELIYA', 'ELISHA', 'TUBUNI'],
    ),
    'psalm-23': (
        ['SHEPHERD', 'PASTURES', 'WATERS', 'STILL', 'STAFF', 'MERCY', 'GOODNESS',
         'VALLEY', 'SOUL', 'DAVID', 'TABLE', 'ROD', 'CUP', 'OIL'],
        ['MCHUNGAJI', 'MALISHO', 'MAJI', 'FIMBO', 'REHEMA', 'WEMA', 'BONDE', 'NAFSI',
         'DAUDI', 'MEZA', 'KIKOMBE', 'MAFUTA'],
    ),
    'creation': (
        ['LIGHT', 'DARKNESS', 'HEAVEN', 'EARTH', 'WATERS', 'STARS', 'MOON', 'BEAST',
         'GARDEN', 'NIGHT', 'ADAM', 'EDEN', 'FISH', 'FOWL', 'SEED', 'GRASS', 'DAY', 'SEA', 'SUN'],
        ['NURU', 'GIZA', 'MBINGU', 'NCHI', 'MAJI', 'NYOTA', 'MWEZI', 'JUA', 'BUSTANI',
         'USIKU', 'MCHANA', 'SAMAKI', 'NDEGE', 'MBEGU', 'ADAMU'],
    ),
    'the-beatitudes': (
        ['BLESSED', 'MEEK', 'MERCIFUL', 'PURE', 'PEACE', 'MOURN', 'POOR', 'SPIRIT',
         'HUNGER', 'THIRST', 'KINGDOM', 'COMFORT', 'SALT', 'LIGHT'],
        ['HERI', 'WAPOLE', 'REHEMA', 'SAFI', 'AMANI', 'MASKINI', 'ROHO', 'NJAA', 'KIU',
         'UFALME', 'FARAJA', 'CHUMVI', 'NURU'],
    ),
    'proverbs-wisdom': (
        ['WISDOM', 'WISE', 'FOOL', 'KNOWLEDGE', 'SOLOMON', 'PRUDENT', 'COUNSEL',
         'HONEST', 'LAZY', 'TONGUE', 'FEAR', 'HEART'],
        ['HEKIMA', 'MPUMBAVU', 'MAARIFA', 'SULEMANI', 'SHAURI', 'ULIMI',
         'HOFU', 'MOYO'],
    ),
    'faith': (
        ['FAITH', 'BELIEVE', 'TRUST', 'HOPE', 'GRACE', 'ABRAHAM', 'SAVED', 'MOUNTAIN',
         'MUSTARD', 'SHIELD'],
        ['IMANI', 'AMINI', 'TUMAINI', 'NEEMA', 'IBRAHIMU', 'OKOLEWA', 'MLIMA', 'HARADALI'],
    ),
    'love': (
        ['LOVE', 'CHARITY', 'HEART', 'NEIGHBOUR', 'KIND', 'PATIENT', 'FORGIVE', 'BELOVED',
         'BROTHER', 'GIVE'],
        ['UPENDO', 'PENDA', 'MOYO', 'JIRANI', 'FADHILI', 'SAMEHE', 'MPENDWA', 'NDUGU'],
    ),
    'prayer': (
        ['PRAY', 'PRAYER', 'AMEN', 'KNEEL', 'SEEK', 'KNOCK', 'FATHER', 'HEAVEN', 'BREAD',
         'FORGIVE', 'PRAISE', 'THANKS', 'ASK'],
        ['OMBA', 'MAOMBI', 'AMINA', 'TAFUTA', 'BISHA', 'BABA', 'MBINGUNI', 'MKATE',
         'SAMEHE', 'SIFA', 'SHUKRANI'],
    ),
}


def clean(word):
    return re.sub(r'[^A-Za-z]', '', word or '').upper()


def _name_words(name):
    return [w for w in (clean(t) for t in re.split(r'[\s\-]+', name or ''))
            if len(w) >= 3 and w not in _NAME_FILLER]


def _book_names(first, last, language):
    """The names of books `first`..`last`, in the Bible being played."""
    if language == 'en':
        return [b['name'] for b in BIBLE_BOOKS if first <= b['number'] <= last]
    from .puzzle import tongue
    rows = (tongue(language).verses()
            .filter(book_number__gte=first, book_number__lte=last)
            .order_by('book_number').values_list('book_number', 'book').distinct())
    seen, names = set(), []
    for number, name in rows:
        if number not in seen:
            seen.add(number)
            names.append(name)
    return names


def signature_words(theme, language='en'):
    """The theme's own words, admin's first: uppercase, unique, in order."""
    source = theme.source or {}
    out = []
    own = source.get('words' if language == 'en' else f'words_{language}') or []
    if isinstance(own, str):
        own = re.split(r'[,\s]+', own)
    out += [clean(w) for w in own]

    kind = source.get('kind')
    if kind == 'books':
        try:
            first, last = int(source.get('first', 1)), int(source.get('last', 66))
        except (TypeError, ValueError):
            first, last = 1, 66
        for name in _book_names(first, last, language):
            out += _name_words(name)
    elif kind == 'passage' and language == 'en':
        book = BOOKS_BY_NAME.get(source.get('book', ''))
        if book:
            out += _name_words(book['name'])
    elif kind == 'topic':
        term = source.get('term' if language == 'en' else f'term_{language}')
        out.append(clean(term))

    curated = CURATED.get(theme.slug)
    if curated:
        out += curated[0] if language == 'en' else (curated[1] if language == 'sw' else [])

    seen, words = set(), []
    for w in out:
        if len(w) >= 3 and w not in seen:
            seen.add(w)
            words.append(w)
    return words

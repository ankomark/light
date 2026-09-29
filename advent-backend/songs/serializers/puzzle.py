from .common import *  # noqa: F401,F403

from ..models import PuzzleProgress, PuzzleTheme, WordPuzzle
from ..puzzle import band_for


def word_key(puzzle_id, word):
    """A word's fingerprint on one board: the first 16 hex characters of
    SHA-256 over "<puzzle id>:<WORD>". The app computes the same over what was
    spelled (utils/sha256.js) and compares.

    This lets a find show at once. It hides the answers from a glance at the
    payload, not from someone determined: the wheel's letters spell few enough
    words to try them all. The coins at stake are a few a word, and every
    claim is still checked and paid by the server.
    """
    import hashlib
    return hashlib.sha256(f'{puzzle_id}:{word}'.encode('utf-8')).hexdigest()[:16]


def verse_payload(puzzle):
    """The verse a finished level was drawn from, ready to render."""
    verse = puzzle.verse
    if not verse:
        return None
    return {
        'reference': verse.reference,
        'text': verse.text,
        'book': verse.book,
        # So "Read in Bible" can open the chapter at this verse.
        'book_number': verse.book_number,
        'chapter': verse.chapter,
        'verse': verse.verse,
    }


class PuzzleThemeSerializer(serializers.ModelSerializer):
    levels_completed = serializers.SerializerMethodField()

    class Meta:
        model = PuzzleTheme
        fields = ['id', 'name', 'slug', 'description', 'icon', 'levels_completed']

    def get_levels_completed(self, obj):
        # Already counted by whoever chose the level (songs/puzzle.py).
        if hasattr(obj, '_levels_completed'):
            return obj._levels_completed
        request = self.context.get('request')
        if not (request and request.user.is_authenticated):
            return 0
        return PuzzleProgress.objects.filter(
            user=request.user, puzzle__theme=obj, is_complete=True,
        ).count()


class WordPuzzleSerializer(serializers.ModelSerializer):
    """A playable level.

    The solution grid never leaves the server. What goes out is the *shape* of
    the board — which cells exist, and the length and position of each answer —
    plus the letters of any word this player has already found or paid a hint
    for. A player can see where the words are without being told what they are.
    """
    theme = PuzzleThemeSerializer(read_only=True)
    rows = serializers.SerializerMethodField()
    cols = serializers.SerializerMethodField()
    layout = serializers.SerializerMethodField()
    slots = serializers.SerializerMethodField()
    revealed = serializers.SerializerMethodField()
    found = serializers.SerializerMethodField()
    bonus = serializers.SerializerMethodField()
    bonus_total = serializers.SerializerMethodField()
    hints_used = serializers.SerializerMethodField()
    is_complete = serializers.SerializerMethodField()
    verse = serializers.SerializerMethodField()
    band = serializers.SerializerMethodField()
    bonus_keys = serializers.SerializerMethodField()
    shown = serializers.SerializerMethodField()
    letters_used = serializers.SerializerMethodField()

    class Meta:
        model = WordPuzzle
        fields = [
            'id', 'theme', 'level', 'letters', 'rows', 'cols', 'layout',
            'slots', 'revealed', 'found', 'bonus', 'bonus_total', 'bonus_keys',
            'hints_used', 'shown', 'letters_used', 'is_complete', 'verse', 'band',
        ]

    # ── the board's shape ────────────────────────────────────────────────────
    def get_rows(self, obj):
        return len(obj.grid or [])

    def get_cols(self, obj):
        return len(obj.grid[0]) if obj.grid else 0

    def get_layout(self, obj):
        """Which cells hold a letter — '#' for a tile, '.' for nothing.

        The letters themselves are stripped: this is the board's outline, the
        empty tiles a player sees before finding anything.
        """
        return [''.join('#' if ch != '.' else '.' for ch in row) for row in (obj.grid or [])]

    def get_slots(self, obj):
        """Where each answer sits and how long it is — never which word it is —
        and its key: a fingerprint of the word (see word_key), so the app can
        tell the moment a word is spelled which slot it fills, and fill it,
        without waiting on the server. The server still decides what counts."""
        return [
            {'length': len(p['word']), 'row': p['row'], 'col': p['col'], 'dir': p['dir'],
             'key': word_key(obj.pk, p['word'])}
            for p in obj.placements
        ]

    def get_bonus_keys(self, obj):
        """The bonus words' fingerprints, in no particular order."""
        return sorted(word_key(obj.pk, w) for w in (obj.bonus_words or []))

    # ── what this player has earned sight of ─────────────────────────────────
    def _progress(self, obj):
        request = self.context.get('request')
        if not (request and request.user.is_authenticated):
            return None
        if hasattr(obj, '_progress_cache'):
            return obj._progress_cache
        return PuzzleProgress.objects.filter(user=request.user, puzzle=obj).first()

    def get_found(self, obj):
        p = self._progress(obj)
        return p.found if p else []

    def get_revealed(self, obj):
        """Full placements — word included — for words found or hinted."""
        p = self._progress(obj)
        if not p:
            return []
        seen = set(p.found or []) | set(p.hinted or [])
        return [x for x in obj.placements if x['word'] in seen]

    def get_shown(self, obj):
        """Single letters this player bought: [{row, col, letter}]."""
        p = self._progress(obj)
        if not (p and p.shown):
            return []
        grid = obj.grid or []
        out = []
        for row, col in p.shown:
            if 0 <= row < len(grid) and 0 <= col < len(grid[row]):
                out.append({'row': row, 'col': col, 'letter': grid[row][col]})
        return out

    def get_letters_used(self, obj):
        p = self._progress(obj)
        return p.letters_used if p else 0

    def get_band(self, obj):
        """How hard this level calls itself: simple, moderate or hard."""
        return band_for(obj.level)

    def get_bonus(self, obj):
        """Bonus words this player has turned up — theirs, not the board's."""
        p = self._progress(obj)
        return p.bonus if p else []

    def get_bonus_total(self, obj):
        """How many there are to find.

        A count, never the words. Knowing that eleven more exist is what makes
        someone keep trying letters; knowing which eleven would end the game.
        """
        return len(obj.bonus_words or [])

    def get_verse(self, obj):
        """The verse the level was built from — only once it is finished.

        The base word appears in this text, so sending it early would hand over
        the longest answer on the board.
        """
        p = self._progress(obj)
        if not (p and p.is_complete) or not obj.verse:
            return None
        return verse_payload(obj)

    def get_hints_used(self, obj):
        p = self._progress(obj)
        return p.hints_used if p else 0

    def get_is_complete(self, obj):
        p = self._progress(obj)
        return bool(p and p.is_complete)


class PuzzleProgressSerializer(serializers.ModelSerializer):
    theme = serializers.CharField(source='puzzle.theme.name', read_only=True)
    level = serializers.IntegerField(source='puzzle.level', read_only=True)

    class Meta:
        model = PuzzleProgress
        fields = [
            'id', 'theme', 'level', 'found', 'bonus', 'hints_used',
            'coins_earned', 'is_complete', 'completed_at',
        ]

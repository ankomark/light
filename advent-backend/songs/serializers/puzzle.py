from .common import *  # noqa: F401,F403

from ..models import PuzzleProgress, PuzzleTheme, WordPuzzle
from ..puzzle import band_for


class PuzzleThemeSerializer(serializers.ModelSerializer):
    levels_completed = serializers.SerializerMethodField()

    class Meta:
        model = PuzzleTheme
        fields = ['id', 'name', 'slug', 'description', 'icon', 'levels_completed']

    def get_levels_completed(self, obj):
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

    class Meta:
        model = WordPuzzle
        fields = [
            'id', 'theme', 'level', 'letters', 'rows', 'cols', 'layout',
            'slots', 'revealed', 'found', 'bonus', 'bonus_total',
            'hints_used', 'is_complete', 'verse', 'band',
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
        """Where each answer sits and how long it is — never which word it is."""
        return [
            {'length': len(p['word']), 'row': p['row'], 'col': p['col'], 'dir': p['dir']}
            for p in obj.placements
        ]

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
        return {
            'reference': obj.verse.reference,
            'text': obj.verse.text,
            'book': obj.verse.book,
        }

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

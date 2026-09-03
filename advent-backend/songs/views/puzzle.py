"""The word puzzle.

Coins are earned by finding words and finishing levels, and spent on hints —
the first thing in the app that takes coins away, which is why every deduction
is written to the ledger rather than inferred from a counter.

The server keeps the placements to itself. A client claims a find by sending
where it dragged, not what it thinks it found, and the server reads its own
grid to decide — so a forged request cannot mint coins.
"""
from collections import Counter

from .common import *  # noqa: F401,F403
from ..models import CoinSpend, PuzzleProgress, PuzzleTheme, WordPuzzle
from ..puzzle import generate
from ..scoring import (
    COINS_PER_BONUS_WORD, COINS_PER_WORD, HINT_COST, coin_balance, completion_bonus,
)
from ..streaks import streak_for
from ..serializers.puzzle import (
    PuzzleThemeSerializer, PuzzleProgressSerializer, WordPuzzleSerializer,
)


def _verse(puzzle):
    """The verse a finished level was drawn from, ready to render."""
    if not puzzle.verse:
        return None
    return {
        'reference': puzzle.verse.reference,
        'text': puzzle.verse.text,
        'book': puzzle.verse.book,
    }


class PuzzleThemeViewSet(viewsets.ReadOnlyModelViewSet):
    """The subjects on offer, and how far this player has got with each."""
    serializer_class = PuzzleThemeSerializer
    permission_classes = [IsAuthenticated]
    lookup_field = 'slug'
    pagination_class = None
    throttle_scope = 'quiz'

    def get_queryset(self):
        return PuzzleTheme.objects.filter(is_active=True)


class WordPuzzleViewSet(viewsets.GenericViewSet):
    """Play a level: read it, claim a word, buy a hint."""
    serializer_class = WordPuzzleSerializer
    permission_classes = [IsAuthenticated]
    throttle_scope = 'quiz'

    def get_queryset(self):
        return WordPuzzle.objects.select_related('theme', 'verse')

    def _progress(self, puzzle, create=True):
        if create:
            progress, _ = PuzzleProgress.objects.get_or_create(
                user=self.request.user, puzzle=puzzle,
            )
            return progress
        return PuzzleProgress.objects.filter(user=self.request.user, puzzle=puzzle).first()

    @action(detail=False, methods=['get'])
    def level(self, request):
        """GET /api/puzzles/level/?theme=<slug>&level=<n> — built on first ask."""
        slug = request.query_params.get('theme')
        theme = PuzzleTheme.objects.filter(slug=slug, is_active=True).first()
        if not theme:
            raise ValidationError({'theme': 'Unknown theme.'})
        try:
            level = int(request.query_params.get('level', 1))
        except (TypeError, ValueError):
            raise ValidationError({'level': 'Must be a number.'})
        if not 1 <= level <= 50:
            raise ValidationError({'level': 'Levels run from 1 to 50.'})

        try:
            puzzle = generate(theme, level)
        except ValueError as exc:
            # The theme cannot supply enough words — a real failure, not an
            # undersized puzzle that still pays a completion bonus.
            raise APIException(str(exc))

        puzzle._progress_cache = self._progress(puzzle)
        return Response(self.get_serializer(puzzle).data)

    @action(detail=True, methods=['post'])
    def found(self, request, pk=None):
        """Submit a word spelled from the wheel.

        POST {"word": "PATHS"}. The word must be one of this level's answers —
        the answers were never sent, so a client cannot enumerate them without
        actually forming words from the letters it was given.
        """
        puzzle = get_object_or_404(self.get_queryset(), pk=pk)
        progress = self._progress(puzzle)

        word = str(request.data.get('word') or '').strip().upper()
        if not word:
            raise ValidationError({'word': 'Send the word you spelled.'})

        # Spelling something the wheel cannot make is not a guess worth checking.
        if Counter(word) - Counter(puzzle.letters):
            return Response({'correct': False, 'found': progress.found, 'coins_earned': 0})

        match = next((p for p in puzzle.placements if p['word'] == word), None)
        if not match:
            # Not on the board — but it may still be a real word the wheel
            # can spell, which is worth something.
            return self._bonus(request, puzzle, progress, word)

        if word in (progress.found or []):
            return Response({
                'correct': True, 'word': word, 'already_found': True,
                'found': progress.found, 'coins_earned': 0, 'placement': match,
            })

        with transaction.atomic():
            progress.found = list(progress.found or []) + [word]
            coins = COINS_PER_WORD
            complete = len(set(progress.found)) >= len(puzzle.placements)
            bonus = 0
            if complete and not progress.is_complete:
                bonus = completion_bonus(puzzle.level)
                progress.is_complete = True
                progress.completed_at = timezone.now()
            progress.coins_earned = (progress.coins_earned or 0) + coins + bonus
            progress.save()

        earned, spent, balance = coin_balance(request.user)
        return Response({
            'correct': True,
            'word': word,
            'placement': match,
            'coins_earned': coins,
            'completion_bonus': bonus,
            'is_complete': progress.is_complete,
            'found': progress.found,
            'balance': balance,
            # The reward for finishing: the verse these words came out of.
            # Held back until the board is done — the base word is in this
            # text, so an early reveal would give the longest answer away.
            'verse': _verse(puzzle) if progress.is_complete else None,
        })

    def _bonus(self, request, puzzle, progress, word):
        """A real word the wheel can spell that the board never asked for.

        `correct` stays False — nothing goes on the board, and a bonus word
        must never bring a level closer to finished. It pays a little anyway,
        which turns a wrong guess from a dead end into a small find.
        """
        if word not in set(puzzle.bonus_words or []):
            return Response({'correct': False, 'found': progress.found, 'coins_earned': 0})

        if word in (progress.bonus or []):
            return Response({
                'correct': False, 'bonus': True, 'already_found': True,
                'word': word, 'bonus_found': progress.bonus, 'coins_earned': 0,
            })

        with transaction.atomic():
            progress.bonus = list(progress.bonus or []) + [word]
            progress.coins_earned = (progress.coins_earned or 0) + COINS_PER_BONUS_WORD
            progress.save(update_fields=['bonus', 'coins_earned'])

        _, _, balance = coin_balance(request.user)
        return Response({
            'correct': False,
            'bonus': True,
            'word': word,
            'coins_earned': COINS_PER_BONUS_WORD,
            'bonus_found': progress.bonus,
            'bonus_total': len(puzzle.bonus_words or []),
            'balance': balance,
        })

    @action(detail=True, methods=['post'])
    def hint(self, request, pk=None):
        """Buy a hint: one unfound word is revealed, and the coins are spent.

        Refused rather than allowed into debt — a balance that can go negative
        is a balance nobody trusts.
        """
        puzzle = get_object_or_404(self.get_queryset(), pk=pk)
        progress = self._progress(puzzle)

        remaining = [
            p for p in puzzle.placements
            if p['word'] not in (progress.found or [])
            and p['word'] not in (progress.hinted or [])
        ]
        if not remaining:
            return Response(
                {'error': 'Nothing left to reveal.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        earned, spent, balance = coin_balance(request.user)
        if balance < HINT_COST:
            return Response(
                {'error': 'A hint costs %d coins; you have %d.' % (HINT_COST, balance),
                 'cost': HINT_COST, 'balance': balance},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # The longest unfound word — the one most likely to be the sticking point.
        target = max(remaining, key=lambda p: len(p['word']))

        with transaction.atomic():
            CoinSpend.objects.create(
                user=request.user, amount=HINT_COST,
                reason=CoinSpend.HINT, puzzle=puzzle,
            )
            progress.hinted = list(progress.hinted or []) + [target['word']]
            progress.hints_used = (progress.hints_used or 0) + 1
            progress.save(update_fields=['hinted', 'hints_used'])

        _, _, balance = coin_balance(request.user)
        return Response({
            'word': target['word'],
            'placement': target,
            'cost': HINT_COST,
            'balance': balance,
            'hints_used': progress.hints_used,
        })

    @action(detail=False, methods=['get'], url_path='my-progress')
    def my_progress(self, request):
        rows = (PuzzleProgress.objects.filter(user=request.user)
                .select_related('puzzle', 'puzzle__theme')
                .order_by('-started_at')[:50])
        return Response(PuzzleProgressSerializer(rows, many=True).data)

    @action(detail=False, methods=['get'])
    def wallet(self, request):
        """What is earned, what is spent, and what is left to spend."""
        earned, spent, balance = coin_balance(request.user)
        current, best, played_today = streak_for(request.user)
        return Response({
            'earned': earned, 'spent': spent, 'balance': balance,
            'hint_cost': HINT_COST, 'coins_per_word': COINS_PER_WORD,
            'coins_per_bonus_word': COINS_PER_BONUS_WORD,
            # The same streak the quiz shows: one record of showing up.
            'day_streak': current, 'best_day_streak': best,
            'played_today': played_today,
        })

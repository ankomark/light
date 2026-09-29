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
from ..puzzle import LEVEL_LIMIT, generate, next_puzzle
from ..scoring import (
    COINS_PER_BONUS_WORD, COINS_PER_WORD, HINT_COST, LETTER_COST, coin_balance,
    completion_bonus,
)
from ..streaks import streak_for
from ..serializers.puzzle import (
    PuzzleThemeSerializer, PuzzleProgressSerializer, WordPuzzleSerializer, verse_payload,
)


# The verse a finished level was drawn from (serializers/puzzle.py).
_verse = verse_payload


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
        if not 1 <= level <= LEVEL_LIMIT:
            raise ValidationError({'level': 'That is not a level.'})

        try:
            puzzle = generate(theme, level)
        except ValueError as exc:
            # The theme cannot supply enough words — a real failure, not an
            # undersized puzzle that still pays a completion bonus.
            raise APIException(str(exc))

        puzzle._progress_cache = self._progress(puzzle, create=False)
        return Response({**self.get_serializer(puzzle).data, 'wallet': self._wallet(request.user)})

    @action(detail=False, methods=['get'])
    def next(self, request):
        """GET /api/puzzles/next/ — the level to play now, server's choice.

        The same payload `level` returns, so the client has one thing to render
        either way. It takes no theme parameter on purpose: choosing is not the
        client's to do.
        """
        try:
            puzzle = next_puzzle(request.user)
        except ValueError as exc:
            raise APIException(str(exc))

        if not hasattr(puzzle, '_progress_cache'):
            puzzle._progress_cache = self._progress(puzzle, create=False)
        return Response({**self.get_serializer(puzzle).data, 'wallet': self._wallet(request.user)})

    @staticmethod
    def _wallet(user):
        """The purse and the streak, sent with the level: one request to open
        the game rather than two."""
        earned, spent, balance = coin_balance(user)
        current, best, played_today = streak_for(user)
        return {
            'earned': earned, 'spent': spent, 'balance': balance, 'hint_cost': HINT_COST,
            'letter_cost': LETTER_COST,
            # So the app can show "+5" the moment a word lands.
            'coins_per_word': COINS_PER_WORD, 'coins_per_bonus_word': COINS_PER_BONUS_WORD,
            'day_streak': current, 'best_day_streak': best, 'played_today': played_today,
        }

    @action(detail=True, methods=['post'])
    def found(self, request, pk=None):
        """Submit a word spelled from the wheel.

        POST {"word": "PATHS"}. The word must be one of this level's answers —
        the answers were never sent, so a client cannot enumerate them without
        actually forming words from the letters it was given.
        """
        # One query, not two. The progress row knows its puzzle, and after the
        # first word of a level that row always exists — so the common case is
        # a single join instead of a lookup for the board and another for the
        # player's place in it.
        progress = (PuzzleProgress.objects
                    .select_related('puzzle', 'puzzle__theme', 'puzzle__verse')
                    .filter(user=request.user, puzzle_id=pk)
                    .first())
        if progress:
            puzzle = progress.puzzle
        else:
            puzzle = get_object_or_404(self.get_queryset(), pk=pk)
            progress, _ = PuzzleProgress.objects.get_or_create(
                user=request.user, puzzle=puzzle,
            )

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

        # No explicit transaction: this is one UPDATE, atomic on its own. The
        # BEGIN and COMMIT around it were two more round trips on the path a
        # player is actually waiting on.
        progress.found = list(progress.found or []) + [word]
        coins = COINS_PER_WORD
        complete = len(set(progress.found)) >= len(puzzle.placements)
        bonus = 0
        fields = ['found', 'coins_earned']
        if complete and not progress.is_complete:
            bonus = completion_bonus(puzzle.level)
            progress.is_complete = True
            progress.completed_at = timezone.now()
            fields += ['is_complete', 'completed_at']
        progress.coins_earned = (progress.coins_earned or 0) + coins + bonus
        progress.save(update_fields=fields)

        return Response({
            'correct': True,
            'word': word,
            'placement': match,
            'coins_earned': coins,
            'completion_bonus': bonus,
            'is_complete': progress.is_complete,
            'found': progress.found,
            # What was earned, not what is left. Reconciling the whole purse
            # took four aggregate queries on every single word, and the client
            # can add a number it already knows to one it already has. The
            # authoritative balance comes back when the level ends — rare
            # enough to pay for, and the moment it matters most.
            'balance': coin_balance(request.user)[2] if progress.is_complete else None,
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

        progress.bonus = list(progress.bonus or []) + [word]
        progress.coins_earned = (progress.coins_earned or 0) + COINS_PER_BONUS_WORD
        progress.save(update_fields=['bonus', 'coins_earned'])

        return Response({
            'correct': False,
            'bonus': True,
            'word': word,
            'coins_earned': COINS_PER_BONUS_WORD,
            'bonus_found': progress.bonus,
            'bonus_total': len(puzzle.bonus_words or []),
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

    @action(detail=True, methods=['post'])
    def letter(self, request, pk=None):
        """Buy one letter, on a tile the player chose. POST {row, col}.

        The cheap hint: it shows what is on that tile and nothing else, and the
        word it sits in still has to be traced. Refused for a tile that is not
        on the board or already shows its letter, and — like a word hint — for
        a purse that cannot pay.
        """
        puzzle = get_object_or_404(self.get_queryset(), pk=pk)
        try:
            row, col = int(request.data.get('row')), int(request.data.get('col'))
        except (TypeError, ValueError):
            raise ValidationError({'row': 'Send the row and column of a tile.'})
        grid = puzzle.grid or []
        if not (0 <= row < len(grid) and 0 <= col < len(grid[row])) or grid[row][col] == '.':
            raise ValidationError({'row': 'That is not a tile on this board.'})

        with transaction.atomic():
            progress, _ = PuzzleProgress.objects.select_for_update().get_or_create(
                user=request.user, puzzle=puzzle,
            )
            if progress.is_complete:
                return Response({'error': 'This board is finished.', 'code': 'finished'},
                                status=status.HTTP_400_BAD_REQUEST)
            open_words = set(progress.found or []) | set(progress.hinted or [])
            showing = {tuple(c) for c in (progress.shown or [])}
            for p in puzzle.placements:
                if p['word'] in open_words:
                    for i in range(len(p['word'])):
                        showing.add((p['row'] + (i if p['dir'] == 'down' else 0),
                                     p['col'] + (i if p['dir'] == 'across' else 0)))
            if (row, col) in showing:
                return Response({'error': 'That letter is already showing.', 'code': 'shown'},
                                status=status.HTTP_400_BAD_REQUEST)

            _earned, _spent, balance = coin_balance(request.user)
            if balance < LETTER_COST:
                return Response(
                    {'error': 'A letter costs %d coins; you have %d.' % (LETTER_COST, balance),
                     'code': 'not_enough_coins', 'cost': LETTER_COST, 'balance': balance},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            CoinSpend.objects.create(
                user=request.user, amount=LETTER_COST, reason=CoinSpend.LETTER, puzzle=puzzle,
            )
            progress.shown = list(progress.shown or []) + [[row, col]]
            progress.letters_used = (progress.letters_used or 0) + 1
            progress.save(update_fields=['shown', 'letters_used'])

        return Response({
            'row': row, 'col': col, 'letter': grid[row][col],
            'cost': LETTER_COST, 'balance': balance - LETTER_COST,
            'letters_used': progress.letters_used,
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
            'hint_cost': HINT_COST, 'letter_cost': LETTER_COST, 'coins_per_word': COINS_PER_WORD,
            'coins_per_bonus_word': COINS_PER_BONUS_WORD,
            # The same streak the quiz shows: one record of showing up.
            'day_streak': current, 'best_day_streak': best,
            'played_today': played_today,
        })

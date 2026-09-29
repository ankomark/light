"""The word puzzle.

Coins are earned by finding words and finishing levels, and spent on hints —
the first thing in the app that takes coins away, which is why every deduction
is written to the ledger rather than inferred from a counter.

The server keeps the placements to itself. A client claims a find by sending
where it dragged, not what it thinks it found, and the server reads its own
grid to decide — so a forged request cannot mint coins.
"""
from collections import Counter

from rest_framework.exceptions import NotFound

from django.db.models import Count, F, Max

from .common import *  # noqa: F401,F403
from ..models import CoinSpend, PuzzleProgress, PuzzleTheme, WordPuzzle
from ..puzzle import (
    LEVEL_LIMIT, WORD_HINT_WEIGHT, band_for, daily_puzzle, generate, help_used,
    language_available, next_puzzle, stars_for,
)
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


def _language(request):
    """The language to play in: `lang` when its Bible is here, else English
    — a Swahili speaker gets an English board rather than none."""
    lang = request.query_params.get('lang') or 'en'
    return lang if language_available(lang) else 'en'


class PuzzleThemeViewSet(viewsets.ReadOnlyModelViewSet):
    """The subjects on offer, and how far this player has got with each."""
    serializer_class = PuzzleThemeSerializer
    permission_classes = [IsAuthenticated]
    lookup_field = 'slug'
    pagination_class = None
    throttle_scope = 'quiz'

    def get_queryset(self):
        themes = PuzzleTheme.objects.filter(is_active=True)
        if _language(self.request) != 'en':
            # A topic with no word to search for in that Bible cannot build.
            themes = [t for t in themes if (t.source or {}).get('kind') != PuzzleTheme.TOPIC
                      or (t.source or {}).get(f'term_{_language(self.request)}')]
        return themes

    def get_object(self):
        theme = next((t for t in self.get_queryset() if t.slug == self.kwargs.get('slug')), None)
        if not theme:
            raise NotFound('No such theme.')
        return theme

    def get_serializer_context(self):
        return {**super().get_serializer_context(), 'lang': _language(self.request)}

    def _mine(self, request):
        """This player's finished levels (not daily boards), one read."""
        return (PuzzleProgress.objects
                .filter(user=request.user, is_complete=True, puzzle__day__isnull=True,
                        puzzle__language=_language(request))
                .select_related('puzzle'))

    def list(self, request, *args, **kwargs):
        """Every theme, with how far this player has got and the stars won —
        counted in one query, not one per theme."""
        themes = list(self.get_queryset())
        done, top, stars = Counter(), {}, Counter()
        for p in self._mine(request):
            tid = p.puzzle.theme_id
            done[tid] += 1
            top[tid] = max(top.get(tid, 0), p.puzzle.level)
            stars[tid] += stars_for(p)
        for theme in themes:
            theme._levels_completed = done[theme.id]
            theme._next_level = top.get(theme.id, 0) + 1
            theme._stars = stars[theme.id]
        return Response(self.get_serializer(themes, many=True).data)

    @action(detail=True, methods=['get'])
    def levels(self, request, slug=None):
        """The levels map: every level reached so far in this theme, with its
        stars, and the next one open to play."""
        theme = self.get_object()
        rows = {}
        for p in (PuzzleProgress.objects
                  .filter(user=request.user, puzzle__theme=theme, puzzle__day__isnull=True,
                          puzzle__language=_language(request))
                  .select_related('puzzle')):
            rows[p.puzzle.level] = p
        reached = max([lv for lv, p in rows.items() if p.is_complete] or [0])
        next_level = reached + 1
        levels = []
        for lv in range(1, next_level + 1):
            p = rows.get(lv)
            levels.append({
                'level': lv, 'band': band_for(lv),
                'is_complete': bool(p and p.is_complete),
                'started': bool(p and not p.is_complete),
                'stars': stars_for(p),
            })
        theme._levels_completed = sum(1 for p in rows.values() if p.is_complete)
        theme._next_level = next_level
        theme._stars = sum(stars_for(p) for p in rows.values())
        return Response({
            'theme': self.get_serializer(theme).data,
            'levels': levels,
            'next_level': next_level,
        })


def _seconds(progress):
    if not (progress and progress.is_complete and progress.completed_at):
        return None
    return max(0, int((progress.completed_at - progress.started_at).total_seconds()))


def _result(progress, user, puzzle):
    """One side of a challenge: how far they got and how."""
    return {
        'username': user.username,
        'is_complete': bool(progress and progress.is_complete),
        'found': len(set(progress.found or [])) if progress else 0,
        'total': len(puzzle.placements),
        'seconds': _seconds(progress),
        'stars': stars_for(progress),
        'help': help_used(progress) if progress else 0,
    }


def _verdict(mine, theirs):
    """'won', 'lost' or 'tied' once both have finished — less help first,
    then the quicker — and 'waiting' until then."""
    if not (mine['is_complete'] and theirs['is_complete']):
        return 'waiting'
    a = (mine['help'], mine['seconds'] or 0)
    b = (theirs['help'], theirs['seconds'] or 0)
    return 'won' if a < b else 'lost' if a > b else 'tied'


def _tell_challenger(progress):
    """The one who sent the challenge hears how it went."""
    challenger = progress.challenger
    if not challenger:
        return
    theirs = PuzzleProgress.objects.filter(user=challenger, puzzle=progress.puzzle).first()
    mine = _result(progress, progress.user, progress.puzzle)
    yours = _result(theirs, challenger, progress.puzzle)
    verdict = _verdict(yours, mine)
    words = {'won': 'You still lead.', 'lost': 'They beat you.', 'tied': 'A tie.'}.get(verdict, '')
    minutes, secs = divmod(mine['seconds'] or 0, 60)
    try:
        notify_user(challenger, 'puzzle_challenge',
                    f"{progress.user.username} solved your puzzle in {minutes}:{secs:02d} "
                    f"with {mine['stars']} stars. {words}".strip(),
                    data={'type': 'puzzle_challenge', 'puzzle': progress.puzzle_id,
                          'from': progress.user.username})
    except Exception:  # noqa: BLE001 — a push never undoes a find
        pass


class WordPuzzleViewSet(viewsets.GenericViewSet):
    """Play a level: read it, claim a word, buy a hint."""
    serializer_class = WordPuzzleSerializer
    permission_classes = [IsAuthenticated]
    throttle_scope = 'quiz'

    def get_queryset(self):
        return WordPuzzle.objects.select_related('theme', 'verse', 'sw_verse')

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
            puzzle = generate(theme, level, language=_language(request))
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
            puzzle = next_puzzle(request.user, _language(request))
        except ValueError as exc:
            raise APIException(str(exc))

        if not hasattr(puzzle, '_progress_cache'):
            puzzle._progress_cache = self._progress(puzzle, create=False)
        return Response({**self.get_serializer(puzzle).data, 'wallet': self._wallet(request.user)})

    def retrieve(self, request, pk=None):
        """GET /api/puzzles/<id>/ — one board, as `level` returns it: what a
        challenge link opens. `?from=<username>` is the friend who sent it.
        Opening a challenge starts the clock, and the sender hears how it went.
        """
        puzzle = get_object_or_404(self.get_queryset(), pk=pk)
        progress = self._progress(puzzle, create=False)
        sender = (request.query_params.get('from') or '').strip()
        if sender and sender != request.user.username:
            challenger = User.objects.filter(username=sender).first()
            # Only someone who has played this board can have sent it: without
            # this, any name in a link would be pushed news of a stranger.
            sent = challenger and PuzzleProgress.objects.filter(
                user=challenger, puzzle=puzzle).exists()
            if sent and not (progress and (progress.challenger_id or progress.is_complete)):
                if not progress:
                    progress = PuzzleProgress.objects.create(user=request.user, puzzle=puzzle)
                progress.challenger = challenger
                progress.save(update_fields=['challenger'])
        puzzle._progress_cache = progress
        return Response({**self.get_serializer(puzzle).data, 'wallet': self._wallet(request.user)})

    @action(detail=True, methods=['get'])
    def versus(self, request, pk=None):
        """GET /api/puzzles/<id>/versus/?user=<username> — a challenge side
        by side: {me, them, verdict}. Only between the two it was sent between.
        """
        puzzle = get_object_or_404(self.get_queryset(), pk=pk)
        other = User.objects.filter(username=request.query_params.get('user') or '').first()
        if not other or other.pk == request.user.pk:
            raise NotFound('No such challenge.')
        mine = PuzzleProgress.objects.filter(user=request.user, puzzle=puzzle).first()
        theirs = PuzzleProgress.objects.filter(user=other, puzzle=puzzle).first()
        linked = ((mine and mine.challenger_id == other.pk)
                  or (theirs and theirs.challenger_id == request.user.pk))
        if not linked:
            raise NotFound('No such challenge.')
        me = _result(mine, request.user, puzzle)
        them = _result(theirs, other, puzzle)
        return Response({'me': me, 'them': them, 'verdict': _verdict(me, them)})

    @action(detail=False, methods=['get'], url_path='daily/leaderboard')
    def daily_leaderboard(self, request):
        """Today's Daily Puzzle, ranked: finished boards only, less help
        first (a word hint counts as three letters), then the quicker, then who
        finished first. `scope`: everyone (the default), `following` (the
        people you follow, and you), or `group:<slug>` (members only).
        `me` is your own place, even below the fifty shown.
        """
        day = timezone.localdate()
        raw = request.query_params.get('date')
        if raw:
            from datetime import date as date_cls
            try:
                day = date_cls.fromisoformat(raw)
            except ValueError:
                raise ValidationError({'date': 'Use YYYY-MM-DD.'})
        ranked = (PuzzleProgress.objects
                  .filter(puzzle__day=day, is_complete=True, completed_at__isnull=False)
                  .annotate(help=F('hints_used') * WORD_HINT_WEIGHT + F('letters_used'),
                            took=F('completed_at') - F('started_at'))
                  .order_by('help', 'took', 'completed_at'))
        scope = request.query_params.get('scope') or ''
        if scope == 'following':
            circle = set(request.user.followed_by.values_list('id', flat=True)) | {request.user.pk}
            ranked = ranked.filter(user_id__in=circle)
        elif scope.startswith('group:'):
            group = Group.objects.filter(slug=scope[len('group:'):]).first()
            if not group:
                raise NotFound('No such group.')
            members = set(group.members.values_list('user_id', flat=True))
            if request.user.pk not in members:
                raise PermissionDenied("Only members can see this group's board.")
            ranked = ranked.filter(user_id__in=members)

        top = list(ranked.select_related('user', 'user__profile')[:self.BOARD_SIZE])
        order = list(ranked.values_list('user_id', flat=True))
        mine = next((p for p in top if p.user_id == request.user.pk), None)
        if request.user.pk in order and not mine:
            mine = ranked.filter(user=request.user).first()
        return Response({
            'date': day,
            'results': [{
                'id': p.pk,
                'user': SimpleUserSerializer(p.user).data,
                'seconds': _seconds(p),
                'stars': stars_for(p),
                'hints_used': p.hints_used,
                'letters_used': p.letters_used,
            } for p in top],
            'me': None if request.user.pk not in order else {
                'rank': order.index(request.user.pk) + 1, 'of': len(order),
                'seconds': _seconds(mine), 'stars': stars_for(mine),
            },
        })

    BOARD_SIZE = 50

    @action(detail=False, methods=['get'])
    def daily(self, request):
        """GET /api/puzzles/daily/ — today's board, the same for everyone.

        Opening it starts the clock (the progress row is made here), so a time
        on the daily board means the same thing for everyone who has one.
        """
        day = timezone.localdate()
        try:
            puzzle = daily_puzzle(day, _language(request))
        except ValueError as exc:
            raise APIException(str(exc))
        puzzle._progress_cache = self._progress(puzzle)
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
                    .select_related('puzzle', 'puzzle__theme', 'puzzle__verse', 'puzzle__sw_verse')
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
        if bonus and progress.challenger_id:
            _tell_challenger(progress)

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
            # How the board was won, once it is.
            'stars': stars_for(progress) if progress.is_complete else 0,
            'seconds': (max(0, int((progress.completed_at - progress.started_at).total_seconds()))
                        if progress.is_complete and progress.completed_at else None),
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

    @action(detail=True, methods=['post'])
    def meaning(self, request, pk=None):
        """What a word found on this board means. POST {word, language}.
        From the glossary when it has the word, otherwise explained by Claude
        and kept for everyone. Only for a word this player has found."""
        from .. import puzzle_words
        puzzle = get_object_or_404(self.get_queryset(), pk=pk)
        lang = request.data.get('language') or request.query_params.get('lang') or 'en'
        try:
            out = puzzle_words.meaning(request.user, puzzle, request.data.get('word'), lang)
        except PermissionError:
            return Response({'error': 'Find the word first.', 'code': 'not_found'},
                            status=status.HTTP_403_FORBIDDEN)
        except puzzle_words.AiOff:
            return Response({'error': 'AI is not available.', 'code': 'ai_off'},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except puzzle_words.AiLimit:
            return Response({'error': "You've used today's AI answers.", 'code': 'ai_limit'},
                            status=status.HTTP_429_TOO_MANY_REQUESTS)
        except puzzle_words.AiFailed:
            return Response({'error': 'AI could not answer just now.', 'code': 'ai_failed'},
                            status=status.HTTP_502_BAD_GATEWAY)
        return Response(out)

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

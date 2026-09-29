"""Live Bible Battle: a room of players answering the same question at once.

A host creates a battle and gets a six-letter code; players join with it.
The host starts it. Each question is open for `seconds` on the server's
clock; answers are scored on being right and on how fast (a right answer is
worth 500, and up to 500 more for speed). When the clock runs out, or when
every player has answered, the answer is shown with how many chose what and
the ranking; then the next question.

Every step is idempotent and names the question it is about, so several
phones asking for the same step at once — the host's and the players', when
the clock runs out — take it once. A battle whose host has gone quiet still
moves: once time is up anyone in it may show the answer, and a shown answer
moves on after a few seconds.

Everything is decided here, through REST; the socket (BattleConsumer) only
tells everyone what happened.
"""
import random

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import IntegrityError, transaction
from django.db.models import Count, F
from django.utils import timezone

from .models import Battle, BattleAnswer, BattlePlayer, BattleQuestion

QUESTIONS = 10
MIX = [('simple', 4), ('moderate', 4), ('hard', 2)]
SECONDS_CHOICES = (10, 15, 20, 30)
# A beat of grace on the server's clock for an answer already in flight.
GRACE = 1.5
# How long a shown answer stays before anyone may move the battle on.
REVEAL_HOLD = 8
MAX_PLAYERS = 200
BOARD = 10


class BattleRefused(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


# ── the room's voice ─────────────────────────────────────────────────────────

def room(code):
    return f'battle_{code}'


def announce(battle, event):
    """Tell everyone in the battle's socket room. A no-op without a channel
    layer; never lets a broadcast failure undo the step that caused it."""
    layer = get_channel_layer()
    if not layer:
        return
    try:
        async_to_sync(layer.group_send)(room(battle.code), {'type': 'battle_event', 'payload': event})
    except Exception:  # noqa: BLE001
        pass


# ── reading a battle ─────────────────────────────────────────────────────────

def _player_row(p):
    return {'id': p.user_id, 'username': p.user.username, 'points': p.points, 'correct': p.correct}


def ranking(battle, limit=BOARD):
    players = battle.players.select_related('user').order_by('-points', '-correct', 'joined_at')
    return [_player_row(p) for p in players[:limit]]


def _question_public(battle, q):
    """A question as players see it while it is open: no answer."""
    remaining = 0
    if battle.question_started_at:
        left = battle.seconds - (timezone.now() - battle.question_started_at).total_seconds()
        remaining = max(0, int(left * 1000))
    return {
        'index': q.order, 'total': battle.questions.count(), 'prompt': q.prompt,
        'passage': q.passage, 'choices': q.choices, 'kind': q.kind, 'difficulty': q.difficulty,
        'seconds': battle.seconds, 'remaining_ms': remaining,
    }


def _reveal_public(battle, q):
    counts = dict(q.answers.values_list('choice').annotate(n=Count('id')))
    return {
        'index': q.order, 'answer_index': q.answer_index, 'reference': q.reference,
        'explanation': q.explanation,
        'counts': [counts.get(i, 0) for i in range(len(q.choices))],
        'ranking': ranking(battle),
    }


def state(battle, user=None):
    """Everything a screen needs to draw the battle now — for joining late,
    or coming back after the connection dropped."""
    battle.refresh_from_db()
    out = {
        'code': battle.code, 'title': battle.title, 'status': battle.status,
        'host': battle.host.username, 'is_host': bool(user and user.pk == battle.host_id),
        'language': battle.language, 'seconds': battle.seconds,
        'players': battle.players.count(), 'total': battle.questions.count(),
        'current': battle.current,
        'lobby': [p['username'] for p in ranking(battle, limit=MAX_PLAYERS)] if battle.status == Battle.LOBBY else [],
    }
    q = battle.questions.filter(order=battle.current).first() if battle.current >= 0 else None
    if battle.status == Battle.QUESTION and q:
        out['question'] = _question_public(battle, q)
        out['answered'] = q.answers.count()
    elif battle.status in (Battle.REVEAL, Battle.FINISHED) and q:
        out['question'] = {**_question_public(battle, q), 'remaining_ms': 0}
        out['reveal'] = _reveal_public(battle, q)
    if battle.status == Battle.FINISHED:
        out['ranking'] = ranking(battle)
    if user:
        me = battle.players.filter(user=user).first()
        if me:
            mine = me.answers.filter(question=q).first() if q else None
            place = battle.players.filter(points__gt=me.points).count() + 1
            out['me'] = {
                'points': me.points, 'correct': me.correct, 'place': place,
                'answered': mine is not None,
                'last': ({'choice': mine.choice, 'correct': mine.is_correct, 'points': mine.points}
                         if mine and battle.status != Battle.QUESTION else None),
            }
    return out


# ── the host's steps ─────────────────────────────────────────────────────────

def _new_code():
    letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'          # no O/0 or I/1 to misread
    for _ in range(20):
        code = ''.join(random.choice(letters) for _ in range(6))
        if not Battle.objects.filter(code=code).exists():
            return code
    raise BattleRefused('busy')


def create(host, title='', seconds=20, language='en'):
    from .quiz import build_questions, corpus_for
    seconds = seconds if seconds in SECONDS_CHOICES else 20
    corpus = corpus_for(language)
    built = build_questions(random.Random(), MIX, corpus)
    with transaction.atomic():
        battle = Battle.objects.create(
            code=_new_code(), host=host, title=(title or '')[:80],
            language=corpus.language, seconds=seconds,
        )
        BattleQuestion.objects.bulk_create([
            BattleQuestion(
                battle=battle, order=i, kind=q['kind'], difficulty=q['difficulty'],
                prompt=q['prompt'], passage=q.get('passage', ''), choices=q['choices'],
                answer_index=q['answer_index'], reference=q.get('reference', ''),
                explanation=q.get('explanation', ''),
            )
            for i, q in enumerate(built[:QUESTIONS])
        ])
    return battle


def join(battle, user):
    if battle.status == Battle.FINISHED:
        raise BattleRefused('finished')
    if user.pk == battle.host_id:
        raise BattleRefused('host')
    if battle.players.count() >= MAX_PLAYERS and not battle.players.filter(user=user).exists():
        raise BattleRefused('full')
    player, created = BattlePlayer.objects.get_or_create(battle=battle, user=user)
    if created:
        announce(battle, {'type': 'joined', 'username': user.username, 'players': battle.players.count()})
    return player


def _open(battle, index):
    battle.current = index
    battle.status = Battle.QUESTION
    battle.question_started_at = timezone.now()
    battle.revealed_at = None
    battle.save(update_fields=['current', 'status', 'question_started_at', 'revealed_at'])
    q = battle.questions.get(order=index)
    announce(battle, {'type': 'question', 'question': _question_public(battle, q)})


def start(battle, user):
    if user.pk != battle.host_id:
        raise BattleRefused('not_host')
    moved = Battle.objects.filter(pk=battle.pk, status=Battle.LOBBY).update(status=Battle.QUESTION)
    if not moved:
        raise BattleRefused('started')
    if not battle.players.exists():
        Battle.objects.filter(pk=battle.pk).update(status=Battle.LOBBY)
        raise BattleRefused('no_players')
    battle.refresh_from_db()
    _open(battle, 0)


def reveal(battle, user, index):
    """Show question `index`'s answer — the host any time, anyone once its
    time is up. Taken once, however many ask."""
    battle.refresh_from_db()
    if battle.status != Battle.QUESTION or battle.current != index:
        return False                                          # already moved on
    time_up = (timezone.now() - battle.question_started_at).total_seconds() >= battle.seconds
    in_it = user.pk == battle.host_id or battle.players.filter(user=user).exists()
    if not in_it or (user.pk != battle.host_id and not time_up and not _all_answered(battle)):
        raise BattleRefused('not_yet')
    return _reveal(battle, index)


def _all_answered(battle):
    q = battle.questions.filter(order=battle.current).first()
    return bool(q) and q.answers.count() >= battle.players.count() > 0


def _reveal(battle, index):
    moved = Battle.objects.filter(pk=battle.pk, status=Battle.QUESTION, current=index).update(
        status=Battle.REVEAL, revealed_at=timezone.now())
    if not moved:
        return False
    battle.refresh_from_db()
    q = battle.questions.get(order=index)
    announce(battle, {'type': 'reveal', 'reveal': _reveal_public(battle, q),
                      'last': index + 1 >= battle.questions.count()})
    return True


def advance(battle, user, index):
    """From question `index`'s answer to the next question, or the end — the
    host any time, anyone once the answer has been up a while."""
    battle.refresh_from_db()
    if battle.status != Battle.REVEAL or battle.current != index:
        return False
    held = (timezone.now() - battle.revealed_at).total_seconds() >= REVEAL_HOLD
    in_it = user.pk == battle.host_id or battle.players.filter(user=user).exists()
    if not in_it or (user.pk != battle.host_id and not held):
        raise BattleRefused('not_yet')
    last = index + 1 >= battle.questions.count()
    moved = Battle.objects.filter(pk=battle.pk, status=Battle.REVEAL, current=index).update(
        status=Battle.FINISHED if last else Battle.QUESTION,
        **({'finished_at': timezone.now()} if last else {}),
    )
    if not moved:
        return False
    battle.refresh_from_db()
    if last:
        announce(battle, {'type': 'finished', 'ranking': ranking(battle)})
    else:
        _open(battle, index + 1)
    return True


# ── a player's answer ────────────────────────────────────────────────────────

def answer(battle, user, index, choice):
    """Score a player's answer to the open question → {accepted, all_in}.
    Right or wrong is not told until the answer is shown to everyone."""
    battle.refresh_from_db()
    if battle.status != Battle.QUESTION or battle.current != index:
        raise BattleRefused('closed')
    player = battle.players.filter(user=user).first()
    if not player:
        raise BattleRefused('not_player')
    q = battle.questions.get(order=index)
    elapsed = (timezone.now() - battle.question_started_at).total_seconds()
    if elapsed > battle.seconds + GRACE:
        raise BattleRefused('too_late')
    valid = isinstance(choice, int) and not isinstance(choice, bool) and 0 <= choice < len(q.choices)
    correct = valid and choice == q.answer_index
    speed = max(0.0, 1 - elapsed / battle.seconds)
    points = round(500 + 500 * speed) if correct else 0
    try:
        with transaction.atomic():
            BattleAnswer.objects.create(player=player, question=q, choice=choice if valid else None,
                                        is_correct=correct, points=points, ms=int(elapsed * 1000))
            BattlePlayer.objects.filter(pk=player.pk).update(
                points=F('points') + points, correct=F('correct') + (1 if correct else 0))
    except IntegrityError:
        raise BattleRefused('answered')
    answered = q.answers.count()
    players = battle.players.count()
    announce(battle, {'type': 'progress', 'index': index, 'answered': answered, 'players': players})
    if answered >= players:
        _reveal(battle, index)                   # everyone is in: no need to wait
    return {'accepted': True, 'all_in': answered >= players}

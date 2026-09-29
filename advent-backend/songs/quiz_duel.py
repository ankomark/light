"""Duels: someone else's Speed run, played on exactly the same questions.

A finished Speed run can be sent as a challenge. Whoever opens it plays a
copy of that run — the same ten questions, in the same order, with the same
choices — so the two can be compared answer by answer, not just by total.
It lasts as long as the original run's questions do (practice questions are
pruned after a week), and each person plays a given duel once.
"""
from django.db import transaction

from .models import QuizAnswer, QuizQuestion, QuizSession
from .modes import DUEL, SPEED


class DuelRefused(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def start_duel(user, of_id):
    """A new Duel run on the questions of Speed run `of_id`.

    Raises DuelRefused: `not_found`, `own_duel` (your own run), `not_ready`
    (that run is not finished), `gone` (its questions have been pruned),
    `already_played` (you have played this duel).
    """
    original = QuizSession.objects.filter(pk=of_id, mode=SPEED).select_related('user').first()
    if not original:
        raise DuelRefused('not_found')
    if original.user_id == user.pk:
        raise DuelRefused('own_duel')
    if not original.is_finished:
        raise DuelRefused('not_ready')
    mine = QuizSession.objects.filter(user=user, duel_of=original).first()
    if mine:
        if mine.is_finished:
            raise DuelRefused('already_played')
        return mine                                   # carry on where you left off
    questions = list(original.questions.order_by('order'))
    if not questions:
        raise DuelRefused('gone')
    with transaction.atomic():
        session = QuizSession.objects.create(
            user=user, mode=DUEL, language=original.language, duel_of=original,
        )
        QuizQuestion.objects.bulk_create([
            QuizQuestion(
                session=session, order=q.order, kind=q.kind, difficulty=q.difficulty,
                category=q.category, prompt=q.prompt, passage=q.passage, choices=q.choices,
                answer_index=q.answer_index, reference=q.reference, explanation=q.explanation,
                base_points=q.base_points, bank_question_id=q.bank_question_id,
            )
            for q in questions
        ])
    return session


def _side(session):
    """One player's run: who, the totals, and a mark per question in order
    (True right, False wrong, None unanswered)."""
    answers = dict(QuizAnswer.objects.filter(session=session)
                   .values_list('question__order', 'is_correct'))
    count = max(session.questions.count(), len(answers))
    return {
        'username': session.user.username,
        'score': session.score, 'points': session.points,
        'finished': session.is_finished,
        'marks': [answers.get(i) for i in range(count)],
    }


def comparison(session):
    """The duel side by side, from the challenger's run and this one."""
    original = session.duel_of
    me, them = _side(session), (_side(original) if original else None)
    verdict = None
    if them and session.is_finished:
        verdict = ('won' if me['points'] > them['points']
                   else 'lost' if me['points'] < them['points'] else 'tie')
    return {'me': me, 'them': them, 'verdict': verdict}

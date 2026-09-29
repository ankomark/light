"""Spaced review: what someone got wrong comes back until they know it.

A miss becomes a ReviewItem, due the next day. Each right answer in a Review
run pushes it further out — 3, 7, 14, 30 days — and after the last it is
mastered. A miss at any point starts it over. The spacing is the classic one
for memory: often at first, then rarely, so what is learned stays learned.
"""
import hashlib
import random
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .models import QuizQuestion, ReviewItem

# Days until the next ask, after a miss (step 0) and after each right answer.
INTERVALS = [1, 3, 7, 14, 30]
PER_RUN = 10


class NothingDue(Exception):
    """A Review run was asked for with nothing waiting."""


def _key(question):
    """The same question, however it was asked: a written one by its bank id,
    a generated one by what it asks about."""
    if question.bank_question_id:
        return f'bank:{question.bank_question_id}'
    raw = f'{question.kind}|{question.reference}|{question.passage}|{question.prompt}'
    return 'gen:' + hashlib.sha256(raw.encode('utf-8')).hexdigest()[:40]


def note_miss(user, question, language='en', today=None):
    """A wrong (or skipped) answer: into review, due tomorrow — or, if it was
    already there, back to the start."""
    today = today or timezone.localdate()
    due = today + timedelta(days=INTERVALS[0])
    item, created = ReviewItem.objects.get_or_create(
        user=user, source_key=_key(question),
        defaults=dict(
            language=language, kind=question.kind, difficulty=question.difficulty,
            category=question.category, prompt=question.prompt, passage=question.passage,
            choices=question.choices, answer_index=question.answer_index,
            reference=question.reference, explanation=question.explanation,
            bank_question_id=question.bank_question_id, step=0, due_on=due,
        ),
    )
    if not created:
        ReviewItem.objects.filter(pk=item.pk).update(step=0, due_on=due, mastered_at=None)


def note_review(item_id, correct, today=None):
    """An answer in a Review run: out to the next interval, mastered after the
    last, or back to the start on a miss."""
    today = today or timezone.localdate()
    item = ReviewItem.objects.filter(pk=item_id).first()
    if not item:
        return
    if not correct:
        item.step, item.due_on, item.mastered_at = 0, today + timedelta(days=INTERVALS[0]), None
    else:
        item.step += 1
        if item.step >= len(INTERVALS):
            item.mastered_at = timezone.now()
        else:
            item.due_on = today + timedelta(days=INTERVALS[item.step])
    item.save(update_fields=['step', 'due_on', 'mastered_at', 'updated_at'])


def due_items(user, language='en', today=None):
    today = today or timezone.localdate()
    return ReviewItem.objects.filter(
        user=user, language=language, mastered_at__isnull=True, due_on__lte=today,
    )


def due_count(user, language=None, today=None):
    qs = ReviewItem.objects.filter(
        user=user, mastered_at__isnull=True, due_on__lte=today or timezone.localdate(),
    )
    return qs.filter(language=language).count() if language else qs.count()


def start_review(user, language='en'):
    """A Review run: up to ten of the questions due, the longest-waiting first,
    each asked again with its answers in a new order."""
    from .models import QuizSession
    from .modes import REVIEW
    from .scoring import base_points_for

    items = list(due_items(user, language).order_by('due_on', 'step', 'id')[:PER_RUN])
    if not items:
        raise NothingDue()
    rng = random.Random()
    with transaction.atomic():
        session = QuizSession.objects.create(user=user, mode=REVIEW, language=language)
        rows = []
        for i, item in enumerate(items):
            order = list(range(len(item.choices)))
            if item.kind != 'true_false':
                rng.shuffle(order)
            rows.append(QuizQuestion(
                session=session, order=i, kind=item.kind, difficulty=item.difficulty,
                category=item.category, prompt=item.prompt, passage=item.passage,
                choices=[item.choices[j] for j in order], answer_index=order.index(item.answer_index),
                reference=item.reference, explanation=item.explanation,
                base_points=base_points_for(item.difficulty),
                bank_question_id=item.bank_question_id, review_item=item,
            ))
        QuizQuestion.objects.bulk_create(rows)
    return session

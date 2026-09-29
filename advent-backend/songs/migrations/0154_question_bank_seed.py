"""Load the question bank's starting set (songs/quiz_bank_seed.py).

Only into an empty English bank: after this the bank is edited in the admin,
and a re-run must never bring back a question someone deleted or duplicate
one they changed.
"""
from django.db import migrations


def load(apps, schema_editor):
    BankQuestion = apps.get_model('songs', 'BankQuestion')
    if BankQuestion.objects.filter(language='en').exists():
        return
    from songs.quiz_bank_seed import SEED
    BankQuestion.objects.bulk_create([
        BankQuestion(
            kind=q['kind'], language='en', difficulty=q['difficulty'], category=q['category'],
            prompt=q['prompt'], choices=q['choices'], answer_index=q['answer'],
            explanation=q['explanation'], reference=q['reference'],
        )
        for q in SEED
    ])


def unload(apps, schema_editor):
    """Nothing to undo: the table itself goes with 0153."""


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0153_question_bank'),
    ]

    operations = [
        migrations.RunPython(load, unload),
    ]

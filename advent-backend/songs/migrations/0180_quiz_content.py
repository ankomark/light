"""Load the story journey and the bank's second set (songs/quiz_bank_seed_more.py).

Additive only: a story whose slug is already there, or a question whose prompt
is already in the bank in that language with the same answers, is left as an
admin made it.
"""
from django.db import migrations


def load(apps, schema_editor):
    BankQuestion = apps.get_model('songs', 'BankQuestion')
    StoryPack = apps.get_model('songs', 'StoryPack')
    from songs.quiz_bank_seed_more import SEED_EN, SEED_SW, STORY_PACKS

    for language, seed in (('en', SEED_EN), ('sw', SEED_SW)):
        # The same question is the same prompt with the same answers: "Which
        # happened first?" is the prompt of many different questions.
        have = {(p, tuple(c)) for p, c in
                BankQuestion.objects.filter(language=language).values_list('prompt', 'choices')}
        BankQuestion.objects.bulk_create([
            BankQuestion(
                kind=q['kind'], language=language, difficulty=q['difficulty'], category=q['category'],
                prompt=q['prompt'], choices=q['choices'], answer_index=q['answer'],
                explanation=q['explanation'], reference=q['reference'],
            )
            for q in seed if (q['prompt'], tuple(q['choices'])) not in have
        ])

    have = set(StoryPack.objects.values_list('slug', flat=True))
    StoryPack.objects.bulk_create([
        StoryPack(slug=slug, title=title, title_sw=title_sw, book_number=book,
                  chapter_start=first, chapter_end=last, summary=summary, summary_sw=summary_sw,
                  icon=icon, order=(i + 1) * 10)
        for i, (slug, title, title_sw, book, first, last, summary, summary_sw, icon) in enumerate(STORY_PACKS)
        if slug not in have
    ])


def unload(apps, schema_editor):
    """Nothing to undo: the stories' table goes with 0179, and the bank's
    rows may have been edited since."""


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0179_quiz_overhaul'),
    ]

    operations = [
        migrations.RunPython(load, unload),
    ]

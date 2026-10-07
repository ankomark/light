"""The quiz in Swahili: built from the imported NENO text, falling back to
English when it is not there, and still once a day across both.

    python manage.py test songs.tests.test_quiz_languages --settings=music.settings_test
"""
from unittest.mock import patch

from django.core.cache import cache
from django.core.management import call_command
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from songs.bible_books import BOOKS_BY_NAME
from songs.models import BibleText, BibleVerse, DailyQuiz, QuizAttempt, User
from songs.quiz import SWAHILI, corpus_for, generate_for_date
from songs.streaks import forget_recorded_plays
from songs.tests.test_quiz import seed_corpus

SW_VARIED = ['mlima', 'mto', 'mchungaji', 'bustani', 'hekalu', 'mavuno', 'shamba',
             'mtumishi', 'nabii', 'ufalme', 'jangwa', 'chemchemi']
SW_NAMES = {'Genesis': 'Mwanzo', 'Psalms': 'Zaburi', 'Proverbs': 'Methali', 'John': 'Yohana', 'Acts': 'Matendo'}


def seed_swahili(chapters=12, verses=30):
    """A Swahili corpus shaped like the English test one: enough for a full quiz."""
    from songs.quiz import forget_kept_corpora
    forget_kept_corpora()          # another test's Bible must not linger
    rows = []
    for english, name in SW_NAMES.items():
        book = BOOKS_BY_NAME[english]
        for ch in range(1, min(chapters, book['chapters']) + 1):
            for v in range(1, verses + 1):
                rows.append(BibleText(
                    version='swh_bib', book=name, book_number=book['number'], chapter=ch, verse=v,
                    text=(f'Ikawa katika {name} sura {ch} mstari {v} watu wakakusanyika '
                          f'kando ya {SW_VARIED[(ch * 5 + v) % 12]} wakalibariki '
                          f'{SW_VARIED[(ch * 5 + v + 5) % 12]} la milele daima.'),
                ))
    BibleText.objects.bulk_create(rows, ignore_conflicts=True)


class ImportTests(APITestCase):
    BOOKS = {'books': [
        {'id': 'GEN', 'commonName': 'Mwanzo', 'numberOfChapters': 2},
        {'id': 'XYZ', 'commonName': 'Not a book', 'numberOfChapters': 1},    # skipped
    ]}

    def chapter(self, n):
        return {'chapter': {'content': [
            {'type': 'heading', 'content': ['Uumbaji']},
            {'type': 'verse', 'number': 1, 'content': ['Hapo mwanzo', {'noteId': 3}, {'text': 'Mungu aliumba'}, {'lineBreak': True}]},
            {'type': 'verse', 'number': 2, 'content': [f'Sura {n} ¶ mstari wa pili']},
        ]}}

    def fake(self, url):
        if url.endswith('books.json'):
            return self.BOOKS
        return self.chapter(int(url.rsplit('/', 1)[1].split('.')[0]))

    def test_it_imports_each_chapter_as_plain_text(self):
        with patch('songs.management.commands.import_bible_version.get_json', side_effect=self.fake):
            call_command('import_bible_version', 'swh_bib', pause=0, verbosity=0)
        rows = BibleText.objects.filter(version='swh_bib').order_by('chapter', 'verse')
        self.assertEqual(rows.count(), 4)
        first = rows.first()
        self.assertEqual((first.book, first.book_number, first.chapter, first.verse), ('Mwanzo', 1, 1, 1))
        self.assertEqual(first.text, 'Hapo mwanzo Mungu aliumba')
        self.assertEqual(rows.last().text, 'Sura 2 mstari wa pili')
        self.assertEqual(first.reference, 'Mwanzo 1:1')

    def test_a_second_run_only_fetches_what_is_missing(self):
        with patch('songs.management.commands.import_bible_version.get_json', side_effect=self.fake):
            call_command('import_bible_version', 'swh_bib', pause=0, verbosity=0)
        with patch('songs.management.commands.import_bible_version.get_json', side_effect=self.fake) as net:
            call_command('import_bible_version', 'swh_bib', pause=0, verbosity=0)
        self.assertEqual(net.call_count, 1)                      # the book list only
        self.assertEqual(BibleText.objects.count(), 4)

    def test_it_never_touches_the_kjv(self):
        with patch('songs.management.commands.import_bible_version.get_json', side_effect=self.fake):
            call_command('import_bible_version', 'swh_bib', pause=0, verbosity=0)
        self.assertFalse(BibleVerse.objects.exists())


class SwahiliQuizTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        seed_corpus()
        seed_swahili()

    def setUp(self):
        cache.clear()
        forget_recorded_plays()
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)
        self.today = timezone.localdate()

    def test_a_swahili_quiz_is_built_from_the_swahili_bible(self):
        quiz = generate_for_date(self.today, language='sw')
        self.assertEqual(quiz.language, 'sw')
        self.assertEqual(quiz.questions.count(), 20)
        generated = quiz.questions.filter(bank_question__isnull=True)
        english_books = set(SW_NAMES)
        for q in generated:
            # Every prompt in Swahili, every reference a Swahili book name.
            if '{book}' in SWAHILI.prompts[q.kind]:
                book = q.reference.rsplit(' ', 1)[0]
                self.assertEqual(q.prompt, SWAHILI.prompt(q.kind, book=book), q.prompt)
            else:
                self.assertEqual(q.prompt, SWAHILI.prompts[q.kind])
            self.assertIn(q.reference.split(' ')[0], SW_NAMES.values(), q.reference)
            if q.kind == 'book':
                self.assertFalse(english_books & set(q.choices), q.choices)

    def test_english_and_swahili_are_separate_quizzes_the_same_day(self):
        en = generate_for_date(self.today, language='en')
        sw = generate_for_date(self.today, language='sw')
        self.assertNotEqual(en.pk, sw.pk)
        self.assertEqual(DailyQuiz.objects.filter(date=self.today).count(), 2)

    def test_the_app_asks_for_swahili_and_gets_it(self):
        res = self.client.get('/api/quiz/today/?lang=sw')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['language'], 'sw')

    def test_once_a_day_whichever_language(self):
        questions = self.client.get('/api/quiz/today/?lang=sw').data['questions']
        res = self.client.post('/api/quiz/submit/',
                               {'shuffled': False, 'answers': {str(q['id']): 0 for q in questions}, 'language': 'sw'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content[:200])
        again = self.client.post('/api/quiz/submit/', {'shuffled': False, 'answers': {}, 'language': 'en'}, format='json')
        self.assertEqual(again.data['code'], 'already_played')
        # Asking for English now brings back the Swahili quiz that was played, with its review.
        today = self.client.get('/api/quiz/today/?lang=en').data
        self.assertEqual(today['language'], 'sw')
        self.assertEqual(len(today['my_attempt']['results']), 20)

    def test_todays_board_counts_both_languages(self):
        other = User.objects.create_user('ivy', 'i@x.com', 'pw12345!')
        QuizAttempt.objects.create(user=self.user, quiz=generate_for_date(self.today, language='sw'), score=5, total=20, points=50)
        QuizAttempt.objects.create(user=other, quiz=generate_for_date(self.today, language='en'), score=9, total=20, points=90)
        board = self.client.get('/api/quiz/leaderboard/').data
        self.assertEqual([r['user']['username'] for r in board['results']], ['ivy', 'mark'])
        self.assertEqual(board['me'], {'rank': 2, 'of': 2})

    def test_practice_in_swahili(self):
        res = self.client.post('/api/quiz-sessions/', {'mode': 'speed', 'language': 'sw'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content[:200])
        prompts = {q['prompt'] for q in res.data['questions']}
        self.assertTrue(prompts & {SWAHILI.prompts['book'], SWAHILI.prompts['blank']}, prompts)


class FallbackTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        seed_corpus()                                            # English only

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)

    def test_without_the_swahili_bible_a_swahili_speaker_gets_english(self):
        self.assertIs(corpus_for('sw').language, 'en')
        res = self.client.get('/api/quiz/today/?lang=sw')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['language'], 'en')

    def test_an_unknown_language_is_english(self):
        self.assertEqual(self.client.get('/api/quiz/today/?lang=xx').data['language'], 'en')

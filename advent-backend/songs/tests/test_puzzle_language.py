"""The word puzzle in Swahili, and what a found word means.

    python manage.py test songs.tests.test_puzzle_language
"""
from unittest.mock import patch

from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APITestCase

from songs import quiz_ai
from songs.bible_books import BOOKS_BY_NAME
from songs.models import BibleText, BibleWord, PuzzleProgress, PuzzleTheme, User, WordPuzzle
from songs.puzzle import generate, reset_dictionary, reset_theme_words
from songs.tests.test_puzzle import seed_corpus

SW_LINES = [
    'Bwana ndiye mchungaji wangu amani yake ni mana kwangu',
    'Amina nia yake ina amani na ana mana',
    'Ama kwa amani ama kwa nia njema',
]
SW_WORDS = ['AMANI', 'AMINA', 'MANA', 'NIA', 'INA', 'ANA', 'AMA', 'BWANA', 'NDIYE', 'WANGU', 'KWANGU']


def seed_swahili():
    """A few verses of Zaburi 23 in the Swahili Bible, and its word index."""
    BibleText.objects.bulk_create([
        BibleText(version='swh_bib', book='Zaburi', book_number=BOOKS_BY_NAME['Psalms']['number'],
                  chapter=23, verse=i, text=text)
        for i, text in enumerate(SW_LINES, start=1)
    ], ignore_conflicts=True)
    BibleWord.objects.bulk_create([
        BibleWord(word=w, language='sw', length=len(w), letters=''.join(sorted(w)), frequency=300)
        for w in SW_WORDS
    ], ignore_conflicts=True)
    reset_dictionary()


class SwahiliPuzzleTests(APITestCase):
    """The puzzle in Swahili, spelled from the Swahili Bible."""

    @classmethod
    def setUpTestData(cls):
        seed_corpus()
        seed_swahili()
        PuzzleTheme.objects.update(is_active=False)
        cls.theme = PuzzleTheme.objects.create(
            name='Psalm 23 sw', slug='psalm-23-sw', order=1, name_sw='Zaburi 23',
            source={'kind': 'passage', 'book': 'Psalms', 'chapter': 23},
        )

    def setUp(self):
        cache.clear()
        reset_theme_words()
        reset_dictionary()
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)

    def test_a_swahili_board_is_spelled_from_swahili_words(self):
        res = self.client.get('/api/puzzles/next/?lang=sw')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['language'], 'sw')
        self.assertEqual(res.data['theme']['name'], 'Zaburi 23')
        puzzle = WordPuzzle.objects.get(pk=res.data['id'])
        self.assertTrue(set(puzzle.words) <= set(SW_WORDS))
        self.assertEqual(sorted(puzzle.letters), sorted('AMANI'))

    def test_each_language_has_its_own_levels(self):
        en = self.client.get(f'/api/puzzles/level/?theme={self.theme.slug}&level=1').data
        sw = self.client.get(f'/api/puzzles/level/?theme={self.theme.slug}&level=1&lang=sw').data
        self.assertNotEqual(en['id'], sw['id'])
        self.assertEqual(en['language'], 'en')
        self.assertEqual(en['theme']['name'], 'Psalm 23 sw')

    def test_the_finished_swahili_board_reveals_a_swahili_verse(self):
        res = self.client.get('/api/puzzles/next/?lang=sw')
        puzzle = WordPuzzle.objects.get(pk=res.data['id'])
        for w in puzzle.words:
            last = self.client.post(f'/api/puzzles/{puzzle.id}/found/', {'word': w}, format='json')
        verse = last.data['verse']
        self.assertTrue(verse['reference'].startswith('Zaburi 23:'))
        self.assertEqual(verse['book_number'], BOOKS_BY_NAME['Psalms']['number'])

    def test_the_themes_list_in_swahili(self):
        res = self.client.get('/api/puzzle-themes/?lang=sw')
        row = next(t for t in res.data if t['slug'] == self.theme.slug)
        self.assertEqual(row['name'], 'Zaburi 23')

    def test_a_topic_with_no_swahili_word_is_not_offered_in_swahili(self):
        PuzzleTheme.objects.create(name='Hope t', slug='hope-t', order=2,
                                   source={'kind': 'topic', 'term': 'hope'})
        slugs = [t['slug'] for t in self.client.get('/api/puzzle-themes/?lang=sw').data]
        self.assertNotIn('hope-t', slugs)
        slugs = [t['slug'] for t in self.client.get('/api/puzzle-themes/').data]
        self.assertIn('hope-t', slugs)

    def test_without_the_swahili_bible_it_is_english(self):
        BibleWord.objects.filter(language='sw').delete()
        cache.clear()
        res = self.client.get('/api/puzzles/next/?lang=sw')
        self.assertEqual(res.data['language'], 'en')

    @patch('songs.puzzle.DAILY_LEVEL', 1)     # the fixture spells five-letter wheels only
    def test_the_swahili_daily_board_is_its_own(self):
        en = self.client.get('/api/puzzles/daily/').data
        sw = self.client.get('/api/puzzles/daily/?lang=sw').data
        self.assertNotEqual(en['id'], sw['id'])
        self.assertEqual(sw['language'], 'sw')


@override_settings(ANTHROPIC_API_KEY='test-key', AI_DAILY_LIMIT=3, AI_QUIZ_MODEL='claude-opus-5-5')
class WordMeaningTests(APITestCase):
    """What a found word means: the glossary, else Claude, kept for everyone."""

    @classmethod
    def setUpTestData(cls):
        seed_corpus()
        cls.theme = PuzzleTheme.objects.create(
            name='Psalm 23 meanings', slug='psalm-23-meanings',
            source={'kind': 'passage', 'book': 'Psalms', 'chapter': 23},
        )

    def setUp(self):
        cache.clear()
        reset_theme_words()
        reset_dictionary()
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)
        WordPuzzle.objects.all().delete()
        self.puzzle = generate(self.theme, 1, force=True)
        self.word = self.puzzle.placements[0]['word']

    def _ask(self, word, language='en'):
        return self.client.post(f'/api/puzzles/{self.puzzle.id}/meaning/',
                                {'word': word, 'language': language}, format='json')

    def _find(self, word):
        self.client.post(f'/api/puzzles/{self.puzzle.id}/found/', {'word': word}, format='json')

    def test_only_a_word_already_found(self):
        with patch.object(quiz_ai, '_ask') as ask:
            res = self._ask(self.word)
        self.assertEqual(res.status_code, 403)
        ask.assert_not_called()

    def test_a_glossary_word_is_answered_without_the_ai(self):
        PuzzleProgress.objects.create(user=self.user, puzzle=self.puzzle, bonus=['SMOTE'])
        with patch.object(quiz_ai, '_ask') as ask:
            en = self._ask('smote')
            sw = self._ask('SMOTE', 'sw')
        ask.assert_not_called()
        self.assertEqual(en.data['source'], 'glossary')
        self.assertEqual(en.data['meaning'], 'struck; hit hard')
        self.assertEqual(sw.data['meaning'], 'alipiga')

    def test_any_other_word_is_explained_once_for_everyone(self):
        self._find(self.word)
        with patch.object(quiz_ai, '_ask', return_value=('A path is a way.', 'claude-opus-5-5')) as ask:
            first = self._ask(self.word)
            other = User.objects.create_user('ivy', 'i@x.com', 'pw12345!')
            PuzzleProgress.objects.create(user=other, puzzle=self.puzzle, found=[self.word])
            self.client.force_authenticate(other)
            second = self._ask(self.word)
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(first.data['meaning'], 'A path is a way.')
        self.assertEqual(first.data['source'], 'ai')
        self.assertEqual(second.data['meaning'], 'A path is a way.')
        self.assertEqual(ask.call_count, 1)
        # Given a verse the word is really in.
        self.assertIn(self.word.lower(), ask.call_args[0][1].lower())
        self.assertIsNotNone(first.data['reference'])

    @override_settings(ANTHROPIC_API_KEY='')
    def test_without_ai_it_says_so_at_once(self):
        """No verse is looked for first: that search took seconds on the real
        database, only to be thrown away."""
        from songs import puzzle_words
        self._find(self.word)
        with patch.object(puzzle_words, '_example') as example:
            res = self._ask(self.word)
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.data['code'], 'ai_off')
        example.assert_not_called()

    @override_settings(ANTHROPIC_API_KEY='')
    def test_without_ai_the_glossary_still_answers(self):
        PuzzleProgress.objects.create(user=self.user, puzzle=self.puzzle, bonus=['SMOTE'])
        res = self._ask('SMOTE')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['source'], 'glossary')

    def test_the_example_is_the_boards_own_verse_when_it_has_the_word(self):
        from songs import puzzle_words
        verse = self.puzzle.verse
        word = next(w for w in self.puzzle.words if w.lower() in verse.text.lower())
        self.assertEqual(puzzle_words._example(self.puzzle, word)[0], verse.reference)

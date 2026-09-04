"""The word-connect puzzle: letters, answers, layout and the coin economy.

    python manage.py test songs.tests.test_puzzle
"""
from collections import Counter
from datetime import timedelta

from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from songs.bible_books import BOOKS_BY_NAME
from songs.streaks import forget_recorded_plays
from songs.models import (
    BibleVerse, BibleWord, CoinSpend, PuzzleProgress, PuzzleTheme, QuizAttempt,
    User, WordPuzzle,
)
from songs.puzzle import _theme_words, reset_theme_words
from songs.puzzle import (
    build_layout, choose_for, generate, reset_dictionary, words_from,
)
from songs.scoring import (
    COINS_PER_BONUS_WORD, COINS_PER_WORD, HINT_COST, coin_balance, completion_bonus,
)

LINES = [
    'The LORD is my shepherd I shall not want',
    'He maketh me to lie down in green pastures beside the still waters',
    'He restoreth my soul he leadeth me in the paths of righteousness',
    'Though I walk through the valley of the shadow of death',
    'Thy rod and thy staff they comfort me before mine enemies',
    'Surely goodness and mercy shall follow me all the days of my life',
    'And I will dwell in the house of the LORD for ever and ever',
    'Thou anointest my head with oil my cup runneth over and past',
    'The paths are set and the path is sure and the past is done',
    'A sat apt path past paths taps spat stop pots opts',
]


def seed_corpus():
    """A passage plus the word index the puzzle spells its answers from."""
    book = BOOKS_BY_NAME['Psalms']
    BibleVerse.objects.bulk_create(
        [
            BibleVerse(book='Psalms', book_number=book['number'], chapter=23,
                       verse=i, text=text)
            for i, text in enumerate(LINES, start=1)
        ],
        ignore_conflicts=True,
    )
    # The dictionary is scripture's own vocabulary; build it the way the
    # command does, without the frequency floor a tiny fixture cannot meet.
    counts = Counter()
    for text in LINES:
        for raw in text.split():
            word = ''.join(ch for ch in raw if ch.isalpha()).upper()
            if 3 <= len(word) <= 9:
                counts[word] += 1
    rows = [
        # Scaled past ANSWER_MIN_FREQUENCY: a ten-line fixture cannot reach the
        # real corpus's counts, and the point here is the puzzle logic, not the
        # frequency of a word in ten verses.
        BibleWord(word=w, length=len(w), letters=''.join(sorted(w)), frequency=n * 40)
        for w, n in counts.items()
    ]
    # One rare word, to prove the frequency floor keeps proper nouns out.
    rows.append(BibleWord(word='TAHPATH', length=7, letters=''.join(sorted('TAHPATH')),
                          frequency=1))
    BibleWord.objects.bulk_create(rows, ignore_conflicts=True)
    reset_dictionary()


# A corpus wide enough to prove the game keeps changing.
#
# The ten-line Psalm 23 fixture has exactly one viable wheel, so every level it
# builds is the same letters reshuffled — it cannot tell a generator that has
# run out from one that has not. These are real KJV words, chosen so that
# several different bases each spell a boardful of shorter ones.
WIDE_WORDS = """
PRAISE RAISE SPARE SPEAR PEARS EARS SEA AIR ARE RISE SIR APE PEA SAP ASP RAP
PAR PIE RIP IRE
MASTER STREAM MEATS TEARS STARE TEAM MEAT SEAT EAST RATE TEAR STAR ARMS RAM ARM
ERA MAT RAT SAT TAR EAT ATE TEA MET SET REST MAST TAME MATE SAME SEAM
SERVANT SERVE NEVER SEVEN VAST EARN NEAR STERN RENTS ANTS TAN VAN ART TEN NET
VET EVER EVEN NEST VENT RENT SENT
GLADNESS GLAD SANDS LANDS LEADS DEALS ANGELS ANGEL LEGS ENDS LEND LAND SAND
LEAD DEAL LADS GLEAN AGES SAGE
KINGDOM KING KIND MIND GOD DOG DIM DIG KID NOD DEN
""".split()


def seed_wide_corpus():
    """The wide word index, plus verses to hang a theme on."""
    book = BOOKS_BY_NAME['Psalms']
    BibleVerse.objects.bulk_create(
        [
            BibleVerse(book='Psalms', book_number=book['number'], chapter=119,
                       verse=i, text=' '.join(WIDE_WORDS[i * 6:(i + 1) * 6]).lower())
            for i in range(len(WIDE_WORDS) // 6)
        ],
        ignore_conflicts=True,
    )
    BibleWord.objects.bulk_create(
        [
            BibleWord(word=w, length=len(w), letters=''.join(sorted(w)), frequency=300)
            for w in sorted(set(WIDE_WORDS))
        ],
        ignore_conflicts=True,
    )
    reset_dictionary()


class WordsFromTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        seed_corpus()

    def setUp(self):
        cache.clear()
        forget_recorded_plays()
        reset_theme_words()
        reset_dictionary()

    def test_only_words_the_letters_can_spell_come_back(self):
        for word in words_from('PATHS'):
            self.assertFalse(Counter(word) - Counter('PATHS'), word)

    def test_a_letter_cannot_be_used_more_often_than_it_appears(self):
        """One S cannot spell a word needing two."""
        self.assertNotIn('PASS', words_from('PATHS'))

    def test_answers_are_scripture_vocabulary(self):
        known = set(BibleWord.objects.values_list('word', flat=True))
        for word in words_from('PATHS'):
            self.assertIn(word, known)

    def test_a_rare_word_is_never_an_answer(self):
        """Scripture is full of names — real words, unfair answers. The
        frequency floor is what keeps TAHPATH out of a puzzle."""
        self.assertNotIn('TAHPATH', words_from('TAHPATH'))

    def test_longest_first(self):
        found = words_from('PATHS')
        self.assertEqual(found, sorted(found, key=lambda w: (-len(w), w)))


class PuzzleGenerationTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        seed_corpus()
        cls.theme = PuzzleTheme.objects.create(
            name='Psalm 23 test', slug='psalm-23-test',
            source={'kind': 'passage', 'book': 'Psalms', 'chapter': 23},
        )

    def setUp(self):
        cache.clear()
        forget_recorded_plays()
        reset_theme_words()
        reset_dictionary()

    def test_a_level_has_letters_and_interlocking_answers(self):
        puzzle = generate(self.theme, 1, force=True)
        self.assertTrue(puzzle.letters)
        self.assertGreaterEqual(len(puzzle.placements), 4)

    def test_every_answer_is_spellable_from_the_wheel(self):
        """The whole mechanic depends on this."""
        puzzle = generate(self.theme, 1, force=True)
        for p in puzzle.placements:
            self.assertFalse(Counter(p['word']) - Counter(puzzle.letters), p['word'])

    def test_the_grid_reads_back_every_answer(self):
        puzzle = generate(self.theme, 1, force=True)
        for p in puzzle.placements:
            letters = ''.join(
                puzzle.grid[p['row'] + (i if p['dir'] == 'down' else 0)]
                           [p['col'] + (i if p['dir'] == 'across' else 0)]
                for i in range(len(p['word']))
            )
            self.assertEqual(letters, p['word'], p)

    def test_the_words_interlock(self):
        """A crossword, not a list — every word after the first must cross one."""
        puzzle = generate(self.theme, 1, force=True)
        occupied = {}
        for p in puzzle.placements[:1]:
            for i in range(len(p['word'])):
                r = p['row'] + (i if p['dir'] == 'down' else 0)
                c = p['col'] + (i if p['dir'] == 'across' else 0)
                occupied[(r, c)] = True
        for p in puzzle.placements[1:]:
            cells = [
                (p['row'] + (i if p['dir'] == 'down' else 0),
                 p['col'] + (i if p['dir'] == 'across' else 0))
                for i in range(len(p['word']))
            ]
            self.assertTrue(any(cell in occupied for cell in cells), p)
            for cell in cells:
                occupied[cell] = True

    def test_the_board_starts_at_the_origin(self):
        puzzle = generate(self.theme, 1, force=True)
        self.assertEqual(min(p['row'] for p in puzzle.placements), 0)
        self.assertEqual(min(p['col'] for p in puzzle.placements), 0)

    def test_the_same_level_is_the_same_puzzle(self):
        first = generate(self.theme, 2, force=True)
        grid, placements, letters = first.grid, first.placements, first.letters
        again = generate(self.theme, 2, force=True)
        self.assertEqual((again.grid, again.placements, again.letters),
                         (grid, placements, letters))

    def test_a_theme_with_no_usable_words_fails_loudly(self):
        empty = PuzzleTheme.objects.create(
            name='Nothing', slug='nothing', source={'kind': 'topic', 'term': 'zzzznotaword'},
        )
        with self.assertRaises(ValueError):
            generate(empty, 1)

    def test_layout_never_contradicts_a_placed_letter(self):
        import random
        placements, board = build_layout(['PATHS', 'PAST', 'APT'], random.Random(3))
        for p in placements:
            for i, letter in enumerate(p['word']):
                r = p['row'] + (i if p['dir'] == 'down' else 0)
                c = p['col'] + (i if p['dir'] == 'across' else 0)
                self.assertEqual(board[(r, c)], letter)


class PuzzleApiTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        seed_corpus()
        cls.theme = PuzzleTheme.objects.create(
            name='Psalm 23 test', slug='psalm-23-test',
            source={'kind': 'passage', 'book': 'Psalms', 'chapter': 23},
        )

    def setUp(self):
        cache.clear()
        forget_recorded_plays()
        reset_theme_words()
        reset_dictionary()
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)
        WordPuzzle.objects.all().delete()
        self.puzzle = generate(self.theme, 1, force=True)

    def _rich(self, coins=500):
        from datetime import date
        from songs.models import DailyQuiz
        quiz = DailyQuiz.objects.create(date=date(2026, 1, 1))
        QuizAttempt.objects.create(user=self.user, quiz=quiz, score=1, total=1, points=coins)

    def _submit(self, word):
        return self.client.post(
            f'/api/puzzles/{self.puzzle.id}/found/', {'word': word}, format='json',
        )

    # ── the board ────────────────────────────────────────────────────────────
    def test_a_level_loads_with_its_letters(self):
        res = self.client.get(f'/api/puzzles/level/?theme={self.theme.slug}&level=1')
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.content[:300])
        self.assertTrue(res.data['letters'])
        self.assertTrue(res.data['slots'])

    def test_the_answers_are_never_sent(self):
        """The board's shape goes out; the words in it do not."""
        res = self.client.get(f'/api/puzzles/level/?theme={self.theme.slug}&level=1')
        self.assertNotIn('placements', res.data)
        self.assertNotIn('grid', res.data)
        self.assertEqual(res.data['revealed'], [])
        # The layout may only say where a tile is, never which letter.
        for row in res.data['layout']:
            self.assertTrue(set(row) <= {'#', '.'}, row)

    def test_slots_say_where_and_how_long_but_not_what(self):
        res = self.client.get(f'/api/puzzles/level/?theme={self.theme.slug}&level=1')
        for slot in res.data['slots']:
            self.assertEqual(set(slot), {'length', 'row', 'col', 'dir'})

    # ── playing ──────────────────────────────────────────────────────────────
    def test_a_correct_word_is_accepted_and_paid(self):
        word = self.puzzle.placements[0]['word']
        res = self._submit(word)
        self.assertTrue(res.data['correct'])
        self.assertEqual(res.data['coins_earned'], COINS_PER_WORD)
        self.assertIn('placement', res.data)

    def test_lowercase_is_accepted(self):
        word = self.puzzle.placements[0]['word']
        self.assertTrue(self._submit(word.lower()).data['correct'])

    def test_a_word_the_wheel_cannot_spell_is_rejected(self):
        res = self._submit('ZEBRA')
        self.assertFalse(res.data['correct'])
        self.assertEqual(res.data['coins_earned'], 0)

    def test_a_real_word_that_is_not_an_answer_is_a_calm_no(self):
        letters = self.puzzle.letters
        answers = {p['word'] for p in self.puzzle.placements}
        # A word from the wheel's letters that this level does not use.
        other = next(
            (w for w in words_from(letters) if w not in answers), None,
        )
        if other:
            res = self._submit(other)
            self.assertEqual(res.status_code, status.HTTP_200_OK)
            self.assertFalse(res.data['correct'])

    def test_the_same_word_pays_once(self):
        word = self.puzzle.placements[0]['word']
        self._submit(word)
        res = self._submit(word)
        self.assertTrue(res.data['already_found'])
        self.assertEqual(res.data['coins_earned'], 0)

    def test_finishing_pays_the_completion_bonus(self):
        for p in self.puzzle.placements:
            res = self._submit(p['word'])
        self.assertTrue(res.data['is_complete'])
        self.assertEqual(res.data['completion_bonus'], completion_bonus(self.puzzle.level))

    def test_the_bonus_is_paid_only_once(self):
        for p in self.puzzle.placements:
            self._submit(p['word'])
        progress = PuzzleProgress.objects.get(user=self.user, puzzle=self.puzzle)
        expected = COINS_PER_WORD * len(self.puzzle.placements) + completion_bonus(1)
        for p in self.puzzle.placements:
            self._submit(p['word'])
        progress.refresh_from_db()
        self.assertEqual(progress.coins_earned, expected)

    def test_progress_is_private(self):
        other = User.objects.create_user('ivy', 'i@x.com', 'pw12345!')
        self._submit(self.puzzle.placements[0]['word'])
        self.client.force_authenticate(other)
        res = self.client.get(f'/api/puzzles/level/?theme={self.theme.slug}&level=1')
        self.assertEqual(res.data['found'], [])

    def test_signing_in_is_required(self):
        self.client.force_authenticate(None)
        res = self.client.get(f'/api/puzzles/level/?theme={self.theme.slug}&level=1')
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    # ── coins ────────────────────────────────────────────────────────────────
    def test_a_hint_costs_coins_and_reveals_a_word(self):
        self._rich()
        before = coin_balance(self.user)[2]
        res = self.client.post(f'/api/puzzles/{self.puzzle.id}/hint/', {}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.content[:200])
        self.assertEqual(res.data['balance'], before - HINT_COST)

    def test_a_hint_is_written_to_the_ledger(self):
        self._rich()
        self.client.post(f'/api/puzzles/{self.puzzle.id}/hint/', {}, format='json')
        spend = CoinSpend.objects.get(user=self.user)
        self.assertEqual(spend.amount, HINT_COST)
        self.assertEqual(spend.puzzle, self.puzzle)

    def test_a_hint_is_refused_without_the_coins(self):
        res = self.client.post(f'/api/puzzles/{self.puzzle.id}/hint/', {}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(CoinSpend.objects.exists())

    def test_a_paid_hint_survives_a_reload(self):
        self._rich()
        hinted = self.client.post(
            f'/api/puzzles/{self.puzzle.id}/hint/', {}, format='json').data
        res = self.client.get(f'/api/puzzles/level/?theme={self.theme.slug}&level=1')
        self.assertIn(hinted['word'], [r['word'] for r in res.data['revealed']])

    def test_the_wallet_reconciles(self):
        self._rich(coins=300)
        self._submit(self.puzzle.placements[0]['word'])
        self.client.post(f'/api/puzzles/{self.puzzle.id}/hint/', {}, format='json')
        res = self.client.get('/api/puzzles/wallet/')
        self.assertEqual(res.data['earned'], 300 + COINS_PER_WORD)
        self.assertEqual(res.data['spent'], HINT_COST)
        self.assertEqual(res.data['balance'], 300 + COINS_PER_WORD - HINT_COST)

    def test_puzzle_coins_count_towards_the_quiz_total(self):
        self._submit(self.puzzle.placements[0]['word'])
        res = self.client.get('/api/quiz/stats/')
        self.assertGreaterEqual(res.data['puzzle_coins'], COINS_PER_WORD)

    def test_themes_report_completed_levels(self):
        for p in self.puzzle.placements:
            self._submit(p['word'])
        res = self.client.get('/api/puzzle-themes/')
        row = next(r for r in res.data if r['slug'] == self.theme.slug)
        self.assertEqual(row['levels_completed'], 1)


class BonusWordTests(APITestCase):
    """Words the wheel can spell that the board never asked for."""

    @classmethod
    def setUpTestData(cls):
        seed_corpus()
        cls.theme = PuzzleTheme.objects.create(
            name='Bonus test', slug='bonus-test',
            source={'kind': 'passage', 'book': 'Psalms', 'chapter': 23},
        )

    def setUp(self):
        cache.clear()
        forget_recorded_plays()
        reset_theme_words()
        reset_dictionary()
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)
        WordPuzzle.objects.all().delete()
        self.puzzle = generate(self.theme, 1, force=True)

    def _submit(self, word):
        return self.client.post(
            f'/api/puzzles/{self.puzzle.id}/found/', {'word': word}, format='json',
        )

    def _a_bonus_word(self):
        if not self.puzzle.bonus_words:
            self.skipTest('this level happens to place every spellable word')
        return self.puzzle.bonus_words[0]

    def test_a_level_knows_its_bonus_words(self):
        """Everything spellable that is not on the board."""
        on_board = set(self.puzzle.words)
        spellable = set(words_from(self.puzzle.letters))
        self.assertEqual(set(self.puzzle.bonus_words), spellable - on_board)

    def test_a_bonus_word_pays_without_going_on_the_board(self):
        word = self._a_bonus_word()
        res = self._submit(word)
        self.assertFalse(res.data['correct'])          # nothing to place
        self.assertTrue(res.data['bonus'])
        self.assertEqual(res.data['coins_earned'], COINS_PER_BONUS_WORD)
        self.assertIn(word, res.data['bonus_found'])

    def test_a_bonus_word_does_not_bring_the_level_closer_to_done(self):
        """The whole point of keeping them in their own list."""
        self._submit(self._a_bonus_word())
        progress = PuzzleProgress.objects.get(user=self.user, puzzle=self.puzzle)
        self.assertEqual(progress.found, [])
        self.assertFalse(progress.is_complete)

    def test_the_same_bonus_word_pays_once(self):
        word = self._a_bonus_word()
        self._submit(word)
        res = self._submit(word)
        self.assertEqual(res.data['coins_earned'], 0)
        self.assertTrue(res.data['already_found'])
        progress = PuzzleProgress.objects.get(user=self.user, puzzle=self.puzzle)
        self.assertEqual(progress.bonus.count(word), 1)

    def test_bonus_coins_reach_the_wallet(self):
        self._submit(self._a_bonus_word())
        res = self.client.get('/api/puzzles/wallet/')
        self.assertEqual(res.data['earned'], COINS_PER_BONUS_WORD)

    def test_gibberish_is_still_just_wrong(self):
        res = self._submit('ZZZ')
        self.assertFalse(res.data['correct'])
        self.assertNotIn('bonus', res.data)
        self.assertEqual(res.data['coins_earned'], 0)

    def test_the_bonus_words_themselves_are_never_sent(self):
        """A count is encouragement; the list would be the answer sheet."""
        res = self.client.get(f'/api/puzzles/level/?theme={self.theme.slug}&level=1')
        self.assertNotIn('bonus_words', res.data)
        self.assertEqual(res.data['bonus_total'], len(self.puzzle.bonus_words))

    def test_bonus_finds_survive_a_reload(self):
        word = self._a_bonus_word()
        self._submit(word)
        res = self.client.get(f'/api/puzzles/level/?theme={self.theme.slug}&level=1')
        self.assertIn(word, res.data['bonus'])


class VerseRevealTests(APITestCase):
    """Finishing a level shows the verse its words came out of."""

    @classmethod
    def setUpTestData(cls):
        seed_corpus()
        cls.theme = PuzzleTheme.objects.create(
            name='Verse test', slug='verse-test',
            source={'kind': 'passage', 'book': 'Psalms', 'chapter': 23},
        )

    def setUp(self):
        cache.clear()
        forget_recorded_plays()
        reset_theme_words()
        reset_dictionary()
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)
        WordPuzzle.objects.all().delete()
        self.puzzle = generate(self.theme, 1, force=True)

    def _finish(self):
        last = None
        for p in self.puzzle.placements:
            last = self.client.post(
                f'/api/puzzles/{self.puzzle.id}/found/', {'word': p['word']}, format='json',
            )
        return last

    def test_a_level_is_built_with_a_verse(self):
        self.assertIsNotNone(self.puzzle.verse)

    def test_the_verse_contains_one_of_the_level_s_words(self):
        """It has to be *the* verse the words came from, not a decorative one."""
        text = self.puzzle.verse.text.upper()
        self.assertTrue(any(w in text for w in self.puzzle.words), self.puzzle.verse.text)

    def test_the_verse_is_withheld_until_the_board_is_done(self):
        """The base word is in that text — an early reveal is a free answer."""
        res = self.client.get(f'/api/puzzles/level/?theme={self.theme.slug}&level=1')
        self.assertIsNone(res.data['verse'])

    def test_finishing_reveals_it(self):
        res = self._finish()
        self.assertTrue(res.data['is_complete'])
        self.assertIsNotNone(res.data['verse'])
        self.assertIn('reference', res.data['verse'])
        self.assertIn('text', res.data['verse'])

    def test_it_stays_revealed_afterwards(self):
        self._finish()
        res = self.client.get(f'/api/puzzles/level/?theme={self.theme.slug}&level=1')
        self.assertEqual(res.data['verse']['reference'], self.puzzle.verse.reference)

    def test_a_level_built_before_any_of_this_is_filled_in(self):
        """Levels are kept, not rebuilt — an old one must not stay half-blank."""
        WordPuzzle.objects.filter(pk=self.puzzle.pk).update(bonus_words=[], verse=None)
        again = generate(self.theme, 1)
        self.assertIsNotNone(again.verse)
        self.assertEqual(again.pk, self.puzzle.pk)       # the same board, not a new one
        self.assertEqual(list(again.placements), list(self.puzzle.placements))


class SharedStreakTests(APITestCase):
    """One streak across both games — a day is a day, whatever was played."""

    @classmethod
    def setUpTestData(cls):
        seed_corpus()
        cls.theme = PuzzleTheme.objects.create(
            name='Streak test', slug='streak-test',
            source={'kind': 'passage', 'book': 'Psalms', 'chapter': 23},
        )

    def setUp(self):
        cache.clear()
        forget_recorded_plays()
        reset_theme_words()
        reset_dictionary()
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)
        WordPuzzle.objects.all().delete()
        self.puzzle = generate(self.theme, 1, force=True)

    def _play_puzzle(self):
        self.client.post(
            f'/api/puzzles/{self.puzzle.id}/found/',
            {'word': self.puzzle.placements[0]['word']}, format='json',
        )

    def test_a_puzzle_day_counts_towards_the_streak(self):
        """The whole point: a day spent on the puzzle must not break it."""
        self._play_puzzle()
        res = self.client.get('/api/quiz/stats/')
        self.assertEqual(res.data['day_streak'], 1)
        self.assertTrue(res.data['played_today'])

    def test_the_puzzle_wallet_reports_the_same_streak(self):
        self._play_puzzle()
        wallet = self.client.get('/api/puzzles/wallet/').data
        stats = self.client.get('/api/quiz/stats/').data
        self.assertEqual(wallet['day_streak'], stats['day_streak'])
        self.assertEqual(wallet['best_day_streak'], stats['best_day_streak'])

    def test_both_games_on_one_day_are_one_day(self):
        from songs.models import DailyQuiz, PlayDay
        self._play_puzzle()
        quiz = DailyQuiz.objects.create(date=timezone.localdate())
        QuizAttempt.objects.create(user=self.user, quiz=quiz, score=1, total=1, points=10)
        self.assertEqual(PlayDay.objects.filter(user=self.user).count(), 1)
        self.assertEqual(self.client.get('/api/quiz/stats/').data['day_streak'], 1)

    def test_yesterday_s_puzzle_keeps_today_s_streak_alive(self):
        from songs.models import PlayDay
        PlayDay.objects.filter(user=self.user).delete()
        PlayDay.objects.create(user=self.user, date=timezone.localdate() - timedelta(days=1))
        res = self.client.get('/api/quiz/stats/')
        self.assertEqual(res.data['day_streak'], 1)
        self.assertFalse(res.data['played_today'])

    def test_buying_a_hint_counts_as_playing(self):
        from songs.models import DailyQuiz, PlayDay
        quiz = DailyQuiz.objects.create(date=timezone.localdate() - timedelta(days=5))
        QuizAttempt.objects.create(user=self.user, quiz=quiz, score=1, total=1, points=500)
        PlayDay.objects.filter(user=self.user).delete()
        self.client.post(f'/api/puzzles/{self.puzzle.id}/hint/', {}, format='json')
        self.assertTrue(PlayDay.objects.filter(
            user=self.user, date=timezone.localdate()).exists())


class ThemeChoiceTests(APITestCase):
    """The server picks the theme; the player is never asked."""

    @classmethod
    def setUpTestData(cls):
        seed_corpus()
        PuzzleTheme.objects.update(is_active=False)     # the seeded themes
        cls.a = PuzzleTheme.objects.create(
            name='Choice A', slug='choice-a', order=1,
            source={'kind': 'passage', 'book': 'Psalms', 'chapter': 23},
        )
        cls.b = PuzzleTheme.objects.create(
            name='Choice B', slug='choice-b', order=2,
            source={'kind': 'passage', 'book': 'Psalms', 'chapter': 23},
        )

    def setUp(self):
        cache.clear()
        forget_recorded_plays()
        reset_theme_words()
        reset_dictionary()
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)

    def _complete(self, theme, level):
        """Mark a level finished without playing it move by move."""
        puzzle = generate(theme, level)
        PuzzleProgress.objects.update_or_create(
            user=self.user, puzzle=puzzle,
            defaults={'found': list(puzzle.words), 'is_complete': True},
        )
        return puzzle


    def test_looking_at_a_board_does_not_start_it(self):
        """A read is a read: no progress row, so nothing to resume."""
        self.client.get('/api/puzzles/next/')
        self.client.get(f'/api/puzzles/level/?theme={self.a.slug}&level=1')
        self.assertFalse(PuzzleProgress.objects.filter(user=self.user).exists())

    def test_opening_the_puzzle_does_not_keep_a_streak_alive(self):
        """A streak someone keeps by opening a screen is not a streak."""
        from songs.models import PlayDay
        self.client.get('/api/puzzles/next/')
        self.assertFalse(PlayDay.objects.filter(user=self.user).exists())

    def test_finding_a_word_does_record_the_day(self):
        from songs.models import PlayDay
        puzzle = generate(self.a, 1)
        self.client.post(f'/api/puzzles/{puzzle.id}/found/',
                         {'word': puzzle.placements[0]['word']}, format='json')
        self.assertTrue(PlayDay.objects.filter(user=self.user).exists())

    def test_a_level_with_a_word_found_is_resumed(self):
        """Resuming now means work done, not a screen opened."""
        puzzle = generate(self.a, 1)
        self.client.post(f'/api/puzzles/{puzzle.id}/found/',
                         {'word': puzzle.placements[0]['word']}, format='json')
        theme, level = choose_for(self.user)
        self.assertEqual(theme, self.a)
        self.assertEqual(level, 1)

    def test_a_fresh_player_is_given_the_first_theme_at_level_one(self):
        theme, level = choose_for(self.user)
        self.assertEqual(theme, self.a)
        self.assertEqual(level, 1)

    def test_the_endpoint_returns_a_playable_level(self):
        res = self.client.get('/api/puzzles/next/')
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.content[:300])
        self.assertTrue(res.data['letters'])
        self.assertTrue(res.data['slots'])
        self.assertIn('theme', res.data)

    def test_it_takes_no_theme_from_the_client(self):
        """Passing one must not change what comes back."""
        plain = self.client.get('/api/puzzles/next/').data
        asked = self.client.get('/api/puzzles/next/?theme=choice-b&level=9').data
        self.assertEqual(asked['theme']['slug'], plain['theme']['slug'])
        self.assertEqual(asked['level'], plain['level'])

    def test_an_unfinished_level_is_resumed(self):
        """Being handed a new board while one sits half-done is the one thing
        this must never do."""
        started = self.client.get('/api/puzzles/next/').data
        puzzle = WordPuzzle.objects.get(pk=started['id'])
        self.client.post(f'/api/puzzles/{puzzle.id}/found/',
                         {'word': puzzle.placements[0]['word']}, format='json')
        again = self.client.get('/api/puzzles/next/').data
        self.assertEqual(again['id'], started['id'])
        self.assertEqual(len(again['found']), 1)

    def test_themes_rotate_once_a_level_is_finished(self):
        self._complete(self.a, 1)
        theme, level = choose_for(self.user)
        self.assertEqual(theme, self.b)          # not theme A again
        self.assertEqual(level, 1)

    def test_each_theme_keeps_its_own_place(self):
        self._complete(self.a, 1)
        self._complete(self.b, 1)
        theme, level = choose_for(self.user)
        self.assertEqual(theme, self.a)          # back round to A
        self.assertEqual(level, 2)               # at its next level

    def test_an_inactive_theme_is_never_chosen(self):
        PuzzleTheme.objects.filter(pk=self.b.pk).update(is_active=False)
        self._complete(self.a, 1)
        theme, _ = choose_for(self.user)
        self.assertEqual(theme, self.a)

    def test_a_theme_that_cannot_build_is_stepped_over(self):
        """A theme with no usable words must not dead-end the player."""
        from songs.puzzle import next_puzzle
        broken = PuzzleTheme.objects.create(
            name='Broken', slug='broken', order=0,          # first in the order
            source={'kind': 'topic', 'term': 'nothingmatchesthis'},
        )
        puzzle = next_puzzle(self.user)
        self.assertNotEqual(puzzle.theme, broken)
        self.assertTrue(puzzle.letters)

    def test_the_levels_do_not_run_out(self):
        """There is no last level: finishing fifty offers a fifty-first."""
        PuzzleTheme.objects.filter(pk=self.b.pk).update(is_active=False)
        # Boards, not generated levels: the chooser counts progress rows, and
        # generating fifty real levels would test the generator instead.
        boards = WordPuzzle.objects.bulk_create([
            WordPuzzle(theme=self.a, level=n, size=0, grid=[], placements=[])
            for n in range(1, 51)
        ])
        PuzzleProgress.objects.bulk_create([
            PuzzleProgress(user=self.user, puzzle=b, is_complete=True) for b in boards
        ])
        theme, level = choose_for(self.user)
        self.assertEqual(theme, self.a)
        self.assertEqual(level, 51)


class EndlessLevelsTests(APITestCase):
    """The game does not finish, and it does not stop changing either."""

    @classmethod
    def setUpTestData(cls):
        seed_corpus()
        cls.theme = PuzzleTheme.objects.create(
            name='Endless', slug='endless',
            source={'kind': 'passage', 'book': 'Psalms', 'chapter': 23},
        )

    def setUp(self):
        cache.clear()
        forget_recorded_plays()
        reset_theme_words()
        reset_dictionary()
        WordPuzzle.objects.all().delete()

    def test_the_wheel_grows_with_the_level(self):
        from songs.puzzle import level_base_length
        self.assertEqual(level_base_length(1), 5)
        self.assertEqual(level_base_length(6), 6)
        self.assertEqual(level_base_length(11), 7)
        self.assertEqual(level_base_length(16), 8)
        # And then holds — eight knobs is as many as a wheel can be traced on.
        self.assertEqual(level_base_length(500), 8)

    def test_more_answers_are_asked_for_as_levels_rise(self):
        from songs.puzzle import level_answer_count
        self.assertLess(level_answer_count(1), level_answer_count(10))
        self.assertLess(level_answer_count(10), level_answer_count(20))
        self.assertEqual(level_answer_count(500), 14)

    def test_early_levels_use_commoner_words_than_later_ones(self):
        from songs.puzzle import answer_floor
        self.assertGreater(answer_floor(1), answer_floor(15))
        self.assertGreater(answer_floor(15), answer_floor(25))

    def test_the_floor_never_drops_below_the_quality_bar(self):
        """Under it the corpus is mostly proper nouns, which never make answers."""
        from songs.puzzle import answer_floor, ANSWER_MIN_FREQUENCY
        for level in (1, 30, 200, 5000):
            self.assertGreaterEqual(answer_floor(level), ANSWER_MIN_FREQUENCY)

    def test_the_bands_are_named_in_order(self):
        from songs.puzzle import band_for
        self.assertEqual(band_for(1), 'simple')
        self.assertEqual(band_for(10), 'simple')
        self.assertEqual(band_for(11), 'moderate')
        self.assertEqual(band_for(25), 'moderate')
        self.assertEqual(band_for(26), 'hard')
        self.assertEqual(band_for(999), 'hard')

    def test_levels_keep_changing_instead_of_repeating(self):
        """The bug this replaces: the base word walked two places down a short
        list and then clamped, so from about level six every level rebuilt the
        board level five had already given you."""
        seed_wide_corpus()
        wide = PuzzleTheme.objects.create(
            name='Wide', slug='wide',
            source={'kind': 'passage', 'book': 'Psalms', 'chapter': 119},
        )
        wheels = []
        for n in range(1, 13):
            try:
                wheels.append(''.join(sorted(generate(wide, n, force=True).letters)))
            except ValueError:
                pass                      # a level this corpus cannot build
        self.assertGreaterEqual(len(wheels), 8, 'too few levels built to judge')
        # Distinct wheels, not just reshuffles of one set of letters.
        self.assertGreaterEqual(len(set(wheels)), 4, wheels)

    def test_the_corpus_tops_up_a_length_the_theme_simply_lacks(self):
        """The last resort, once widening to the book has not helped.

        A theme is widened to its own book before the corpus is considered —
        that is what keeps a Psalm 23 wheel a Psalms wheel. But a book with no
        long words at all cannot supply an eight-letter wheel however wide you
        go, and a level that cannot be built is worse than one built from
        scripture at large.
        """
        from songs.puzzle import MIN_BASE_POOL, base_pool, _theme_words
        seed_wide_corpus()
        BibleVerse.objects.bulk_create([
            BibleVerse(book='Nahum', book_number=34, chapter=1, verse=i,
                       text='the lord is good mercy shall be given to all who trust him')
            for i in range(1, 12)
        ], ignore_conflicts=True)
        short = PuzzleTheme.objects.create(
            name='Short', slug='short-words',
            source={'kind': 'passage', 'book': 'Nahum', 'chapter': 1},
        )
        vocabulary = _theme_words(short)
        self.assertTrue(vocabulary, 'the theme must have words, just not long ones')
        self.assertEqual([w for w in vocabulary if len(w) == 8], [])
        topped = base_pool(short, 8, 25)
        self.assertTrue(topped, 'a level must still be buildable')
        self.assertLessEqual(len(topped), 400)

    def test_a_level_far_past_the_old_ceiling_still_builds(self):
        puzzle = generate(self.theme, 300)
        self.assertTrue(puzzle.letters)
        self.assertTrue(puzzle.placements)

    def test_the_band_goes_out_with_the_level(self):
        user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(user)
        res = self.client.get(f'/api/puzzles/level/?theme={self.theme.slug}&level=30')
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.content[:200])
        self.assertEqual(res.data['band'], 'hard')


class ClaimCostTests(APITestCase):
    """How much work one traced word costs.

    Every query here is a round trip to a database in another country, so the
    count is the latency the player feels when they let go of a word.
    """

    @classmethod
    def setUpTestData(cls):
        seed_corpus()
        cls.theme = PuzzleTheme.objects.create(
            name='Cost', slug='cost',
            source={'kind': 'passage', 'book': 'Psalms', 'chapter': 23},
        )

    def setUp(self):
        cache.clear()
        forget_recorded_plays()
        reset_theme_words()
        reset_dictionary()
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)
        WordPuzzle.objects.all().delete()
        self.puzzle = generate(self.theme, 1, force=True)
        # Warm the rows a first claim would create, so the count reflects the
        # steady state rather than the first word of a level.
        self.client.post(f'/api/puzzles/{self.puzzle.id}/found/',
                         {'word': self.puzzle.placements[0]['word']}, format='json')

    def test_a_correct_word_costs_few_queries(self):
        word = self.puzzle.placements[1]['word']
        with CaptureQueriesContext(connection) as ctx:
            res = self.client.post(f'/api/puzzles/{self.puzzle.id}/found/',
                                   {'word': word}, format='json')
        self.assertTrue(res.data['correct'])
        print('')
        print('    QUERIES for one correct word: %d' % len(ctx))
        for q in ctx.captured_queries:
            print('      %s' % q['sql'][:110])
        self.assertLessEqual(len(ctx), 2, 'each query is a round trip the player waits for')


class ThemeVocabularyTests(APITestCase):
    """A theme's words come from a theme's scripture."""

    @classmethod
    def setUpTestData(cls):
        seed_corpus()
        BibleVerse.objects.bulk_create([
            BibleVerse(book='Genesis', book_number=1, chapter=1, verse=i,
                       text='In the beginning God created the heaven and the earth waters')
            for i in range(1, 20)
        ], ignore_conflicts=True)

    def setUp(self):
        cache.clear()
        forget_recorded_plays()
        reset_theme_words()
        reset_dictionary()

    def test_a_book_theme_reads_its_verses_not_its_title(self):
        """The bug this replaces: book themes returned the words of their own
        NAMES — five for the whole Law — so every board came from elsewhere."""
        theme = PuzzleTheme.objects.create(
            name='Law', slug='law-vocab', source={'kind': 'books', 'first': 1, 'last': 5},
        )
        words = _theme_words(theme)
        self.assertTrue(any(w in ('HEAVEN', 'EARTH', 'WATERS', 'CREATED') for w in words), words)
        self.assertNotIn('GENESIS', words)      # the title is not vocabulary

    def test_a_passage_theme_uses_its_passage(self):
        theme = PuzzleTheme.objects.create(
            name='P23', slug='p23-vocab',
            source={'kind': 'passage', 'book': 'Psalms', 'chapter': 23},
        )
        self.assertTrue(any(w in ('PATHS', 'WATERS', 'SHADOW') for w in _theme_words(theme)))

    def test_a_thin_passage_widens_to_its_book_not_the_corpus(self):
        """A Psalm 23 wheel built from elsewhere in the Psalms is still Psalms.
        One built from the corpus is a theme in name only."""
        from songs.puzzle import _scope
        theme = PuzzleTheme.objects.create(
            name='Thin', slug='thin-vocab',
            source={'kind': 'passage', 'book': 'Psalms', 'chapter': 23},
        )
        narrow = _scope(theme).count()
        wide = _scope(theme, widen=True).count()
        self.assertGreaterEqual(wide, narrow)
        # Widening stays inside the book.
        self.assertEqual(set(_scope(theme, widen=True).values_list('book', flat=True)), {'Psalms'})

    def test_thinness_is_judged_per_wheel_size(self):
        """A theme can look ample in total and still have no eight-letter word."""
        from songs.puzzle import _thin, MIN_BASE_POOL, BASE_MIN, BASE_MAX
        plenty = [
            ('%d%s' % (n, 'X' * 20))[:length]
            for length in range(BASE_MIN, BASE_MAX + 1)
            for n in range(MIN_BASE_POOL)
        ]
        self.assertFalse(_thin(plenty))
        # Same word count, but nothing of the longest length.
        lopsided = [w for w in plenty if len(w) != BASE_MAX] * 4
        self.assertTrue(_thin(lopsided))

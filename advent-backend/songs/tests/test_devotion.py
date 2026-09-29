"""The verse of the day.

    python manage.py test songs.tests.test_devotion
"""
from datetime import date, timedelta

from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from songs.bible_books import BOOKS_BY_NAME
from songs.devotion import EPOCH, REFERENCES, reference_for_date, verse_for_date
from songs.models import BibleVerse, User


def seed_curated(limit=None):
    """Import just the curated references, so the pool is the real one."""
    rows = []
    for book, chapter, verse in (REFERENCES[:limit] if limit else REFERENCES):
        rows.append(BibleVerse(
            book=book, book_number=BOOKS_BY_NAME[book]['number'],
            chapter=chapter, verse=verse,
            text=f'Text of {book} {chapter}:{verse}, long enough to read as a verse.',
        ))
    BibleVerse.objects.bulk_create(rows, ignore_conflicts=True)


class RotationTests(APITestCase):
    """Which verse belongs to which day."""

    @classmethod
    def setUpTestData(cls):
        seed_curated()

    def test_the_same_day_always_gives_the_same_verse(self):
        day = date(2026, 5, 5)
        self.assertEqual(reference_for_date(day), reference_for_date(day))
        self.assertEqual(verse_for_date(day).reference, verse_for_date(day).reference)

    def test_consecutive_days_differ(self):
        seen = {reference_for_date(EPOCH + timedelta(days=i)) for i in range(30)}
        self.assertEqual(len(seen), 30)

    def test_the_whole_selection_is_used_before_any_repeat(self):
        span = len(REFERENCES)
        seen = {reference_for_date(EPOCH + timedelta(days=i)) for i in range(span)}
        self.assertEqual(len(seen), span)

    def test_it_repeats_only_after_a_full_cycle(self):
        span = len(REFERENCES)
        self.assertEqual(reference_for_date(EPOCH), reference_for_date(EPOCH + timedelta(days=span)))

    def test_the_order_is_not_simply_the_bible_order(self):
        """Shuffled once from a fixed seed, so a year does not read Genesis first."""
        first_ten = [reference_for_date(EPOCH + timedelta(days=i))[0] for i in range(10)]
        self.assertGreater(len(set(first_ten)), 3, first_ten)

    def test_dates_far_apart_still_resolve(self):
        for day in (date(2020, 1, 1), date(2030, 12, 31), EPOCH - timedelta(days=900)):
            self.assertIsNotNone(verse_for_date(day))


class MissingTextTests(APITestCase):
    """A partial corpus must not leave the screen blank."""

    def test_a_missing_reference_falls_forward(self):
        # Only one verse imported: every day must still land on something.
        book, chapter, verse = REFERENCES[0]
        BibleVerse.objects.create(
            book=book, book_number=BOOKS_BY_NAME[book]['number'],
            chapter=chapter, verse=verse, text='The only verse there is.',
        )
        for i in range(6):
            found = verse_for_date(EPOCH + timedelta(days=i))
            self.assertIsNotNone(found)
            self.assertEqual(found.text, 'The only verse there is.')

    def test_an_empty_corpus_says_so_rather_than_guessing(self):
        self.assertIsNone(verse_for_date(date(2026, 6, 1)))


class DailyVerseApiTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        seed_curated()

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)

    def test_today_comes_back_with_its_reference(self):
        res = self.client.get('/api/daily-verse/')
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.content[:200])
        self.assertTrue(res.data['text'])
        self.assertTrue(res.data['reference'])
        self.assertTrue(res.data['is_today'])

    def test_a_recent_day_can_be_read_back(self):
        day = (timezone.localdate() - timedelta(days=3)).isoformat()
        res = self.client.get(f'/api/daily-verse/?date={day}')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['date'], day)
        self.assertFalse(res.data['is_today'])

    def test_tomorrow_is_refused(self):
        """The verse of the day is not a thing to read ahead."""
        day = (timezone.localdate() + timedelta(days=1)).isoformat()
        self.assertEqual(self.client.get(f'/api/daily-verse/?date={day}').status_code,
                         status.HTTP_400_BAD_REQUEST)

    def test_the_distant_past_is_refused(self):
        day = (timezone.localdate() - timedelta(days=90)).isoformat()
        self.assertEqual(self.client.get(f'/api/daily-verse/?date={day}').status_code,
                         status.HTTP_400_BAD_REQUEST)

    def test_a_malformed_date_is_refused(self):
        self.assertEqual(self.client.get('/api/daily-verse/?date=yesterday').status_code,
                         status.HTTP_400_BAD_REQUEST)

    def test_it_is_private(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/daily-verse/').status_code,
                         status.HTTP_401_UNAUTHORIZED)

    def test_everyone_sees_the_same_verse_today(self):
        mine = self.client.get('/api/daily-verse/').data['reference']
        other = User.objects.create_user('ivy', 'i@x.com', 'pw12345!')
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get('/api/daily-verse/').data['reference'], mine)

    def test_a_day_is_looked_up_once_not_once_per_person(self):
        first = self.client.get('/api/daily-verse/').data
        # Gone from the database, still served: the second read is the cache's.
        BibleVerse.objects.all().delete()
        again = self.client.get('/api/daily-verse/')
        self.assertEqual(again.status_code, status.HTTP_200_OK)
        self.assertEqual(again.data['reference'], first['reference'])
        self.assertTrue(again.data['is_today'])

    def test_a_cached_day_still_knows_it_is_no_longer_today(self):
        day = (timezone.localdate() - timedelta(days=1)).isoformat()
        self.client.get(f'/api/daily-verse/?date={day}')
        self.assertFalse(self.client.get(f'/api/daily-verse/?date={day}').data['is_today'])


class EmptyCorpusApiTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.client.force_authenticate(User.objects.create_user('mark', 'm@x.com', 'pw12345!'))

    def test_an_import_shows_at_once_after_an_empty_corpus(self):
        """The failure is not cached, so the import is not hidden for a day."""
        self.assertEqual(self.client.get('/api/daily-verse/').status_code, 500)
        seed_curated()
        self.assertEqual(self.client.get('/api/daily-verse/').status_code, status.HTTP_200_OK)


class ReflectionTests(APITestCase):
    """A line under each verse, in both languages the app speaks."""

    def test_every_curated_verse_has_a_line_in_english_and_swahili(self):
        from songs.verse_reflections import REFLECTIONS
        missing = [r for r in REFERENCES if r not in REFLECTIONS]
        self.assertEqual(missing, [])
        for ref, (en, sw) in REFLECTIONS.items():
            self.assertTrue(en.strip() and sw.strip(), ref)
            self.assertNotEqual(en, sw, ref)

    def test_no_line_is_written_for_a_verse_that_is_never_shown(self):
        from songs.verse_reflections import REFLECTIONS
        self.assertEqual(sorted(set(REFLECTIONS) - set(REFERENCES)), [])

    def test_a_line_is_short_enough_to_sit_under_the_verse(self):
        from songs.verse_reflections import REFLECTIONS
        for ref, pair in REFLECTIONS.items():
            for line in pair:
                self.assertLessEqual(len(line), 110, (ref, line))


class VerseStreakApiTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        seed_curated()

    def setUp(self):
        from songs.models import VerseDay
        self.VerseDay = VerseDay
        cache.clear()
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)
        self.today = timezone.localdate()

    def test_the_verse_comes_with_its_reflection(self):
        res = self.client.get('/api/daily-verse/')
        self.assertTrue(res.data['reflection']['en'])
        self.assertTrue(res.data['reflection']['sw'])

    def test_opening_today_starts_a_streak(self):
        res = self.client.get('/api/daily-verse/')
        self.assertEqual(res.data['streak'], {'current': 1, 'best': 1})

    def test_consecutive_days_extend_it(self):
        for back in (1, 2, 3):
            self.VerseDay.objects.create(user=self.user, date=self.today - timedelta(days=back))
        self.assertEqual(self.client.get('/api/daily-verse/').data['streak']['current'], 4)

    def test_a_missed_day_starts_again_but_the_best_is_kept(self):
        for back in (2, 3, 4, 5):
            self.VerseDay.objects.create(user=self.user, date=self.today - timedelta(days=back))
        streak = self.client.get('/api/daily-verse/').data['streak']
        self.assertEqual(streak, {'current': 1, 'best': 4})

    def test_opening_twice_in_a_day_counts_once(self):
        self.client.get('/api/daily-verse/')
        self.client.get('/api/daily-verse/')
        self.assertEqual(self.VerseDay.objects.filter(user=self.user).count(), 1)

    def test_paging_back_is_not_showing_up(self):
        day = (self.today - timedelta(days=2)).isoformat()
        res = self.client.get(f'/api/daily-verse/?date={day}')
        self.assertNotIn('streak', res.data)
        self.assertFalse(self.VerseDay.objects.exists())

    def test_a_streak_is_ones_own_even_when_the_verse_is_cached(self):
        self.VerseDay.objects.create(user=self.user, date=self.today - timedelta(days=1))
        self.assertEqual(self.client.get('/api/daily-verse/').data['streak']['current'], 2)
        other = User.objects.create_user('ivy', 'i@x.com', 'pw12345!')
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get('/api/daily-verse/').data['streak']['current'], 1)

    def test_the_widget_refreshing_is_not_a_visit(self):
        res = self.client.get('/api/daily-verse/?via=widget')
        self.assertEqual(res.status_code, 200)
        self.assertNotIn('streak', res.data)
        self.assertFalse(self.VerseDay.objects.exists())

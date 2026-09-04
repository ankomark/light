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

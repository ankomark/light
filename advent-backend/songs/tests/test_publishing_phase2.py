"""Publishing phase 2: progress through a book, finishing it, shelves,
reading stats, and highlights / notes that sync between phones.

    python manage.py test songs.tests.test_publishing_phase2 --settings=music.settings_test
"""
from datetime import date, timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from songs.models import User, Publication, Chapter, ReadingActivity, ReadingProgress, BookHighlight, Block
from songs import publishing


def book(author, words=(100, 300, 600), status='published', title='Book'):
    pub = Publication.objects.create(title=title, author=author, status=status, category='devotional')
    for i, w in enumerate(words):
        Chapter.objects.create(publication=pub, order=i + 1, title=f'Ch {i + 1}', body='w ' * w, word_count=w)
    return pub


class Base(APITestCase):
    def setUp(self):
        self.author = User.objects.create_user('author', 'a@x.com', 'x')
        self.me = User.objects.create_user('me', 'm@x.com', 'x')
        self.pub = book(self.author)
        self.client.force_authenticate(self.me)

    def read(self, events, pub=None):
        res = self.client.post(f'/api/publications/{(pub or self.pub).id}/reading/', {'events': events}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        return res.json()


class ProgressTests(Base):
    def test_percent_is_by_words_not_chapters(self):
        self.read([{'index': 1, 'seconds': 60, 'furthest': 0.5, 'position': 0.5}])
        rp = ReadingProgress.objects.get(user=self.me)
        self.assertAlmostEqual(rp.percent, (100 + 150) / 1000)          # a quarter, not "chapter 2 of 3"
        self.assertIsNone(rp.finished_at)
        data = self.client.get(f'/api/publications/{self.pub.id}/?toc=1').json()
        self.assertAlmostEqual(data['my_percent'], 0.25)
        self.assertFalse(data['my_finished'])

    def test_reading_the_last_chapter_to_its_end_finishes_the_book(self):
        self.read([{'index': 2, 'seconds': 60, 'furthest': 0.98, 'position': 0.98}])
        rp = ReadingProgress.objects.get(user=self.me)
        self.assertIsNotNone(rp.finished_at)
        self.assertEqual(rp.percent, 1.0)
        # Going back to re-read chapter 1 doesn't un-finish it.
        self.read([{'index': 0, 'seconds': 30, 'furthest': 0.1, 'position': 0.1}])
        rp.refresh_from_db()
        self.assertIsNotNone(rp.finished_at)
        self.assertEqual((rp.last_chapter, rp.percent), (0, 1.0))

    def test_a_chapter_part_read_does_not_finish_it(self):
        self.read([{'index': 2, 'seconds': 60, 'furthest': 0.5}])
        self.assertIsNone(ReadingProgress.objects.get(user=self.me).finished_at)

    def test_the_old_progress_call_starts_a_new_chapter_at_its_top(self):
        self.read([{'index': 0, 'seconds': 30, 'furthest': 0.8, 'position': 0.8}])
        self.client.post(f'/api/publications/{self.pub.id}/progress/', {'chapter': 1}, format='json')
        rp = ReadingProgress.objects.get(user=self.me)
        self.assertEqual((rp.last_chapter, rp.position), (1, 0))       # not 80% into chapter 2
        self.assertAlmostEqual(rp.percent, 0.1)

    def test_the_readers_own_day_is_used(self):
        at = timezone.now().replace(hour=22, minute=0)                  # UTC evening: past midnight in Nairobi
        tomorrow = (at + timedelta(days=1)).date().isoformat()
        self.read([{'index': 0, 'seconds': 60, 'at': at.isoformat(), 'day': tomorrow}])
        self.assertEqual(ReadingActivity.objects.get().day.isoformat(), tomorrow)
        # A day far from when it happened is not believed.
        self.read([{'index': 1, 'seconds': 60, 'at': at.isoformat(), 'day': '2001-01-01'}])
        self.assertNotEqual(ReadingActivity.objects.get(chapter_index=1).day.isoformat(), '2001-01-01')


class ShelfTests(Base):
    def test_reading_and_finished_shelves(self):
        other = book(self.author, title='Other')
        untouched = book(self.author, title='Untouched')
        self.read([{'index': 0, 'seconds': 30, 'furthest': 0.4}])
        self.read([{'index': 2, 'seconds': 30, 'furthest': 1}], pub=other)
        reading = self.client.get('/api/publications/', {'shelf': 'reading'}).json()['results']
        finished = self.client.get('/api/publications/', {'shelf': 'finished'}).json()['results']
        self.assertEqual([r['title'] for r in reading], ['Book'])
        self.assertEqual([r['title'] for r in finished], ['Other'])
        self.assertTrue(finished[0]['my_finished'])
        self.assertAlmostEqual(reading[0]['my_percent'], 0.04)
        rows = self.client.get('/api/publications/').json()['results']
        self.assertIsNone(next(r for r in rows if r['id'] == untouched.id)['my_percent'])

    def test_shelves_are_most_recent_first(self):
        other = book(self.author, title='Other')
        now = timezone.now()
        self.read([{'index': 0, 'seconds': 5, 'at': (now - timedelta(hours=2)).isoformat()}])
        self.read([{'index': 0, 'seconds': 5, 'at': (now - timedelta(hours=1)).isoformat()}], pub=other)
        titles = [r['title'] for r in self.client.get('/api/publications/', {'shelf': 'reading'}).json()['results']]
        self.assertEqual(titles, ['Other', 'Book'])


class StatsTests(Base):
    def day(self, d, seconds, pub=None, index=0):
        ReadingActivity.objects.create(user=self.me, publication=pub or self.pub, chapter_index=index,
                                       day=d, seconds=seconds)

    def test_streaks_week_and_month(self):
        today = date(2026, 9, 24)                                        # a Thursday
        for back in range(0, 4):                                         # 21st–24th
            self.day(today - timedelta(days=back), 600)
        self.day(today - timedelta(days=4), 30)                          # 20th: under a minute — no
        for back in range(10, 16):                                       # an older, longer run of 6
            self.day(today - timedelta(days=back), 120)
        s = publishing.reading_stats(self.me, today)
        self.assertEqual((s['streak'], s['best_streak'], s['read_today']), (4, 6, True))
        self.assertEqual(s['today_seconds'], 600)
        self.assertEqual(s['week_seconds'], 600 * 4)                     # Monday 21st to today
        self.assertEqual(s['month_seconds'], 600 * 4 + 30 + 120 * 6)
        self.assertEqual([d['seconds'] for d in s['last7']], [0, 0, 30, 600, 600, 600, 600])

    def test_a_streak_holds_until_today_is_over(self):
        today = date(2026, 9, 24)
        self.day(today - timedelta(days=1), 600)
        self.day(today - timedelta(days=2), 600)
        s = publishing.reading_stats(self.me, today)
        self.assertEqual((s['streak'], s['read_today']), (2, False))

    def test_the_endpoint_uses_the_readers_date(self):
        today = timezone.localdate()
        self.day(today, 300)
        res = self.client.get('/api/publications/reading-stats/', {'today': today.isoformat()}).json()
        self.assertEqual((res['streak'], res['today_seconds']), (1, 300))
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/publications/reading-stats/').status_code, 401)


class HighlightTests(Base):
    URL = '/api/book-highlights/'

    def sync(self, ops):
        res = self.client.post(self.URL + 'sync/', {'ops': ops}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        return res.json()['applied']

    def op(self, cid='h1', **kw):
        ch = self.pub.chapters.first()
        return {'op': 'upsert', 'client_id': cid, 'publication': self.pub.id, 'chapter_id': ch.id,
                'block': 3, 'quote': 'Grace and peace', 'color': 'yellow', 'note': '',
                'at': timezone.now().isoformat(), **kw}

    def test_highlight_then_note_then_list(self):
        self.assertEqual(self.sync([self.op()]), ['h1'])
        self.sync([self.op(note='Remember this', at=(timezone.now() + timedelta(seconds=1)).isoformat())])
        rows = self.client.get(self.URL, {'publication': self.pub.id}).json()['results']
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]['color'], rows[0]['note'], rows[0]['block'], rows[0]['publication_title']),
                         ('yellow', 'Remember this', 3, 'Book'))
        library = self.client.get(self.URL).json()
        self.assertEqual(library['results'][0]['chapter_title'], 'Ch 1')

    def test_the_newer_change_wins_between_phones(self):
        now = timezone.now()
        self.sync([self.op(color='green', at=now.isoformat())])
        self.sync([self.op(color='pink', at=(now - timedelta(minutes=5)).isoformat())])   # older, arrives late
        self.assertEqual(BookHighlight.objects.get().color, 'green')

    def test_deleting_is_remembered_for_other_phones(self):
        now = timezone.now()
        self.sync([self.op(at=now.isoformat())])
        self.sync([{'op': 'delete', 'client_id': 'h1', 'at': (now + timedelta(seconds=1)).isoformat()}])
        self.assertEqual(self.client.get(self.URL, {'publication': self.pub.id}).json()['results'], [])
        since = (now - timedelta(minutes=1)).isoformat()
        changed = self.client.get(self.URL, {'since': since}).json()['results']
        self.assertEqual([(c['client_id'], c['deleted']) for c in changed], [('h1', True)])

    def test_no_colour_and_no_note_is_a_deletion(self):
        now = timezone.now()
        self.sync([self.op(at=now.isoformat())])
        self.sync([self.op(color='', note='  ', at=(now + timedelta(seconds=1)).isoformat())])
        self.assertTrue(BookHighlight.objects.get().deleted)

    def test_only_books_the_reader_may_open(self):
        draft = book(self.author, status='draft', title='Draft')
        self.assertEqual(self.sync([self.op(publication=draft.id)]), [])
        self.sync([self.op()])
        Block.objects.create(blocker=self.me, blocked=self.author)
        self.assertEqual(self.client.get(self.URL).json()['results'], [])

    def test_bad_input(self):
        self.assertEqual(self.sync([{'op': 'upsert'}, 'junk']), [])
        # An unknown colour and no note: nothing to keep — handled, and nothing stored.
        self.assertEqual(self.sync([self.op(color='plaid', note='')]), ['h1'])
        self.assertFalse(BookHighlight.objects.exists())
        self.assertEqual(self.client.post(self.URL + 'sync/', {'ops': 'x'}, format='json').status_code, 400)
        self.assertEqual(self.client.get(self.URL, {'since': 'yesterday'}).status_code, 400)
        other = User.objects.create_user('other', 'o@x.com', 'x')
        self.sync([self.op()])
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get(self.URL).json()['results'], [])

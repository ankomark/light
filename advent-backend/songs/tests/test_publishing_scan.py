"""Publishing deep scan (2026-10-07): what it found, kept fixed.

    python manage.py test songs.tests.test_publishing_scan --settings=music.settings_test
"""
from django.core.cache import cache
from rest_framework.test import APITestCase

from songs.models import BookClub, BookHighlight, Chapter, Publication, User


class _Book(APITestCase):
    """An author's published book (one chapter out, one in draft) and a reader."""

    def setUp(self):
        cache.clear()
        self.author = User.objects.create_user('pubauthor', 'pa@x.com', 'pw')
        self.reader = User.objects.create_user('pubreader', 'pr@x.com', 'pw')
        self.book = Publication.objects.create(author=self.author, title='Book', status='published')
        self.ch = Chapter.objects.create(publication=self.book, title='One', body='hello', order=0, status='published')
        self.draft_ch = Chapter.objects.create(publication=self.book, title='Draft', body='secret', order=1,
                                               status='draft')
        self.client.force_authenticate(self.reader)


class PublishingScanTests(_Book):
    def test_a_non_numeric_id_is_never_a_500(self):
        self.client.raise_request_exception = False
        self.assertEqual(self.client.get('/api/publications/?author=abc').status_code, 200)
        self.assertEqual(self.client.get('/api/publications/?author=abc').data['results'], [])
        self.assertEqual(self.client.get('/api/book-highlights/?publication=abc').status_code, 400)

    def test_one_broken_highlight_does_not_fail_the_whole_sync(self):
        ops = [
            {'op': 'upsert', 'client_id': 'bad', 'publication': 'abc', 'color': 'yellow'},
            {'op': 'upsert', 'client_id': 'good', 'publication': self.book.id, 'chapter_id': self.ch.id,
             'block': 0, 'quote': 'hello', 'color': 'yellow'},
        ]
        r = self.client.post('/api/book-highlights/sync/', {'ops': ops}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(BookHighlight.objects.filter(user=self.reader, client_id='good').exists())

    def test_a_highlight_never_points_into_an_authors_draft(self):
        self.client.post('/api/book-highlights/sync/', {'ops': [
            {'op': 'upsert', 'client_id': 'h1', 'publication': self.book.id, 'chapter_id': self.draft_ch.id,
             'block': 0, 'quote': 'x', 'color': 'yellow'}]}, format='json')
        self.assertIsNone(BookHighlight.objects.get(client_id='h1').chapter_id)

    def test_a_book_club_plan_stays_on_the_calendar(self):
        self.client.raise_request_exception = False
        r = self.client.post(f'/api/publications/{self.book.id}/clubs/',
                             {'name': 'Readers', 'every_days': 10 ** 9, 'chapters_per_step': 10 ** 9}, format='json')
        self.assertEqual(r.status_code, 201, getattr(r, 'data', r.content[:200]))
        self.assertTrue(BookClub.objects.exists())


class DiscoverFreshTests(APITestCase):
    def test_a_finished_book_leaves_new_and_trending_for_its_reader(self):
        from django.utils import timezone
        from songs import book_community
        from songs.models import ReadingProgress
        cache.clear()
        author = User.objects.create_user('dauthor', 'da@x.com', 'pw')
        me = User.objects.create_user('dme', 'dm@x.com', 'pw')
        done = Publication.objects.create(author=author, title='Read it', status='published', published_at=timezone.now())
        other = Publication.objects.create(author=author, title='Not yet', status='published', published_at=timezone.now())
        ReadingProgress.objects.create(user=me, publication=done, percent=1.0, finished_at=timezone.now())
        sections = book_community.home_sections(me)
        self.assertNotIn(done.id, sections['new'])
        self.assertIn(other.id, sections['new'])
        # Someone who hasn't read it still sees it.
        self.assertIn(done.id, book_community.home_sections(author)['new'])


class AdminReportPreviewTests(APITestCase):
    def test_reported_reviews_and_comments_show_what_was_written(self):
        from songs.models import BookReview, ChapterComment, Report
        author = User.objects.create_user('rauthor', 'ra@x.com', 'pw')
        reader = User.objects.create_user('rreader', 'rr@x.com', 'pw')
        book = Publication.objects.create(author=author, title='Reported Book', status='published')
        ch = Chapter.objects.create(publication=book, title='One', body='x', order=0, status='published')
        review = BookReview.objects.create(publication=book, user=reader, rating=1, body='nasty review')
        comment = ChapterComment.objects.create(publication=book, chapter=ch, user=reader, body='nasty comment')
        for ctype, oid in (('bookreview', review.id), ('chaptercomment', comment.id)):
            Report.objects.create(reporter=author, content_type=ctype, object_id=oid, reason='other')
        boss = User.objects.create_user('rboss', 'rb@x.com', 'pw', is_superuser=True)
        self.client.force_authenticate(boss)
        rows = self.client.get('/api/admin/reports/').data
        rows = rows['results'] if isinstance(rows, dict) else rows
        bodies = {r['content_type']: (r['target'] or {}).get('body') for r in rows}
        self.assertEqual(bodies, {'bookreview': 'nasty review', 'chaptercomment': 'nasty comment'})


class RescanTests(_Book):
    """The re-scan: who may write in a book's discussion, and what it shows."""

    def url(self):
        return f'/api/publications/{self.book.id}/chapters/0/comments/'

    def test_a_suspended_account_can_neither_comment_nor_review(self):
        from songs.models import ReadingActivity, ReadingProgress
        from django.utils import timezone
        User.objects.filter(pk=self.reader.pk).update(is_suspended=True)
        self.client.force_authenticate(User.objects.get(pk=self.reader.pk))
        self.assertEqual(self.client.post(self.url(), {'body': 'hello'}, format='json').status_code, 403)
        ReadingProgress.objects.create(user=self.reader, publication=self.book, percent=1)
        ReadingActivity.objects.create(user=self.reader, publication=self.book, chapter_index=0,
                                       day=timezone.localdate(), seconds=600)
        r = self.client.post(f'/api/publications/{self.book.id}/reviews/', {'rating': 1}, format='json')
        self.assertEqual(r.status_code, 403)

    def test_a_reply_to_a_non_numeric_comment_is_a_400(self):
        self.client.raise_request_exception = False
        r = self.client.post(self.url(), {'body': 'hi', 'parent': 'abc'}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_a_busy_chapter_shows_its_newest_comments(self):
        from songs.models import ChapterComment, ReadingProgress
        ReadingProgress.objects.create(user=self.reader, publication=self.book, percent=1, last_chapter=1)
        ChapterComment.objects.bulk_create([
            ChapterComment(publication=self.book, chapter=self.ch, user=self.author, body=f'c{i}') for i in range(505)])
        rows = self.client.get(self.url() + '?reveal=1').data['results']
        bodies = [r['body'] for r in rows]
        self.assertIn('c504', bodies)                     # the newest is there
        self.assertNotIn('c0', bodies)                    # the oldest made room
        self.assertEqual(bodies[-1], 'c504')              # still in reading order

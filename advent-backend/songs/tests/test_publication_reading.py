"""Publishing: the book page without chapter bodies, one chapter at a time,
query counts that don't grow with a book, and who may see what.

    python manage.py test songs.tests.test_publication_reading --settings=music.settings_test
"""
import importlib

from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from songs.models import (
    User, Publication, Chapter, PublicationLike, PublicationBookmark, ReadingProgress, Block,
)

IMG = '![image](data:image/jpeg;base64,' + 'A' * 4000 + ')'


def make_pub(author, title='Book', status='published', chapters=3, likes=(), body='word ' * 400):
    pub = Publication.objects.create(title=title, author=author, status=status, category='devotional')
    for i in range(chapters):
        text = f'{body}\n\n{IMG}'
        Chapter.objects.create(publication=pub, order=i + 1, title=f'Ch {i + 1}', body=text,
                               word_count=Chapter.count_words(text))
    for u in likes:
        PublicationLike.objects.create(publication=pub, user=u)
    return pub


def bodies_loaded(ctx):
    return any('songs_chapter' in q['sql'] and '"body"' in q['sql'] for q in ctx.captured_queries)


class WordCountTests(APITestCase):
    def test_images_and_link_targets_are_not_words(self):
        body = f"Grace and peace. {IMG} Read [the gospel](https://example.org/a-b-c) — it's good."
        self.assertEqual(Chapter.count_words(body), 8)   # Grace and peace Read the gospel it's good

    def test_saving_through_the_api_counts_words(self):
        author = User.objects.create_user('w', 'w@x.com', 'x')
        self.client.force_authenticate(author)
        res = self.client.post('/api/publications/', {
            'title': 'T', 'category': 'other', 'status': 'draft',
            'chapters': [{'order': 1, 'title': 'a', 'body': f'one two three {IMG}'}],
        }, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(Chapter.objects.get(publication_id=res.json()['id']).word_count, 3)

    def test_the_migration_counts_the_same_way(self):
        mig = importlib.import_module('songs.migrations.0132_chapter_word_count')
        for body in ('', f'a b {IMG} c', "it's [x](http://y) well-known ok"):
            self.assertEqual(mig._count(body), Chapter.count_words(body))


class BookPageTests(APITestCase):
    def setUp(self):
        self.author = User.objects.create_user('author', 'a@x.com', 'x')
        self.reader = User.objects.create_user('reader', 'r@x.com', 'x')
        self.pub = make_pub(self.author, likes=[self.reader])

    def test_toc_has_no_bodies_and_never_loads_them(self):
        self.client.force_authenticate(self.reader)
        with CaptureQueriesContext(connection) as ctx:
            res = self.client.get(f'/api/publications/{self.pub.id}/?toc=1')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual([c['title'] for c in data['chapters']], ['Ch 1', 'Ch 2', 'Ch 3'])
        self.assertTrue(all('body' not in c for c in data['chapters']))
        self.assertFalse(bodies_loaded(ctx), 'the book page loaded chapter bodies')
        self.assertEqual(data['reading_minutes'], 6)          # 1200 words at 200 a minute
        self.assertEqual(data['likes_count'], 1)
        self.assertTrue(data['is_liked'])
        self.assertLess(len(res.content), 3000)               # vs. ~12 KB of images below

    def test_without_toc_the_bodies_still_come_for_the_editor_and_old_apps(self):
        self.client.force_authenticate(self.author)
        res = self.client.get(f'/api/publications/{self.pub.id}/')
        self.assertIn('data:image/jpeg;base64,', res.json()['chapters'][0]['body'])

    def test_the_reader_marks_come_through(self):
        ReadingProgress.objects.create(publication=self.pub, user=self.reader, last_chapter=2)
        PublicationBookmark.objects.create(publication=self.pub, user=self.reader)
        self.author.followers.add(self.reader)
        self.client.force_authenticate(self.reader)
        data = self.client.get(f'/api/publications/{self.pub.id}/?toc=1').json()
        self.assertEqual(data['last_read_chapter'], 2)
        self.assertTrue(data['is_bookmarked'])
        self.assertTrue(data['author_is_following'])

    def test_query_count_does_not_grow_with_the_book(self):
        self.client.force_authenticate(self.reader)
        small = make_pub(self.author, chapters=1)
        big = make_pub(self.author, chapters=12, likes=[self.reader, self.author])
        counts = []
        for pub in (small, big):
            with CaptureQueriesContext(connection) as ctx:
                self.client.get(f'/api/publications/{pub.id}/?toc=1')
            counts.append(len(ctx.captured_queries))
        self.assertEqual(counts[0], counts[1])
        self.assertLessEqual(counts[1], 6)   # + chapters coming soon (serial publishing)


class ChapterEndpointTests(APITestCase):
    def setUp(self):
        self.author = User.objects.create_user('author', 'a@x.com', 'x')
        self.other = User.objects.create_user('other', 'o@x.com', 'x')
        self.pub = make_pub(self.author, chapters=3)

    def test_one_chapter_by_its_place_in_the_book(self):
        res = self.client.get(f'/api/publications/{self.pub.id}/chapters/1/')   # anyone may read
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual((data['index'], data['count']), (1, 3))
        self.assertEqual(data['chapter']['title'], 'Ch 2')
        self.assertIn('data:image/jpeg', data['chapter']['body'])
        self.assertEqual(self.client.get(f'/api/publications/{self.pub.id}/chapters/3/').status_code, 404)

    def test_follows_the_reading_order_not_the_ids(self):
        Chapter.objects.filter(publication=self.pub, order=1).update(order=9)
        res = self.client.get(f'/api/publications/{self.pub.id}/chapters/0/')
        self.assertEqual(res.json()['chapter']['title'], 'Ch 2')

    def test_a_draft_is_its_authors_alone(self):
        draft = make_pub(self.author, status='draft', chapters=1)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(f'/api/publications/{draft.id}/chapters/0/').status_code, 404)
        self.assertEqual(self.client.get(f'/api/publications/{draft.id}/cover/').status_code, 404)
        self.client.force_authenticate(self.author)
        self.assertEqual(self.client.get(f'/api/publications/{draft.id}/chapters/0/').status_code, 200)

    def test_a_takedown_is_gone(self):
        self.pub.is_removed = True
        self.pub.save()
        self.assertEqual(self.client.get(f'/api/publications/{self.pub.id}/chapters/0/').status_code, 404)


class ListTests(APITestCase):
    def setUp(self):
        self.author = User.objects.create_user('author', 'a@x.com', 'x')
        self.me = User.objects.create_user('me', 'm@x.com', 'x')
        self.client.force_authenticate(self.me)

    def _count(self, url):
        with CaptureQueriesContext(connection) as ctx:
            res = self.client.get(url)
        self.assertEqual(res.status_code, 200, res.content)
        return len(ctx.captured_queries), res.json()

    def test_list_queries_do_not_grow_with_rows(self):
        make_pub(self.author, chapters=0)                  # a 0 used to cost a query
        n1, _ = self._count('/api/publications/')
        for i in range(6):
            make_pub(self.author, title=f'B{i}', chapters=2, likes=[self.me])
        n7, data = self._count('/api/publications/')
        self.assertEqual(n1, n7)
        self.assertEqual(len(data['results']), 7)
        row = next(r for r in data['results'] if r['title'] == 'B0')
        self.assertEqual((row['chapter_count'], row['likes_count'], row['is_liked']), (2, 1, True))

    def test_my_work_is_counted_in_the_page_query_too(self):
        self.client.force_authenticate(self.author)
        make_pub(self.author, status='draft')
        n1, _ = self._count('/api/publications/mine/')
        for i in range(5):
            make_pub(self.author, title=f'M{i}', likes=[self.me, self.author])
        n6, data = self._count('/api/publications/mine/')
        self.assertEqual(n1, n6)
        row = next(r for r in data['results'] if r['title'] == 'M0')
        self.assertEqual((row['likes_count'], row['is_liked']), (2, True))

    def test_my_work_needs_an_account(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/publications/mine/').status_code, 401)

    def test_blocked_and_deactivated_authors_are_hidden(self):
        pub = make_pub(self.author)
        Block.objects.create(blocker=self.author, blocked=self.me)
        _, data = self._count('/api/publications/')
        self.assertEqual(data['results'], [])
        self.assertEqual(self.client.get(f'/api/publications/{pub.id}/').status_code, 404)
        Block.objects.all().delete()
        self.author.is_deactivated = True
        self.author.save()
        _, data = self._count('/api/publications/')
        self.assertEqual(data['results'], [])
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(f'/api/publications/{pub.id}/chapters/0/').status_code, 404)

    def test_the_author_still_sees_their_own_work_after_deactivating(self):
        pub = make_pub(self.author)
        self.author.is_deactivated = True
        self.author.save()
        self.client.force_authenticate(self.author)
        self.assertEqual(self.client.get(f'/api/publications/{pub.id}/').status_code, 200)

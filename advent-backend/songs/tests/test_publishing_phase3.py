"""Publishing phase 3: Discover, reviews, spoiler-aware chapter discussions,
author pages, and telling readers about new books and chapters.

    python manage.py test songs.tests.test_publishing_phase3 --settings=music.settings_test
"""
from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from songs.models import (
    User, Publication, Chapter, ReadingActivity, ReadingProgress, BookReview, ChapterComment, Block,
    PublicationBookmark,
)
from songs import book_community


def book(author, title='Book', chapters=3, status='published', **kw):
    pub = Publication.objects.create(title=title, author=author, status=status, category='devotional',
                                     published_at=timezone.now() if status == 'published' else None, **kw)
    for i in range(chapters):
        Chapter.objects.create(publication=pub, order=i + 1, title=f'Ch {i + 1}', body='w ' * 100, word_count=100)
    return pub


def read(user, pub, index, finished=False, days_ago=0):
    ReadingActivity.objects.create(user=user, publication=pub, chapter_index=index, seconds=300,
                                   day=timezone.localdate() - timedelta(days=days_ago), finished=finished)


class Base(APITestCase):
    def setUp(self):
        cache.clear()
        self.author = User.objects.create_user('author', 'a@x.com', 'x')
        self.me = User.objects.create_user('me', 'm@x.com', 'x')
        self.pub = book(self.author)
        self.client.force_authenticate(self.me)


class DiscoverTests(Base):
    def test_sections(self):
        other = User.objects.create_user('other', 'o@x.com', 'x')
        pick = book(other, title='Pick', featured_at=timezone.now())
        hot = book(other, title='Hot')
        readers = [User.objects.create_user(f'r{i}', f'r{i}@x.com', 'x') for i in range(4)]
        for r in readers:
            read(r, hot, 0, finished=True)
        read(readers[0], self.pub, 0)
        self.author.followers.add(self.me)              # I follow the author
        ReadingProgress.objects.create(user=self.me, publication=pick, last_chapter=1, percent=0.4)
        book(other, title='Draft', status='draft')

        res = self.client.get('/api/publications/home/').json()
        titles = {k: [b['title'] for b in res[k]] for k in ('continue', 'picks', 'trending', 'following', 'new')}
        self.assertEqual(titles['continue'], ['Pick'])
        self.assertEqual(titles['picks'], ['Pick'])
        self.assertEqual(titles['trending'][0], 'Hot')                  # finishers count double
        self.assertEqual(titles['following'], ['Book'])
        self.assertNotIn('Draft', titles['new'])
        self.assertEqual(res['rising'][0]['username'], 'other')

    def test_guests_get_the_shared_sections(self):
        self.client.force_authenticate(None)
        res = self.client.get('/api/publications/home/').json()
        self.assertEqual((res['continue'], res['following']), ([], []))
        self.assertEqual([b['title'] for b in res['new']], ['Book'])

    def test_blocked_authors_are_left_out(self):
        Block.objects.create(blocker=self.me, blocked=self.author)
        res = self.client.get('/api/publications/home/').json()
        self.assertEqual(res['new'], [])

    def test_rising_needs_a_few_readers_and_prefers_growth(self):
        a2 = User.objects.create_user('a2', 'a2@x.com', 'x')
        slow = book(a2, title='Slow')
        readers = [User.objects.create_user(f'q{i}', f'q{i}@x.com', 'x') for i in range(6)]
        for r in readers[:3]:
            read(r, self.pub, 0)                                         # 3 new readers, none before
        for r in readers:
            read(r, slow, 0, days_ago=20)                                # 6 readers before…
        for r in readers[:4]:
            read(r, slow, 0)                                             # …4 now: shrinking
        rows = book_community.rising_author_rows()
        self.assertEqual([r['user_id'] for r in rows][0], self.author.id)


class ReviewTests(Base):
    URL = '/api/publications/{}/reviews/'

    def test_reviewing_needs_some_reading(self):
        url = self.URL.format(self.pub.id)
        res = self.client.post(url, {'rating': 5, 'body': 'Great'}, format='json')
        self.assertEqual((res.status_code, res.json()['code']), (403, 'read_more'))
        ReadingProgress.objects.create(user=self.me, publication=self.pub, percent=0.3)
        with mock.patch('songs.push.notify_user') as notify:
            res = self.client.post(url, {'rating': 5, 'body': 'Great'}, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        notify.assert_called_once()
        self.assertEqual(notify.call_args.args[:2], (self.author, 'book_review'))
        # Changing it keeps one review.
        self.assertEqual(self.client.post(url, {'rating': 4}, format='json').status_code, 200)
        self.assertEqual(BookReview.objects.get().rating, 4)

    def test_an_author_cannot_review_their_own_book(self):
        self.client.force_authenticate(self.author)
        res = self.client.post(self.URL.format(self.pub.id), {'rating': 5}, format='json')
        self.assertEqual(res.json()['code'], 'own')

    def test_the_summary_and_ratings_on_the_book(self):
        for i, stars in enumerate([5, 4, 4]):
            u = User.objects.create_user(f'v{i}', f'v{i}@x.com', 'x')
            BookReview.objects.create(publication=self.pub, user=u, rating=stars, body='ok')
        BookReview.objects.create(publication=self.pub, user=User.objects.create_user('bad', 'b@x.com', 'x'),
                                  rating=1, is_removed=True)
        data = self.client.get(self.URL.format(self.pub.id)).json()
        self.assertEqual(data['summary'], {'count': 3, 'average': 4.3,
                                           'spread': {'1': 0, '2': 0, '3': 0, '4': 2, '5': 1}})
        self.assertEqual((data['can_review'], data['reason'], data['mine']), (False, 'read_more', None))
        self.assertEqual(len(data['results']), 3)
        row = next(r for r in self.client.get('/api/publications/').json()['results'] if r['id'] == self.pub.id)
        self.assertEqual((row['rating_avg'], row['rating_count']), (4.3, 3))

    def test_bad_ratings_are_refused(self):
        ReadingProgress.objects.create(user=self.me, publication=self.pub, percent=1)
        self.assertEqual(self.client.post(self.URL.format(self.pub.id), {'rating': 6}, format='json').status_code, 400)


class DiscussionTests(Base):
    URL = '/api/publications/{}/chapters/{}/comments/'

    def test_comment_reply_and_who_is_told(self):
        with mock.patch('songs.push.notify_user') as notify:
            res = self.client.post(self.URL.format(self.pub.id, 0), {'body': 'Beautiful chapter'}, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(notify.call_args.args[:2], (self.author, 'book_discussion'))
        parent = res.json()['id']
        other = User.objects.create_user('other', 'o@x.com', 'x')
        self.client.force_authenticate(other)
        read(other, self.pub, 0)
        with mock.patch('songs.push.notify_user') as notify:
            self.client.post(self.URL.format(self.pub.id, 0), {'body': 'Agreed', 'parent': parent}, format='json')
        self.assertEqual({c.args[0] for c in notify.call_args_list}, {self.me, self.author})
        data = self.client.get(self.URL.format(self.pub.id, 0)).json()
        self.assertEqual(data['count'], 2)
        self.assertEqual(data['results'][0]['replies'][0]['body'], 'Agreed')

    def test_spoilers_are_held_back_until_the_reader_gets_there(self):
        ChapterComment.objects.create(publication=self.pub, chapter=self.pub.chapters.get(order=3),
                                      user=self.author, body='The twist!')
        read(self.me, self.pub, 0)
        data = self.client.get(self.URL.format(self.pub.id, 2)).json()
        self.assertEqual((data['locked'], data['reached'], data['count'], data['results']), (True, 0, 1, []))
        revealed = self.client.get(self.URL.format(self.pub.id, 2), {'reveal': 1}).json()
        self.assertEqual(revealed['results'][0]['body'], 'The twist!')
        self.assertTrue(revealed['results'][0]['is_author'])
        ReadingProgress.objects.create(user=self.me, publication=self.pub, finished_at=timezone.now())
        self.assertFalse(self.client.get(self.URL.format(self.pub.id, 2)).json()['locked'])

    def test_the_contents_show_each_chapters_discussion_size(self):
        ch = self.pub.chapters.get(order=1)
        ChapterComment.objects.create(publication=self.pub, chapter=ch, user=self.me, body='a')
        ChapterComment.objects.create(publication=self.pub, chapter=ch, user=self.me, body='b', is_removed=True)
        toc = self.client.get(f'/api/publications/{self.pub.id}/?toc=1').json()
        self.assertEqual([c['comment_count'] for c in toc['chapters']], [1, 0, 0])

    def test_removing_a_comment(self):
        c = ChapterComment.objects.create(publication=self.pub, chapter=self.pub.chapters.first(), user=self.me, body='x')
        stranger = User.objects.create_user('s', 's@x.com', 'x')
        self.client.force_authenticate(stranger)
        self.assertEqual(self.client.delete(f'/api/publications/{self.pub.id}/comments/{c.id}/').status_code, 403)
        self.client.force_authenticate(self.author)                      # the book's author may
        self.assertEqual(self.client.delete(f'/api/publications/{self.pub.id}/comments/{c.id}/').status_code, 204)

    def test_comments_must_have_words(self):
        self.assertEqual(self.client.post(self.URL.format(self.pub.id, 0), {'body': '  '}, format='json').status_code, 400)


class AuthorPageTests(Base):
    def test_the_authors_page(self):
        book(self.author, title='Second')
        book(self.author, title='Hidden draft', status='draft')
        read(self.me, self.pub, 0)
        read(self.author, self.pub, 0)                                   # their own reading doesn't count
        ReadingProgress.objects.create(user=self.me, publication=self.pub, finished_at=timezone.now())
        self.author.followers.add(self.me)
        data = self.client.get(f'/api/publications/authors/{self.author.id}/').json()
        self.assertEqual((data['readers_count'], data['finished_count'], data['followers_count'], data['is_following']),
                         (1, 1, 1, True))
        self.assertEqual(sorted(b['title'] for b in data['books']), ['Book', 'Second'])

    def test_blocked_or_gone_authors_have_no_page(self):
        Block.objects.create(blocker=self.author, blocked=self.me)
        self.assertEqual(self.client.get(f'/api/publications/authors/{self.author.id}/').status_code, 404)


class AnnounceTests(Base):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.author)
        self.follower = User.objects.create_user('fan', 'f@x.com', 'x')
        self.author.followers.add(self.follower)

    def test_a_new_book_tells_followers_once(self):
        with mock.patch('songs.book_community.notify_new_book') as told, \
                mock.patch('songs.tasks.run_in_background', side_effect=lambda fn, *a: fn(*a)):
            res = self.client.post('/api/publications/', {
                'title': 'New', 'category': 'other', 'status': 'published',
                'chapters': [{'title': 'a', 'body': 'b'}]}, format='json')
            self.assertEqual(res.status_code, 201)
            told.assert_called_once()
            pid = res.json()['id']
            # Saving it again isn't news.
            self.client.patch(f'/api/publications/{pid}/', {'title': 'New!'}, format='json')
            told.assert_called_once()

    def test_a_new_chapter_tells_followers_savers_and_readers(self):
        saver = User.objects.create_user('saver', 's@x.com', 'x')
        PublicationBookmark.objects.create(publication=self.pub, user=saver)
        ReadingProgress.objects.create(publication=self.pub, user=self.me)
        Block.objects.create(blocker=self.me, blocked=self.author)       # blocked: not told
        chapters = self.client.get(f'/api/publications/{self.pub.id}/').json()['chapters']
        with mock.patch('songs.push.notify_user') as notify, \
                mock.patch('songs.tasks.run_in_background', side_effect=lambda fn, *a: fn(*a)):
            self.client.patch(f'/api/publications/{self.pub.id}/', {
                'title': 'Book', 'chapters': chapters + [{'title': 'Four', 'body': 'new words'}]}, format='json')
        told = {c.args[0] for c in notify.call_args_list}
        self.assertEqual(told, {self.follower, saver})
        self.assertIn('“Four”', notify.call_args.args[2])

    def test_a_draft_chapter_going_out_is_news_too(self):
        chapters = self.client.get(f'/api/publications/{self.pub.id}/').json()['chapters']
        chapters[2]['status'] = 'draft'
        with mock.patch('songs.tasks.run_in_background'):
            self.client.patch(f'/api/publications/{self.pub.id}/', {'title': 'Book', 'chapters': chapters}, format='json')
        chapters[2]['status'] = 'published'
        with mock.patch('songs.book_community.notify_new_chapters') as told, \
                mock.patch('songs.tasks.run_in_background', side_effect=lambda fn, *a: fn(*a)):
            self.client.patch(f'/api/publications/{self.pub.id}/', {'title': 'Book', 'chapters': chapters}, format='json')
        self.assertEqual(told.call_args.args[1], [chapters[2]['id']])

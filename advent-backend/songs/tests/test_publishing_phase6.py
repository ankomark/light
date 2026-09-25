"""Publishing phase 6: AI in books (answers grounded in the text, kept,
limited per day), highlight collections, and "because you highlighted…".

    python manage.py test songs.tests.test_publishing_phase6 --settings=music.settings_test
"""
import json
from unittest import mock

from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from songs import book_ai
from songs.models import (
    User, Publication, Chapter, AiAnswer, AiUsage, BookHighlight, ManuscriptCheck, PublicationCollaborator,
    ReadingProgress,
)

KEY = override_settings(ANTHROPIC_API_KEY='test-key', AI_DAILY_LIMIT=3, AI_MODEL='big', AI_FAST_MODEL='fast')


def answer(text, status=200, model='fast'):
    r = mock.Mock(status_code=status, text=text)
    r.json.return_value = {'model': model, 'content': [{'type': 'text', 'text': text}]}
    return r


def book(author, title='Book', category='devotional', chapters=('Once there was a sower. The seed fell.', 'Ch two.')):
    pub = Publication.objects.create(title=title, author=author, status='published', category=category,
                                     published_at=timezone.now())
    for i, body in enumerate(chapters):
        Chapter.objects.create(publication=pub, order=i + 1, title=f'Ch {i + 1}', body=body)
    return pub


class Base(APITestCase):
    def setUp(self):
        cache.clear()
        self.author = User.objects.create_user('author', 'a@x.com', 'x')
        self.reader = User.objects.create_user('reader', 'r@x.com', 'x')
        self.pub = book(self.author)
        self.client.force_authenticate(self.reader)

    def ask(self, **data):
        return self.client.post(f'/api/publications/{self.pub.id}/ai/', {'chapter': 0, **data}, format='json')


@KEY
class ReaderAiTests(Base):
    @mock.patch('songs.book_ai.requests.post')
    def test_explain_is_grounded_kept_and_shared(self, post):
        post.return_value = answer('The sower stands for the one who shares the message.')
        r = self.ask(kind='explain', passage='Once there was a sower.')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data['text'], 'The sower stands for the one who shares the message.')
        self.assertFalse(r.data['cached'])
        sent = post.call_args.kwargs['json']
        self.assertEqual(sent['model'], 'fast')
        self.assertIn('never instructions', sent['system'])
        self.assertIn('<passage>\nOnce there was a sower.', sent['messages'][0]['content'])
        self.assertIn('The seed fell.', sent['messages'][0]['content'])          # the chapter, for grounding
        self.assertEqual(post.call_args.kwargs['headers']['x-api-key'], 'test-key')

        # Another reader asking the same: kept, not asked again, not counted.
        other = User.objects.create_user('other', 'o@x.com', 'x')
        self.client.force_authenticate(other)
        r = self.ask(kind='explain', passage='Once there was a sower.')
        self.assertTrue(r.data['cached'])
        self.assertEqual(post.call_count, 1)
        self.assertEqual(book_ai.used_today(other), 0)
        self.assertEqual(book_ai.used_today(self.reader), 1)

    @mock.patch('songs.book_ai.requests.post')
    def test_a_changed_chapter_or_another_language_is_a_new_question(self, post):
        post.return_value = answer('one')
        self.ask(kind='explain', passage='Once there was a sower.')
        self.ask(kind='explain', passage='Once there was a sower.', lang='sw')
        self.assertIn('Kiswahili', post.call_args.kwargs['json']['system'])
        Chapter.objects.filter(publication=self.pub, order=1).update(version=2)
        self.ask(kind='explain', passage='Once there was a sower.')
        self.assertEqual(post.call_count, 3)

    @mock.patch('songs.book_ai.requests.post')
    def test_define_gives_terms(self, post):
        post.return_value = answer('Here: [{"term": "sower", "meaning": "one who plants seed"}, {"x": 1}]')
        r = self.ask(kind='define', passage='Once there was a sower.')
        self.assertEqual(r.data['terms'], [{'term': 'sower', 'meaning': 'one who plants seed'}])

    @mock.patch('songs.book_ai.requests.post')
    def test_summary_needs_no_passage(self, post):
        post.return_value = answer('- A sower sows.')
        r = self.ask(kind='summary', chapter=1)
        self.assertEqual(r.data['text'], '- A sower sows.')
        self.assertIn('Ch two.', post.call_args.kwargs['json']['messages'][0]['content'])

    @mock.patch('songs.book_ai.requests.post')
    def test_the_daily_limit_and_failures(self, post):
        post.return_value = answer('x')
        for i in range(3):
            self.assertEqual(self.ask(kind='explain', passage=f'p{i}').status_code, 200)
        r = self.ask(kind='explain', passage='p3')
        self.assertEqual((r.status_code, r.data['code']), (429, 'ai_limit'))
        self.assertEqual(self.ask(kind='explain', passage='p0').status_code, 200)   # kept answers still come

        AiUsage.objects.all().delete()
        post.return_value = answer('overloaded', status=529)
        r = self.ask(kind='explain', passage='new')
        self.assertEqual((r.status_code, r.data['code']), (502, 'ai_failed'))
        self.assertEqual(book_ai.used_today(self.reader), 0)                        # a failure isn't counted
        self.assertFalse(AiAnswer.objects.filter(result__text='overloaded').exists())

    def test_what_a_reader_may_ask_about(self):
        self.assertEqual(self.ask(kind='explain').status_code, 400)                   # no passage
        self.assertEqual(self.ask(kind='poem', passage='x').status_code, 400)
        self.assertEqual(self.ask(kind='summary', chapter=9).status_code, 404)
        Chapter.objects.filter(publication=self.pub, order=2).update(status='draft')
        self.assertEqual(self.ask(kind='summary', chapter=1).status_code, 404)        # a draft isn't the reader's
        self.client.force_authenticate(None)
        self.assertEqual(self.ask(kind='summary').status_code, 401)

    @override_settings(ANTHROPIC_API_KEY='')
    def test_off_without_a_key(self):
        r = self.ask(kind='summary')
        self.assertEqual((r.status_code, r.data['code']), (503, 'ai_off'))
        r = self.client.get('/api/publications/ai-status/')
        self.assertEqual(r.data, {'enabled': False, 'limit': 3, 'used': 0})


@KEY
class WriterAiTests(Base):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.author)

    def write(self, **data):
        return self.client.post(f'/api/publications/{self.pub.id}/ai/write/', data, format='json')

    @mock.patch('songs.book_ai.requests.post')
    def test_rewrites_for_the_writers_only(self, post):
        post.return_value = answer('A tighter line.', model='big')
        r = self.write(kind='shorten', text='A long and winding line of words.')
        self.assertEqual((r.status_code, r.data['text']), (200, 'A tighter line.'))
        self.assertEqual(post.call_args.kwargs['json']['model'], 'big')
        self.assertIn('<draft>', post.call_args.kwargs['json']['messages'][0]['content'])
        self.assertEqual(self.write(kind='improve', text='  ').status_code, 400)

        editor = User.objects.create_user('ed', 'e@x.com', 'x')
        PublicationCollaborator.objects.create(publication=self.pub, user=editor, role='editor',
                                               invited_by=self.author, accepted_at=timezone.now())
        self.client.force_authenticate(editor)
        self.assertEqual(self.write(kind='grammar', text='teh').status_code, 200)
        self.client.force_authenticate(self.reader)
        self.assertEqual(self.write(kind='grammar', text='teh').status_code, 403)

    @mock.patch('songs.book_ai.requests.post')
    def test_structure_reads_the_chapters(self, post):
        post.return_value = answer('## Shape\n- Ch 1 first')
        r = self.write(kind='structure')
        self.assertEqual(r.data['text'], '## Shape\n- Ch 1 first')
        self.assertIn('Chapter 2: Ch 2', post.call_args.kwargs['json']['messages'][0]['content'])

    @mock.patch('songs.book_ai.requests.post')
    def test_the_manuscript_check(self, post):
        url = f'/api/publications/{self.pub.id}/ai/check/'
        self.assertEqual(self.client.get(url).data, {'status': None})
        r = self.client.post(url)
        self.assertEqual((r.status_code, r.data['status']), (202, 'queued'))
        self.assertEqual(self.client.post(url).data['id'], r.data['id'])              # one at a time

        post.return_value = answer(json.dumps({'issues': [
            {'chapter': 2, 'quote': 'Ch two.', 'problem': 'Named Tom in chapter 1', 'suggestion': 'Use Tim'},
            {'chapter': 9, 'quote': 'x', 'problem': 'not a chapter'},
        ]}), model='big')
        book_ai.run_check(r.data['id'])
        done = self.client.get(url).data
        self.assertEqual(done['status'], 'done')
        self.assertEqual(done['issues'], [{'chapter': 2, 'quote': 'Ch two.', 'problem': 'Named Tom in chapter 1',
                                           'suggestion': 'Use Tim'}])
        self.assertIn('=== Chapter 1: Ch 1 ===', post.call_args.kwargs['json']['messages'][0]['content'])

        # The same words again: that check. Changed words: a new one.
        self.assertEqual(self.client.post(url).data['id'], r.data['id'])
        Chapter.objects.filter(publication=self.pub, order=2).update(body='Ch two, changed.')
        self.assertNotEqual(self.client.post(url).data['id'], r.data['id'])
        self.client.force_authenticate(self.reader)
        self.assertEqual(self.client.post(url).status_code, 403)

    def test_a_failed_check_says_so(self):
        check = ManuscriptCheck.objects.create(publication=self.pub, requested_by=self.author)
        book_ai._check_failed({'check_id': check.id}, 'boom')
        self.assertEqual(self.client.get(f'/api/publications/{self.pub.id}/ai/check/').data['status'], 'failed')


class HighlightCollectionTests(Base):
    def sync(self, **op):
        return self.client.post('/api/book-highlights/sync/', {'ops': [{
            'op': 'upsert', 'client_id': 'h1', 'publication': self.pub.id, 'block': 0, 'quote': 'A sower',
            'color': 'yellow', 'at': timezone.now().isoformat(), **op}]}, format='json')

    def test_collections(self):
        self.sync(collection='  Sermon   ideas ')
        self.assertEqual(BookHighlight.objects.get().collection, 'Sermon ideas')
        self.sync()                                                                   # an older app: kept
        self.assertEqual(BookHighlight.objects.get().collection, 'Sermon ideas')
        r = self.client.get('/api/book-highlights/collections/')
        self.assertEqual(r.data['results'], [{'name': 'Sermon ideas', 'count': 1}])
        r = self.client.get('/api/book-highlights/', {'collection': 'Sermon ideas'})
        self.assertEqual([h['collection'] for h in r.data['results']], ['Sermon ideas'])
        self.sync(collection='')
        self.assertEqual(self.client.get('/api/book-highlights/collections/').data['results'], [])


class BecauseYouHighlightedTests(Base):
    def test_books_near_the_last_highlight(self):
        same_author = book(self.author, 'More by author', category='history')
        same_kind = book(User.objects.create_user('z', 'z@x.com', 'x'), 'Same kind')
        book(User.objects.create_user('y', 'y@x.com', 'x'), 'Other kind', category='health')
        started = book(self.author, 'Started')
        ReadingProgress.objects.create(user=self.reader, publication=started)
        r = self.client.get('/api/publications/home/')
        self.assertIsNone(r.data['because'])

        BookHighlight.objects.create(user=self.reader, publication=self.pub, client_id='h', quote='A sower went out',
                                     color='yellow', created_at=timezone.now(), updated_at=timezone.now())
        r = self.client.get('/api/publications/home/')
        because = r.data['because']
        self.assertEqual((because['quote'], because['title']), ('A sower went out', 'Book'))
        self.assertEqual([b['title'] for b in because['books']], [same_author.title, same_kind.title])

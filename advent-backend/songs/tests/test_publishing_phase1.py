"""Publishing phase 1: chapters saved in place with history, draft chapters,
chapter takedowns, reading activity, old pictures moved to R2, books in search.

    python manage.py test songs.tests.test_publishing_phase1 --settings=music.settings_test
"""
from datetime import timedelta
from unittest import mock

from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from songs.models import (
    User, Publication, Chapter, ChapterRevision, ReadingActivity, ReadingProgress, Block, Job, Report,
)
from songs import publishing

PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='


class Base(APITestCase):
    def setUp(self):
        self.author = User.objects.create_user('author', 'a@x.com', 'x')
        self.reader = User.objects.create_user('reader', 'r@x.com', 'x')
        self.client.force_authenticate(self.author)
        res = self.client.post('/api/publications/', {
            'title': 'Book', 'category': 'devotional', 'status': 'published', 'rights_confirmed': True,
            'chapters': [{'title': 'One', 'body': 'first words'}, {'title': 'Two', 'body': 'second words'},
                         {'title': 'Three', 'body': 'third words'}],
        }, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        self.pub = Publication.objects.get(pk=res.json()['id'])

    def chapters(self):
        return list(self.pub.chapters.order_by('order', 'id'))

    def editor(self):
        return self.client.get(f'/api/publications/{self.pub.id}/').json()['chapters']

    def save(self, chapters, **extra):
        res = self.client.patch(f'/api/publications/{self.pub.id}/', {'title': 'Book', 'chapters': chapters, **extra},
                                format='json')
        self.assertEqual(res.status_code, 200, res.content)
        return res


class InPlaceSaveTests(Base):
    def test_a_save_keeps_ids_and_versions_only_what_changed(self):
        before = self.editor()
        edited = [dict(c) for c in before]
        edited[1]['body'] = 'second words, revised'
        self.save(edited)
        after = self.chapters()
        self.assertEqual([c.pk for c in after], [c['id'] for c in before])
        self.assertEqual([c.version for c in after], [1, 2, 1])
        rev = ChapterRevision.objects.get()
        self.assertEqual((rev.chapter_ref, rev.body, rev.version, rev.reason, rev.created_by),
                         (after[1].pk, 'second words', 1, 'edit', self.author))

    def test_reordering_and_deleting_and_adding(self):
        one, two, three = self.editor()
        self.save([three, one, {'title': 'Four', 'body': 'new'}])
        titles = [(c.title, c.order) for c in self.chapters()]
        self.assertEqual(titles, [('Three', 1), ('One', 2), ('Four', 3)])
        gone = ChapterRevision.objects.get(reason='delete')
        self.assertEqual((gone.chapter_ref, gone.title), (two['id'], 'Two'))
        self.assertFalse(ChapterRevision.objects.filter(reason='edit').exists())   # a move isn't an edit

    def test_an_app_from_before_ids_matches_chapters_by_place(self):
        ids = [c.pk for c in self.chapters()]
        self.save([{'title': 'One', 'body': 'first words'}, {'title': 'Two', 'body': 'changed'},
                   {'title': 'Three', 'body': 'third words'}])
        self.assertEqual([c.pk for c in self.chapters()], ids)
        self.assertEqual(ChapterRevision.objects.count(), 1)

    def test_history_is_capped_per_chapter(self):
        ch = self.editor()
        for n in range(ChapterRevision.KEEP + 5):
            ch[0]['body'] = f'draft {n}'
            ch = self.save(ch).json()['chapters']        # the editor goes on from what was saved
        self.assertEqual(ChapterRevision.objects.filter(chapter_ref=ch[0]['id']).count(), ChapterRevision.KEEP)
        newest = ChapterRevision.objects.filter(chapter_ref=ch[0]['id']).first()
        self.assertEqual(newest.body, f'draft {ChapterRevision.KEEP + 3}')

    def test_a_takedown_survives_the_authors_save(self):
        first = self.chapters()[0]
        Chapter.objects.filter(pk=first.pk).update(is_removed=True)
        ch = self.editor()
        self.assertTrue(ch[0]['is_removed'])                    # the author sees it marked
        ch[0]['body'] = 'rewritten'
        self.save(ch)
        self.assertTrue(Chapter.objects.get(pk=first.pk).is_removed)


class ReaderVisibilityTests(Base):
    def test_draft_and_removed_chapters_are_the_authors_alone(self):
        one, two, three = self.chapters()
        Chapter.objects.filter(pk=two.pk).update(status='draft')
        Chapter.objects.filter(pk=three.pk).update(is_removed=True)
        self.client.force_authenticate(self.reader)
        toc = self.client.get(f'/api/publications/{self.pub.id}/?toc=1').json()
        self.assertEqual([c['title'] for c in toc['chapters']], ['One'])
        self.assertEqual(self.client.get(f'/api/publications/{self.pub.id}/chapters/1/').status_code, 404)
        row = next(r for r in self.client.get('/api/publications/').json()['results'] if r['id'] == self.pub.id)
        self.assertEqual(row['chapter_count'], 1)

        self.client.force_authenticate(self.author)
        toc = self.client.get(f'/api/publications/{self.pub.id}/?toc=1').json()
        self.assertEqual([(c['title'], c['status']) for c in toc['chapters']],
                         [('One', 'published'), ('Two', 'draft'), ('Three', 'published')])
        mine = self.client.get('/api/publications/mine/').json()['results'][0]
        self.assertEqual(mine['chapter_count'], 3)

    def test_a_chapter_can_be_saved_as_a_draft(self):
        ch = self.editor()
        ch[2]['status'] = 'draft'
        self.save(ch)
        self.assertEqual(self.chapters()[2].status, 'draft')

    def test_the_toc_carries_versions_for_kept_copies(self):
        toc = self.client.get(f'/api/publications/{self.pub.id}/?toc=1').json()
        self.assertEqual({c['version'] for c in toc['chapters']}, {1})


class HistoryApiTests(Base):
    def test_a_chapters_history_and_what_changed_since(self):
        ch = self.editor()
        ch[0]['body'] = 'first words\nand a new line'
        self.save(ch)
        lst = self.client.get(f'/api/publications/{self.pub.id}/revisions/?chapter={ch[0]["id"]}').json()['results']
        self.assertEqual(len(lst), 1)
        self.assertNotIn('body', lst[0])
        rev = self.client.get(f'/api/publications/{self.pub.id}/revisions/{lst[0]["id"]}/').json()
        self.assertEqual(rev['body'], 'first words')
        self.assertTrue(rev['chapter_exists'])
        self.assertEqual(rev['changes'], [{'op': 'equal', 'text': 'first words'},
                                          {'op': 'insert', 'text': 'and a new line'}])

    def test_deleted_chapters_can_be_found_again(self):
        one, two, three = self.editor()
        self.save([one, three])
        deleted = self.client.get(f'/api/publications/{self.pub.id}/revisions/').json()['results']
        self.assertEqual([(d['title'], d['reason']) for d in deleted], [('Two', 'delete')])
        rev = self.client.get(f'/api/publications/{self.pub.id}/revisions/{deleted[0]["id"]}/').json()
        self.assertEqual((rev['body'], rev['chapter_exists'], rev['changes']), ('second words', False, None))

    def test_base64_pictures_show_as_image_in_a_comparison(self):
        old = f'Text\n![pic](data:image/png;base64,{PNG})'
        self.assertEqual(publishing.diff_paragraphs(old, 'Text'),
                         [{'op': 'equal', 'text': 'Text'}, {'op': 'delete', 'text': '![pic]([image])'}])

    def test_history_is_the_authors_alone(self):
        ch = self.editor()
        ch[0]['body'] = 'changed'
        self.save(ch)
        rid = ChapterRevision.objects.get().pk
        self.client.force_authenticate(self.reader)
        self.assertEqual(self.client.get(f'/api/publications/{self.pub.id}/revisions/').status_code, 404)
        self.assertEqual(self.client.get(f'/api/publications/{self.pub.id}/revisions/{rid}/').status_code, 404)


class ReadingTests(Base):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.reader)
        self.url = f'/api/publications/{self.pub.id}/reading/'

    def post(self, events):
        return self.client.post(self.url, {'events': events}, format='json')

    def test_reading_adds_up_per_chapter_per_day(self):
        now = timezone.now()
        self.assertEqual(self.post([
            {'index': 0, 'seconds': 40, 'furthest': 0.3, 'at': now.isoformat()},
            {'index': 0, 'seconds': 50, 'furthest': 0.2, 'at': now.isoformat()},
            {'index': 1, 'seconds': 99999, 'furthest': 0.98, 'at': now.isoformat()},
        ]).json(), {'accepted': 3})
        a = ReadingActivity.objects.get(chapter_index=0)
        self.assertEqual((a.seconds, a.furthest, a.finished), (90, 0.3, False))
        b = ReadingActivity.objects.get(chapter_index=1)
        self.assertEqual((b.seconds, b.finished), (publishing.MAX_SECONDS, True))
        self.assertEqual(b.chapter_id, self.chapters()[1].pk)

    def test_the_newest_reading_sets_the_place_even_when_it_arrives_first(self):
        now = timezone.now()
        self.post([{'index': 2, 'seconds': 10, 'furthest': 0.5, 'position': 0.4, 'at': now.isoformat()}])
        # A phone that was offline yesterday reports late: it mustn't pull the place back.
        self.post([{'index': 0, 'seconds': 10, 'furthest': 1, 'at': (now - timedelta(days=1)).isoformat()}])
        rp = ReadingProgress.objects.get(user=self.reader)
        self.assertEqual((rp.last_chapter, rp.position), (2, 0.4))
        data = self.client.get(f'/api/publications/{self.pub.id}/?toc=1').json()
        self.assertEqual((data['last_read_chapter'], data['last_read_position']), (2, 0.4))
        self.assertEqual(ReadingActivity.objects.count(), 2)          # yesterday is its own day

    def test_nonsense_is_dropped(self):
        now = timezone.now()
        self.assertEqual(self.post([
            {'index': 9, 'seconds': 5, 'at': now.isoformat()},                          # no such chapter
            {'index': 0, 'seconds': 5, 'at': (now - timedelta(days=60)).isoformat()},   # too old
            {'index': 'x'}, 'junk', {'index': 0, 'seconds': 'many', 'furthest': 'far'},
        ]).json(), {'accepted': 1})
        self.assertEqual(self.post({'not': 'a list'}).status_code, 400)

    def test_a_draft_chapter_is_not_a_readers_place(self):
        Chapter.objects.filter(pk=self.chapters()[0].pk).update(status='draft')
        self.assertEqual(self.post([{'index': 2, 'seconds': 5}]).json(), {'accepted': 0})   # only 2 chapters now

    def test_reading_needs_an_account(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.post([{'index': 0, 'seconds': 5}]).status_code, 401)

    def test_epoch_milliseconds_are_understood(self):
        at = int((timezone.now() - timedelta(hours=1)).timestamp() * 1000)
        self.assertEqual(self.post([{'index': 0, 'seconds': 5, 'at': at}]).json(), {'accepted': 1})


class InlinePictureTests(Base):
    def test_a_save_with_base64_queues_the_move_and_the_job_moves_them(self):
        ch = self.editor()
        ch[0]['body'] = f'Look:\n\n![pic](data:image/png;base64,{PNG})\n\nMore'
        self.save(ch)
        job = Job.objects.get(kind='pub_inline_images')
        with mock.patch('songs.r2.put_bytes', return_value='https://r2.test/publication_images/x.png') as put:
            publishing.move_inline_images(**job.payload)
        c = Chapter.objects.get(pk=ch[0]['id'])
        self.assertEqual(c.body, 'Look:\n\n![pic](https://r2.test/publication_images/x.png)\n\nMore')
        self.assertEqual(c.version, 3)                    # the save, then the move
        self.assertEqual(put.call_args.args[2], 'image/png')
        self.assertTrue(put.call_args.args[0].startswith('publication_images/'))

    def test_the_move_retries_when_the_author_saved_meanwhile(self):
        c = self.chapters()[0]
        Chapter.objects.filter(pk=c.pk).update(body=f'![p](data:image/png;base64,{PNG})')

        def author_saves(*a, **k):
            Chapter.objects.filter(pk=c.pk).update(body=f'new words ![p](data:image/png;base64,{PNG})')
            return 'https://r2.test/x.png'
        with mock.patch('songs.r2.put_bytes', side_effect=author_saves):
            with self.assertRaises(RuntimeError):
                publishing.move_inline_images(c.pk)
        self.assertIn('new words', Chapter.objects.get(pk=c.pk).body)

    def test_the_command_queues_every_chapter_left(self):
        Chapter.objects.filter(pk=self.chapters()[1].pk).update(body=f'![p](data:image/png;base64,{PNG})')
        self.assertEqual(publishing.queue_inline_image_moves(), 1)
        self.assertEqual(publishing.queue_inline_image_moves(), 1)
        self.assertEqual(Job.objects.filter(kind='pub_inline_images', status='queued').count(), 1)   # deduped


class SearchAndReportTests(Base):
    def test_books_are_found_by_title_forgiving_typos_and_only_the_visible_ones(self):
        Publication.objects.create(title='Steps to Christ', author=self.author, status='published')
        Publication.objects.create(title='Steps drafted', author=self.author, status='draft')
        Publication.objects.create(title='Steps removed', author=self.author, status='published', is_removed=True)
        self.client.force_authenticate(self.reader)
        res = self.client.get('/api/explore/search/', {'q': 'Stepps to christ'}).json()
        self.assertEqual([b['title'] for b in res['books']], ['Steps to Christ'])
        Block.objects.create(blocker=self.reader, blocked=self.author)
        self.assertEqual(self.client.get('/api/explore/search/', {'q': 'steps to christ'}).json()['books'], [])

    def test_a_single_chapter_can_be_reported(self):
        self.client.force_authenticate(self.reader)
        chapter = self.chapters()[1]
        res = self.client.post('/api/reports/', {'content_type': 'chapter', 'object_id': chapter.pk,
                                                 'reason': 'inappropriate'}, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        from songs.views.admin import _soft_remove
        self.assertTrue(_soft_remove('chapter', chapter.pk, True))
        toc = self.client.get(f'/api/publications/{self.pub.id}/?toc=1').json()
        self.assertEqual([c['title'] for c in toc['chapters']], ['One', 'Three'])
        from songs.serializers.admin import build_report_targets
        preview = build_report_targets([Report.objects.get()])[('chapter', chapter.pk)]
        self.assertEqual(preview['title'], 'Book · Two')

"""Publishing phase 4, the Writer Studio: scheduled chapters, the rights
confirmation, conflicts between writers, collaborators, EPUB export, covers.

    python manage.py test songs.tests.test_publishing_phase4 --settings=music.settings_test
"""
import io
import zipfile
from datetime import timedelta
from unittest import mock

from django.utils import timezone
from rest_framework.test import APITestCase

from songs.models import (
    User, Publication, Chapter, Job, PublicationCollaborator, PublicationExport, Block,
)
from songs import publishing, writer_studio

PNG = ('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')


class Base(APITestCase):
    def setUp(self):
        self.author = User.objects.create_user('author', 'a@x.com', 'x')
        self.other = User.objects.create_user('other', 'o@x.com', 'x')
        self.client.force_authenticate(self.author)
        res = self.client.post('/api/publications/', {
            'title': 'Book', 'category': 'devotional', 'status': 'published', 'rights_confirmed': True,
            'chapters': [{'title': 'One', 'body': 'first'}, {'title': 'Two', 'body': 'second'}],
        }, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        self.pub = Publication.objects.get(pk=res.json()['id'])

    def editor(self, who=None):
        if who:
            self.client.force_authenticate(who)
        return self.client.get(f'/api/publications/{self.pub.id}/').json()['chapters']

    def save(self, chapters, **extra):
        return self.client.patch(f'/api/publications/{self.pub.id}/',
                                 {'title': 'Book', 'chapters': chapters, **extra}, format='json')


class RightsTests(APITestCase):
    def setUp(self):
        self.author = User.objects.create_user('author', 'a@x.com', 'x')
        self.client.force_authenticate(self.author)

    def test_publishing_asks_once_for_the_rights_confirmation(self):
        body = {'title': 'B', 'category': 'other', 'status': 'published', 'chapters': [{'title': 'a', 'body': 'b'}]}
        res = self.client.post('/api/publications/', body, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()['code'], 'rights_required')
        res = self.client.post('/api/publications/', {**body, 'rights_confirmed': True}, format='json')
        self.assertEqual(res.status_code, 201)
        pub = Publication.objects.get()
        self.assertIsNotNone(pub.rights_confirmed_at)
        # Later saves (and unpublish / republish) don't ask again.
        self.assertEqual(self.client.patch(f'/api/publications/{pub.id}/', {'status': 'draft'}, format='json').status_code, 200)
        self.assertEqual(self.client.patch(f'/api/publications/{pub.id}/', {'status': 'published'}, format='json').status_code, 200)

    def test_drafts_need_no_confirmation(self):
        res = self.client.post('/api/publications/', {'title': 'B', 'category': 'other', 'status': 'draft',
                                                      'chapters': [{'title': 'a', 'body': 'b'}]}, format='json')
        self.assertEqual(res.status_code, 201)


class ConflictTests(Base):
    def test_a_chapter_changed_elsewhere_is_not_silently_overwritten(self):
        mine = self.editor()                                  # this phone opens the book
        theirs = [dict(c) for c in mine]
        theirs[0]['body'] = 'changed on another phone'
        self.assertEqual(self.save(theirs).status_code, 200)

        mine[0]['body'] = 'my edit'
        mine[1]['body'] = 'second, edited too'
        res = self.save(mine)
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()['chapters'], [{'id': mine[0]['id'], 'title': 'One', 'version': 2}])
        self.assertEqual(Chapter.objects.get(pk=mine[1]['id']).body, 'second')   # nothing was saved
        # Keeping mine: saved, and what it replaced is in the history.
        self.assertEqual(self.save(mine, force=True).status_code, 200)
        self.assertEqual(Chapter.objects.get(pk=mine[0]['id']).body, 'my edit')
        self.assertTrue(self.pub.revisions.filter(body='changed on another phone').exists())

    def test_the_book_is_left_as_it_was_on_a_conflict(self):
        mine = self.editor()
        theirs = [dict(c) for c in mine]
        theirs[0]['body'] = 'x'
        self.save(theirs)
        mine[0]['body'] = 'y'
        self.client.patch(f'/api/publications/{self.pub.id}/', {'title': 'Renamed', 'chapters': mine}, format='json')
        self.pub.refresh_from_db()
        self.assertEqual(self.pub.title, 'Book')

    def test_an_untouched_chapter_is_not_a_conflict(self):
        mine = self.editor()
        theirs = [dict(c) for c in mine]
        theirs[0]['body'] = 'changed elsewhere'
        self.save(theirs)
        mine[1]['body'] = 'only chapter two'                   # chapter one sent as it was opened
        mine[0]['body'] = 'first'
        # Chapter one's words differ from now: that's a conflict. Sent as now: fine.
        mine[0]['body'] = 'changed elsewhere'
        self.assertEqual(self.save(mine).status_code, 200)


class ScheduleTests(Base):
    def test_a_scheduled_chapter_goes_out_on_time_and_readers_are_told(self):
        ch = self.editor()
        when = timezone.now() + timedelta(days=2)
        ch.append({'title': 'Three', 'body': 'soon', 'status': 'draft', 'publish_at': when.isoformat()})
        self.assertEqual(self.save(ch).status_code, 200)
        three = Chapter.objects.get(title='Three')
        job = Job.objects.get(kind='publish_chapter')
        self.assertEqual((job.payload['chapter_id'], job.run_after), (three.pk, three.publish_at))

        self.client.force_authenticate(self.other)
        data = self.client.get(f'/api/publications/{self.pub.id}/?toc=1').json()
        self.assertEqual([c['title'] for c in data['chapters']], ['One', 'Two'])
        self.assertEqual([u['title'] for u in data['upcoming']], ['Three'])

        # Too early: it waits.
        publishing.publish_chapter(three.pk)
        self.assertEqual(Chapter.objects.get(pk=three.pk).status, 'draft')
        # Its time comes.
        Chapter.objects.filter(pk=three.pk).update(publish_at=timezone.now() - timedelta(minutes=1))
        with mock.patch('songs.book_community.notify_new_chapters') as told:
            publishing.publish_chapter(three.pk)
        c = Chapter.objects.get(pk=three.pk)
        self.assertEqual((c.status, c.publish_at), ('published', None))
        told.assert_called_once()

    def test_rescheduling_moves_the_waiting_job(self):
        ch = self.editor()
        ch.append({'title': 'Three', 'body': 'soon', 'status': 'draft',
                   'publish_at': (timezone.now() + timedelta(days=5)).isoformat()})
        ch = self.save(ch).json()['chapters']
        sooner = timezone.now() + timedelta(days=1)
        ch[2]['publish_at'] = sooner.isoformat()
        self.save(ch)
        self.assertEqual(Job.objects.filter(kind='publish_chapter', status='queued').count(), 1)
        self.assertLess(abs((Job.objects.get(kind='publish_chapter').run_after - sooner).total_seconds()), 1)

    def test_publishing_now_clears_the_schedule(self):
        ch = self.editor()
        ch.append({'title': 'Three', 'body': 'x', 'status': 'draft',
                   'publish_at': (timezone.now() + timedelta(days=5)).isoformat()})
        ch = self.save(ch).json()['chapters']
        ch[2]['status'] = 'published'
        self.save(ch)
        self.assertIsNone(Chapter.objects.get(title='Three').publish_at)


class CollaboratorTests(Base):
    def invite(self, role='editor'):
        self.client.force_authenticate(self.author)
        with mock.patch('songs.push.notify_user') as told:
            res = self.client.post(f'/api/publications/{self.pub.id}/collaborators/',
                                   {'username': '@other', 'role': role}, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        told.assert_called_once()
        return res.json()['id']

    def test_invite_accept_and_edit_but_not_publish(self):
        draft = Chapter.objects.create(publication=self.pub, order=3, title='Draft', body='d', status='draft')
        cid = self.invite('coauthor')
        self.client.force_authenticate(self.other)
        # Not yet accepted: nothing more than any reader.
        self.assertEqual(self.client.patch(f'/api/publications/{self.pub.id}/', {'title': 'x'}, format='json').status_code, 403)
        inv = self.client.get('/api/publications/invitations/').json()['results']
        self.assertEqual([(i['id'], i['title']) for i in inv], [(cid, 'Book')])
        self.assertEqual(self.client.post(f'/api/publications/invitations/{cid}/accept/').status_code, 200)

        ch = self.editor(self.other)
        self.assertIn(draft.pk, [c['id'] for c in ch])            # sees the drafts
        ch[0]['body'] = 'a co-author\'s edit'
        self.assertEqual(self.save(ch).status_code, 200)
        self.assertEqual(self.client.patch(f'/api/publications/{self.pub.id}/', {'status': 'draft'}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(f'/api/publications/{self.pub.id}/').status_code, 403)
        mine = [p['title'] for p in self.client.get('/api/publications/mine/').json()['results']]
        self.assertEqual(mine, ['Book'])
        self.assertEqual(self.client.get(f'/api/publications/{self.pub.id}/').json()['my_role'], 'coauthor')

    def test_a_viewer_reads_drafts_but_does_not_edit(self):
        cid = self.invite('viewer')
        self.client.force_authenticate(self.other)
        self.client.post(f'/api/publications/invitations/{cid}/accept/')
        self.assertEqual(self.client.patch(f'/api/publications/{self.pub.id}/', {'title': 'x'}, format='json').status_code, 403)

    def test_decline_leave_and_remove(self):
        cid = self.invite()
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.post(f'/api/publications/invitations/{cid}/decline/').status_code, 204)
        self.assertFalse(PublicationCollaborator.objects.exists())
        cid = self.invite()
        self.client.force_authenticate(self.other)
        self.client.post(f'/api/publications/invitations/{cid}/accept/')
        self.assertEqual(self.client.delete(f'/api/publications/{self.pub.id}/collaborators/{cid}/').status_code, 204)

    def test_only_the_author_invites_and_not_just_anyone(self):
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.post(f'/api/publications/{self.pub.id}/collaborators/', {'username': 'author'},
                                          format='json').status_code, 403)
        self.client.force_authenticate(self.author)
        Block.objects.create(blocker=self.other, blocked=self.author)
        res = self.client.post(f'/api/publications/{self.pub.id}/collaborators/', {'username': 'other'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(self.client.post(f'/api/publications/{self.pub.id}/collaborators/', {'username': 'nobody'},
                                          format='json').status_code, 400)


class ExportTests(Base):
    def test_epub_is_a_real_epub(self):
        Chapter.objects.filter(publication=self.pub, order=1).update(
            body=f'Grace[^1] and peace.\n\n![pic](data:image/png;base64,{PNG})\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[^1]: A footnote.')
        data = writer_studio.build_epub(self.pub)
        z = zipfile.ZipFile(io.BytesIO(data))
        names = z.namelist()
        self.assertEqual(names[0], 'mimetype')
        self.assertEqual(z.getinfo('mimetype').compress_type, zipfile.ZIP_STORED)
        self.assertEqual(z.read('mimetype'), b'application/epub+zip')
        self.assertIn('OEBPS/nav.xhtml', names)
        ch1 = z.read('OEBPS/chapter1.xhtml').decode()
        self.assertIn('<sup>1</sup>', ch1)
        self.assertIn('A footnote.', ch1)
        self.assertIn('<table>', ch1)
        self.assertIn('src="images/img1.png"', ch1)
        self.assertIn('OEBPS/images/img1.png', names)
        # Every page is well-formed XML.
        from xml.dom import minidom
        for n in names:
            if n.endswith(('.xhtml', '.opf', '.xml')):
                minidom.parseString(z.read(n))

    def test_another_sites_pictures_are_not_fetched(self):
        self.assertIsNone(writer_studio._fetch_image('https://evil.example/x.png'))

    def test_export_through_the_worker(self):
        res = self.client.post(f'/api/publications/{self.pub.id}/export/')
        self.assertEqual(res.status_code, 202)
        job = Job.objects.get(kind='pub_export')
        with mock.patch('songs.r2.put_bytes', return_value='https://r2.test/exports/1/x/book.epub') as put:
            writer_studio.run_export(**job.payload)
        self.assertEqual(put.call_args.args[2], 'application/epub+zip')
        got = self.client.get(f'/api/publications/{self.pub.id}/export/').json()
        self.assertEqual((got['status'], got['url']), ('done', 'https://r2.test/exports/1/x/book.epub'))

    def test_a_failed_export_says_so(self):
        exp = writer_studio.request_export(self.pub, self.author)
        writer_studio._export_failed({'export_id': exp.id}, RuntimeError('R2 is not configured'))
        self.assertEqual(PublicationExport.objects.get().status, 'failed')

    def test_readers_cannot_export(self):
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.post(f'/api/publications/{self.pub.id}/export/').status_code, 403)


class CoverTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('author', 'a@x.com', 'x')
        self.client.force_authenticate(self.user)

    def test_every_template_draws_a_cover(self):
        from PIL import Image
        photo = io.BytesIO()
        Image.new('RGB', (300, 300), '#884422').save(photo, 'JPEG')
        for tpl in writer_studio.TEMPLATES:
            data = writer_studio.render_cover(tpl, 'The Silent Path of a Very Long Title Indeed', author='Mark',
                                              subtitle='A devotional', palette='wine', image=photo.getvalue())
            img = Image.open(io.BytesIO(data))
            self.assertEqual((img.format, img.size), ('JPEG', (1200, 1800)))

    def test_the_endpoint(self):
        with mock.patch('songs.r2.put_bytes', return_value='https://r2.test/cover_images/c.jpg') as put:
            res = self.client.post('/api/publications/cover-render/', {'template': 'classic', 'title': 'Steps'}, format='json')
        self.assertEqual(res.json(), {'url': 'https://r2.test/cover_images/c.jpg'})
        self.assertTrue(put.call_args.args[0].startswith('cover_images/'))
        self.assertEqual(self.client.post('/api/publications/cover-render/', {'title': ' '}, format='json').status_code, 400)

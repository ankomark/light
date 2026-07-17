"""Notice board ordering + query-count guards.

    python manage.py test songs.tests.test_notice_board --settings=music.settings_test
"""
from datetime import datetime, timezone as dt_timezone

from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from songs.models import User, Notice, AdminNote


def _t(h):
    return datetime(2026, 1, 1, h, 0, 0, tzinfo=dt_timezone.utc)


class NoticeBoardOrderingTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user('nb_admin', 'nba@x.com', 'x')
        self.admin.is_staff = True
        self.admin.save(update_fields=['is_staff'])
        self.reader = User.objects.create_user('nb_reader', 'nbr@x.com', 'x')

    def _notice(self, title, when, pinned=False):
        n = Notice.objects.create(title=title, body='body', created_by=self.admin, is_pinned=pinned)
        Notice.objects.filter(pk=n.pk).update(created_at=when)  # created_at is auto_now_add
        return n

    def test_pinned_first_then_newest(self):
        self._notice('A old', _t(1))
        self._notice('B new', _t(3))
        self._notice('C pinned old', _t(2), pinned=True)

        self.client.force_authenticate(self.reader)
        rows = self.client.get('/api/notices/').json()['results']
        # Pinned floats to the top even though it's older; the rest are newest-first.
        self.assertEqual([r['title'] for r in rows], ['C pinned old', 'B new', 'A old'])

    def test_list_query_count_is_constant(self):
        self.client.force_authenticate(self.reader)

        def load_count():
            with CaptureQueriesContext(connection) as ctx:
                r = self.client.get('/api/notices/')
                self.assertEqual(r.status_code, 200)
            return len(ctx.captured_queries)

        for i in range(2):
            self._notice(f'n{i}', _t(1))
        few = load_count()
        for i in range(5):
            self._notice(f'm{i}', _t(1))
        many = load_count()
        # created_by is select_related, so 7 notices cost no more queries than 2.
        self.assertEqual(few, many, f'notice list scales per-row: {few} -> {many}')


class AdminInboxOrderingTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user('ai_admin', 'aia@x.com', 'x')
        self.admin.is_staff = True
        self.admin.save(update_fields=['is_staff'])
        self.user = User.objects.create_user('ai_user', 'aiu@x.com', 'x')

    def _note(self, body, when):
        n = AdminNote.objects.create(sender=self.user, body=body, is_read=False)
        AdminNote.objects.filter(pk=n.pk).update(created_at=when)
        return n

    def test_inbox_newest_first(self):
        self._note('first', _t(1))
        self._note('second', _t(2))
        self.client.force_authenticate(self.admin)
        rows = self.client.get('/api/admin-notes/').json()['results']
        self.assertEqual([r['body'] for r in rows], ['second', 'first'])

"""The notice board: reaching people, admin tools, richer notices.

    python manage.py test songs.tests.test_notices --settings=music.settings_test
"""
from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from songs.models import User, Notice, DeviceToken, NotificationPreference


class Base(APITestCase):
    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_user('nadmin', 'na@x.com', 'x', is_staff=True)
        self.reader = User.objects.create_user('nreader', 'nr@x.com', 'x')
        self.quiet = User.objects.create_user('nquiet', 'nq@x.com', 'x')
        for u in (self.admin, self.reader, self.quiet):
            DeviceToken.objects.create(user=u, token=f'ExponentPushToken[{u.username}]', is_active=True)
        NotificationPreference.objects.create(user=self.quiet, notices=False)
        # Joined a while ago, so older notices would count as new.
        User.objects.filter(pk__in=[self.reader.pk, self.quiet.pk]).update(date_joined=timezone.now() - timedelta(days=30))
        self.reader.refresh_from_db()

    def post(self, **data):
        self.client.force_authenticate(self.admin)
        return self.client.post('/api/notices/', {'title': 'Camp meeting', 'body': 'Friday at 6', **data}, format='json')


class ReachTests(Base):
    def test_a_new_notice_is_pushed_to_everyone_who_wants_it(self):
        pushed = []
        with mock.patch('songs.push.send_expo_push', side_effect=lambda tokens, *a, **k: pushed.extend(tokens)):
            self.assertEqual(self.post().status_code, 201)
        self.assertEqual(pushed, ['ExponentPushToken[nreader]'])    # not the poster, not who turned it off

    def test_new_until_seen_and_the_badge(self):
        self.post()
        self.client.force_authenticate(self.reader)
        rows = self.client.get('/api/notices/').json()['results']
        self.assertTrue(rows[0]['is_new'])
        self.assertEqual(self.client.get('/api/notices/unseen/').json()['count'], 1)
        self.assertEqual(self.client.get('/api/conversations/unread_count/').json()['notices'], 1)
        self.client.post('/api/notices/seen/')
        self.reader.refresh_from_db()                     # (each request loads the user afresh)
        self.client.force_authenticate(self.reader)
        self.assertEqual(self.client.get('/api/notices/unseen/').json()['count'], 0)
        self.assertFalse(self.client.get('/api/notices/').json()['results'][0]['is_new'])

    def test_my_own_notice_is_not_new_to_me(self):
        self.post()
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get('/api/notices/unseen/').json()['count'], 0)

class AdminToolTests(Base):
    def test_scheduled_notices_wait_then_go_live_and_are_announced_once(self):
        pushed = []
        later = timezone.now() + timedelta(hours=2)
        with mock.patch('songs.push.send_expo_push', side_effect=lambda tokens, *a, **k: pushed.extend(tokens)):
            r = self.post(publish_at=later.isoformat())
            self.assertEqual(r.status_code, 201)
            nid = r.json()['id']
            self.assertEqual(r.json()['status'], 'scheduled')
            self.assertEqual(pushed, [])                                 # not yet
            self.client.force_authenticate(self.reader)
            self.assertEqual(self.client.get('/api/notices/').json()['results'], [])
            self.client.force_authenticate(self.admin)
            self.assertEqual(len(self.client.get('/api/notices/').json()['results']), 1)   # managers see it
            # Its time comes (the worker may not run): the next load announces it, once.
            Notice.objects.filter(pk=nid).update(publish_at=timezone.now() - timedelta(minutes=1))
            self.client.force_authenticate(self.reader)
            self.assertEqual(len(self.client.get('/api/notices/').json()['results']), 1)
            self.client.get('/api/notices/')
        self.assertEqual(pushed, ['ExponentPushToken[nreader]'])

    def test_the_job_announces_a_scheduled_notice(self):
        from songs.notice_jobs import announce_scheduled_notice
        n = Notice.objects.create(title='t', body='b', created_by=self.admin,
                                  publish_at=timezone.now() - timedelta(seconds=1))
        with mock.patch('songs.push.send_expo_push') as send:
            announce_scheduled_notice(n.id)
            announce_scheduled_notice(n.id)
        self.assertEqual(send.call_count, 1)

    def test_expired_notices_leave_the_board(self):
        Notice.objects.create(title='old', body='b', created_by=self.admin, announced=True,
                              expires_at=timezone.now() - timedelta(minutes=1))
        self.client.force_authenticate(self.reader)
        self.assertEqual(self.client.get('/api/notices/').json()['results'], [])
        self.assertEqual(self.client.get('/api/notices/unseen/').json()['count'], 0)
        bad = self.post(publish_at=timezone.now().isoformat(), expires_at=(timezone.now() - timedelta(hours=1)).isoformat())
        self.assertEqual(bad.status_code, 400)

    def test_edit_marks_edited(self):
        nid = self.post().json()['id']
        r = self.client.patch(f'/api/notices/{nid}/', {'body': 'Friday at 7'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertIsNotNone(r.json()['edited_at'])
        pinned = self.client.patch(f'/api/notices/{nid}/', {'is_pinned': True}, format='json').json()
        self.assertEqual(pinned['edited_at'], r.json()['edited_at'])       # pinning isn't an edit

    def test_a_role_with_manage_notices_may_post_others_may_not(self):
        from songs.models import Role
        role = Role.objects.create(name='Communications', capabilities=['manage_notices'])
        comms = User.objects.create_user('ncomms', 'nc@x.com', 'x')
        comms.role = role
        comms.save()
        self.client.force_authenticate(comms)
        self.assertEqual(self.client.post('/api/notices/', {'title': 't', 'body': 'b'}, format='json').status_code, 201)
        self.client.force_authenticate(self.reader)
        self.assertEqual(self.client.post('/api/notices/', {'title': 't', 'body': 'b'}, format='json').status_code, 403)
        self.assertEqual(self.client.get('/api/admin-notes/').status_code, 403)

    def test_notes_are_rate_limited_answered_and_the_sender_sees_it(self):
        self.client.force_authenticate(self.reader)
        codes = [self.client.post('/api/admin-notes/', {'body': f'note {i}'}, format='json').status_code for i in range(6)]
        self.assertEqual(codes, [201] * 5 + [429])
        nid = self.client.get('/api/admin-notes/mine/').json()['results'][0]['id']
        self.client.force_authenticate(self.admin)
        with mock.patch('songs.push.send_expo_push') as send:
            r = self.client.post(f'/api/admin-notes/{nid}/reply/', {'reply': 'Thanks, fixing it'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(send.call_count, 1)
        self.client.force_authenticate(self.reader)
        mine = self.client.get('/api/admin-notes/mine/').json()['results'][0]
        self.assertEqual((mine['reply'], mine['is_read'], mine['replied_by_username']), ('Thanks, fixing it', True, 'nadmin'))
        # Someone else's notes aren't theirs to read.
        other = User.objects.create_user('nother', 'no@x.com', 'x')
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get('/api/admin-notes/mine/').json()['results'], [])

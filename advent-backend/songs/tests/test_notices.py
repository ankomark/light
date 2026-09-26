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
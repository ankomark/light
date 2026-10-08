"""List screens do not cost one query per row (N+1).

Each list is read with 2 rows, then with 8: the number of queries must not
grow with the rows (a little slack for a page count). One query per row is a
list of 50 making 50+ trips to the database - fast in testing, slow live.

    python manage.py test songs.tests.test_list_query_growth --settings=music.settings_test
"""
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from songs import models as m

SLACK = 2


class ListQueryGrowthTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.me = m.User.objects.create_user('me', 'me@x.com', 'pw-12345678', is_email_verified=True)
        self.n = 0

    def _people(self, k):
        self.n += 1
        return [m.User.objects.create_user(f'p{self.n}_{i}', f'p{self.n}_{i}@x.com', 'pw') for i in range(k)]

    def _make(self, kind, k):
        me = self.me
        people = self._people(k)
        for i, p in enumerate(people):
            if kind == 'conversations':
                c = m.Conversation.objects.create()
                c.participants.add(me, p)
                m.Message.objects.create(conversation=c, sender=p, content=f'hi {i}')
            elif kind == 'notifications':
                m.Notification.objects.create(recipient=me, sender=p, message=f'n{i}', notification_type='follow')
            elif kind == 'orders':
                m.Order.objects.create(buyer=me, total_amount=10 + i)
            elif kind == 'live':
                m.LiveBroadcast.objects.create(host=p, kind='meet', title=f'Live {i}', room_name=f'r{self.n}_{i}')
            elif kind == 'services':
                m.Videostudio.objects.create(name=f'S{i}', location='Nairobi', created_by=p)
            elif kind == 'stations':
                m.MediaStation.objects.create(name=f'M{self.n}_{i}', created_by=p)
            elif kind == 'live_events':
                m.LiveEvent.objects.create(user=p, youtube_url='https://youtu.be/dQw4w9WgXcQ', title=f'E{i}')
            elif kind == 'albums':
                m.Album.objects.create(artist=p, title=f'A{i}')
            elif kind == 'playlists':
                m.Playlist.objects.create(user=me, name=f'P{self.n}_{i}')
            elif kind == 'notes':
                m.AdminNote.objects.create(sender=me, body=f'note {i}')

    def _count(self, url):
        self.client.force_authenticate(self.me)
        with CaptureQueriesContext(connection) as ctx:
            r = self.client.get(url)
        self.assertLess(r.status_code, 400, f'{url}: {r.status_code}')
        return len(ctx.captured_queries)

    def test_lists_do_not_grow_with_their_rows(self):
        cases = [
            ('conversations', '/api/conversations/'),
            ('notifications', '/api/notifications/'),
            ('orders', '/api/marketplace/orders/'),
            ('live', '/api/live/broadcasts/'),
            ('services', '/api/video-studios/'),
            ('stations', '/api/media-stations/'),
            ('live_events', '/api/live-events/'),
            ('albums', '/api/albums/'),
            ('playlists', '/api/playlists/'),
            ('notes', '/api/admin-notes/mine/'),
        ]
        growth = []
        for kind, url in cases:
            self._make(kind, 2)
            few = self._count(url)
            self._make(kind, 6)            # 8 in all
            many = self._count(url)
            if many - few > SLACK:
                growth.append(f'{url}: {few} queries for 2 rows, {many} for 8')
            cache.clear()
        self.assertEqual(growth, [], '\n' + '\n'.join(growth))

"""Takedown for organization pages, book clubs and live broadcasts: listed in
the admin content screen, removed with a reason, then gone from every place
they show; a live broadcast also ends. Restore brings them back.

    python manage.py test songs.tests.test_admin_takedown_more --settings=music.settings_test
"""
from datetime import date

from rest_framework.test import APITestCase

from songs.models import AdminActionLog, BookClub, Group, LiveBroadcast, Organization, Publication, User


def _admin(name):
    u = User.objects.create_user(name, f'{name}@x.com', 'x')
    u.admin_role = 'super_admin'
    u.is_superuser = True
    u.is_staff = True
    u.save(update_fields=['admin_role', 'is_superuser', 'is_staff'])
    return u


class TakedownTests(APITestCase):
    def setUp(self):
        self.boss = _admin('td_boss')
        self.member = User.objects.create_user('td_member', 'm@x.com', 'x')
        self.org = Organization.objects.create(name='Hope Church', slug='hope', created_by=self.member)
        pub = Publication.objects.create(title='Steps to Christ', author=self.member, status='published')
        group = Group.objects.create(creator=self.member, name='Steps readers', slug='steps-readers')
        self.club = BookClub.objects.create(group=group, publication=pub, created_by=self.member, starts_on=date.today())
        self.live = LiveBroadcast.objects.create(host=self.member, title='Vespers', room_name='room-td-1')

    def remove(self, ctype, oid):
        self.client.force_authenticate(self.boss)
        return self.client.post('/api/admin/content/remove/', {'type': ctype, 'id': oid, 'reason': 'Breaks the rules'},
                                format='json')

    def as_member(self):
        self.client.force_authenticate(self.member)

    def test_admin_lists_each_new_type(self):
        self.client.force_authenticate(self.boss)
        for ctype, oid in (('organization', self.org.id), ('bookclub', self.club.id), ('livebroadcast', self.live.id)):
            res = self.client.get('/api/admin/content/', {'type': ctype})
            self.assertEqual(res.status_code, 200, (ctype, res.content[:200]))
            self.assertIn(oid, [r['id'] for r in res.json()['results']], ctype)

    def test_an_organization_taken_down_is_gone_and_comes_back(self):
        self.assertEqual(self.remove('organization', self.org.id).status_code, 200)
        self.as_member()
        self.assertNotIn('hope', [o['slug'] for o in self.client.get('/api/organizations/').json()['results']])
        self.assertEqual(self.client.get('/api/organizations/hope/').status_code, 404)
        self.assertTrue(AdminActionLog.objects.filter(action='remove_organization').exists())

        self.client.force_authenticate(self.boss)
        self.client.post('/api/admin/content/restore/', {'type': 'organization', 'id': self.org.id}, format='json')
        self.as_member()
        self.assertEqual(self.client.get('/api/organizations/hope/').status_code, 200)

    def test_a_book_club_taken_down_is_gone_but_its_group_stays(self):
        self.assertEqual(self.remove('bookclub', self.club.id).status_code, 200)
        self.as_member()
        self.assertEqual(self.client.get(f'/api/publications/clubs/{self.club.id}/').status_code, 404)
        self.assertIsNone(self.client.get('/api/publications/clubs/by-group/steps-readers/').json()['club'])
        self.assertFalse(Group.objects.get(slug='steps-readers').is_removed)

    def test_a_live_broadcast_taken_down_ends_and_is_gone(self):
        self.assertEqual(self.remove('livebroadcast', self.live.id).status_code, 200)
        self.live.refresh_from_db()
        self.assertEqual(self.live.status, 'ended')
        self.assertIsNotNone(self.live.ended_at)
        self.as_member()
        self.assertEqual(self.client.get(f'/api/live/broadcasts/{self.live.id}/').status_code, 404)

    def test_bulk_takedown_of_live_broadcasts_ends_them_too(self):
        other = LiveBroadcast.objects.create(host=self.member, title='Choir', room_name='room-td-2')
        self.client.force_authenticate(self.boss)
        res = self.client.post('/api/admin/content/bulk/', {'type': 'livebroadcast', 'ids': [self.live.id, other.id],
                                                            'action': 'remove', 'reason': 'Spam rooms'}, format='json')
        self.assertEqual(res.status_code, 200, res.content[:200])
        self.assertEqual(set(LiveBroadcast.objects.values_list('status', flat=True)), {'ended'})

    def test_people_without_the_capability_cannot(self):
        self.as_member()
        res = self.client.post('/api/admin/content/remove/', {'type': 'organization', 'id': self.org.id, 'reason': 'x y z'},
                               format='json')
        self.assertIn(res.status_code, (401, 403))

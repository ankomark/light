"""Groups & communities upgrade: speed, live, security, member features.

    python manage.py test songs.tests.test_groups_upgrade --settings=music.settings_test
"""
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from songs.models import User, Group, GroupMember, GroupPost


class Base(APITestCase):
    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user('gowner', 'go@x.com', 'x')
        self.member = User.objects.create_user('gmember', 'gm@x.com', 'x')
        self.outsider = User.objects.create_user('goutsider', 'gx@x.com', 'x')
        self.group = Group.objects.create(creator=self.owner, name='Choir')
        GroupMember.objects.create(group=self.group, user=self.owner, is_admin=True)
        GroupMember.objects.create(group=self.group, user=self.member)

    def url(self, tail=''):
        return f'/api/groups/{self.group.slug}/{tail}'


class MembersListTests(Base):
    def test_paged_with_admins_first_and_search(self):
        for i in range(45):
            u = User.objects.create_user(f'singer{i:02d}', f's{i}@x.com', 'x')
            GroupMember.objects.create(group=self.group, user=u)
        self.client.force_authenticate(self.member)
        r = self.client.get(self.url('members/'), {'paged': 1, 'page_size': 20})
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body['count'], 47)
        self.assertEqual(len(body['results']), 20)
        self.assertTrue(body['next'])
        self.assertTrue(body['results'][0]['is_admin'])              # the owner leads
        r = self.client.get(self.url('members/'), {'paged': 1, 'q': 'singer4'})
        names = sorted(m['user']['username'] for m in r.json()['results'])
        self.assertEqual(names, [f'singer{i}' for i in range(40, 45)])

    def test_old_builds_still_get_the_whole_list(self):
        self.client.force_authenticate(self.member)
        r = self.client.get(self.url('members/'))
        self.assertIsInstance(r.json(), list)
        self.assertEqual(len(r.json()), 2)

    def test_outsider_cannot_list_members(self):
        self.client.force_authenticate(self.outsider)
        r = self.client.get(self.url('members/'), {'paged': 1})
        self.assertIn(r.status_code, (403, 404))


class CursorTests(Base):
    def test_messages_in_the_same_instant_are_all_reached(self):
        same = timezone.now() - timedelta(minutes=5)
        posts = [GroupPost.objects.create(group=self.group, user=self.owner, content=f'p{i}') for i in range(4)]
        GroupPost.objects.filter(pk__in=[p.pk for p in posts]).update(created_at=same)
        self.client.force_authenticate(self.member)
        # After the first of the four: the other three, in order.
        r = self.client.get(self.url('posts/'), {'after': posts[0].id})
        self.assertEqual([p['id'] for p in r.json()['results']], [p.id for p in posts[1:]])
        # Before the last: the first three, newest first.
        r = self.client.get(self.url('posts/'), {'before': posts[3].id})
        self.assertEqual([p['id'] for p in r.json()['results']], [p.id for p in reversed(posts[:3])])

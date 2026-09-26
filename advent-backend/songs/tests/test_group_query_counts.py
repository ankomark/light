"""Groups stay fast as they grow: the list, a group, a page of its chat,
sending and reacting cost the same number of queries for 3 rows or 15.

    python manage.py test songs.tests.test_group_query_counts --settings=music.settings_test
"""
from django.core.cache import cache
from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from songs.models import User, Group, GroupMember, GroupPost, GroupPostReaction


def count(fn):
    with CaptureQueriesContext(connection) as ctx:
        r = fn()
    assert r.status_code < 300, (r.status_code, r.content[:300])
    return len(ctx.captured_queries)


@override_settings(R2_PUBLIC_BASE='https://cdn.example')
class GroupQueryCountTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.me = User.objects.create_user('qcme', 'qm@x.com', 'x')
        self.them = [User.objects.create_user(f'qc{i}', f'q{i}@x.com', 'x') for i in range(4)]

    def make_groups(self, n):
        for i in range(n):
            g = Group.objects.create(creator=self.them[0], name=f'G{i}-{n}')
            GroupMember.objects.create(group=g, user=self.me)
            GroupMember.objects.create(group=g, user=self.them[0], is_admin=True)
            GroupPost.objects.create(group=g, user=self.them[0], content='hello')

    def make_chat(self, n):
        g = Group.objects.create(creator=self.them[0], name=f'Chat{n}')
        GroupMember.objects.create(group=g, user=self.me)
        for u in self.them:
            GroupMember.objects.create(group=g, user=u)
        prev = None
        for i in range(n):
            p = GroupPost.objects.create(group=g, user=self.them[i % 4], content=f'm{i}', reply_to=prev)
            GroupPostReaction.objects.create(post=p, user=self.them[(i + 1) % 4], emoji='🙏')
            prev = p
        return g

    def test_the_list_is_flat(self):
        self.client.force_authenticate(self.me)
        self.make_groups(3)
        self.client.get('/api/groups/', {'scope': 'mine'})             # warm the shared caches
        few = count(lambda: self.client.get('/api/groups/', {'scope': 'mine'}))
        self.make_groups(12)
        many = count(lambda: self.client.get('/api/groups/', {'scope': 'mine'}))
        self.assertEqual(few, many)
        self.assertLessEqual(many, 8)

    def test_a_chat_page_is_flat(self):
        self.client.force_authenticate(self.me)
        small = self.make_chat(3)
        big = self.make_chat(15)
        self.client.get(f'/api/groups/{small.slug}/posts/')             # warm the shared caches
        few = count(lambda: self.client.get(f'/api/groups/{small.slug}/posts/'))
        many = count(lambda: self.client.get(f'/api/groups/{big.slug}/posts/'))
        self.assertEqual(few, many)
        self.assertLessEqual(many, 7)
        first = GroupPost.objects.filter(group=big).order_by('id').first().id
        newer = count(lambda: self.client.get(f'/api/groups/{big.slug}/posts/', {'after': first}))
        self.assertLessEqual(newer, 6)

    def test_opening_a_group(self):
        self.client.force_authenticate(self.me)
        g = self.make_chat(5)
        self.assertLessEqual(count(lambda: self.client.get(f'/api/groups/{g.slug}/')), 8)

    def test_sending_and_reacting_dont_grow_with_members(self):
        self.client.force_authenticate(self.me)
        small = self.make_chat(1)
        big = self.make_chat(1)
        for i in range(20):
            u = User.objects.create_user(f'qcx{i}', f'qx{i}@x.com', 'x')
            GroupMember.objects.create(group=big, user=u)
        self.client.post(f'/api/groups/{small.slug}/posts/', {'content': 'warm'}, format='json')   # my profile, loaded once
        few = count(lambda: self.client.post(f'/api/groups/{small.slug}/posts/', {'content': 'hi'}, format='json'))
        many = count(lambda: self.client.post(f'/api/groups/{big.slug}/posts/', {'content': 'hi'}, format='json'))
        self.assertEqual(few, many)
        post = GroupPost.objects.filter(group=big).first()
        self.assertLessEqual(count(lambda: self.client.post(f'/api/groups/{big.slug}/posts/{post.id}/react/', {'emoji': '🙏'}, format='json')), 14)

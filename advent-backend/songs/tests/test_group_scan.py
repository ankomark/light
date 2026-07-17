"""Ad-hoc scan tests for the Groups feature (membership/privacy enforcement).

    python manage.py test songs.tests.test_group_scan
"""
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from songs.models import User, Group, GroupMember, GroupPost, GroupJoinRequest


class GroupPrivacyScanTests(APITestCase):
    def setUp(self):
        self.creator = User.objects.create_user('scancreator', 'sc@x.com', 'x')
        self.outsider = User.objects.create_user('scanoutsider', 'so@x.com', 'x')
        self.group = Group.objects.create(creator=self.creator, name='Secret Council', is_private=True)
        GroupMember.objects.create(group=self.group, user=self.creator, is_admin=True)
        GroupPost.objects.create(group=self.group, user=self.creator, content='top secret')

    def test_outsider_cannot_read_private_group_details(self):
        self.client.force_authenticate(self.outsider)
        r = self.client.get(f'/api/groups/{self.group.slug}/')
        # Expect 404 (not in the visible queryset) — this is the correct behavior.
        self.assertIn(r.status_code, (403, 404), f'details leaked: {r.status_code}')

    def test_outsider_cannot_read_private_group_posts(self):
        """A non-member should NOT be able to read a private group's messages."""
        self.client.force_authenticate(self.outsider)
        r = self.client.get(f'/api/groups/{self.group.slug}/posts/')
        self.assertEqual(r.status_code, 403, f'private posts should be members-only, got {r.status_code}')

    def test_member_can_read_private_group_posts(self):
        member = User.objects.create_user('scanmember', 'sm@x.com', 'x')
        GroupMember.objects.create(group=self.group, user=member)
        self.client.force_authenticate(member)
        r = self.client.get(f'/api/groups/{self.group.slug}/posts/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['count'], 1)

    def test_super_admin_can_read_private_group_posts(self):
        """A super admin holds a master key: every private group, no membership."""
        boss = User.objects.create_user('scanboss', 'boss@x.com', 'x')
        boss.admin_role = 'super_admin'
        boss.is_superuser = True
        boss.save(update_fields=['admin_role', 'is_superuser'])
        self.client.force_authenticate(boss)
        # Posts of a private group they're not a member of.
        r = self.client.get(f'/api/groups/{self.group.slug}/posts/')
        self.assertEqual(r.status_code, 200, r.content[:200])
        self.assertEqual(r.json()['count'], 1)
        # The group itself is visible (master-key queryset) and flagged member/admin.
        d = self.client.get(f'/api/groups/{self.group.slug}/')
        self.assertEqual(d.status_code, 200)
        self.assertTrue(d.json()['is_member'])
        self.assertTrue(d.json()['is_admin'])

    def test_super_admin_messages_invisible_to_regular_members(self):
        """A super admin operates invisibly: a regular member never sees a message
        the super admin authored, but the super admin sees their own."""
        boss = User.objects.create_user('ghostboss', 'gb@x.com', 'x')
        boss.admin_role = 'super_admin'
        boss.is_superuser = True
        boss.save(update_fields=['admin_role', 'is_superuser'])
        self.client.force_authenticate(boss)
        resp = self.client.post(
            f'/api/groups/{self.group.slug}/posts/',
            {'content': 'ghost note', 'message_type': 'text'}, format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.content[:200])
        # The group creator (a regular member) must not see the super admin's note.
        self.client.force_authenticate(self.creator)
        r = self.client.get(f'/api/groups/{self.group.slug}/posts/')
        self.assertNotIn('ghost note', [p['content'] for p in r.json()['results']])
        # The super admin sees their own message.
        self.client.force_authenticate(boss)
        r2 = self.client.get(f'/api/groups/{self.group.slug}/posts/')
        self.assertIn('ghost note', [p['content'] for p in r2.json()['results']])

    def test_outsider_can_read_public_group_posts(self):
        """Public group messages stay readable so people can preview before joining."""
        pub = Group.objects.create(creator=self.creator, name='Open Forum', is_private=False)
        GroupMember.objects.create(group=pub, user=self.creator, is_admin=True)
        GroupPost.objects.create(group=pub, user=self.creator, content='welcome all')
        self.client.force_authenticate(self.outsider)
        r = self.client.get(f'/api/groups/{pub.slug}/posts/')
        self.assertEqual(r.status_code, 200)


class GroupListScalingTests(APITestCase):
    """The group list folds its per-row fields (member count, membership, unread,
    last message) into subqueries — its query count must NOT grow per group, and
    the annotated values must match the live-lookup semantics they replaced."""

    def _row(self, body, slug):
        return next(g for g in body['results'] if g['slug'] == slug)

    def _make_group(self, owner, name, private=False):
        g = Group.objects.create(creator=owner, name=name, is_private=private)
        GroupMember.objects.create(group=g, user=owner, is_admin=True)
        return g

    def test_query_count_is_constant_regardless_of_group_count(self):
        owner = User.objects.create_user('gsc_owner', 'gsco@x.com', 'x')
        viewer = User.objects.create_user('gsc_viewer', 'gscv@x.com', 'x')
        self.client.force_authenticate(viewer)

        def load_query_count():
            with CaptureQueriesContext(connection) as ctx:
                r = self.client.get('/api/groups/')
                self.assertEqual(r.status_code, 200)
            return len(ctx.captured_queries)

        for i in range(3):
            self._make_group(owner, f'Scale A{i}')
        few = load_query_count()
        for i in range(6):
            self._make_group(owner, f'Scale B{i}')
        many = load_query_count()
        # 9 groups must cost no more queries than 3 — proves there's no N+1.
        self.assertEqual(few, many, f'group list scales per-row: {few} -> {many}')

    def _stamp(self, post, when):
        # created_at is auto_now_add; set explicit, well-separated timestamps so
        # the unread comparison doesn't hinge on the clock's resolution.
        GroupPost.objects.filter(pk=post.pk).update(created_at=when)

    def test_annotated_values_match_semantics(self):
        from datetime import datetime, timezone as dt_timezone
        owner = User.objects.create_user('gav_owner', 'gavo@x.com', 'x')
        viewer = User.objects.create_user('gav_viewer', 'gavv@x.com', 'x')
        t = lambda h: datetime(2026, 1, 1, h, 0, 0, tzinfo=dt_timezone.utc)  # noqa: E731

        # A: viewer is a plain member; 1 read + 2 unread + own + system posts.
        a = self._make_group(owner, 'Alpha')
        m = GroupMember.objects.create(group=a, user=viewer)
        first = GroupPost.objects.create(group=a, user=owner, content='read me')
        u1 = GroupPost.objects.create(group=a, user=owner, content='unread 1')
        u2 = GroupPost.objects.create(group=a, user=owner, content='unread 2')
        own = GroupPost.objects.create(group=a, user=viewer, content='my own note')   # excluded
        sysm = GroupPost.objects.create(group=a, user=owner, message_type='system', content='x joined')  # excluded
        self._stamp(first, t(1))
        self._stamp(u1, t(3))
        self._stamp(u2, t(4))
        self._stamp(own, t(5))
        self._stamp(sysm, t(6))
        m.last_read_at = t(2)   # read through 02:00 → u1, u2 are unread
        m.save(update_fields=['last_read_at'])

        # B: viewer is admin, never read → all non-own/system posts are unread.
        b = self._make_group(owner, 'Bravo')
        GroupMember.objects.create(group=b, user=viewer, is_admin=True)
        hello_b = GroupPost.objects.create(group=b, user=owner, content='hello')
        last_b = GroupPost.objects.create(group=b, user=owner, content='newest')
        self._stamp(hello_b, t(1))
        self._stamp(last_b, t(2))

        # C: public group, viewer is NOT a member, but has a pending request.
        c = self._make_group(owner, 'Charlie')
        GroupJoinRequest.objects.create(group=c, user=viewer, status='pending')

        self.client.force_authenticate(viewer)
        body = self.client.get('/api/groups/').json()

        ra = self._row(body, a.slug)
        self.assertEqual(ra['unread_count'], 2)
        self.assertTrue(ra['is_member'])
        self.assertFalse(ra['is_admin'])
        self.assertEqual(ra['member_count'], 2)

        rb = self._row(body, b.slug)
        self.assertEqual(rb['unread_count'], 2)          # never read → both count
        self.assertTrue(rb['is_admin'])
        self.assertEqual(rb['last_message']['content'], 'newest')
        self.assertEqual(rb['last_message']['id'], last_b.id)

        rc = self._row(body, c.slug)
        self.assertFalse(rc['is_member'])
        self.assertEqual(rc['unread_count'], 0)          # non-members carry no unread
        self.assertTrue(rc['has_pending_request'])

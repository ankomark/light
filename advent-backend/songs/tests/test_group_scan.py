"""Ad-hoc scan tests for the Groups feature (membership/privacy enforcement).

    python manage.py test songs.tests.test_group_scan
"""
from rest_framework.test import APITestCase

from songs.models import User, Group, GroupMember, GroupPost


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

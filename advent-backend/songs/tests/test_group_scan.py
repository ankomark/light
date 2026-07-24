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

    def test_outsider_cannot_read_public_group_posts(self):
        """Even a PUBLIC group's chat is members-only: a non-member must be
        approved before they can read any messages."""
        pub = Group.objects.create(creator=self.creator, name='Open Forum', is_private=False)
        GroupMember.objects.create(group=pub, user=self.creator, is_admin=True)
        GroupPost.objects.create(group=pub, user=self.creator, content='welcome all')
        self.client.force_authenticate(self.outsider)
        r = self.client.get(f'/api/groups/{pub.slug}/posts/')
        self.assertEqual(r.status_code, 403, f'public posts must be members-only, got {r.status_code}')

    def test_public_group_last_message_hidden_from_outsider(self):
        """The group list shows a public group in discovery, but a non-member gets
        no last-message preview — no chat content leaks before approval."""
        pub = Group.objects.create(creator=self.creator, name='Open Forum', is_private=False)
        GroupMember.objects.create(group=pub, user=self.creator, is_admin=True)
        GroupPost.objects.create(group=pub, user=self.creator, content='welcome all')

        self.client.force_authenticate(self.outsider)
        body = self.client.get('/api/groups/').json()
        row = next(g for g in body['results'] if g['slug'] == pub.slug)
        self.assertTrue(row['is_member'] is False)
        self.assertIsNone(row['last_message'], 'chat preview leaked to a non-member')

        # The member does see the preview.
        self.client.force_authenticate(self.creator)
        body2 = self.client.get('/api/groups/').json()
        row2 = next(g for g in body2['results'] if g['slug'] == pub.slug)
        self.assertIsNotNone(row2['last_message'])
        self.assertEqual(row2['last_message']['content'], 'welcome all')

    def test_public_group_join_requires_approval(self):
        """Requesting to join a public group creates a PENDING request, not an
        instant membership — an admin still has to approve."""
        pub = Group.objects.create(creator=self.creator, name='Open Forum', is_private=False)
        GroupMember.objects.create(group=pub, user=self.creator, is_admin=True)
        self.client.force_authenticate(self.outsider)
        r = self.client.post(f'/api/groups/{pub.slug}/request-join/', {}, format='json')
        self.assertEqual(r.status_code, 201, r.content[:200])
        self.assertFalse(GroupMember.objects.filter(group=pub, user=self.outsider).exists())
        self.assertTrue(GroupJoinRequest.objects.filter(
            group=pub, user=self.outsider, status='pending').exists())

    def test_join_request_notifications_carry_group_slug(self):
        """The admin's join-request alert and the requester's approval alert both
        carry the group slug so the client can deep-link the tap."""
        from songs.models import Notification

        pub = Group.objects.create(creator=self.creator, name='Open Forum', is_private=False)
        GroupMember.objects.create(group=pub, user=self.creator, is_admin=True)

        # Outsider requests to join → the admin gets a routable notification.
        self.client.force_authenticate(self.outsider)
        self.client.post(f'/api/groups/{pub.slug}/request-join/', {}, format='json')
        admin_note = Notification.objects.get(
            recipient=self.creator, notification_type='group_join_request')
        self.assertEqual(admin_note.group_id, pub.id)

        self.client.force_authenticate(self.creator)
        body = self.client.get('/api/notifications/').json()
        rows = body.get('results', body)
        row = next(n for n in rows if n['notification_type'] == 'group_join_request')
        self.assertEqual(row['group_slug'], pub.slug)

        # Admin approves → the requester gets an approval notification for the group.
        jr = GroupJoinRequest.objects.get(group=pub, user=self.outsider)
        approve = self.client.post(f'/api/group-join-requests/{jr.id}/approve/', {}, format='json')
        self.assertEqual(approve.status_code, 200, approve.content[:200])
        self.assertTrue(GroupMember.objects.filter(group=pub, user=self.outsider).exists())
        approved = Notification.objects.get(
            recipient=self.outsider, notification_type='group_join_approved')
        self.assertEqual(approved.group_id, pub.id)

    def test_base64_attachment_is_rejected(self):
        """New messages must reference an uploaded R2 URL — inline base64 (which
        would bloat the DB) is refused; a real https URL is accepted."""
        member = User.objects.create_user('mediauser', 'mu@x.com', 'x')
        g = Group.objects.create(creator=member, name='Media Room', is_private=False)
        GroupMember.objects.create(group=g, user=member, is_admin=True)
        self.client.force_authenticate(member)
        url = f'/api/groups/{g.slug}/posts/'

        data_uri = 'data:image/png;base64,' + ('A' * 5000)
        bad = self.client.post(url, {'message_type': 'image', 'attachment': data_uri}, format='json')
        self.assertEqual(bad.status_code, 400, bad.content[:200])

        ok = self.client.post(
            url,
            {'message_type': 'image', 'attachment': 'https://cdn.example/r2/pic.jpg'},
            format='json',
        )
        self.assertEqual(ok.status_code, 201, ok.content[:200])

    def test_edit_own_text_message(self):
        """The author can edit their text message; it gets an edited_at stamp.
        Others can't edit it, and non-text messages can't be edited."""
        author = User.objects.create_user('editor', 'ed@x.com', 'x')
        other = User.objects.create_user('other', 'ot@x.com', 'x')
        g = Group.objects.create(creator=author, name='Edit Room', is_private=False)
        GroupMember.objects.create(group=g, user=author, is_admin=True)
        GroupMember.objects.create(group=g, user=other)

        self.client.force_authenticate(author)
        pid = self.client.post(
            f'/api/groups/{g.slug}/posts/',
            {'content': 'hpelo', 'message_type': 'text'}, format='json',
        ).json()['id']

        edited = self.client.patch(
            f'/api/groups/{g.slug}/posts/{pid}/edit/', {'content': 'hello'}, format='json',
        )
        self.assertEqual(edited.status_code, 200, edited.content[:200])
        self.assertEqual(edited.json()['content'], 'hello')
        self.assertIsNotNone(edited.json()['edited_at'])

        # Someone else can't edit it.
        self.client.force_authenticate(other)
        forbidden = self.client.patch(
            f'/api/groups/{g.slug}/posts/{pid}/edit/', {'content': 'hacked'}, format='json',
        )
        self.assertEqual(forbidden.status_code, 403)

        # A non-text message can't be edited.
        self.client.force_authenticate(author)
        img = self.client.post(
            f'/api/groups/{g.slug}/posts/',
            {'message_type': 'image', 'attachment': 'https://cdn.example/r2/p.jpg'}, format='json',
        ).json()['id']
        bad = self.client.patch(
            f'/api/groups/{g.slug}/posts/{img}/edit/', {'content': 'x'}, format='json',
        )
        self.assertEqual(bad.status_code, 400)

    def test_audit_log_records_moderation(self):
        """Moderation actions land in the group's audit log, which only
        admins/moderators can read."""
        admin = User.objects.create_user('aladmin', 'al1@x.com', 'x')
        member = User.objects.create_user('almember', 'al2@x.com', 'x')
        g = Group.objects.create(creator=admin, name='Audit Room', is_private=False)
        GroupMember.objects.create(group=g, user=admin, is_admin=True)
        GroupMember.objects.create(group=g, user=member)

        # Admin deletes a member's message → logged.
        self.client.force_authenticate(member)
        pid = self.client.post(
            f'/api/groups/{g.slug}/posts/', {'content': 'delete me', 'message_type': 'text'},
            format='json').json()['id']
        self.client.force_authenticate(admin)
        self.client.delete(f'/api/groups/{g.slug}/posts/{pid}/')

        log = self.client.get(f'/api/groups/{g.slug}/audit-log/')
        self.assertEqual(log.status_code, 200)
        rows = log.json().get('results', log.json())
        self.assertTrue(any(r['action'] == 'delete_message' for r in rows))
        self.assertEqual(rows[0]['actor']['username'], 'aladmin')

        # A plain member can't read the log.
        self.client.force_authenticate(member)
        self.assertEqual(self.client.get(f'/api/groups/{g.slug}/audit-log/').status_code, 403)

    def test_report_group_message(self):
        """A member can report a message; it lands as a Report the admin panel
        can act on (content_type 'grouppost')."""
        from songs.models import Report

        author = User.objects.create_user('rpauthor', 'rp1@x.com', 'x')
        reporter = User.objects.create_user('rpreporter', 'rp2@x.com', 'x')
        g = Group.objects.create(creator=author, name='Report Room', is_private=False)
        GroupMember.objects.create(group=g, user=author, is_admin=True)
        GroupMember.objects.create(group=g, user=reporter)

        self.client.force_authenticate(author)
        pid = self.client.post(
            f'/api/groups/{g.slug}/posts/', {'content': 'bad stuff', 'message_type': 'text'},
            format='json').json()['id']

        self.client.force_authenticate(reporter)
        res = self.client.post(
            '/api/reports/',
            {'content_type': 'grouppost', 'object_id': pid, 'reason': 'spam'}, format='json')
        self.assertEqual(res.status_code, 201, res.content[:200])
        self.assertTrue(Report.objects.filter(
            content_type='grouppost', object_id=pid, reporter=reporter).exists())

    def test_moderator_role(self):
        """An admin can appoint a moderator; the moderator can delete others'
        messages and pin, but can't manage membership. Non-admins can't appoint."""
        admin = User.objects.create_user('modadmin', 'ma1@x.com', 'x')
        mod = User.objects.create_user('themod', 'ma2@x.com', 'x')
        member = User.objects.create_user('plainmember', 'ma3@x.com', 'x')
        g = Group.objects.create(creator=admin, name='Mod Room', is_private=False)
        GroupMember.objects.create(group=g, user=admin, is_admin=True)
        GroupMember.objects.create(group=g, user=mod)
        GroupMember.objects.create(group=g, user=member)

        # A plain member can't appoint moderators.
        self.client.force_authenticate(member)
        self.assertEqual(self.client.post(
            f'/api/groups/{g.slug}/set-moderator/', {'user_id': mod.id}, format='json').status_code, 403)

        # Admin appoints the moderator.
        self.client.force_authenticate(admin)
        res = self.client.post(f'/api/groups/{g.slug}/set-moderator/', {'user_id': mod.id}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()['is_moderator'])
        self.assertTrue(self.client.get(f'/api/groups/{g.slug}/').json()['is_moderator'])  # admin is a mod too

        # A member posts; the moderator can delete it.
        self.client.force_authenticate(member)
        pid = self.client.post(
            f'/api/groups/{g.slug}/posts/', {'content': 'oops', 'message_type': 'text'}, format='json').json()['id']
        self.client.force_authenticate(mod)
        self.assertEqual(self.client.delete(f'/api/groups/{g.slug}/posts/{pid}/').status_code, 204)

        # The moderator can pin, but can NOT appoint admins (membership management).
        pid2 = self.client.post(
            f'/api/groups/{g.slug}/posts/', {'content': 'pin me', 'message_type': 'text'}, format='json').json()['id']
        self.assertEqual(self.client.post(f'/api/groups/{g.slug}/posts/{pid2}/pin/', {}, format='json').status_code, 200)
        self.assertEqual(self.client.post(
            f'/api/groups/{g.slug}/set-admin/', {'user_id': member.id}, format='json').status_code, 403)

    def test_join_question_admin_only(self):
        """An admin can set the join prompt; it shows on the group; a member can't."""
        admin = User.objects.create_user('jqadmin', 'jq1@x.com', 'x')
        member = User.objects.create_user('jqmember', 'jq2@x.com', 'x')
        g = Group.objects.create(creator=admin, name='JQ Room', is_private=False)
        GroupMember.objects.create(group=g, user=admin, is_admin=True)
        GroupMember.objects.create(group=g, user=member)

        self.client.force_authenticate(member)
        self.assertEqual(
            self.client.post(f'/api/groups/{g.slug}/join-question/', {'join_question': 'x'}, format='json').status_code, 403)

        self.client.force_authenticate(admin)
        res = self.client.post(f'/api/groups/{g.slug}/join-question/', {'join_question': 'Why join?'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.client.get(f'/api/groups/{g.slug}/').json()['join_question'], 'Why join?')

    def test_rejoin_cooldown_after_rejection(self):
        """After a rejection, re-requesting is blocked until the cooldown passes,
        then it reopens the same request (no unique-constraint crash)."""
        from datetime import timedelta
        from django.utils import timezone
        from songs.models import GroupJoinRequest

        admin = User.objects.create_user('cdadmin', 'cd1@x.com', 'x')
        applicant = User.objects.create_user('cdapp', 'cd2@x.com', 'x')
        g = Group.objects.create(creator=admin, name='CD Room', is_private=False)
        GroupMember.objects.create(group=g, user=admin, is_admin=True)

        self.client.force_authenticate(applicant)
        jr_id = self.client.post(f'/api/groups/{g.slug}/request-join/', {}, format='json').json()['id']

        self.client.force_authenticate(admin)
        self.client.post(f'/api/group-join-requests/{jr_id}/reject/', {}, format='json')

        # Immediate re-request is blocked by the cooldown.
        self.client.force_authenticate(applicant)
        blocked = self.client.post(f'/api/groups/{g.slug}/request-join/', {}, format='json')
        self.assertEqual(blocked.status_code, 400)

        # Backdate the rejection past the cooldown → re-request reopens it.
        GroupJoinRequest.objects.filter(id=jr_id).update(
            updated_at=timezone.now() - timedelta(days=8))
        ok = self.client.post(f'/api/groups/{g.slug}/request-join/', {'message': 'take two'}, format='json')
        self.assertEqual(ok.status_code, 201, ok.content[:200])
        jr = GroupJoinRequest.objects.get(id=jr_id)
        self.assertEqual(jr.status, 'pending')
        self.assertEqual(jr.message, 'take two')

    def test_read_receipts(self):
        """A member counts as a reader of a message once they mark the group read;
        the author is never counted."""
        author = User.objects.create_user('rcauthor', 'r1@x.com', 'x')
        reader = User.objects.create_user('rcreader', 'r2@x.com', 'x')
        g = Group.objects.create(creator=author, name='Receipt Room', is_private=False)
        GroupMember.objects.create(group=g, user=author, is_admin=True)
        GroupMember.objects.create(group=g, user=reader)

        self.client.force_authenticate(author)
        pid = self.client.post(
            f'/api/groups/{g.slug}/posts/', {'content': 'seen?', 'message_type': 'text'}, format='json',
        ).json()['id']

        # Nobody has read it yet.
        r0 = self.client.get(f'/api/groups/{g.slug}/posts/{pid}/receipts/').json()
        self.assertEqual(r0['count'], 0)

        # The reader opens the group (marks read) → now counts as a reader.
        self.client.force_authenticate(reader)
        self.client.post(f'/api/groups/{g.slug}/mark-read/')
        self.client.force_authenticate(author)
        r1 = self.client.get(f'/api/groups/{g.slug}/posts/{pid}/receipts/').json()
        self.assertEqual(r1['count'], 1)
        self.assertEqual(r1['readers'][0]['user']['username'], 'rcreader')

    def test_search_finds_text_messages(self):
        """Search returns matching text messages to a member and is members-only."""
        owner = User.objects.create_user('srchowner', 's1@x.com', 'x')
        outsider = User.objects.create_user('srchout', 's2@x.com', 'x')
        g = Group.objects.create(creator=owner, name='Search Room', is_private=False)
        GroupMember.objects.create(group=g, user=owner, is_admin=True)

        self.client.force_authenticate(owner)
        url = f'/api/groups/{g.slug}/posts/'
        self.client.post(url, {'content': 'meet at the chapel tomorrow', 'message_type': 'text'}, format='json')
        self.client.post(url, {'content': 'bring your bibles', 'message_type': 'text'}, format='json')

        res = self.client.get(f'/api/groups/{g.slug}/posts/search/?q=chapel')
        rows = res.json().get('results', res.json())
        self.assertEqual(len(rows), 1)
        self.assertIn('chapel', rows[0]['content'])

        # Too-short query returns nothing.
        self.assertEqual(len(self.client.get(f'/api/groups/{g.slug}/posts/search/?q=c').json()['results']), 0)

        # Members-only.
        self.client.force_authenticate(outsider)
        self.assertEqual(self.client.get(f'/api/groups/{g.slug}/posts/search/?q=chapel').status_code, 403)

    def test_media_endpoint_returns_only_media(self):
        """The gallery endpoint returns image/file/audio messages (not text) to a
        member, and is members-only."""
        owner = User.objects.create_user('galowner', 'g@x.com', 'x')
        outsider = User.objects.create_user('galout', 'go@x.com', 'x')
        g = Group.objects.create(creator=owner, name='Gallery', is_private=False)
        GroupMember.objects.create(group=g, user=owner, is_admin=True)

        self.client.force_authenticate(owner)
        url = f'/api/groups/{g.slug}/posts/'
        self.client.post(url, {'content': 'just text', 'message_type': 'text'}, format='json')
        self.client.post(url, {'message_type': 'image', 'attachment': 'https://cdn.example/a.jpg'}, format='json')
        self.client.post(url, {'message_type': 'file', 'attachment': 'https://cdn.example/a.pdf', 'file_name': 'a.pdf'}, format='json')

        res = self.client.get(f'/api/groups/{g.slug}/posts/media/')
        self.assertEqual(res.status_code, 200)
        rows = res.json().get('results', res.json())
        types = {r['message_type'] for r in rows}
        self.assertEqual(types, {'image', 'file'})

        self.client.force_authenticate(outsider)
        self.assertEqual(self.client.get(f'/api/groups/{g.slug}/posts/media/').status_code, 403)

    def test_pin_and_unpin_message(self):
        """An admin can pin a message (surfaced as group.pinned_message); a
        non-admin can't; unpinning and deleting the pinned message both clear it."""
        admin = User.objects.create_user('pinadmin', 'pa@x.com', 'x')
        member = User.objects.create_user('pinmember', 'pm@x.com', 'x')
        g = Group.objects.create(creator=admin, name='Pin Room', is_private=False)
        GroupMember.objects.create(group=g, user=admin, is_admin=True)
        GroupMember.objects.create(group=g, user=member)

        self.client.force_authenticate(admin)
        pid = self.client.post(
            f'/api/groups/{g.slug}/posts/', {'content': 'read this', 'message_type': 'text'},
            format='json',
        ).json()['id']

        # Member can't pin.
        self.client.force_authenticate(member)
        self.assertEqual(
            self.client.post(f'/api/groups/{g.slug}/posts/{pid}/pin/', {}, format='json').status_code, 403)

        # Admin pins → shows up on the group detail.
        self.client.force_authenticate(admin)
        self.assertEqual(
            self.client.post(f'/api/groups/{g.slug}/posts/{pid}/pin/', {}, format='json').status_code, 200)
        detail = self.client.get(f'/api/groups/{g.slug}/').json()
        self.assertEqual(detail['pinned_message']['id'], pid)

        # Unpin clears it.
        self.assertEqual(
            self.client.post(f'/api/groups/{g.slug}/posts/{pid}/unpin/', {}, format='json').status_code, 200)
        self.assertIsNone(self.client.get(f'/api/groups/{g.slug}/').json()['pinned_message'])

        # Re-pin, then delete the message → pin auto-clears.
        self.client.post(f'/api/groups/{g.slug}/posts/{pid}/pin/', {}, format='json')
        self.client.delete(f'/api/groups/{g.slug}/posts/{pid}/')
        self.assertIsNone(self.client.get(f'/api/groups/{g.slug}/').json()['pinned_message'])

    def test_attachment_blurhash_round_trips(self):
        """The image placeholder hash is stored on send and returned on read."""
        member = User.objects.create_user('bhuser', 'bh@x.com', 'x')
        g = Group.objects.create(creator=member, name='Blur Room', is_private=False)
        GroupMember.objects.create(group=g, user=member, is_admin=True)
        self.client.force_authenticate(member)
        res = self.client.post(
            f'/api/groups/{g.slug}/posts/',
            {
                'message_type': 'image',
                'attachment': 'https://cdn.example/r2/pic.jpg',
                'attachment_blurhash': 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 201, res.content[:200])
        self.assertEqual(res.json()['attachment_blurhash'], 'LEHV6nWB2yk8pyo0adR*.7kCMdnj')

    def test_non_group_notification_has_null_group(self):
        """A non-group notification serializes group_slug as null (no crash)."""
        from songs.models import Notification

        Notification.objects.create(
            recipient=self.creator, sender=self.outsider,
            message='hi', notification_type='follow',
        )
        self.client.force_authenticate(self.creator)
        body = self.client.get('/api/notifications/').json()
        rows = body.get('results', body)
        row = next(n for n in rows if n['notification_type'] == 'follow')
        self.assertIsNone(row['group_slug'])


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

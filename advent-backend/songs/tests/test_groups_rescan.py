"""Groups & communities re-scan (2026-10-06): the fixes it led to.

    python manage.py test songs.tests.test_groups_rescan --settings=music.settings_test
"""
from unittest import mock

from django.core.cache import cache
from rest_framework.test import APITestCase

from songs.models import CommunityCategory, Group, GroupMember, GroupPost, User


class GroupRescanTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user('rsowner', 'o@x.com', 'pw12345!')
        self.other = User.objects.create_user('rsother', 'e@x.com', 'pw12345!')
        self.group = Group.objects.create(name='Mine', creator=self.owner, kind=Group.KIND_GROUP, is_private=False)
        GroupMember.objects.create(group=self.group, user=self.owner, is_admin=True)
        self.client.force_authenticate(self.owner)

    # ── A category can't name a field after the list's own params ────────────

    def test_reserved_field_key_is_refused(self):
        self.client.force_authenticate(self.other)
        for key in ('scope', 'page', 'Search'):
            r = self.client.post('/api/community-categories/',
                                 {'name': f'Evil {key}', 'field_schema': [{'key': key}]}, format='json')
            self.assertEqual(r.status_code, 400, key)

    def test_existing_reserved_key_does_not_filter_lists(self):
        # Made before the key was refused: the list must ignore it.
        CommunityCategory.objects.create(name='Old', slug='old', field_schema=[{'key': 'scope'}, {'key': 'page'}])
        r = self.client.get('/api/groups/?scope=mine')
        self.assertEqual(r.data['count'], 1)

    # ── A group taken down by moderation ─────────────────────────────────────

    def test_removed_group_chat_is_closed(self):
        GroupPost.objects.create(group=self.group, user=self.owner, content='hi')
        Group.objects.filter(pk=self.group.pk).update(is_removed=True)
        self.assertEqual(self.client.get(f'/api/groups/{self.group.slug}/posts/').status_code, 404)
        r = self.client.post(f'/api/groups/{self.group.slug}/posts/', {'content': 'still here?'}, format='json')
        self.assertEqual(r.status_code, 404)

    def test_takedown_closes_open_chats(self):
        from songs.views.admin import _soft_remove
        with mock.patch('songs.group_live.tell_group') as tell:
            self.assertTrue(_soft_remove('group', self.group.pk, True))
        tell.assert_called_once_with(self.group.slug, {'type': 'group_deleted'})

    # ── The pinned message is chat content: members only ─────────────────────

    def test_pinned_message_hidden_from_non_members(self):
        p = GroupPost.objects.create(group=self.group, user=self.owner, content='members only')
        Group.objects.filter(pk=self.group.pk).update(pinned_post=p)
        self.client.force_authenticate(self.other)
        self.assertIsNone(self.client.get(f'/api/groups/{self.group.slug}/').data['pinned_message'])
        rows = self.client.get('/api/groups/?scope=public').data['results']
        self.assertTrue(rows and all(row['pinned_message'] is None for row in rows))
        # A member still sees it.
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.get(f'/api/groups/{self.group.slug}/').data['pinned_message']['content'],
                         'members only')

    def test_taken_down_pinned_message_is_not_shown(self):
        p = GroupPost.objects.create(group=self.group, user=self.owner, content='removed', is_removed=True)
        Group.objects.filter(pk=self.group.pk).update(pinned_post=p)
        self.assertIsNone(self.client.get(f'/api/groups/{self.group.slug}/').data['pinned_message'])


class GroupRescanFollowUpTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user('fuowner', 'fo@x.com', 'pw12345!')
        self.other = User.objects.create_user('fuother', 'fe@x.com', 'pw12345!')
        self.group = Group.objects.create(name='Ours', creator=self.owner, kind=Group.KIND_GROUP)
        GroupMember.objects.create(group=self.group, user=self.owner, is_admin=True)
        self.client.force_authenticate(self.owner)

    def test_detail_preview_and_unread_skip_taken_down_messages(self):
        GroupMember.objects.create(group=self.group, user=self.other)
        GroupPost.objects.create(group=self.group, user=self.owner, content='kept')
        GroupPost.objects.create(group=self.group, user=self.owner, content='taken down', is_removed=True)
        self.client.force_authenticate(self.other)
        data = self.client.get(f'/api/groups/{self.group.slug}/').data
        self.assertEqual(data['last_message']['content'], 'kept')
        self.assertEqual(data['unread_count'], 1)

    def test_added_notification_names_the_group(self):
        from songs.models import Notification
        self.client.post(f'/api/groups/{self.group.slug}/add-member/', {'user_id': self.other.id}, format='json')
        n = Notification.objects.get(recipient=self.other, notification_type='group_added')
        self.assertEqual(n.group_id, self.group.id)

    def test_suspended_account_cannot_join_open_community(self):
        community = Group.objects.create(name='Open', creator=self.owner, kind=Group.KIND_COMMUNITY,
                                         is_private=False)
        User.objects.filter(pk=self.other.pk).update(is_suspended=True)
        self.client.force_authenticate(User.objects.get(pk=self.other.pk))
        r = self.client.post(f'/api/communities/{community.slug}/request-join/')
        self.assertEqual(r.status_code, 403)
        self.assertFalse(GroupMember.objects.filter(group=community, user=self.other).exists())

    def test_admin_cannot_remove_themselves(self):
        GroupMember.objects.create(group=self.group, user=self.other, is_admin=True)
        self.client.force_authenticate(self.other)
        r = self.client.post(f'/api/groups/{self.group.slug}/remove-member/', {'user_id': str(self.other.id)},
                             format='json')
        self.assertEqual(r.status_code, 400)
        self.assertTrue(GroupMember.objects.filter(group=self.group, user=self.other).exists())

    def test_invite_link_stops_at_its_limit(self):
        import uuid
        Group.objects.filter(pk=self.group.pk).update(invite_code=uuid.uuid4(), invite_max_uses=1)
        code = str(Group.objects.get(pk=self.group.pk).invite_code)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.post('/api/groups/join-by-code/', {'code': code}, format='json').status_code, 200)
        # Again, already in: fine, and no second use counted.
        self.assertEqual(self.client.post('/api/groups/join-by-code/', {'code': code}, format='json').status_code, 200)
        self.assertEqual(Group.objects.get(pk=self.group.pk).invite_uses, 1)
        third = User.objects.create_user('futhird', 'ft@x.com', 'pw12345!')
        self.client.force_authenticate(third)
        self.assertEqual(self.client.post('/api/groups/join-by-code/', {'code': code}, format='json').status_code, 410)
        self.assertFalse(GroupMember.objects.filter(group=self.group, user=third).exists())


class GroupMessageTakedownTests(APITestCase):
    def test_takedown_drops_message_from_open_chats_and_unpins_it(self):
        from songs.views.admin import _soft_remove
        owner = User.objects.create_user('tdowner', 'td@x.com', 'pw12345!')
        group = Group.objects.create(name='Td', creator=owner)
        post = GroupPost.objects.create(group=group, user=owner, content='bad')
        Group.objects.filter(pk=group.pk).update(pinned_post=post)
        with mock.patch('songs.consumers.broadcast_group_deleted') as deleted, \
                mock.patch('songs.consumers.broadcast_group_pinned') as pinned:
            self.assertTrue(_soft_remove('grouppost', post.pk, True))
        deleted.assert_called_once_with(group.slug, post.pk)
        pinned.assert_called_once_with(group.slug, None)
        self.assertIsNone(Group.objects.get(pk=group.pk).pinned_post_id)


class GroupRescanMinorTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user('mnowner', 'mn@x.com', 'pw12345!')
        self.client.force_authenticate(self.owner)

    def test_category_list_counts_in_one_query(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        for i in range(5):
            cat = CommunityCategory.objects.create(name=f'Cat {i}', slug=f'cat-{i}', created_by=self.owner)
            Group.objects.create(name=f'C{i}', creator=self.owner, kind=Group.KIND_COMMUNITY, category=cat)
            Group.objects.create(name=f'Gone{i}', creator=self.owner, kind=Group.KIND_COMMUNITY, category=cat,
                                 is_removed=True)
        with CaptureQueriesContext(connection) as q:
            rows = self.client.get('/api/community-categories/').data
        self.assertLessEqual(len(q), 4)
        self.assertTrue(all(r['community_count'] == 1 for r in rows if r['slug'].startswith('cat-')))

    def test_editing_a_group_cannot_give_it_community_fields(self):
        group = Group.objects.create(name='G', creator=self.owner, kind=Group.KIND_GROUP)
        GroupMember.objects.create(group=group, user=self.owner, is_admin=True)
        cat = CommunityCategory.objects.create(name='Rescan cat', slug='rescan-cat')
        parent = Group.objects.create(name='P', creator=self.owner, kind=Group.KIND_COMMUNITY, is_private=False)
        r = self.client.patch(f'/api/groups/{group.slug}/',
                              {'category': cat.id, 'details': {'a': 'b'}, 'parent': parent.id, 'name': 'Renamed'},
                              format='json')
        self.assertEqual(r.status_code, 200)
        group.refresh_from_db()
        self.assertEqual((group.name, group.category_id, group.details, group.parent_id), ('Renamed', None, {}, None))

    def test_promoting_to_admin_clears_moderator(self):
        group = Group.objects.create(name='G', creator=self.owner)
        GroupMember.objects.create(group=group, user=self.owner, is_admin=True)
        mod = User.objects.create_user('mnmod', 'mm@x.com', 'pw12345!')
        GroupMember.objects.create(group=group, user=mod, is_moderator=True)
        r = self.client.post(f'/api/groups/{group.slug}/set-admin/', {'user_id': mod.id, 'is_admin': True},
                             format='json')
        self.assertEqual((r.data['is_admin'], r.data['is_moderator']), (True, False))


class PrivateGroupVisibilityTests(APITestCase):
    """A private group is seen only by its creator, its members (joined by
    invite, added by an admin, approved) and super admins - nobody else,
    by any route."""

    def setUp(self):
        cache.clear()
        self.creator = User.objects.create_user('pvcreator', 'pc@x.com', 'pw12345!')
        self.added = User.objects.create_user('pvadded', 'pa@x.com', 'pw12345!')
        self.invited = User.objects.create_user('pvinvited', 'pi@x.com', 'pw12345!')
        self.stranger = User.objects.create_user('pvstranger', 'ps@x.com', 'pw12345!')
        self.cat = CommunityCategory.objects.create(name='Pv cat', slug='pv-cat')
        self.group = Group.objects.create(name='Zebra Hidden Circle', description='zebra secrets',
                                          creator=self.creator, kind=Group.KIND_GROUP, is_private=True)
        self.community = Group.objects.create(name='Zebra Hidden Church', description='zebra secrets',
                                              creator=self.creator, kind=Group.KIND_COMMUNITY,
                                              is_private=True, category=self.cat)
        for g in (self.group, self.community):
            GroupMember.objects.create(group=g, user=self.creator, is_admin=True)
            GroupPost.objects.create(group=g, user=self.creator, content='hi')

    def _list_slugs(self, url):
        r = self.client.get(url)
        rows = r.data['results'] if isinstance(r.data, dict) and 'results' in r.data else r.data
        return {row['slug'] for row in rows}

    def _sees(self, user):
        self.client.force_authenticate(user)
        slugs = set()
        for base in ('/api/groups/', '/api/communities/'):
            for q in ('', '?scope=private', '?scope=mine', '?search=zebra', '?category=pv-cat'):
                slugs |= self._list_slugs(base + q)
        s = self.client.get('/api/explore/search/?q=zebra&type=groups').data
        slugs |= {g['slug'] for g in (s.get('groups') or [])}
        return slugs

    def test_stranger_cannot_see_or_detect_private_groups(self):
        self.assertEqual(self._sees(self.stranger) & {self.group.slug, self.community.slug}, set())
        for g in (self.group, self.community):
            for path in ('', 'members/', 'check-membership/', 'posts/', 'posts/media/'):
                r = self.client.get(f'/api/groups/{g.slug}/{path}')
                self.assertEqual(r.status_code, 404, f'{g.kind} {path}: {r.status_code}')
            r = self.client.post(f'/api/groups/{g.slug}/posts/', {'content': 'x'}, format='json')
            self.assertEqual(r.status_code, 404)
            self.assertEqual(self.client.post(f'/api/groups/{g.slug}/request-join/').status_code, 404)
            # The group boards answer exactly as for a slug that names nothing.
            for board in ('/api/quiz/leaderboard/', '/api/puzzles/daily/leaderboard/'):
                real = self.client.get(f'{board}?scope=group:{g.slug}')
                fake = self.client.get(f'{board}?scope=group:no-such-group-xyz')
                self.assertEqual(real.status_code, fake.status_code, board)

    def test_anonymous_cannot_see_private_groups(self):
        for base in ('/api/groups/', '/api/communities/'):
            r = self.client.get(base)
            if r.status_code == 200:
                self.assertEqual(self._list_slugs(base) & {self.group.slug, self.community.slug}, set())

    def test_creator_added_and_invited_members_see_it(self):
        import uuid
        self.client.force_authenticate(self.creator)
        self.client.post(f'/api/groups/{self.group.slug}/add-member/', {'user_id': self.added.id}, format='json')
        Group.objects.filter(pk=self.group.pk).update(invite_code=uuid.uuid4())
        code = str(Group.objects.get(pk=self.group.pk).invite_code)
        self.client.force_authenticate(self.invited)
        self.assertEqual(self.client.post('/api/groups/join-by-code/', {'code': code}, format='json').status_code, 200)
        for user in (self.creator, self.added, self.invited):
            self.assertIn(self.group.slug, self._sees(user), user.username)
            self.assertEqual(self.client.get(f'/api/groups/{self.group.slug}/posts/').status_code, 200)
        self.assertIn(self.community.slug, self._sees(self.creator))
        # Search on its own finds it for a member (so the stranger's miss is real).
        self.client.force_authenticate(self.invited)
        found = self.client.get('/api/explore/search/?q=zebra&type=groups').data['groups']
        self.assertIn(self.group.slug, {g['slug'] for g in found})

    def test_private_parent_is_not_named_to_outsiders(self):
        child = Group.objects.create(name='Open Choir', creator=self.creator, kind=Group.KIND_COMMUNITY,
                                     is_private=False, parent=self.community)
        self.client.force_authenticate(self.stranger)
        data = self.client.get(f'/api/groups/{child.slug}/').data
        self.assertIsNone(data['parent_slug'])
        self.assertIsNone(data['parent'])
        self.client.force_authenticate(self.creator)
        self.assertEqual(self.client.get(f'/api/groups/{child.slug}/').data['parent_slug'], self.community.slug)


class JoinedVsMemberTests(APITestCase):
    def test_super_admin_reads_but_is_not_joined_until_they_join(self):
        owner = User.objects.create_user('jvowner', 'jo@x.com', 'pw12345!')
        boss = User.objects.create_user('jvboss', 'jb@x.com', 'pw12345!', is_superuser=True)
        group = Group.objects.create(name='Open', creator=owner, is_private=False)
        GroupMember.objects.create(group=group, user=owner, is_admin=True)
        self.client.force_authenticate(boss)
        for data in (self.client.get(f'/api/groups/{group.slug}/').data,
                     self.client.get('/api/groups/?scope=public').data['results'][0]):
            self.assertEqual((data['is_member'], data['is_joined']), (True, False))
        GroupMember.objects.create(group=group, user=boss)
        self.assertTrue(self.client.get(f'/api/groups/{group.slug}/').data['is_joined'])
        # An ordinary member and an outsider: the two agree.
        self.client.force_authenticate(owner)
        self.assertTrue(self.client.get(f'/api/groups/{group.slug}/').data['is_joined'])
        outsider = User.objects.create_user('jvout', 'jx@x.com', 'pw12345!')
        self.client.force_authenticate(outsider)
        data = self.client.get(f'/api/groups/{group.slug}/').data
        self.assertEqual((data['is_member'], data['is_joined']), (False, False))

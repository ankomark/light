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


class LiveSendTests(Base):
    def setUp(self):
        super().setUp()
        from songs.models import DeviceToken
        self.quiet = User.objects.create_user('gquiet', 'gq@x.com', 'x')
        self.looking = User.objects.create_user('glooking', 'gl@x.com', 'x')
        GroupMember.objects.create(group=self.group, user=self.quiet, muted_until=timezone.now() + timedelta(hours=8))
        GroupMember.objects.create(group=self.group, user=self.looking)
        for u in (self.owner, self.member, self.quiet, self.looking):
            DeviceToken.objects.create(user=u, token=f'ExponentPushToken[{u.username}]', is_active=True)

    def send(self, **extra):
        return self.client.post(self.url('posts/'), {'content': 'hello', **extra}, format='json')

    def test_a_retry_with_the_same_client_id_is_one_message(self):
        self.client.force_authenticate(self.member)
        a = self.send(client_id='c-1')
        b = self.send(client_id='c-1')
        self.assertEqual(a.status_code, 201)
        self.assertEqual(b.status_code, 200)
        self.assertEqual(a.json()['id'], b.json()['id'])
        self.assertEqual(a.json()['client_id'], 'c-1')
        self.assertEqual(GroupPost.objects.filter(group=self.group, message_type='text').count(), 1)

    def test_pushes_skip_the_sender_the_muted_and_whoever_is_looking(self):
        from unittest import mock
        from songs import group_live
        group_live.came_online(self.group.slug, self.looking.id)     # has the chat open
        sent = []
        with mock.patch('songs.push.send_expo_push', side_effect=lambda tokens, *a, **k: sent.extend(tokens)):
            self.client.force_authenticate(self.member)
            self.assertEqual(self.send().status_code, 201)
        self.assertEqual(sent, ['ExponentPushToken[gowner]'])
        group_live.went_offline(self.group.slug, self.looking.id)

    def test_the_broadcast_is_nobody_s_own(self):
        from unittest import mock
        with mock.patch('songs.views.groups.broadcast_group_message') as b:
            self.client.force_authenticate(self.member)
            self.send()
        data = b.call_args[0][1]
        self.assertFalse(data['is_owner'])
        self.assertIsNone(data['reactions']['mine'])

    def test_reactions_members_and_settings_are_live(self):
        from unittest import mock
        post = GroupPost.objects.create(group=self.group, user=self.owner, content='hi')
        with mock.patch('songs.group_live.tell_group') as tell:
            self.client.force_authenticate(self.member)
            self.client.post(self.url(f'posts/{post.id}/react/'), {'emoji': '🙏'}, format='json')
            self.client.force_authenticate(self.owner)
            self.client.post(self.url('remove-member/'), {'user_id': self.member.id}, format='json')
            self.client.post(self.url('posting-policy/'), {'only_admins_can_post': True}, format='json')
        kinds = [c.args[1]['type'] for c in tell.call_args_list]
        self.assertIn('reaction', kinds)
        self.assertIn('members', kinds)
        self.assertIn('member_removed', kinds)
        self.assertIn('group_updated', kinds)
        reaction = next(c.args[1] for c in tell.call_args_list if c.args[1]['type'] == 'reaction')
        self.assertEqual(reaction['summary'], [{'emoji': '🙏', 'count': 1}])

    def test_mute_and_the_unread_badge(self):
        GroupPost.objects.create(group=self.group, user=self.owner, content='news')
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.get('/api/conversations/unread_count/').json()['groups'], 1)
        r = self.client.post(self.url('mute/'), {'hours': 8}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertIsNotNone(self.client.get(self.url()).json()['muted_until'])
        self.assertEqual(self.client.get('/api/conversations/unread_count/').json()['groups'], 0)
        self.client.post(self.url('mute/'), {'hours': 0}, format='json')
        self.assertIsNone(self.client.get(self.url()).json()['muted_until'])
        self.client.post(self.url('mark-read/'))
        self.assertEqual(self.client.get('/api/conversations/unread_count/').json()['groups'], 0)


from django.test import override_settings


@override_settings(R2_PUBLIC_BASE='https://cdn.example')
class SafetyTests(Base):
    def post(self, **data):
        return self.client.post(self.url('posts/'), {'content': 'x', **data}, format='json')

    def test_attachments_must_be_our_uploads(self):
        self.client.force_authenticate(self.member)
        bad = self.post(message_type='image', attachment='https://evil.example/track.gif')
        self.assertEqual(bad.status_code, 400)
        ok = self.post(message_type='image', attachment='https://cdn.example/chat/a.jpg')
        self.assertEqual(ok.status_code, 201)

    def test_a_reply_cannot_quote_another_group(self):
        secret = Group.objects.create(creator=self.outsider, name='Secret', is_private=True)
        hidden = GroupPost.objects.create(group=secret, user=self.outsider, content='private words')
        self.client.force_authenticate(self.member)
        r = self.post(reply_to_id=hidden.id)
        self.assertEqual(r.status_code, 400)
        self.assertNotIn('private words', r.content.decode())

    def test_suspended_cannot_post_react_or_create(self):
        post = GroupPost.objects.create(group=self.group, user=self.owner, content='hi')
        User.objects.filter(pk=self.member.pk).update(is_suspended=True)
        self.member.refresh_from_db()
        self.client.force_authenticate(self.member)
        self.assertEqual(self.post().status_code, 403)
        self.assertEqual(self.client.post(self.url(f'posts/{post.id}/react/'), {'emoji': '🙏'}, format='json').status_code, 403)
        self.assertEqual(self.client.post('/api/groups/', {'name': 'New'}, format='json').status_code, 403)
        # A suspension that has lapsed is no suspension.
        User.objects.filter(pk=self.member.pk).update(suspended_until=timezone.now() - timedelta(days=1))
        self.member.refresh_from_db()
        self.client.force_authenticate(self.member)
        self.assertEqual(self.post().status_code, 201)

    def test_slow_mode_slows_members_not_admins(self):
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.post(self.url('slow-mode/'), {'seconds': 30}, format='json').status_code, 200)
        self.client.force_authenticate(self.member)
        self.assertEqual(self.post().status_code, 201)
        slowed = self.post()
        self.assertEqual(slowed.status_code, 429)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.post().status_code, 201)
        self.assertEqual(self.post().status_code, 201)
        # Members can't change it.
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.post(self.url('slow-mode/'), {'seconds': 0}, format='json').status_code, 403)

    def test_invite_links_expire_run_out_and_can_be_revoked(self):
        self.client.force_authenticate(self.owner)
        code = self.client.post(self.url('invite-link/'), {'regenerate': True, 'max_uses': 1}, format='json').json()['code']
        a = User.objects.create_user('ginvitea', 'ia@x.com', 'x')
        b = User.objects.create_user('ginviteb', 'ib@x.com', 'x')
        self.client.force_authenticate(a)
        self.assertEqual(self.client.post('/api/groups/join-by-code/', {'code': code}, format='json').status_code, 200)
        self.client.force_authenticate(b)
        self.assertEqual(self.client.post('/api/groups/join-by-code/', {'code': code}, format='json').status_code, 410)

        self.client.force_authenticate(self.owner)
        code = self.client.post(self.url('invite-link/'), {'regenerate': True, 'expires_in_hours': 1}, format='json').json()['code']
        Group.objects.filter(pk=self.group.pk).update(invite_expires_at=timezone.now() - timedelta(minutes=1))
        self.client.force_authenticate(b)
        self.assertEqual(self.client.post('/api/groups/join-by-code/', {'code': code}, format='json').status_code, 410)

        self.client.force_authenticate(self.owner)
        self.assertIsNone(self.client.post(self.url('invite-link/'), {'revoke': True}, format='json').json()['code'])
        self.client.force_authenticate(b)
        self.assertEqual(self.client.post('/api/groups/join-by-code/', {'code': code}, format='json').status_code, 404)

    def test_invite_limits_are_admins_business(self):
        self.client.force_authenticate(self.owner)
        self.client.post(self.url('invite-link/'), {'regenerate': True, 'max_uses': 5}, format='json')
        self.assertEqual(self.client.get(self.url()).json()['invite_max_uses'], 5)
        self.client.force_authenticate(self.member)
        body = self.client.get(self.url()).json()
        self.assertNotIn('invite_max_uses', body)
        self.assertIsNone(body['invite_code'])

    def test_add_member_respects_blocks_and_deactivation(self):
        from songs.models import Block
        gone = User.objects.create_user('ggone', 'gg@x.com', 'x')
        User.objects.filter(pk=gone.pk).update(is_deactivated=True)
        Block.objects.create(blocker=self.outsider, blocked=self.owner)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.post(self.url('add-member/'), {'user_id': gone.id}, format='json').status_code, 404)
        self.assertEqual(self.client.post(self.url('add-member/'), {'user_id': self.outsider.id}, format='json').status_code, 403)

    def test_only_members_report_a_group_message(self):
        post = GroupPost.objects.create(group=self.group, user=self.owner, content='hi')
        body = {'content_type': 'grouppost', 'object_id': post.id, 'reason': 'spam'}
        self.client.force_authenticate(self.outsider)
        self.assertEqual(self.client.post('/api/reports/', body, format='json').status_code, 404)
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.post('/api/reports/', body, format='json').status_code, 201)


@override_settings(R2_PUBLIC_BASE='https://cdn.example')
class MemberFeatureTests(Base):
    def setUp(self):
        super().setUp()
        from songs.models import DeviceToken
        self.named = User.objects.create_user('gnamed', 'gn@x.com', 'x')
        GroupMember.objects.create(group=self.group, user=self.named, muted_until=timezone.now() + timedelta(days=1))
        GroupMember.objects.filter(group=self.group, user=self.owner).update(notify_level='mentions')
        for u in (self.owner, self.member, self.named):
            DeviceToken.objects.create(user=u, token=f'ExponentPushToken[{u.username}]', is_active=True)

    def test_a_mention_reaches_even_a_muted_member_mentions_only_skips_the_rest(self):
        from unittest import mock
        from songs.models import Notification
        pushes = []
        with mock.patch('songs.push.send_expo_push', side_effect=lambda tokens, title, body, data=None: pushes.append((tuple(tokens), body))):
            self.client.force_authenticate(self.member)
            self.client.post(self.url('posts/'), {'content': 'hello @GNamed, see this'}, format='json')
            self.client.post(self.url('posts/'), {'content': 'no names here'}, format='json')
        # The owner chose "mentions only", the named member muted: only the mention gets through.
        self.assertEqual(pushes, [(('ExponentPushToken[gnamed]',), 'gmember mentioned you in Choir: hello @GNamed, see this')])
        self.assertTrue(Notification.objects.filter(recipient=self.named, notification_type='group_mention').exists())

    def test_archive_and_notify_level_are_mine(self):
        self.client.force_authenticate(self.member)
        r = self.client.post(self.url('me/'), {'archived': True, 'notify': 'mentions'}, format='json')
        self.assertEqual(r.json()['archived'], True)
        self.assertEqual(r.json()['notify'], 'mentions')
        mine = [g['slug'] for g in self.client.get('/api/groups/', {'scope': 'mine'}).json()['results']]
        archived = [g['slug'] for g in self.client.get('/api/groups/', {'scope': 'archived'}).json()['results']]
        self.assertNotIn(self.group.slug, mine)
        self.assertIn(self.group.slug, archived)
        me = self.client.get(self.url()).json()['my_settings']
        self.assertEqual((me['archived'], me['notify']), (True, 'mentions'))
        self.assertEqual(self.client.post(self.url('me/'), {'notify': 'everything'}, format='json').status_code, 400)
        # Someone else still sees it in theirs.
        self.client.force_authenticate(self.owner)
        mine = [g['slug'] for g in self.client.get('/api/groups/', {'scope': 'mine'}).json()['results']]
        self.assertIn(self.group.slug, mine)

    def test_media_by_kind(self):
        GroupPost.objects.create(group=self.group, user=self.owner, message_type='image', attachment='https://cdn.example/a.jpg')
        GroupPost.objects.create(group=self.group, user=self.owner, message_type='file', attachment='https://cdn.example/a.pdf')
        self.client.force_authenticate(self.member)
        kinds = [p['message_type'] for p in self.client.get(self.url('posts/media/'), {'type': 'file'}).json()['results']]
        self.assertEqual(kinds, ['file'])
        self.assertEqual(self.client.get(self.url('posts/media/')).json()['count'], 2)

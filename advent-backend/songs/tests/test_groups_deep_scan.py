"""Groups & communities deep scan: a group's settings can't reach another
group's words, takedowns stay out of previews, removed members wait before
coming back, "false" means no, covers are pictures, categories are their
maker's, messages have a length.

    python manage.py test songs.tests.test_groups_deep_scan --settings=music.settings_test
"""
import io
from unittest import mock

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image as PILImage
from rest_framework.test import APITestCase

from songs.models import CommunityCategory, Group, GroupMember, GroupPost, User


def png():
    buf = io.BytesIO()
    PILImage.new('RGB', (4, 4), 'red').save(buf, 'PNG')
    return SimpleUploadedFile('c.png', buf.getvalue(), content_type='image/png')


@mock.patch('songs.views.groups.notify_user')
class GroupScanTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user('own', 'o@x.com', 'x')
        self.member = User.objects.create_user('mem', 'm@x.com', 'x')
        self.group = Group.objects.create(creator=self.owner, name='Choir', is_private=False)
        GroupMember.objects.create(group=self.group, user=self.owner, is_admin=True)
        GroupMember.objects.create(group=self.group, user=self.member)
        self.client.force_authenticate(self.owner)

    def url(self, tail=''):
        return f'/api/groups/{self.group.slug}/{tail}'

    def test_a_group_cannot_pin_another_groups_words_nor_change_its_kind(self, notify):
        stranger = User.objects.create_user('str', 's@x.com', 'x')
        secret = Group.objects.create(creator=stranger, name='Secret', is_private=True)
        hidden = GroupPost.objects.create(group=secret, user=stranger, content='private words')
        self.client.patch(self.url(), {'pinned_post': hidden.id, 'kind': 'community', 'is_removed': True},
                          format='json')
        self.group.refresh_from_db()
        self.assertIsNone(self.group.pinned_post_id)
        self.assertEqual(self.group.kind, Group.KIND_GROUP)
        self.assertFalse(self.group.is_removed)

    def test_a_takedown_is_never_the_preview(self, notify):
        GroupPost.objects.create(group=self.group, user=self.member, content='fine')
        GroupPost.objects.create(group=self.group, user=self.member, content='hateful', is_removed=True)
        row = next(g for g in self.client.get('/api/groups/?scope=mine').data['results'] if g['slug'] == self.group.slug)
        self.assertNotEqual((row.get('last_message') or {}).get('content'), 'hateful')

    def test_a_removed_member_waits_before_coming_back(self, notify):
        code = self.client.post(self.url('invite-link/'), {}, format='json').data['code']
        self.client.post(self.url('remove-member/'), {'user_id': self.member.id}, format='json')
        self.client.force_authenticate(self.member)
        r = self.client.post('/api/groups/join-by-code/', {'code': code}, format='json')
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data['code'], 'cooldown')
        # An admin adding them back clears it.
        self.client.force_authenticate(self.owner)
        self.client.post(self.url('add-member/'), {'user_id': self.member.id}, format='json')
        self.assertTrue(GroupMember.objects.filter(group=self.group, user=self.member).exists())

    def test_false_means_no(self, notify):
        self.client.post(self.url('set-admin/'), {'user_id': self.member.id, 'is_admin': True}, format='json')
        self.client.post(self.url('set-admin/'), {'user_id': self.member.id, 'is_admin': 'false'})   # a form
        self.assertFalse(GroupMember.objects.get(group=self.group, user=self.member).is_admin)

    def test_the_cover_is_a_picture_and_admins_may_set_it(self, notify):
        GroupMember.objects.filter(group=self.group, user=self.member).update(is_admin=True)
        self.client.force_authenticate(self.member)
        bad = SimpleUploadedFile('c.png', b'<html>not a picture</html>', content_type='image/png')
        with mock.patch('songs.r2.upload_file', return_value='https://cdn.x/c.png') as up:
            self.assertEqual(self.client.post(self.url('upload-cover/'), {'cover_image': bad},
                                              format='multipart').status_code, 400)
            up.assert_not_called()
            self.assertEqual(self.client.post(self.url('upload-cover/'), {'cover_image': png()},
                                              format='multipart').status_code, 200)

    def test_a_message_has_a_length(self, notify):
        r = self.client.post(self.url('posts/'), {'content': 'x' * 5001}, format='json')
        self.assertEqual(r.status_code, 400)
        post = GroupPost.objects.create(group=self.group, user=self.owner, content='hi', message_type='text')
        r = self.client.patch(self.url(f'posts/{post.id}/edit/'), {'content': 'y' * 5001}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_join_requests_are_not_written_straight(self, notify):
        r = self.client.post(f'/api/groups/{self.group.slug}/join-requests/', {'message': 'x'}, format='json')
        self.assertIn(r.status_code, (403, 404, 405))


class CategoryTests(APITestCase):
    def test_a_category_is_its_makers_to_change(self):
        maker = User.objects.create_user('maker', 'mk@x.com', 'x')
        other = User.objects.create_user('other', 'ot@x.com', 'x')
        cat = CommunityCategory.objects.create(name='Choirs', slug='choirs-x', created_by=maker)
        self.client.force_authenticate(other)
        self.assertEqual(self.client.patch(f'/api/community-categories/{cat.slug}/', {'name': 'Spam'},
                                           format='json').status_code, 403)
        self.assertEqual(self.client.delete(f'/api/community-categories/{cat.slug}/').status_code, 403)
        self.client.force_authenticate(maker)
        self.assertEqual(self.client.patch(f'/api/community-categories/{cat.slug}/', {'name': 'Choirs & bands'},
                                           format='json').status_code, 200)


class GroupLiveTests(APITestCase):
    """Re-scan 1: counts that can't drift, pushes by the group's own switch,
    none from someone blocked, and mentions that can't flood a mute."""

    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user('lo', 'lo@x.com', 'x')
        self.a = User.objects.create_user('la', 'la@x.com', 'x')
        self.b = User.objects.create_user('lb', 'lb@x.com', 'x')
        self.group = Group.objects.create(creator=self.owner, name='Youth', kind=Group.KIND_COMMUNITY)
        for u in (self.owner, self.a, self.b):
            GroupMember.objects.create(group=self.group, user=u, is_admin=(u == self.owner))

    def test_two_devices_count_once(self):
        from songs import group_live as live
        self.assertEqual(live.came_online('g', 1), (True, 1))
        self.assertEqual(live.came_online('g', 1), (False, 1))
        self.assertEqual(live.came_online('g', 2), (True, 2))
        self.assertEqual(live.went_offline('g', 1), (False, 2))
        self.assertEqual(live.went_offline('g', 1), (True, 1))
        self.assertEqual(live.went_offline('g', 1), (True, 1))      # never below zero

    def test_pushes_go_by_the_groups_switch_and_not_from_the_blocked(self):
        from songs import group_live as live
        from songs.models import Block
        Block.objects.create(blocker=self.b, blocked=self.owner)
        post = GroupPost.objects.create(group=self.group, user=self.owner, content='hello', message_type='text')
        with mock.patch('songs.push.notify_many') as many:
            live.fan_out(self.group, self.owner, post, 'hello')
        args, kwargs = many.call_args
        self.assertEqual(sorted(args[0]), [self.a.id])            # not the one who blocked them
        self.assertEqual(kwargs['category'], 'communities')

    def test_naming_someone_again_and_again_rings_once(self):
        from songs import group_live as live
        GroupMember.objects.filter(user=self.a).update(notify_level=GroupMember.NOTIFY_MENTIONS)
        with mock.patch('songs.push.notify_many') as many:
            for i in range(3):
                p = GroupPost.objects.create(group=self.group, user=self.owner, content='@la look', message_type='text')
                live.fan_out(self.group, self.owner, p, '@la look')
        mention_calls = [c for c in many.call_args_list if c.args[1] == 'group_mention']
        self.assertEqual(len(mention_calls), 1)


class ListOrderTests(APITestCase):
    """Re-scan 2: one's own groups by latest activity; finding one to join,
    the liveliest first."""

    def setUp(self):
        cache.clear()
        self.me = User.objects.create_user('orderer', 'or@x.com', 'x')
        self.client.force_authenticate(self.me)

    def make(self, name, members=0, **extra):
        g = Group.objects.create(creator=self.me, name=name, is_private=False, **extra)
        GroupMember.objects.create(group=g, user=self.me, is_admin=True)
        for i in range(members):
            GroupMember.objects.create(group=g, user=User.objects.create_user(f'{name}{i}', f'{name}{i}@x.com', 'x'))
        return g

    def slugs(self, scope):
        return [g['slug'] for g in self.client.get(f'/api/groups/?scope={scope}').data['results']]

    def test_my_groups_by_latest_message_not_by_when_they_were_made(self):
        old = self.make('Old')
        new = self.make('New')                        # made later
        GroupPost.objects.create(group=old, user=self.me, content='still talking', message_type='text')
        self.assertEqual(self.slugs('mine')[:2], [old.slug, new.slug])

    def test_finding_a_group_the_liveliest_first(self):
        quiet = self.make('Quiet', members=0)
        busy = self.make('Busy', members=3)
        self.assertEqual(self.slugs('public')[:2], [busy.slug, quiet.slug])

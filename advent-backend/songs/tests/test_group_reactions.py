"""Tests for group-chat emoji reactions.

    python manage.py test songs.tests.test_group_reactions
"""
from rest_framework import status
from rest_framework.test import APITestCase

from songs.models import User, Group, GroupMember, GroupPost, GroupPostReaction


class GroupReactionTests(APITestCase):
    def setUp(self):
        self.creator = User.objects.create_user('gcreator', 'gc@x.com', 'x')
        self.member = User.objects.create_user('gmember', 'gm@x.com', 'x')
        self.outsider = User.objects.create_user('goutsider', 'go@x.com', 'x')
        self.group = Group.objects.create(creator=self.creator, name='Praise Team')
        GroupMember.objects.create(group=self.group, user=self.creator, is_admin=True)
        GroupMember.objects.create(group=self.group, user=self.member)
        self.post = GroupPost.objects.create(group=self.group, user=self.creator, content='Amen')

    def _react(self, emoji):
        return self.client.post(
            f'/api/groups/{self.group.slug}/posts/{self.post.id}/react/',
            {'emoji': emoji}, format='json',
        )

    def test_reaction_toggle_replace_and_clear(self):
        self.client.force_authenticate(self.member)

        r = self._react('❤️')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['reactions'], {'summary': [{'emoji': '❤️', 'count': 1}], 'mine': '❤️'})

        # Re-reacting with a different emoji replaces (still one per user).
        r = self._react('🔥')
        self.assertEqual(r.json()['reactions'], {'summary': [{'emoji': '🔥', 'count': 1}], 'mine': '🔥'})
        self.assertEqual(GroupPostReaction.objects.filter(post=self.post, user=self.member).count(), 1)

        # Tapping the same emoji clears it.
        r = self._react('🔥')
        self.assertEqual(r.json()['reactions'], {'summary': [], 'mine': None})
        self.assertFalse(GroupPostReaction.objects.filter(post=self.post).exists())

    def test_counts_aggregate_across_members(self):
        self.client.force_authenticate(self.creator)
        self._react('🙏')
        self.client.force_authenticate(self.member)
        r = self._react('🙏')
        self.assertEqual(r.json()['reactions'], {'summary': [{'emoji': '🙏', 'count': 2}], 'mine': '🙏'})

    def test_non_member_cannot_react(self):
        self.client.force_authenticate(self.outsider)
        self.assertEqual(self._react('👍').status_code, 403)

    def test_empty_emoji_rejected(self):
        self.client.force_authenticate(self.member)
        self.assertEqual(self._react('   ').status_code, 400)

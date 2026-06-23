"""Tests for the admin moderation actions ported from groups to the choir &
church communities: add member, change role (make/dismiss admin), and the
WhatsApp-style "only admins can send messages" lock.

    python manage.py test songs.tests.test_community_admin
"""
from rest_framework import status
from rest_framework.test import APITestCase
from unittest import mock

from songs.models import (
    User, Choir, ChoirMembership, Church, ChurchMembership,
)


class ChoirAdminActionTests(APITestCase):
    def setUp(self):
        self.creator = User.objects.create_user('creator', 'c@x.com', 'x')
        self.member = User.objects.create_user('member', 'm@x.com', 'x')
        self.stranger = User.objects.create_user('stranger', 's@x.com', 'x')

    def _make_choir(self):
        self.client.force_authenticate(self.creator)
        res = self.client.post('/api/choirs/', {'name': 'Zion Voices', 'location': 'Nairobi'}, format='json')
        assert res.status_code == status.HTTP_201_CREATED, res.content
        return res.json()['id']

    def test_admin_adds_member_directly(self):
        cid = self._make_choir()
        self.client.force_authenticate(self.creator)
        with mock.patch('songs.views.directory.notify_user'):
            res = self.client.post(f'/api/choirs/{cid}/add-member/', {'user_id': self.member.id}, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content)
        m = ChoirMembership.objects.get(choir_id=cid, user=self.member)
        self.assertEqual(m.role, 'member')
        # The added member can immediately post.
        self.client.force_authenticate(self.member)
        self.assertEqual(
            self.client.post(f'/api/choirs/{cid}/messages/', {'content': 'hi'}, format='json').status_code, 201)

    def test_non_admin_cannot_add_or_search(self):
        cid = self._make_choir()
        self.client.force_authenticate(self.stranger)
        self.assertEqual(
            self.client.post(f'/api/choirs/{cid}/add-member/', {'user_id': self.member.id}, format='json').status_code, 403)
        self.assertEqual(self.client.get(f'/api/choirs/{cid}/search-users/?q=mem').status_code, 403)

    def test_search_excludes_existing_members(self):
        cid = self._make_choir()
        self.client.force_authenticate(self.creator)
        with mock.patch('songs.views.directory.notify_user'):
            self.client.post(f'/api/choirs/{cid}/add-member/', {'user_id': self.member.id}, format='json')
        names = [u['username'] for u in self.client.get(f'/api/choirs/{cid}/search-users/?q=er').json()]
        self.assertIn('stranger', names)        # not a member → searchable
        self.assertNotIn('member', names)       # already a member → excluded (also matches "er")

    def test_make_and_dismiss_admin(self):
        cid = self._make_choir()
        self.client.force_authenticate(self.creator)
        with mock.patch('songs.views.directory.notify_user'):
            self.client.post(f'/api/choirs/{cid}/add-member/', {'user_id': self.member.id}, format='json')
        # Promote to admin.
        res = self.client.post(f'/api/choirs/{cid}/set-role/', {'user_id': self.member.id, 'role': 'admin'}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(ChoirMembership.objects.get(choir_id=cid, user=self.member).role, 'admin')
        # The new admin can now moderate (e.g. dismiss themselves back to member via the creator only).
        res = self.client.post(f'/api/choirs/{cid}/set-role/', {'user_id': self.member.id, 'role': 'member'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(ChoirMembership.objects.get(choir_id=cid, user=self.member).role, 'member')

    def test_creator_cannot_be_demoted(self):
        cid = self._make_choir()
        self.client.force_authenticate(self.creator)
        res = self.client.post(f'/api/choirs/{cid}/set-role/', {'user_id': self.creator.id, 'role': 'member'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(ChoirMembership.objects.get(choir_id=cid, user=self.creator).role, 'admin')

    def test_posting_policy_locks_non_admins(self):
        cid = self._make_choir()
        self.client.force_authenticate(self.creator)
        with mock.patch('songs.views.directory.notify_user'):
            self.client.post(f'/api/choirs/{cid}/add-member/', {'user_id': self.member.id}, format='json')
        # Lock the chat to admins.
        res = self.client.post(f'/api/choirs/{cid}/posting-policy/', {'only_admins_can_post': True}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()['only_admins_can_post'])
        # The snapshot reflects the lock.
        self.assertTrue(self.client.get(f'/api/choirs/{cid}/community/').json()['only_admins_can_post'])
        # Member is now blocked from posting; admin still can.
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.post(f'/api/choirs/{cid}/messages/', {'content': 'hi'}, format='json').status_code, 403)
        self.client.force_authenticate(self.creator)
        self.assertEqual(self.client.post(f'/api/choirs/{cid}/messages/', {'content': 'hi'}, format='json').status_code, 201)


class ChurchAdminActionTests(APITestCase):
    def setUp(self):
        self.creator = User.objects.create_user('pastor', 'p@x.com', 'x')
        self.member = User.objects.create_user('flock', 'fl@x.com', 'x')

    def _make_church(self):
        self.client.force_authenticate(self.creator)
        res = self.client.post('/api/churches/', {
            'name': 'Central SDA', 'country': 'Kenya', 'conference': 'CKC', 'location': 'Nairobi',
        }, format='json')
        assert res.status_code == status.HTTP_201_CREATED, res.content
        return res.json()['id']

    def test_add_member_and_make_admin(self):
        cid = self._make_church()
        self.client.force_authenticate(self.creator)
        with mock.patch('songs.views.directory.notify_user'):
            res = self.client.post(f'/api/churches/{cid}/add-member/', {'user_id': self.member.id}, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content)
        self.assertEqual(ChurchMembership.objects.get(church_id=cid, user=self.member).role, 'member')
        res = self.client.post(f'/api/churches/{cid}/set-role/', {'user_id': self.member.id, 'role': 'admin'}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(ChurchMembership.objects.get(church_id=cid, user=self.member).role, 'admin')

    def test_posting_policy_locks_non_admins(self):
        cid = self._make_church()
        self.client.force_authenticate(self.creator)
        with mock.patch('songs.views.directory.notify_user'):
            self.client.post(f'/api/churches/{cid}/add-member/', {'user_id': self.member.id}, format='json')
        self.client.post(f'/api/churches/{cid}/posting-policy/', {'only_admins_can_post': True}, format='json')
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.post(f'/api/churches/{cid}/messages/', {'content': 'hi'}, format='json').status_code, 403)
        self.client.force_authenticate(self.creator)
        self.assertEqual(self.client.post(f'/api/churches/{cid}/messages/', {'content': 'hi'}, format='json').status_code, 201)

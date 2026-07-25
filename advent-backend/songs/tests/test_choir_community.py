"""Tests for the choir community layer (membership / requests / chat).

    python manage.py test songs.tests.test_choir_community --settings=music.settings_test
"""
from django.core.cache import cache
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework.throttling import SimpleRateThrottle
from unittest import mock

from songs.models import (
    User, Choir, ChoirMembership, ChoirJoinRequest, ChoirMessage, ChoirMessageReaction,
    CommunityAuditLog,
)


class ChoirCommunityTests(APITestCase):
    def setUp(self):
        self.creator = User.objects.create_user('creator', 'c@x.com', 'x')
        self.fan = User.objects.create_user('fan', 'f@x.com', 'x')
        self.outsider = User.objects.create_user('outsider', 'o@x.com', 'x')

    def _make_choir(self):
        self.client.force_authenticate(self.creator)
        res = self.client.post('/api/choirs/', {'name': 'Zion Voices', 'location': 'Nairobi'}, format='json')
        assert res.status_code == status.HTTP_201_CREATED, res.content
        return res.json()['id']

    def test_creator_becomes_admin_member(self):
        cid = self._make_choir()
        m = ChoirMembership.objects.get(choir_id=cid, user=self.creator)
        self.assertEqual(m.role, 'admin')

    def test_request_then_approve_grants_chat_access(self):
        cid = self._make_choir()
        # Outsider can't read the chat yet.
        self.client.force_authenticate(self.fan)
        self.assertEqual(self.client.get(f'/api/choirs/{cid}/messages/').status_code, 403)
        # Request to join.
        with mock.patch('songs.views.directory.notify_user'):
            rq = self.client.post(f'/api/choirs/{cid}/request-join/', {'message': 'love your music'}, format='json')
        self.assertEqual(rq.status_code, 201)
        req_id = rq.json()['id']
        # Creator approves.
        self.client.force_authenticate(self.creator)
        with mock.patch('songs.views.directory.notify_user'):
            ap = self.client.post(f'/api/choirs/{cid}/approve-request/', {'request_id': req_id}, format='json')
        self.assertEqual(ap.status_code, 200)
        self.assertTrue(ChoirMembership.objects.filter(choir_id=cid, user=self.fan, role='friend').exists())
        # Now the fan can read and post.
        self.client.force_authenticate(self.fan)
        self.assertEqual(self.client.get(f'/api/choirs/{cid}/messages/').status_code, 200)
        post = self.client.post(f'/api/choirs/{cid}/messages/', {'content': 'Hallelujah!'}, format='json')
        self.assertEqual(post.status_code, 201)
        self.assertEqual(post.json()['sender']['username'], 'fan')

    def test_base64_rejected_and_blurhash_round_trips(self):
        """Image messages must reference an uploaded R2 URL (inline base64 is
        refused), and the BlurHash placeholder persists and comes back."""
        cid = self._make_choir()
        self.client.force_authenticate(self.creator)
        url = f'/api/choirs/{cid}/messages/'

        bad = self.client.post(
            url, {'message_type': 'image', 'attachment': 'data:image/png;base64,' + 'A' * 4000},
            format='json')
        self.assertEqual(bad.status_code, 400, bad.content[:200])

        ok = self.client.post(
            url,
            {'message_type': 'image', 'attachment': 'https://cdn.example/r2/pic.jpg',
             'attachment_blurhash': 'LEHV6nWB2yk8pyo0adR*.7kCMdnj'},
            format='json')
        self.assertEqual(ok.status_code, 201, ok.content[:200])
        self.assertEqual(ok.json()['attachment_blurhash'], 'LEHV6nWB2yk8pyo0adR*.7kCMdnj')

    def test_non_member_cannot_post(self):
        cid = self._make_choir()
        self.client.force_authenticate(self.outsider)
        r = self.client.post(f'/api/choirs/{cid}/messages/', {'content': 'hi'}, format='json')
        self.assertEqual(r.status_code, 403)
        self.assertEqual(ChoirMessage.objects.filter(choir_id=cid).count(), 0)

    def test_only_admin_sees_and_approves_requests(self):
        cid = self._make_choir()
        self.client.force_authenticate(self.fan)
        with mock.patch('songs.views.directory.notify_user'):
            req_id = self.client.post(f'/api/choirs/{cid}/request-join/', {}, format='json').json()['id']
        # Non-admin can't list or approve.
        self.assertEqual(self.client.get(f'/api/choirs/{cid}/join-requests/').status_code, 403)
        self.assertEqual(
            self.client.post(f'/api/choirs/{cid}/approve-request/', {'request_id': req_id}, format='json').status_code,
            403,
        )
        # Admin can list.
        self.client.force_authenticate(self.creator)
        lst = self.client.get(f'/api/choirs/{cid}/join-requests/')
        self.assertEqual(lst.status_code, 200)
        self.assertEqual(len(lst.json()), 1)

    def test_admin_removes_member(self):
        cid = self._make_choir()
        ChoirMembership.objects.create(choir_id=cid, user=self.fan, role='friend')
        self.client.force_authenticate(self.creator)
        r = self.client.post(f'/api/choirs/{cid}/remove-member/', {'user_id': self.fan.id}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertFalse(ChoirMembership.objects.filter(choir_id=cid, user=self.fan).exists())

    def test_creator_cannot_be_removed_or_leave(self):
        cid = self._make_choir()
        self.client.force_authenticate(self.creator)
        self.assertEqual(
            self.client.post(f'/api/choirs/{cid}/remove-member/', {'user_id': self.creator.id}, format='json').status_code,
            400,
        )
        self.assertEqual(self.client.post(f'/api/choirs/{cid}/leave/').status_code, 400)

    def test_member_can_leave(self):
        cid = self._make_choir()
        ChoirMembership.objects.create(choir_id=cid, user=self.fan, role='friend')
        self.client.force_authenticate(self.fan)
        self.assertEqual(self.client.post(f'/api/choirs/{cid}/leave/').status_code, 200)
        self.assertFalse(ChoirMembership.objects.filter(choir_id=cid, user=self.fan).exists())

    def test_only_creator_deletes_choir(self):
        cid = self._make_choir()
        self.client.force_authenticate(self.fan)
        self.assertEqual(self.client.delete(f'/api/choirs/{cid}/').status_code, 403)
        self.client.force_authenticate(self.creator)
        self.assertEqual(self.client.delete(f'/api/choirs/{cid}/').status_code, 204)
        self.assertFalse(Choir.objects.filter(id=cid).exists())

    def test_sender_can_delete_own_message(self):
        cid = self._make_choir()
        self.client.force_authenticate(self.creator)
        mid = self.client.post(f'/api/choirs/{cid}/messages/', {'content': 'oops'}, format='json').json()['id']
        r = self.client.post(f'/api/choirs/{cid}/messages/{mid}/delete/')
        self.assertEqual(r.status_code, 200)
        self.assertFalse(ChoirMessage.objects.filter(id=mid).exists())

    def test_reply_threads_a_message(self):
        cid = self._make_choir()
        self.client.force_authenticate(self.creator)
        first = self.client.post(f'/api/choirs/{cid}/messages/', {'content': 'Welcome!'}, format='json').json()
        reply = self.client.post(
            f'/api/choirs/{cid}/messages/',
            {'content': 'Thank you!', 'reply_to': first['id']}, format='json',
        )
        self.assertEqual(reply.status_code, 201)
        body = reply.json()
        self.assertIsNotNone(body['reply_to'])
        self.assertEqual(body['reply_to']['id'], first['id'])
        self.assertEqual(body['reply_to']['sender'], 'creator')
        self.assertEqual(body['reply_to']['content'], 'Welcome!')

    def test_reaction_toggle_replace_and_clear(self):
        cid = self._make_choir()
        ChoirMembership.objects.create(choir_id=cid, user=self.fan, role='friend')
        self.client.force_authenticate(self.creator)
        mid = self.client.post(f'/api/choirs/{cid}/messages/', {'content': 'Amen'}, format='json').json()['id']

        # Fan adds ❤️.
        self.client.force_authenticate(self.fan)
        r = self.client.post(f'/api/choirs/{cid}/messages/{mid}/react/', {'emoji': '❤️'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['reactions'], {'summary': [{'emoji': '❤️', 'count': 1}], 'mine': '❤️'})

        # Re-reacting with a different emoji replaces (still one per user).
        r = self.client.post(f'/api/choirs/{cid}/messages/{mid}/react/', {'emoji': '🔥'}, format='json')
        self.assertEqual(r.json()['reactions'], {'summary': [{'emoji': '🔥', 'count': 1}], 'mine': '🔥'})
        self.assertEqual(ChoirMessageReaction.objects.filter(message_id=mid, user=self.fan).count(), 1)

        # Tapping the same emoji clears it.
        r = self.client.post(f'/api/choirs/{cid}/messages/{mid}/react/', {'emoji': '🔥'}, format='json')
        self.assertEqual(r.json()['reactions'], {'summary': [], 'mine': None})
        self.assertFalse(ChoirMessageReaction.objects.filter(message_id=mid).exists())

    def test_non_member_cannot_react(self):
        cid = self._make_choir()
        self.client.force_authenticate(self.creator)
        mid = self.client.post(f'/api/choirs/{cid}/messages/', {'content': 'hi'}, format='json').json()['id']
        self.client.force_authenticate(self.outsider)
        r = self.client.post(f'/api/choirs/{cid}/messages/{mid}/react/', {'emoji': '👍'}, format='json')
        self.assertEqual(r.status_code, 403)

    # Images are R2 URLs now (moved off base64 data-URIs).
    PROFILE = 'https://pub-test.r2.dev/profile_images/p.jpg'
    COVER = 'https://pub-test.r2.dev/cover_images/c.jpg'

    @override_settings(R2_PUBLIC_BASE='https://pub-test.r2.dev')
    def test_list_returns_stored_r2_urls(self):
        self.client.force_authenticate(self.creator)
        res = self.client.post(
            '/api/choirs/',
            {'name': 'Pixel Praise', 'location': 'Web',
             'profile_image': self.PROFILE, 'cover_image': self.COVER},
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        cid = res.json()['id']

        lst = self.client.get('/api/choirs/')
        row = next(c for c in (lst.json().get('results') or lst.json()) if c['id'] == cid)
        self.assertEqual(row['profile_image'], self.PROFILE)
        self.assertEqual(row['cover_image'], self.COVER)

    def test_missing_images_are_empty(self):
        cid = self._make_choir()  # created without images
        lst = self.client.get('/api/choirs/')
        row = next(c for c in (lst.json().get('results') or lst.json()) if c['id'] == cid)
        self.assertEqual(row['cover_image'], '')
        self.assertEqual(row['profile_image'], '')


class ChoirChatPhase3Tests(APITestCase):
    """Edit, pin, receipts, and in-chat search/context for the choir chat."""

    def setUp(self):
        self.admin = User.objects.create_user('adm', 'a@x.com', 'x')
        self.member = User.objects.create_user('mem', 'm@x.com', 'x')
        self.outsider = User.objects.create_user('out', 'o@x.com', 'x')
        self.choir = Choir.objects.create(name='Zion', location='Nairobi', created_by=self.admin)
        ChoirMembership.objects.create(choir=self.choir, user=self.admin, role='admin')
        ChoirMembership.objects.create(choir=self.choir, user=self.member, role='friend')

    def _post(self, user, content):
        self.client.force_authenticate(user)
        r = self.client.post(f'/api/choirs/{self.choir.id}/messages/', {'content': content}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()['id']

    def test_author_edits_own_message_only(self):
        mid = self._post(self.member, 'helo')
        # Author edits.
        self.client.force_authenticate(self.member)
        r = self.client.patch(f'/api/choirs/{self.choir.id}/messages/{mid}/edit/',
                              {'content': 'hello'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()['content'], 'hello')
        self.assertIsNotNone(r.json()['edited_at'])
        # Someone else cannot.
        self.client.force_authenticate(self.admin)
        r2 = self.client.patch(f'/api/choirs/{self.choir.id}/messages/{mid}/edit/',
                               {'content': 'nope'}, format='json')
        self.assertEqual(r2.status_code, 403)

    def test_admin_pins_and_unpins(self):
        mid = self._post(self.member, 'pin me')
        # Member cannot pin.
        self.client.force_authenticate(self.member)
        self.assertEqual(
            self.client.post(f'/api/choirs/{self.choir.id}/messages/{mid}/pin/').status_code, 403)
        # Admin pins; it surfaces on the community snapshot.
        self.client.force_authenticate(self.admin)
        r = self.client.post(f'/api/choirs/{self.choir.id}/messages/{mid}/pin/')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()['id'], mid)
        snap = self.client.get(f'/api/choirs/{self.choir.id}/community/').json()
        self.assertEqual(snap['pinned_message']['id'], mid)
        # Unpin clears it.
        self.client.post(f'/api/choirs/{self.choir.id}/unpin/')
        snap2 = self.client.get(f'/api/choirs/{self.choir.id}/community/').json()
        self.assertIsNone(snap2['pinned_message'])

    def test_receipts_count_readers_after_mark_read(self):
        mid = self._post(self.admin, 'roll call')
        # Before anyone reads, no receipts.
        self.client.force_authenticate(self.admin)
        r0 = self.client.get(f'/api/choirs/{self.choir.id}/messages/{mid}/receipts/')
        self.assertEqual(r0.json()['count'], 0)
        # Member marks the chat read → shows up as a reader (author excluded).
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.post(f'/api/choirs/{self.choir.id}/mark-read/').status_code, 200)
        self.client.force_authenticate(self.admin)
        r1 = self.client.get(f'/api/choirs/{self.choir.id}/messages/{mid}/receipts/')
        self.assertEqual(r1.json()['count'], 1)
        self.assertEqual(r1.json()['readers'][0]['user']['username'], 'mem')

    def test_search_and_context(self):
        self._post(self.member, 'first apple message')
        target = self._post(self.member, 'the banana in the middle')
        self._post(self.member, 'last cherry note')
        self.client.force_authenticate(self.member)
        # Search finds the banana message.
        s = self.client.get(f'/api/choirs/{self.choir.id}/search/', {'q': 'banana'})
        self.assertEqual(s.status_code, 200)
        ids = [m['id'] for m in s.json()['results']]
        self.assertIn(target, ids)
        # Context returns a window around it.
        c = self.client.get(f'/api/choirs/{self.choir.id}/context/', {'message_id': target})
        self.assertEqual(c.status_code, 200)
        win_ids = [m['id'] for m in c.json()['results']]
        self.assertIn(target, win_ids)
        self.assertFalse(c.json()['has_earlier'])
        self.assertFalse(c.json()['has_newer'])
        # Outsider is locked out of search.
        self.client.force_authenticate(self.outsider)
        self.assertEqual(
            self.client.get(f'/api/choirs/{self.choir.id}/search/', {'q': 'banana'}).status_code, 403)


class ChoirModerationPhase4Tests(APITestCase):
    """Moderator role, per-community audit log, and chat rate limiting."""

    def setUp(self):
        cache.clear()  # throttle counters live in the cache; reset between tests
        self.admin = User.objects.create_user('padm', 'a@x.com', 'x')
        self.mod = User.objects.create_user('pmod', 'm@x.com', 'x')
        self.member = User.objects.create_user('pmem', 'p@x.com', 'x')
        self.choir = Choir.objects.create(name='Zion', location='Nairobi', created_by=self.admin)
        ChoirMembership.objects.create(choir=self.choir, user=self.admin, role='admin')
        self.mod_m = ChoirMembership.objects.create(choir=self.choir, user=self.mod, role='friend')
        ChoirMembership.objects.create(choir=self.choir, user=self.member, role='friend')

    def _post(self, user, content):
        self.client.force_authenticate(user)
        r = self.client.post(f'/api/choirs/{self.choir.id}/messages/', {'content': content}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()['id']

    def test_set_moderator_is_admin_only_and_grants_powers(self):
        # A plain member can't promote anyone.
        self.client.force_authenticate(self.member)
        self.assertEqual(
            self.client.post(f'/api/choirs/{self.choir.id}/set-moderator/',
                             {'user_id': self.mod.id}, format='json').status_code, 403)
        # Admin promotes the moderator; it shows on the membership + snapshot.
        self.client.force_authenticate(self.admin)
        r = self.client.post(f'/api/choirs/{self.choir.id}/set-moderator/',
                             {'user_id': self.mod.id}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()['is_moderator'])
        self.mod_m.refresh_from_db()
        self.assertTrue(self.mod_m.is_moderator)
        self.client.force_authenticate(self.mod)
        snap = self.client.get(f'/api/choirs/{self.choir.id}/community/').json()
        self.assertTrue(snap['is_moderator'])

    def test_moderator_can_delete_others_and_pin(self):
        self.mod_m.is_moderator = True
        self.mod_m.save(update_fields=['is_moderator'])
        victim_msg = self._post(self.member, 'delete me')
        # Plain member cannot delete someone else's message.
        self.client.force_authenticate(self.member)
        other = self._post(self.admin, 'admin note')
        self.client.force_authenticate(self.member)
        self.assertEqual(
            self.client.post(f'/api/choirs/{self.choir.id}/messages/{other}/delete/').status_code, 403)
        # Moderator can delete another member's message and pin one.
        self.client.force_authenticate(self.mod)
        self.assertEqual(
            self.client.post(f'/api/choirs/{self.choir.id}/messages/{victim_msg}/delete/').status_code, 200)
        self.assertEqual(
            self.client.post(f'/api/choirs/{self.choir.id}/messages/{other}/pin/').status_code, 200)

    def test_audit_log_records_and_is_gated(self):
        # An admin action gets logged.
        self.client.force_authenticate(self.admin)
        self.client.post(f'/api/choirs/{self.choir.id}/set-moderator/',
                         {'user_id': self.mod.id}, format='json')
        self.assertTrue(CommunityAuditLog.objects.filter(
            kind='choir', community_id=self.choir.id, action='grant_moderator').exists())
        # Admin + moderator can read the log; a plain member cannot.
        log = self.client.get(f'/api/choirs/{self.choir.id}/audit-log/')
        self.assertEqual(log.status_code, 200)
        rows = log.json().get('results', log.json())
        self.assertTrue(any(r['action'] == 'grant_moderator' for r in rows))
        self.mod_m.is_moderator = True
        self.mod_m.save(update_fields=['is_moderator'])
        self.client.force_authenticate(self.mod)
        self.assertEqual(self.client.get(f'/api/choirs/{self.choir.id}/audit-log/').status_code, 200)
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.get(f'/api/choirs/{self.choir.id}/audit-log/').status_code, 403)

    def test_message_rate_limit(self):
        cache.clear()
        with mock.patch.dict(SimpleRateThrottle.THROTTLE_RATES, {'community_post': '2/min'}):
            self.client.force_authenticate(self.member)
            url = f'/api/choirs/{self.choir.id}/messages/'
            self.assertEqual(self.client.post(url, {'content': '1'}, format='json').status_code, 201)
            self.assertEqual(self.client.post(url, {'content': '2'}, format='json').status_code, 201)
            self.assertEqual(self.client.post(url, {'content': '3'}, format='json').status_code, 429)

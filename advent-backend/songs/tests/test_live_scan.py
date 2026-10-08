"""The live re-scan: removal that sticks, faked input refused, admin ends on
the record, stale rooms reaped, the hub without blocked hosts.

    python manage.py test songs.tests.test_live_scan --settings=music.settings_test
"""
from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from songs.models import AdminActionLog, Block, CoHostRequest, LiveBroadcast, Role, User
from songs.views.live import STALE_AFTER


def make(name, **extra):
    return User.objects.create_user(name, f'{name}@x.com', 'pw', **extra)


class LiveScanTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.host = make('host')
        self.viewer = make('viewer')
        self.b = LiveBroadcast.objects.create(host=self.host, kind='meet', title='Evening hymns', room_name='bc_1')

    def _as(self, user):
        self.client.force_authenticate(user)

    def test_someone_removed_cannot_rejoin(self):
        self._as(self.host)
        r = self.client.post(f'/api/live/broadcasts/{self.b.id}/moderate/', {'user_id': self.viewer.id}, format='json')
        self.assertEqual(r.status_code, 200)
        self._as(self.viewer)
        r = self.client.get(f'/api/live/broadcasts/{self.b.id}/token/')
        self.assertEqual((r.status_code, r.data['code']), (403, 'removed'))
        # Nor ask to come on stage.
        r = self.client.post(f'/api/live/broadcasts/{self.b.id}/request-cohost/')
        self.assertEqual(r.status_code, 403)

    def test_the_host_cannot_be_removed_and_bad_ids_are_refused(self):
        self._as(self.host)
        url = f'/api/live/broadcasts/{self.b.id}/moderate/'
        self.assertEqual(self.client.post(url, {'user_id': self.host.id}, format='json').status_code, 400)
        self.assertEqual(self.client.post(url, {'user_id': 'abc'}, format='json').status_code, 400)
        url = f'/api/live/broadcasts/{self.b.id}/approve-cohost/'
        self.assertEqual(self.client.post(url, {'request_id': 'abc'}, format='json').status_code, 404)

    def test_a_viewer_cannot_end_or_remove(self):
        self._as(self.viewer)
        self.assertEqual(self.client.post(f'/api/live/broadcasts/{self.b.id}/end/').status_code, 403)
        r = self.client.post(f'/api/live/broadcasts/{self.b.id}/moderate/', {'user_id': self.host.id}, format='json')
        self.assertEqual(r.status_code, 403)

    def test_a_moderator_ends_a_broadcast_on_the_record(self):
        mod = make('mod', role=Role.objects.create(name='Mods', capabilities=['remove_content']))
        self._as(mod)
        self.assertEqual(self.client.post(f'/api/live/broadcasts/{self.b.id}/end/').status_code, 200)
        self.b.refresh_from_db()
        self.assertEqual(self.b.status, 'ended')
        self.assertTrue(AdminActionLog.objects.filter(action='end_live', target_id=self.b.id).exists())

    def test_the_hosts_own_likes_do_not_count_on_their_profile(self):
        self._as(self.host)
        with mock.patch('songs.views.live.credit_user_likes') as credit:
            r = self.client.post(f'/api/live/broadcasts/{self.b.id}/react/', {'count': 10}, format='json')
        self.assertEqual(r.data['like_count'], 10)
        credit.assert_not_called()

    def test_someone_blocked_cannot_react(self):
        Block.objects.create(blocker=self.host, blocked=self.viewer)
        self._as(self.viewer)
        r = self.client.post(f'/api/live/broadcasts/{self.b.id}/react/', {'count': 5}, format='json')
        self.assertEqual(r.status_code, 403)

    def test_overlay_style_is_one_the_app_draws(self):
        self._as(self.host)
        r = self.client.post(f'/api/live/broadcasts/{self.b.id}/overlay/',
                             {'title': 'Line\none', 'style': '<script>'}, format='json')
        self.assertEqual(r.data['overlay']['style'], 'lower3')
        self.assertEqual(r.data['overlay']['title'], 'Line one')

    def test_the_hub_hides_blocked_hosts_and_ends_stale_rooms(self):
        Block.objects.create(blocker=self.viewer, blocked=self.host)
        other = make('other')
        old = LiveBroadcast.objects.create(host=other, kind='meet', title='Forgotten', room_name='bc_2')
        LiveBroadcast.objects.filter(pk=old.pk).update(started_at=timezone.now() - STALE_AFTER - timedelta(minutes=1))
        self._as(self.viewer)
        r = self.client.get('/api/live/broadcasts/')
        self.assertEqual(r.data['results'], [])
        old.refresh_from_db()
        self.assertEqual(old.status, 'ended')

    def test_cohost_token_says_when_to_stop_asking(self):
        CoHostRequest.objects.create(broadcast=self.b, user=self.viewer, status='rejected')
        self._as(self.viewer)
        r = self.client.get(f'/api/live/broadcasts/{self.b.id}/cohost-token/')
        self.assertEqual((r.status_code, r.data['code']), (403, 'rejected'))

    def test_asking_again_while_waiting_does_not_buzz_the_host_again(self):
        self._as(self.viewer)
        with mock.patch('songs.views.live.notify_user') as notify:
            self.client.post(f'/api/live/broadcasts/{self.b.id}/request-cohost/')
            self.client.post(f'/api/live/broadcasts/{self.b.id}/request-cohost/')
        self.assertEqual(notify.call_count, 1)

    def test_eligibility_says_what_is_needed(self):
        self._as(self.viewer)
        r = self.client.get('/api/live/broadcasts/eligibility/')
        self.assertEqual(r.data['followers'], 0)
        self.assertEqual(r.data['allowed'], {'tv': False, 'meet': False})
        r = self.client.post('/api/live/broadcasts/', {'kind': 'meet', 'title': 'Hi'}, format='json')
        self.assertEqual((r.status_code, r.data['code'], r.data['needed']), (403, 'followers_needed', 100))

    def test_an_admin_takedown_closes_the_room_at_livekit(self):
        from songs.views.admin import _end_live
        with mock.patch('songs.livekit_service.end_room') as end_room, \
                mock.patch('songs.tasks.run_in_background', side_effect=lambda f, *a, **k: f(*a, **k)):
            _end_live([self.b.id])
        end_room.assert_called_once_with('bc_1')
        self.b.refresh_from_db()
        self.assertEqual(self.b.status, 'ended')

    def test_the_hub_puts_hosts_i_follow_first_then_the_busiest(self):
        quiet, busy, friend = make('quiet'), make('busy'), make('friend')
        LiveBroadcast.objects.create(host=quiet, kind='meet', title='Quiet', room_name='r1', viewer_count=1)
        LiveBroadcast.objects.create(host=busy, kind='meet', title='Busy', room_name='r2', viewer_count=90)
        LiveBroadcast.objects.create(host=friend, kind='meet', title='Friend', room_name='r3', viewer_count=2)
        friend.followers.add(self.viewer)
        self._as(self.viewer)
        titles = [b['title'] for b in self.client.get('/api/live/broadcasts/').data['results']]
        self.assertEqual(titles[0], 'Friend')
        self.assertEqual(titles[1], 'Busy')

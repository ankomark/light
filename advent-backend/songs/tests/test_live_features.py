"""TikTok-style live features: chat moderation (mute, pin) and the share page.

    python manage.py test songs.tests.test_live_features --settings=music.settings_test
"""
from types import SimpleNamespace
from unittest import mock

from django.core.cache import cache
from rest_framework.test import APITestCase

from songs.models import CoHostRequest, LiveBroadcast, User


def make(name, **extra):
    return User.objects.create_user(name, f'{name}@x.com', 'pw', **extra)


class LiveChatModerationTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.host = make('host2')
        self.viewer = make('viewer2')
        self.b = LiveBroadcast.objects.create(host=self.host, kind='meet', title='Choir', room_name='bc_9')

    def _mute(self, user_id, mute=True):
        return self.client.post(f'/api/live/broadcasts/{self.b.id}/mute-chat/',
                                {'user_id': user_id, 'mute': mute}, format='json')

    def test_the_host_mutes_someone_and_their_next_token_cannot_chat(self):
        self.client.force_authenticate(self.host)
        with mock.patch('songs.views.live.lk.set_permissions') as perm:
            r = self._mute(self.viewer.id)
        self.assertEqual(r.data, {'muted': True, 'user_id': self.viewer.id})
        perm.assert_called_once_with('bc_9', f'u{self.viewer.id}', can_publish=False, can_publish_data=False)

        self.client.force_authenticate(self.viewer)
        with mock.patch('songs.views.live.lk.create_access_token', return_value='t') as tok:
            r = self.client.get(f'/api/live/broadcasts/{self.b.id}/token/')
        self.assertFalse(tok.call_args.kwargs['can_publish_data'])
        self.assertTrue(r.data['broadcast']['chat_muted'])

        self.client.force_authenticate(self.host)
        with mock.patch('songs.views.live.lk.set_permissions'):
            self._mute(self.viewer.id, mute=False)
        self.b.refresh_from_db()
        self.assertEqual(self.b.muted_ids, [])

    def test_nobody_mutes_the_host_and_a_viewer_mutes_nobody(self):
        self.client.force_authenticate(self.viewer)
        self.assertEqual(self._mute(self.host.id).status_code, 403)
        self.client.force_authenticate(self.host)
        self.assertEqual(self._mute(self.host.id).status_code, 403)

    def test_a_cohost_mutes_viewers_but_not_another_cohost(self):
        co, co2 = make('co'), make('co2')
        CoHostRequest.objects.create(broadcast=self.b, user=co, status='approved')
        CoHostRequest.objects.create(broadcast=self.b, user=co2, status='approved')
        self.client.force_authenticate(co)
        with mock.patch('songs.views.live.lk.set_permissions'):
            self.assertEqual(self._mute(self.viewer.id).status_code, 200)
            self.assertEqual(self._mute(co2.id).status_code, 403)

    def test_a_muted_cohost_stays_on_stage(self):
        co = make('co')
        CoHostRequest.objects.create(broadcast=self.b, user=co, status='approved')
        self.client.force_authenticate(self.host)
        with mock.patch('songs.views.live.lk.set_permissions') as perm:
            self._mute(co.id)
        perm.assert_called_once_with('bc_9', f'u{co.id}', can_publish=True, can_publish_data=False)

    def test_a_pinned_comment_takes_the_name_from_the_database(self):
        self.client.force_authenticate(self.host)
        r = self.client.post(f'/api/live/broadcasts/{self.b.id}/pin/',
                             {'user_id': self.viewer.id, 'text': 'Amen!\nPraise', 'name': 'pastor'}, format='json')
        self.assertEqual(r.data['pinned'], {'user_id': self.viewer.id, 'name': 'viewer2',
                                            'text': 'Amen! Praise', 'by': 'host2'})
        self.client.force_authenticate(self.viewer)
        r = self.client.post(f'/api/live/broadcasts/{self.b.id}/pin/', {'clear': True}, format='json')
        self.assertEqual(r.status_code, 403)
        # Late joiners get it with the room.
        self.assertEqual(self.client.get(f'/api/live/broadcasts/{self.b.id}/').data['pinned']['text'], 'Amen! Praise')

    def test_a_muted_person_rejoining_on_an_old_token_is_muted_again(self):
        LiveBroadcast.objects.filter(pk=self.b.pk).update(muted_ids=[self.viewer.id])
        ev = SimpleNamespace(event='participant_joined', room=SimpleNamespace(name='bc_9', num_participants=2),
                             participant=SimpleNamespace(identity=f'u{self.viewer.id}'))
        with mock.patch('songs.views.live.lk.verify_webhook', return_value=ev), \
                mock.patch('songs.views.live.lk.set_permissions') as perm:
            self.client.post('/api/live/webhook/', data='{}', content_type='application/json')
        perm.assert_called_once_with('bc_9', f'u{self.viewer.id}', can_publish=False, can_publish_data=False)

    def test_approving_a_muted_viewer_keeps_them_muted_in_chat(self):
        LiveBroadcast.objects.filter(pk=self.b.pk).update(muted_ids=[self.viewer.id])
        req = CoHostRequest.objects.create(broadcast=self.b, user=self.viewer, status='pending')
        self.client.force_authenticate(self.host)
        with mock.patch('songs.views.live.lk.set_permissions') as perm, mock.patch('songs.views.live.notify_user'):
            self.client.post(f'/api/live/broadcasts/{self.b.id}/approve-cohost/', {'request_id': req.id}, format='json')
        perm.assert_called_once_with('bc_9', f'u{self.viewer.id}', can_publish=True, can_publish_data=False)


class LiveSharePageTests(APITestCase):
    def test_the_share_page_opens_the_room_and_hides_singles_rooms(self):
        b = LiveBroadcast.objects.create(host=make('h'), kind='meet', title='Choir <b>night</b>', room_name='bc_s')
        r = self.client.get(f'/live/{b.id}/')
        page = r.content.decode()
        self.assertEqual(r.status_code, 200)
        self.assertIn(f'streams://live/{b.id}', page)
        self.assertIn('is live now', page)
        self.assertNotIn('<b>night</b>', page)          # escaped
        LiveBroadcast.objects.filter(pk=b.pk).update(singles_only=True)
        self.assertEqual(self.client.get(f'/live/{b.id}/').status_code, 404)

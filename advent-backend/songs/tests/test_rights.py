"""Song rights: the upload confirmation and credits, copyright reports,
takedowns that tell the uploader, and the uploader's dispute."""
from unittest import mock

from django.core import mail
from rest_framework.test import APITestCase

from songs import rights
from songs.models import Appeal, Notification, Report, Role, Track, User

R2 = 'https://media.example.com'


def user(name, **kw):
    return User.objects.create_user(name, f'{name}@x.com', 'x', **kw)


def song(artist, title='Hymn', **kw):
    return Track.objects.create(title=title, artist=artist, audio_file=f'{R2}/a/{title}.mp3', **kw)


class Base(APITestCase):
    def setUp(self):
        from django.core.cache import cache
        cache.clear()   # throttle counters
        self.artist = user('rt_artist')
        self.fan = user('rt_fan')
        self.admin = user('rt_admin', is_staff=True, is_superuser=True)
        self.client.force_authenticate(self.artist)


class UploadTests(Base):
    def test_a_new_song_needs_the_rights_confirmation_and_records_when(self):
        base = {'title': 'New', 'audio_file': f'{R2}/n.mp3'}
        res = self.client.post('/api/tracks/', base, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('rights_confirmed', res.json())
        res = self.client.post('/api/tracks/', {**base, 'rights_confirmed': True}, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        self.assertIsNotNone(Track.objects.get(pk=res.json()['id']).rights_confirmed_at)
        self.assertNotIn('rights_confirmed', res.json())

    def test_credits_and_licence_with_a_checked_isrc(self):
        res = self.client.post('/api/tracks/', {
            'title': 'Credited', 'audio_file': f'{R2}/c.mp3', 'rights_confirmed': True,
            'license': 'public_domain', 'composer': 'Fanny Crosby', 'producer': 'Camp Choir',
            'rights_holder': 'Public domain', 'isrc': 'ke-a1b-26-00001',
        }, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        data = res.json()
        self.assertEqual((data['license'], data['composer'], data['isrc']), ('public_domain', 'Fanny Crosby', 'KEA1B2600001'))
        bad = self.client.post('/api/tracks/', {'title': 'X', 'audio_file': f'{R2}/x.mp3', 'rights_confirmed': True,
                                                'isrc': '12345'}, format='json')
        self.assertIn('isrc', bad.json())

    def test_editing_does_not_ask_again(self):
        t = song(self.artist)
        res = self.client.patch(f'/api/tracks/{t.id}/', {'composer': 'Me'}, format='json')
        self.assertEqual(res.status_code, 200, res.content)


class ReportTests(Base):
    def test_a_copyright_report_must_say_what_is_copied(self):
        t = song(self.artist)
        self.client.force_authenticate(self.fan)
        short = self.client.post('/api/reports/', {'content_type': 'track', 'object_id': t.id,
                                                   'reason': 'copyright', 'description': 'mine'}, format='json')
        self.assertEqual((short.status_code, short.json()['code']), (400, 'copyright_details'))
        ok = self.client.post('/api/reports/', {'content_type': 'track', 'object_id': t.id, 'reason': 'copyright',
                                                'description': 'This is my recording from my 2024 album Grace.'}, format='json')
        self.assertEqual(ok.status_code, 201)


class TakedownTests(Base):
    def report(self, t, reason='copyright'):
        return Report.objects.create(reporter=self.fan, content_type='track', object_id=t.id, reason=reason,
                                     description='My recording, my album, released 2024.')

    def test_removal_from_a_copyright_report_records_why_and_tells_the_uploader(self):
        t = song(self.artist, 'Grace')
        r = self.report(t)
        self.client.force_authenticate(self.admin)
        with mock.patch('songs.views.admin.notify_user') as push:
            res = self.client.post(f'/api/admin/reports/{r.id}/remove_target/', {'reason': 'Matches the claimant\'s release'}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        t.refresh_from_db()
        self.assertEqual((t.is_removed, t.removed_reason, t.removal_note), (True, 'copyright', "Matches the claimant's release"))
        note = Notification.objects.get(notification_type='takedown')
        self.assertEqual((note.recipient_id, note.track_id), (self.artist.id, t.id))
        self.assertIn('copyright', note.message)
        push.assert_called()
        self.assertEqual(len(mail.outbox), 1)

    def test_direct_and_bulk_removals_and_restores_tell_the_uploader(self):
        a, b = song(self.artist, 'A'), song(self.artist, 'B')
        self.client.force_authenticate(self.admin)
        with mock.patch('songs.views.admin.notify_user'):
            self.client.post('/api/admin/content/remove/', {'type': 'track', 'id': a.id}, format='json')
            self.client.post('/api/admin/content/bulk/', {'type': 'track', 'ids': [a.id, b.id], 'action': 'remove',
                                                          'removal_reason': 'copyright'}, format='json')
        a.refresh_from_db(); b.refresh_from_db()
        self.assertEqual((a.removed_reason, b.removed_reason), ('policy', 'copyright'))   # a was already down
        self.assertEqual(Notification.objects.filter(notification_type='takedown').count(), 2)
        with mock.patch('songs.views.admin.notify_user'):
            self.client.post('/api/admin/content/restore/', {'type': 'track', 'id': a.id}, format='json')
        a.refresh_from_db()
        self.assertEqual((a.is_removed, a.removed_reason), (False, ''))
        self.assertTrue(Notification.objects.filter(notification_type='restored', track=a).exists())


class DisputeTests(Base):
    def removed(self, title='Grace'):
        t = song(self.artist, title)
        Track.objects.filter(pk=t.pk).update(is_removed=True)
        rights.track_removed([t.id], reason='copyright', note='claim')
        return Track.objects.get(pk=t.pk)

    def dispute(self, t, **kw):
        body = {'message': 'I wrote and recorded this at our church in 2024; the claimant copied it.', 'good_faith': True, **kw}
        return self.client.post(f'/api/tracks/{t.id}/dispute/', body, format='json')

    def test_the_uploader_sees_removed_songs_and_disputes_once(self):
        t = self.removed()
        rows = self.client.get('/api/studio/removed/').json()
        self.assertEqual((rows[0]['id'], rows[0]['reason'], rows[0]['can_dispute']), (t.id, 'copyright', True))
        self.assertEqual(self.dispute(t, good_faith=False).status_code, 400)
        self.assertEqual(self.dispute(t, message='too short').status_code, 400)
        self.assertEqual(self.dispute(t).status_code, 201)
        self.assertEqual(self.dispute(t).status_code, 400)                  # already waiting
        rows = self.client.get('/api/studio/removed/').json()
        self.assertEqual((rows[0]['dispute']['status'], rows[0]['can_dispute']), ('pending', False))

    def test_only_your_own_removed_songs(self):
        t = self.removed()
        self.client.force_authenticate(self.fan)
        self.assertEqual(self.dispute(t).status_code, 404)
        self.client.force_authenticate(self.artist)
        live = song(self.artist, 'Live')
        self.assertEqual(self.dispute(live).status_code, 400)

    def test_upheld_dispute_brings_the_song_back_rejected_is_final(self):
        t = self.removed()
        appeal_id = self.dispute(t).json()['id']
        self.client.force_authenticate(self.admin)
        rows = self.client.get('/api/admin/appeals/?kind=copyright').json()['results']
        self.assertEqual((rows[0]['kind'], rows[0]['track']['title']), ('copyright', 'Grace'))
        with mock.patch('songs.views.admin.notify_user'):
            self.client.post(f'/api/admin/appeals/{appeal_id}/approve/', {}, format='json')
        t.refresh_from_db()
        self.assertEqual((t.is_removed, t.removed_reason), (False, ''))
        self.assertTrue(Notification.objects.filter(notification_type='restored', track=t).exists())

        other = self.removed('Other')
        self.client.force_authenticate(self.artist)
        aid = self.dispute(other).json()['id']
        self.client.force_authenticate(self.admin)
        with mock.patch('songs.views.admin.notify_user'):
            self.client.post(f'/api/admin/appeals/{aid}/reject/', {'notes': 'Claim verified'}, format='json')
        other.refresh_from_db()
        self.assertTrue(other.is_removed)
        self.client.force_authenticate(self.artist)
        self.assertEqual(self.dispute(other).status_code, 400)             # reviewed: final

    def test_a_song_removed_again_can_be_disputed_again(self):
        t = self.removed()
        aid = self.dispute(t).json()['id']
        Appeal.objects.filter(pk=aid).update(status='approved')
        Track.objects.filter(pk=t.pk).update(is_removed=False)
        rights.track_restored([t.id], notify=False)
        Track.objects.filter(pk=t.pk).update(is_removed=True)
        rights.track_removed([t.id], reason='copyright')
        self.assertEqual(self.dispute(Track.objects.get(pk=t.pk)).status_code, 201)

    def test_song_disputes_stay_out_of_the_suspension_appeal(self):
        t = self.removed()
        self.dispute(t)
        self.assertIsNone(self.client.get('/api/appeals/mine/').data)   # no suspension appeal

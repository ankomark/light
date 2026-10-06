"""Single & Searching deep scan (2026-10-06): the fixes it led to.

    python manage.py test songs.tests.test_singles_scan --settings=music.settings_test
"""
from datetime import timedelta
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from songs.models import (
    Report, SinglesGathering, SinglesMatch, SinglesProfile, SinglesReply, SinglesStory, SinglesTopic, User,
)
from songs.tests.test_singles_matching import Base, single
from songs.tests.test_singles_phase1 import jpeg_bytes

UPLOAD = 'songs.r2.upload_file'
TELL = 'songs.push.notify_user'


class SecurityTests(Base):
    def test_an_unapproved_profile_cannot_open_anyone(self):
        ann = single('ann')
        for state in ('draft', 'pending', 'rejected'):
            lurker = single(f'lurk{state}', 'man', status=state)
            self.client.force_authenticate(lurker.user)
            self.assertEqual(self.client.get(f'/api/singles/profiles/{ann.id}/').status_code, 404, state)
        # Approved: yes (and paused still may, to answer who liked them).
        self.client.force_authenticate(self.mark.user)
        self.assertEqual(self.client.get(f'/api/singles/profiles/{ann.id}/').status_code, 200)
        SinglesProfile.objects.filter(pk=self.mark.pk).update(is_paused=True)
        self.assertEqual(self.client.get(f'/api/singles/profiles/{ann.id}/').status_code, 200)

    def test_a_match_stays_open_whatever_my_review_state(self):
        ann = single('ann')
        SinglesMatch.objects.create(profile_a=self.mark, profile_b=ann)
        SinglesProfile.objects.filter(pk=self.mark.pk).update(status='pending')
        self.assertEqual(self.client.get(f'/api/singles/profiles/{ann.id}/').status_code, 200)

    @mock.patch(UPLOAD, return_value='https://pub-test.r2.dev/singles/x.jpg')
    def test_only_real_pictures_are_uploaded(self, up):
        svg = SimpleUploadedFile('x.jpg', b'<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>',
                                 content_type='image/svg+xml')
        self.assertEqual(self.client.post('/api/singles/me/photos/', {'image': svg}, format='multipart').status_code, 400)
        fake = SimpleUploadedFile('x.jpg', b'not a picture', content_type='image/jpeg')
        self.assertEqual(self.client.post('/api/singles/me/photos/', {'image': fake}, format='multipart').status_code, 400)
        up.assert_not_called()
        real = SimpleUploadedFile('x.png', jpeg_bytes(), content_type='image/png')   # claims png, is jpeg
        self.assertEqual(self.client.post('/api/singles/me/photos/', {'image': real}, format='multipart').status_code, 201)
        self.assertEqual(up.call_args.kwargs['content_type'], 'image/jpeg')    # stored as what it is

    @mock.patch(TELL)
    @mock.patch(UPLOAD, return_value='https://pub-test.r2.dev/singles_verify/s.jpg')
    def test_the_selfie_shows_the_gesture_we_asked_for(self, up, _tell):
        asked = self.client.get('/api/singles/me/verify/').data['gesture']
        # Coming back keeps the same one.
        self.assertEqual(self.client.get('/api/singles/me/verify/').data['gesture'], asked)
        other = next(g for g in ('thumbs_up', 'peace', 'wave', 'hand_on_chin') if g != asked)

        def send(gesture, body=None):
            img = SimpleUploadedFile('s.jpg', body or jpeg_bytes(), content_type='image/jpeg')
            return self.client.post('/api/singles/me/verify/', {'image': img, 'gesture': gesture}, format='multipart')
        r = send(other)
        self.assertEqual((r.status_code, r.data.get('code')), (400, 'gesture_expired'))
        self.assertEqual(send(asked, b'nope').status_code, 400)
        self.assertEqual(send(asked).status_code, 201)
        # Used up: the next selfie needs a fresh ask.
        from songs.models import SinglesVerification
        SinglesVerification.objects.update(status='rejected')
        self.assertEqual(send(asked).data.get('code'), 'gesture_expired')


class BugTests(Base):
    def test_photo_order_with_bad_ids_is_a_400(self):
        for ids in (['a', 1], 'x', [None]):
            r = self.client.post('/api/singles/me/photos/order/', {'ids': ids}, format='json')
            self.assertEqual(r.status_code, 400, ids)

    def test_an_event_in_the_past_is_refused_with_or_without_a_zone(self):
        for when in ('2020-01-01T10:00:00', '2020-01-01T10:00:00+03:00'):
            r = self.client.post('/api/singles/gatherings/', {'kind': 'online', 'title': 'Old', 'starts_at': when},
                                 format='json')
            self.assertEqual(r.status_code, 400, when)

    @mock.patch('songs.singles.notify_reviewers')
    def test_at_most_three_events_wait_for_review(self, _n):
        soon = (timezone.now() + timedelta(days=3)).isoformat()
        codes = [self.client.post('/api/singles/gatherings/', {'kind': 'online', 'title': f'E{i}', 'starts_at': soon},
                                  format='json').status_code for i in range(4)]
        self.assertEqual(codes, [201, 201, 201, 429])

    def test_replies_are_limited(self):
        topic = SinglesTopic.objects.create(author=self.mark, body='What helps you keep the Sabbath?')
        with mock.patch('songs.views.singles_hub.REPLIES_PER_HOUR', 2):
            codes = [self.client.post(f'/api/singles/topics/{topic.id}/replies/', {'body': f'r{i}'},
                                      format='json').status_code for i in range(3)]
        self.assertEqual(codes, [201, 201, 429])

    def test_a_banned_authors_words_are_gone(self):
        ann = single('ann')
        topic = SinglesTopic.objects.create(author=ann, body='A question from Ann here')
        SinglesReply.objects.create(topic=SinglesTopic.objects.create(author=self.mark, body='Mark asks this one'),
                                    author=ann, body='a reply from Ann')
        SinglesProfile.objects.filter(pk=ann.pk).update(status='banned')
        self.assertEqual(self.client.get(f'/api/singles/topics/{topic.id}/').status_code, 404)
        mine = SinglesTopic.objects.get(author=self.mark)
        self.assertEqual(self.client.get(f'/api/singles/topics/{mine.id}/').data['replies'], [])

    def test_show_flags_read_false_as_false(self):
        self.client.patch('/api/singles/me/', {'show_age': 'false', 'show_town': 'true'}, format='json')
        self.mark.refresh_from_db()
        self.assertEqual((self.mark.show_age, self.mark.show_town), (False, True))

    @mock.patch(TELL)
    def test_leaving_takes_down_our_story(self, _tell):
        ann = single('ann')
        match = SinglesMatch.objects.create(profile_a=self.mark, profile_b=ann)
        SinglesStory.objects.create(match=match, title='How we met', body='x' * 50, status='published',
                                    consents=[self.mark.user_id, ann.user_id])
        with mock.patch('songs.r2.delete'):
            self.client.delete('/api/singles/me/')
        self.assertFalse(SinglesStory.objects.exists())

    @mock.patch(TELL)
    def test_unban_unpauses_and_tells_them(self, tell):
        from songs.tests.test_singles_hub import reviewer
        SinglesProfile.objects.filter(pk=self.mark.pk).update(status='banned', is_paused=True)
        self.client.force_authenticate(reviewer())
        self.client.post(f'/api/admin/singles/{self.mark.id}/unban/', {'reason': 'appeal accepted'}, format='json')
        self.mark.refresh_from_db()
        self.assertEqual((self.mark.status, self.mark.is_paused), ('draft', False))
        self.assertTrue(tell.called)


class AdminReportTests(Base):
    def setUp(self):
        super().setUp()
        self.ann = single('ann')
        self.report = Report.objects.create(reporter=self.mark.user, content_type='singlesprofile',
                                            object_id=self.ann.id, reason='other', description='[scam] money')
        self.boss = User.objects.create_user('boss', 'b@x.com', 'pw', is_superuser=True)
        self.client.force_authenticate(self.boss)

    def test_the_queue_shows_who_was_reported(self):
        rows = self.client.get('/api/admin/reports/').data
        rows = rows['results'] if isinstance(rows, dict) else rows
        row = next(r for r in rows if r['id'] == self.report.id)
        self.assertEqual(row['target']['name'], 'Ann')

    @mock.patch('songs.views.admin.notify_moderation')
    def test_remove_sends_the_profile_back_for_review(self, told):
        r = self.client.post(f'/api/admin/reports/{self.report.id}/remove_target/', {'reason': 'asked for money'},
                             format='json')
        self.assertEqual(r.status_code, 200)
        self.ann.refresh_from_db()
        self.report.refresh_from_db()
        self.assertEqual((self.ann.status, self.report.status), ('pending', 'resolved'))
        told.assert_called_once()


class SpeedTests(Base):
    def test_matches_list_does_not_grow_with_matches(self):
        def count():
            with CaptureQueriesContext(connection) as q:
                self.assertEqual(self.client.get('/api/singles/matches/').status_code, 200)
            return len(q)
        SinglesMatch.objects.create(profile_a=self.mark, profile_b=single('w0'))
        one = count()
        for i in range(1, 6):
            SinglesMatch.objects.create(profile_a=self.mark, profile_b=single(f'w{i}'))
        self.assertLessEqual(count(), one + 1)


class ClosedChatTests(Base):
    """An ended match's chat (or one between people who blocked each other):
    nothing more is said in it - not by sending, editing or reacting."""

    def setUp(self):
        super().setUp()
        from songs.models import Conversation, Message
        self.ann = single('ann')
        self.conv = Conversation.objects.create()
        self.conv.participants.add(self.mark.user, self.ann.user)
        self.match = SinglesMatch.objects.create(profile_a=self.mark, profile_b=self.ann, conversation=self.conv)
        self.msg = Message.objects.create(conversation=self.conv, sender=self.mark.user, content='Hello Ann')
        self.theirs = Message.objects.create(conversation=self.conv, sender=self.ann.user, content='Hi Mark')

    def edit(self):
        return self.client.patch(f'/api/conversations/{self.conv.id}/messages/{self.msg.id}/',
                                 {'content': 'something else'}, format='json')

    def react(self):
        return self.client.post(f'/api/conversations/{self.conv.id}/messages/{self.theirs.id}/react/',
                                {'emoji': '❤️'}, format='json')

    def test_open_match_edits_and_reacts(self):
        self.assertEqual(self.edit().status_code, 200)
        self.assertEqual(self.react().status_code, 200)

    def test_ended_match_refuses_both(self):
        SinglesMatch.objects.filter(pk=self.match.pk).update(ended_at=timezone.now())
        for r in (self.edit(), self.react()):
            self.assertEqual((r.status_code, r.data.get('code')), (403, 'unmatched'))
        self.msg.refresh_from_db()
        self.assertEqual(self.msg.content, 'Hello Ann')

    def test_blocked_refuses_both(self):
        from songs.models import Block
        Block.objects.create(blocker=self.ann.user, blocked=self.mark.user)
        self.assertEqual(self.edit().status_code, 403)
        self.assertEqual(self.react().status_code, 403)

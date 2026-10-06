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


class AlgorithmTests(Base):
    """Mark (a 29-year-old man in Kenya looking for marriage) and who he sees."""

    def foryou(self):
        return [c['id'] for c in self.client.get('/api/singles/browse/', {'mode': 'foryou'}).data['results']]

    def test_preferences_work_both_ways(self):
        open_ = single('open')                                            # no preferences: sees anyone
        young = single('young', pref_max_age=25)                          # Mark is too old for her
        older = single('older', pref_min_age=26, pref_max_age=40)         # Mark fits
        away = single('away', pref_countries=['Uganda'])                  # not Kenya
        kenya = single('kenya', pref_countries=['uganda', 'KENYA'])       # Kenya, any case
        friends = single('friends', pref_intents=['friendship'])          # not what Mark wants
        both = single('both', pref_intents=['serious', 'marriage'])
        seen = set(self.foryou())
        self.assertEqual(seen & {open_.id, older.id, kenya.id, both.id}, {open_.id, older.id, kenya.id, both.id})
        self.assertEqual(seen & {young.id, away.id, friends.id}, set())
        self.assertNotIn(young.id, set(self.ids()))                       # Discover too

    def test_a_not_now_fades_after_ninety_days_both_ways(self):
        from songs.models import SinglesInterest
        mine = single('mine')                                             # Mark passed her
        theirs = single('theirs')                                         # she passed Mark
        SinglesInterest.objects.create(from_profile=self.mark, to_profile=mine, kind='pass')
        SinglesInterest.objects.create(from_profile=theirs, to_profile=self.mark, kind='pass')
        self.assertEqual(set(self.foryou()) & {mine.id, theirs.id}, set())
        SinglesInterest.objects.update(created_at=timezone.now() - timedelta(days=91))
        self.assertEqual(set(self.foryou()) & {mine.id, theirs.id}, {mine.id, theirs.id})
        # Answered again: a new answer (today's count, a fresh 90 days).
        r = self.client.post(f'/api/singles/profiles/{mine.id}/interest/', {'kind': 'pass'}, format='json')
        self.assertEqual(r.data['left_today'], 19)
        self.assertNotIn(mine.id, self.foryou())

    def test_an_interested_answer_never_fades(self):
        from songs.models import SinglesInterest
        her = single('her')
        SinglesInterest.objects.create(from_profile=self.mark, to_profile=her, kind='interested')
        SinglesInterest.objects.update(created_at=timezone.now() - timedelta(days=400))
        self.assertNotIn(her.id, self.foryou())

    def test_someone_who_liked_me_comes_first_among_equals(self):
        from songs.models import SinglesInterest
        a, b, c = single('a'), single('b'), single('c')
        SinglesInterest.objects.create(from_profile=b, to_profile=self.mark, kind='interested')
        self.assertEqual(self.foryou()[0], b.id)

    def test_a_much_liked_profile_is_lowered_a_little(self):
        from songs.models import SinglesInterest
        quiet, busy = single('quiet'), single('busy')
        SinglesProfile.objects.filter(pk=busy.pk).update(last_active_at=timezone.now())
        SinglesProfile.objects.filter(pk=quiet.pk).update(last_active_at=timezone.now() - timedelta(minutes=5))
        self.assertEqual(self.foryou()[:2], [busy.id, quiet.id])         # equal: the more recent first
        for i in range(10):                                               # ten suitors this fortnight
            SinglesInterest.objects.create(from_profile=single(f'm{i}', 'man'), to_profile=busy, kind='interested')
        self.assertEqual(self.foryou()[:2], [quiet.id, busy.id])


class FinalScanTests(Base):
    def _match_with_chat(self, other):
        from songs.models import Conversation
        conv = Conversation.objects.create()
        conv.participants.add(self.mark.user, other.user)
        return SinglesMatch.objects.create(profile_a=self.mark, profile_b=other, conversation=conv)

    def test_unmatching_closes_the_open_chat_on_both_phones(self):
        ann = single('ann')
        match = self._match_with_chat(ann)
        with mock.patch('songs.messaging.tell') as tell:
            self.client.post(f'/api/singles/matches/{match.id}/unmatch/')
        users, payload = tell.call_args.args
        self.assertEqual(set(users), {self.mark.user_id, ann.user_id})
        self.assertEqual((payload['type'], payload['conversation_id']), ('singles_unmatched', match.conversation_id))

    def test_parting_takes_down_their_story(self):
        ann = single('ann')
        match = self._match_with_chat(ann)
        SinglesStory.objects.create(match=match, title='How we met', body='x' * 50, status='published',
                                    consents=[self.mark.user_id, ann.user_id])
        self.client.post(f'/api/singles/matches/{match.id}/unmatch/')
        self.assertFalse(SinglesStory.objects.exists())

    def test_no_story_on_an_ended_match(self):
        match = self._match_with_chat(single('ann'))
        SinglesMatch.objects.filter(pk=match.pk).update(ended_at=timezone.now())
        r = self.client.post(f'/api/singles/matches/{match.id}/story/', {'title': 'Us', 'body': 'y' * 60}, format='json')
        self.assertEqual(r.status_code, 404)

    def test_stories_leave_out_blocked_and_banned_couples(self):
        from songs.models import Block
        def story(a, b, title):
            m = SinglesMatch.objects.create(profile_a=a, profile_b=b)
            SinglesStory.objects.create(match=m, title=title, body='z' * 50, status='published',
                                        consents=[a.user_id, b.user_id])
        story(single('h1', 'man'), single('w1'), 'Fine')
        blocked_man = single('h2', 'man')
        story(blocked_man, single('w2'), 'Blocked')
        banned = single('w3')
        story(single('h3', 'man'), banned, 'Banned')
        Block.objects.create(blocker=self.mark.user, blocked=blocked_man.user)
        SinglesProfile.objects.filter(pk=banned.pk).update(status='banned')
        titles = [s['title'] for s in self.client.get('/api/singles/stories/').data['results']]
        self.assertEqual(titles, ['Fine'])

    def test_two_quick_creates_are_one_profile_not_a_500(self):
        from django.db import IntegrityError
        fresh = User.objects.create_user('newbie', 'n@x.com', 'pw', is_email_verified=True)
        User.objects.filter(pk=fresh.pk).update(date_joined=timezone.now() - timedelta(days=30))
        self.client.force_authenticate(User.objects.get(pk=fresh.pk))
        body = {'agree_rules': True, 'birth_date': '1995-05-05', 'gender': 'man', 'first_name': 'Newbie',
                'country': 'Kenya', 'baptised': 'yes'}
        with mock.patch('songs.models.SinglesProfile.save', side_effect=IntegrityError('duplicate')):
            r = self.client.post('/api/singles/me/', body, format='json')
        self.assertEqual(r.status_code, 400)

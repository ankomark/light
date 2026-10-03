"""Single & Searching, phases 6-11: the hub; browsing For You / New /
Nearby / Online with honest reasons; incognito; who is interested in you;
values answers and what a profile shows; saved preferences; icebreakers both
answer before either sees; the singles community (questions, replies,
hearts, moderation); gatherings an admin lists; singles-only live rooms;
stories both must agree to; photo verification; Scripture cards; signals,
risk and totals for the admins.

    python manage.py test songs.tests.test_singles_hub --settings=music.settings_test
"""
from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from songs import singles
from songs.models import (
    BibleVerse, Block, LiveBroadcast, Report, Role, SinglesAnswer, SinglesGathering, SinglesInterest, SinglesMatch,
    SinglesPhoto, SinglesProfile, SinglesSignal, SinglesStory, SinglesTopic, SinglesVerification, User,
)

TELL = 'songs.push.notify_user'


def years_ago(n):
    today = timezone.localdate()
    return today.replace(year=today.year - n) if not (today.month == 2 and today.day == 29) \
        else today.replace(year=today.year - n, day=28)


def single(name, gender='woman', age=27, **extra):
    u = User.objects.create_user(name, f'{name}@x.com', 'pw', is_email_verified=True)
    User.objects.filter(pk=u.pk).update(date_joined=timezone.now() - timedelta(days=60))
    u.refresh_from_db()
    defaults = dict(first_name=name.title(), birth_date=years_ago(age), gender=gender, country='Kenya',
                    baptised='yes', status='approved', agreed_rules_at=timezone.now(),
                    last_active_at=timezone.now() - timedelta(hours=3), approved_at=timezone.now() - timedelta(days=60))
    defaults.update(extra)
    p = SinglesProfile.objects.create(user=u, **defaults)
    SinglesPhoto.objects.create(profile=p, url=f'https://pub-test.r2.dev/singles/{name}.jpg', status='approved')
    return p


def reviewer():
    return User.objects.create_user('rev', 'rev@x.com', 'pw',
                                    role=Role.objects.create(name='S', capabilities=['review_singles']))


class Base(APITestCase):
    def setUp(self):
        cache.clear()
        self.mark = single('mark', 'man', 29, town='Nairobi', church='Central', interests=['Music', 'Hiking'],
                           ministries=['youth', 'music'], languages=['English'])
        self.client.force_authenticate(self.mark.user)

    def as_(self, profile):
        self.client.force_authenticate(profile.user if hasattr(profile, 'user') else profile)

    def match(self, other):
        with mock.patch(TELL):
            self.as_(self.mark)
            self.client.post(f'/api/singles/profiles/{other.id}/interest/', {'kind': 'interested'}, format='json')
            self.as_(other)
            self.client.post(f'/api/singles/profiles/{self.mark.id}/interest/', {'kind': 'interested'}, format='json')
            self.as_(self.mark)
        return SinglesMatch.objects.get()


class HubAndBrowseTests(Base):
    def test_for_you_ranks_by_shared_things_and_says_why(self):
        alike = single('alike', interests=['music'], ministries=['youth'], church='Central', languages=['English'])
        other = single('other')
        r = self.client.get('/api/singles/browse/', {'mode': 'foryou'})
        self.assertEqual([p['id'] for p in r.data['results']], [alike.id, other.id])
        kinds = [x['kind'] for x in r.data['results'][0]['reasons']]
        self.assertEqual(kinds[:3], ['ministries', 'interests', 'intent'])
        self.assertIn('church', kinds)
        self.assertNotIn('score', r.data['results'][0])                  # no "97% soulmate"

    def test_new_nearby_online(self):
        new = single('new', approved_at=timezone.now())
        old = single('old')
        near = single('near', town='nairobi', approved_at=timezone.now() - timedelta(days=90))
        online = single('online', last_active_at=timezone.now())
        hidden_online = single('hidden', last_active_at=timezone.now(), show_online=False)
        ids = lambda mode: [p['id'] for p in self.client.get('/api/singles/browse/', {'mode': mode}).data['results']]
        self.assertIn(new.id, ids('new'))
        self.assertNotIn(old.id, ids('new'))
        self.assertEqual(ids('nearby'), [near.id])
        self.assertEqual(ids('online'), [online.id])
        self.assertNotIn(hidden_online.id, ids('online'))

    def test_the_hub(self):
        single('grace')
        r = self.client.get('/api/singles/hub/')
        self.assertEqual((r.data['first_name'], r.data['today'], r.data['likes'], r.data['matches']), ('Mark', 1, 0, 0))
        self.assertEqual(len(r.data['preview']), 1)

    def test_saved_preferences_shape_discover(self):
        young = single('young', age=22)
        older = single('older', age=33)
        self.client.patch('/api/singles/me/', {'preferences': {'min_age': 30, 'max_age': 40}}, format='json')
        self.assertEqual([p['id'] for p in self.client.get('/api/singles/discover/').data['results']], [older.id])
        r = self.client.patch('/api/singles/me/', {'preferences': {'min_age': 40, 'max_age': 30}}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertNotIn(young.id, [p['id'] for p in self.client.get('/api/singles/browse/').data['results']])


class PrivacyTests(Base):
    def test_incognito_only_seen_by_those_they_like(self):
        quiet = single('quiet', discoverable='liked')
        self.assertEqual(self.client.get('/api/singles/discover/').data['results'], [])
        self.assertEqual(self.client.get(f'/api/singles/profiles/{quiet.id}/').status_code, 404)
        SinglesInterest.objects.create(from_profile=quiet, to_profile=self.mark, kind='interested')
        self.assertEqual([p['id'] for p in self.client.get('/api/singles/discover/').data['results']], [quiet.id])

    def test_what_a_profile_shows_is_its_owners_choice(self):
        grace = single('grace', town='Kisumu', show_age=False, show_town=False)
        SinglesAnswer.objects.create(profile=grace, key='relocate', answer='yes', visible=True)
        SinglesAnswer.objects.create(profile=grace, key='children', answer='want', visible=False)
        r = self.client.get(f'/api/singles/profiles/{grace.id}/')
        self.assertEqual((r.data['age'], r.data['town']), (None, ''))
        self.assertEqual(r.data['answers'], [{'key': 'relocate', 'answer': 'yes'}])
        self.assertEqual(r.data['badges'], {'email': True, 'photo': False})

    def test_values_answers(self):
        r = self.client.put('/api/singles/me/answers/', {'answers': [
            {'key': 'family_worship', 'answer': 'very'}, {'key': 'relocate', 'answer': 'maybe', 'visible': False}]},
            format='json')
        self.assertEqual(len(r.data['answers']), 2)
        bad = self.client.put('/api/singles/me/answers/', {'answers': [{'key': 'relocate', 'answer': 'never'}]},
                              format='json')
        self.assertEqual(bad.status_code, 400)
        self.client.put('/api/singles/me/answers/', {'answers': [{'key': 'relocate', 'answer': ''}]}, format='json')
        self.assertEqual(SinglesAnswer.objects.filter(profile=self.mark).count(), 1)

    def test_who_is_interested_in_you(self):
        grace, ann = single('grace'), single('ann')
        SinglesInterest.objects.create(from_profile=grace, to_profile=self.mark, kind='interested')
        SinglesInterest.objects.create(from_profile=ann, to_profile=self.mark, kind='interested')
        Block.objects.create(blocker=self.mark.user, blocked=ann.user)
        self.assertEqual([p['id'] for p in self.client.get('/api/singles/likes/').data['results']], [grace.id])
        self.client.post(f'/api/singles/profiles/{grace.id}/interest/', {'kind': 'pass'}, format='json')
        self.assertEqual(self.client.get('/api/singles/likes/').data['results'], [])

    def test_ministries_and_intent_are_from_the_lists(self):
        self.assertEqual(self.client.patch('/api/singles/me/', {'ministries': ['dancing']}, format='json').status_code, 400)
        r = self.client.patch('/api/singles/me/', {'ministries': ['music', 'prayer'], 'looking_for': 'serious'},
                              format='json')
        self.assertEqual((r.data['ministries'], r.data['looking_for']), (['music', 'prayer'], 'serious'))


class ConversationTests(Base):
    def setUp(self):
        super().setUp()
        self.grace = single('grace', prompts=[{'key': 'verse', 'answer': 'Romans 8:28'}], ministries=['music'])
        self.m = self.match(self.grace)

    def test_starters_from_what_they_wrote(self):
        rows = self.client.get('/api/singles/matches/').data['results']
        kinds = [s['kind'] for s in rows[0]['starters']]
        self.assertEqual(kinds, ['prompt', 'ministry', 'meaningful'])

    def test_icebreaker_both_answer_before_either_sees(self):
        url = f'/api/singles/matches/{self.m.id}/icebreakers/'
        ice = self.client.post(url, {'key': 'gospel_song'}, format='json').data
        self.assertEqual(self.client.post(url, {'key': 'gospel_song'}, format='json').status_code, 400)
        r = self.client.post(f'/api/singles/icebreakers/{ice["id"]}/answer/', {'answer': 'Amazing Grace'}, format='json')
        self.assertEqual((r.data['mine'], r.data['theirs'], r.data['waiting_for']), ('Amazing Grace', None, 'them'))
        self.as_(self.grace)
        before = self.client.get(url).data['results'][0]
        self.assertEqual((before['theirs'], before['waiting_for']), (None, 'you'))
        r = self.client.post(f'/api/singles/icebreakers/{ice["id"]}/answer/', {'answer': 'It Is Well'}, format='json')
        self.assertEqual((r.data['theirs'], r.data['waiting_for']), ('Amazing Grace', None))
        outsider = single('outsider', 'man')
        self.as_(outsider)
        self.assertEqual(self.client.get(url).status_code, 404)

    def test_scripture_cards_carry_the_bibles_words(self):
        BibleVerse.objects.create(book='Philippians', book_number=50, chapter=4, verse=13,
                                  text='I can do all things through Christ which strengtheneth me.')
        self.assertEqual(self.client.get('/api/bible/lookup/', {'ref': 'phil 4:13'}).data['ref'], 'Philippians 4:13')
        self.assertEqual(self.client.get('/api/bible/lookup/', {'ref': 'Hezekiah 1:1'}).status_code, 404)
        r = self.client.post(f'/api/conversations/{self.m.conversation_id}/send_message/',
                             {'message_type': 'verse', 'content': 'Philippians 4:13|I can do anything I like'},
                             format='json')
        self.assertEqual(r.data['content'], 'Philippians 4:13|I can do all things through Christ which strengtheneth me.')
        bad = self.client.post(f'/api/conversations/{self.m.conversation_id}/send_message/',
                               {'message_type': 'verse', 'content': 'Nowhere 9:9'}, format='json')
        self.assertEqual(bad.data['code'], 'verse_not_found')

    def test_a_conversation_started_and_contact_details_are_signals(self):
        url = f'/api/conversations/{self.m.conversation_id}/send_message/'
        self.client.post(url, {'content': 'Hello Grace'}, format='json')
        self.client.post(url, {'content': 'Call me on 0712 345 678'}, format='json')
        kinds = list(SinglesSignal.objects.filter(profile=self.mark).values_list('kind', flat=True))
        self.assertEqual(kinds.count('chat_started'), 1)
        self.assertEqual(kinds.count('link_shared'), 1)
        self.assertEqual(SinglesSignal.objects.filter(kind='match').count(), 1)   # recorded once, by who completed it


class CommunityTests(Base):
    def test_questions_replies_and_hearts(self):
        r = self.client.post('/api/singles/topics/', {'body': 'What matters most in marriage? www.spam.com'}, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertNotIn('spam', r.data['body'])
        tid = r.data['id']
        grace = single('grace')
        self.as_(grace)
        self.client.post(f'/api/singles/topics/{tid}/replies/', {'body': 'Shared faith'}, format='json')
        self.assertTrue(self.client.post(f'/api/singles/topics/{tid}/heart/').data['hearted'])
        self.assertFalse(self.client.post(f'/api/singles/topics/{tid}/heart/').data['hearted'])
        topic = self.client.get(f'/api/singles/topics/{tid}/').data
        self.assertEqual((topic['reply_count'], topic['heart_count'], len(topic['replies'])), (1, 0, 1))
        Block.objects.create(blocker=grace.user, blocked=self.mark.user)
        self.assertEqual(self.client.get('/api/singles/topics/').data['results'], [])

    def test_unapproved_cannot_post_and_reports_reach_moderators(self):
        tid = self.client.post('/api/singles/topics/', {'body': 'A question about Sabbath plans'}, format='json').data['id']
        r = self.client.post('/api/reports/', {'content_type': 'singlestopic', 'object_id': tid, 'reason': 'spam'},
                             format='json')
        self.assertEqual(r.status_code, 201)
        waiting = single('waiting', status='pending')
        self.as_(waiting)
        self.assertEqual(self.client.post('/api/singles/topics/', {'body': 'Hello everyone here'}, format='json').status_code, 403)

    @mock.patch(TELL)
    def test_gatherings_listed_by_an_admin(self, _tell):
        when = (timezone.now() + timedelta(days=5)).isoformat()
        gid = self.client.post('/api/singles/gatherings/', {'kind': 'coffee', 'title': 'Young Adults Connect',
                                                            'starts_at': when, 'place': 'Nairobi'}, format='json').data['id']
        grace = single('grace')
        self.as_(grace)
        self.assertEqual(self.client.get('/api/singles/gatherings/').data['results'], [])   # not listed yet
        self.as_(reviewer())
        self.assertEqual(self.client.post(f'/api/admin/singles-gatherings/{gid}/decide/', {'decision': 'approve'},
                                          format='json').data['status'], 'approved')
        self.match(grace)
        self.as_(grace)
        self.assertEqual(self.client.post(f'/api/singles/gatherings/{gid}/rsvp/').data['going'], 1)
        self.as_(self.mark)
        row = self.client.get('/api/singles/gatherings/').data['results'][0]
        self.assertEqual(row['friends_going'], ['Grace'])
        past = self.client.post('/api/singles/gatherings/', {'kind': 'coffee', 'title': 'Then',
                                                             'starts_at': '2020-01-01T10:00:00Z'}, format='json')
        self.assertEqual(past.status_code, 400)


@override_settings(LIVEKIT_API_KEY='devkey', LIVEKIT_API_SECRET='devsecret_devsecret_devsecret_0123', LIVEKIT_URL='')
class RoomTests(Base):
    def test_singles_rooms_are_for_verified_hosts_and_members_only(self):
        r = self.client.post('/api/live/broadcasts/', {'kind': 'meet', 'title': 'Faith & Career', 'singles_only': True},
                             format='json')
        self.assertEqual(r.data['code'], 'singles_host')
        SinglesProfile.objects.filter(pk=self.mark.pk).update(photo_verified_at=timezone.now())
        r = self.client.post('/api/live/broadcasts/', {'kind': 'meet', 'title': 'Faith & Career', 'singles_only': True},
                             format='json')
        self.assertEqual(r.status_code, 201, r.data)
        bid = r.data['broadcast']['id']
        public = self.client.get('/api/live/broadcasts/').data
        self.assertEqual(public['results'] if isinstance(public, dict) else public, [])   # not on the public list
        self.assertEqual(len(self.client.get('/api/singles/rooms/').data['results']), 1)
        outsider = User.objects.create_user('out', 'out@x.com', 'pw')
        self.as_(outsider)
        self.assertEqual(self.client.get(f'/api/live/broadcasts/{bid}/token/').data['code'], 'singles_only')
        self.assertEqual(self.client.get(f'/api/live/broadcasts/{bid}/').status_code, 404)   # not even its title
        self.as_(single('grace'))
        self.assertEqual(self.client.get(f'/api/live/broadcasts/{bid}/token/').status_code, 200)


class StoryAndVerifyTests(Base):
    @mock.patch(TELL)
    def test_a_story_needs_both_before_it_is_published(self, _tell):
        grace = single('grace')
        m = self.match(grace)
        sid = self.client.post(f'/api/singles/matches/{m.id}/story/', {
            'title': 'We met here', 'body': 'We matched over a shared love of choir music and Sabbath hikes.'},
            format='json').data['id']
        self.as_(reviewer())
        r = self.client.post(f'/api/admin/singles-stories/{sid}/decide/', {'decision': 'approve'}, format='json')
        self.assertEqual(r.status_code, 400)                                  # Grace hasn't agreed
        self.as_(grace)
        self.assertTrue(self.client.post(f'/api/singles/stories/{sid}/consent/').data['both_agreed'])
        self.as_(reviewer() if not User.objects.filter(username='rev').exists() else User.objects.get(username='rev'))
        self.client.post(f'/api/admin/singles-stories/{sid}/decide/', {'decision': 'approve'}, format='json')
        self.as_(self.mark)
        self.assertEqual(self.client.get('/api/singles/stories/').data['results'][0]['names'], ['Mark', 'Grace'])
        self.client.delete(f'/api/singles/stories/{sid}/consent/')            # either takes it down
        self.assertFalse(SinglesStory.objects.exists())

    @mock.patch(TELL)
    @mock.patch('songs.views.singles_hub.r2.upload_file', return_value='https://pub-test.r2.dev/singles_verify/s.jpg')
    def test_photo_verification(self, _up, _tell):
        gesture = self.client.get('/api/singles/me/verify/').data['gesture']
        self.assertIn(gesture, singles.GESTURES)
        img = SimpleUploadedFile('s.jpg', b'x' * 10, content_type='image/jpeg')
        self.assertEqual(self.client.post('/api/singles/me/verify/', {'image': img, 'gesture': gesture},
                                          format='multipart').status_code, 201)
        v = SinglesVerification.objects.get()
        self.as_(reviewer())
        self.assertEqual(len(self.client.get('/api/admin/singles-verifications/').data['results']), 1)
        self.client.post(f'/api/admin/singles-verifications/{v.id}/decide/', {'decision': 'approve'}, format='json')
        self.mark.refresh_from_db()
        self.assertIsNotNone(self.mark.photo_verified_at)


class AdminTests(Base):
    def test_risk_signals_and_totals(self):
        grace = single('grace')
        for n in range(2):
            r = single(f'r{n}', 'man')
            Report.objects.create(reporter=r.user, content_type='singlesprofile', object_id=grace.id, reason='other')
        SinglesProfile.objects.filter(pk=grace.pk).update(status='pending')
        self.as_(reviewer())
        row = self.client.get('/api/admin/singles/').data['results'][0]
        self.assertIn('reports', [x['kind'] for x in row['risk']['reasons']])
        self.assertEqual(row['risk']['level'], 'medium')
        stats = self.client.get('/api/admin/singles-stats/').data
        self.assertEqual(stats['waiting']['profiles'], 1)
        self.assertIn('chat_started', stats['week'])


class Phase13And14Tests(Base):
    """Phase 13: every match chat in the Chats tab (not only the inbox's first
    page), and its own unread badge. Phase 14: Discover's answers in one
    query, and the hub kept briefly but dropped when you answer."""

    def test_every_singles_chat_and_its_unread_count(self):
        grace = single('grace')
        m = self.match(grace)
        self.as_(grace)
        self.client.post(f'/api/conversations/{m.conversation_id}/send_message/', {'content': 'Hello Mark'}, format='json')
        self.as_(self.mark)
        ids = [c['id'] for c in self.client.get('/api/conversations/', {'singles': 1}).data['results']]
        self.assertEqual(ids, [m.conversation_id])
        self.assertEqual(self.client.get('/api/conversations/unread_count/').data['singles'], 1)
        self.client.post(f'/api/singles/matches/{m.id}/unmatch/')
        self.assertEqual(self.client.get('/api/conversations/unread_count/').data['singles'], 0)
        ids = [c['id'] for c in self.client.get('/api/conversations/', {'singles': 1}).data['results']]
        self.assertEqual(ids, [m.conversation_id])          # ended chats still listed there, closed

    def test_discover_loads_answers_once_for_the_page(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        for i in range(5):
            p = single(f'w{i}')
            SinglesAnswer.objects.create(profile=p, key='relocate', answer='yes')
        with CaptureQueriesContext(connection) as few:
            self.client.get('/api/singles/discover/')
        for i in range(5, 10):
            single(f'w{i}')
        cache.clear()
        with CaptureQueriesContext(connection) as more:
            r = self.client.get('/api/singles/discover/')
        self.assertEqual(len(r.data['results']), 5)
        self.assertLessEqual(len(more.captured_queries), len(few.captured_queries))

    def test_the_hub_is_kept_briefly_and_dropped_when_you_answer(self):
        grace = single('grace')
        first = self.client.get('/api/singles/hub/').data
        self.assertEqual(first['today'], 1)
        ann = single('ann')
        self.assertEqual(self.client.get('/api/singles/hub/').data['today'], 1)       # kept
        self.client.post(f'/api/singles/profiles/{grace.id}/interest/', {'kind': 'pass'}, format='json')
        self.assertEqual(self.client.get('/api/singles/hub/').data['today'], 1)       # grace gone, ann counted
        self.assertIn(ann.id, [c['id'] for c in self.client.get('/api/singles/hub/').data['preview']])

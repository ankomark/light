"""Single & Searching, phases 2 and 3: Discover (the opposite gender, only
approved and visible people, never anyone blocked, answered, matched, or who
said "not now" to you; twenty new a day; filters), interest → match → its
own chat (not a request), unmatch closing that chat, and safety — reports
that send a profile back for review, blocking, and too many interests too
fast.

    python manage.py test songs.tests.test_singles_matching --settings=music.settings_test
"""
from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from songs import singles
from songs.models import (
    Block, Conversation, ConversationState, Report, Role, SinglesInterest, SinglesMatch, SinglesPhoto,
    SinglesProfile, User,
)

TELL = 'songs.push.notify_user'


def years_ago(n):
    today = timezone.localdate()
    return today.replace(year=today.year - n) if not (today.month == 2 and today.day == 29) \
        else today.replace(year=today.year - n, day=28)


def single(name, gender='woman', age=27, status='approved', country='Kenya', **extra):
    u = User.objects.create_user(name, f'{name}@x.com', 'pw', is_email_verified=True)
    User.objects.filter(pk=u.pk).update(date_joined=timezone.now() - timedelta(days=30))
    p = SinglesProfile.objects.create(
        user=u, first_name=name.title(), birth_date=years_ago(age), gender=gender, country=country,
        baptised='yes', status=status, agreed_rules_at=timezone.now(), last_active_at=timezone.now(), **extra)
    SinglesPhoto.objects.create(profile=p, url=f'https://pub-test.r2.dev/singles/{name}.jpg',
                                status=SinglesPhoto.APPROVED)
    return p


class Base(APITestCase):
    def setUp(self):
        cache.clear()
        self.mark = single('mark', 'man', 29)
        self.client.force_authenticate(self.mark.user)

    def discover(self, **params):
        return self.client.get('/api/singles/discover/', params)

    def ids(self, **params):
        return [p['id'] for p in self.discover(**params).data['results']]

    def interest(self, profile, kind='interested', as_=None):
        if as_ is not None:
            self.client.force_authenticate(as_.user)
        r = self.client.post(f'/api/singles/profiles/{profile.id}/interest/', {'kind': kind}, format='json')
        if as_ is not None:
            self.client.force_authenticate(self.mark.user)
        return r


class DiscoverTests(Base):
    def test_only_the_opposite_gender_who_can_be_seen(self):
        grace = single('grace')
        single('peter', 'man')                                         # same gender
        single('draft', status='draft')
        single('waiting', status='pending')
        single('paused', is_paused=True)
        nophoto = single('nophoto')
        SinglesPhoto.objects.filter(profile=nophoto).update(status=SinglesPhoto.PENDING)
        suspended = single('suspended')
        User.objects.filter(pk=suspended.user_id).update(is_suspended=True)
        r = self.discover()
        self.assertEqual([p['id'] for p in r.data['results']], [grace.id])
        self.assertEqual(r.data['left_today'], singles.DAILY_NEW)
        shown = r.data['results'][0]
        self.assertNotIn('birth_date', shown)
        self.assertNotIn('status', shown)
        self.assertEqual(shown['age'], 27)

    def test_you_must_be_approved_and_not_paused_to_look(self):
        SinglesProfile.objects.filter(pk=self.mark.pk).update(status='pending')
        self.assertEqual(self.discover().data['code'], 'not_approved')
        SinglesProfile.objects.filter(pk=self.mark.pk).update(status='approved', is_paused=True)
        self.assertEqual(self.discover().data['code'], 'paused')

    def test_never_blocked_answered_matched_or_one_who_passed_on_you(self):
        blocked, answered, passed_me, fine = (single(n) for n in ('blocked', 'answered', 'passedme', 'fine'))
        Block.objects.create(blocker=blocked.user, blocked=self.mark.user)
        SinglesInterest.objects.create(from_profile=self.mark, to_profile=answered, kind='pass')
        SinglesInterest.objects.create(from_profile=passed_me, to_profile=self.mark, kind='pass')
        self.assertEqual(self.ids(), [fine.id])

    def test_filters_and_nearest_first(self):
        near = single('near', age=25)
        far = single('far', age=35, country='Uganda')
        self.assertEqual(self.ids(), [near.id, far.id])
        self.assertEqual(self.ids(min_age=30), [far.id])
        self.assertEqual(self.ids(max_age=26), [near.id])
        self.assertEqual(self.ids(country='uganda'), [far.id])

    def test_twenty_new_a_day(self):
        people = [single(f'w{i}') for i in range(singles.DAILY_NEW + 1)]
        for p in people[:singles.DAILY_NEW]:
            self.assertEqual(self.interest(p, 'pass').status_code, 200)
        r = self.discover()
        self.assertEqual((r.data['results'], r.data['left_today']), ([], 0))
        r = self.interest(people[-1])
        self.assertEqual((r.status_code, r.data['code']), (429, 'daily_limit'))
        self.assertEqual(self.interest(people[0]).status_code, 200)        # changing an answer is not new


class MatchTests(Base):
    def setUp(self):
        super().setUp()
        self.grace = single('grace')

    @mock.patch(TELL)
    def test_both_interested_make_a_match_with_its_own_open_chat(self, tell):
        r = self.interest(self.grace)
        self.assertFalse(r.data['matched'])
        tell.assert_not_called()                                           # an interest alone tells no one
        r = self.interest(self.mark, as_=self.grace)
        self.assertTrue(r.data['matched'])
        match = SinglesMatch.objects.get()
        conv = match.conversation
        self.assertEqual(set(conv.participants.values_list('pk', flat=True)), {self.mark.user_id, self.grace.user_id})
        self.assertTrue(all(ConversationState.objects.filter(conversation=conv).values_list('accepted', flat=True)))
        self.assertEqual(tell.call_count, 2)
        self.assertNotIn('Grace', tell.call_args[0][2])                    # no names on the lock screen
        self.assertEqual(r.data['match']['opener'], {'kind': 'general'})
        rows = self.client.get('/api/singles/matches/').data['results']
        self.assertEqual((rows[0]['profile']['id'], rows[0]['conversation_id']), (self.grace.id, conv.id))
        self.client.post(f'/api/conversations/{conv.id}/send_message/', {'content': 'Hello Grace'}, format='json')
        inbox = self.client.get('/api/conversations/').data['results']
        self.assertEqual((inbox[0]['singles'], inbox[0]['closed'], inbox[0]['is_request']), (True, False, False))

    @mock.patch(TELL)
    def test_unmatch_closes_the_chat_for_both(self, _tell):
        self.interest(self.grace)
        self.interest(self.mark, as_=self.grace)
        match = SinglesMatch.objects.get()
        self.client.force_authenticate(self.grace.user)
        self.assertEqual(self.client.post(f'/api/singles/matches/{match.id}/unmatch/').status_code, 200)
        r = self.client.post(f'/api/conversations/{match.conversation_id}/send_message/', {'content': 'Hi'}, format='json')
        self.assertEqual((r.status_code, r.data['code']), (403, 'unmatched'))
        self.client.force_authenticate(self.mark.user)
        self.assertEqual(self.client.get('/api/singles/matches/').data['results'], [])
        self.assertNotIn(self.grace.id, self.ids())                       # and never shown again

    def test_profiles_open_only_to_those_who_may_see_them(self):
        self.assertEqual(self.client.get(f'/api/singles/profiles/{self.grace.id}/').status_code, 200)
        peter = single('peter', 'man')
        self.assertEqual(self.client.get(f'/api/singles/profiles/{peter.id}/').status_code, 404)
        hidden = single('hidden', status='pending')
        self.assertEqual(self.client.get(f'/api/singles/profiles/{hidden.id}/').status_code, 404)


class SafetyTests(Base):
    def setUp(self):
        super().setUp()
        self.grace = single('grace')

    def test_reports_send_a_profile_back_for_review(self):
        for n in range(singles.REPORTS_TO_PAUSE):
            reporter = self.mark if n == 0 else single(f'r{n}', 'man')
            self.client.force_authenticate(reporter.user)
            r = self.client.post(f'/api/singles/profiles/{self.grace.id}/report/', {'reason': 'scam'}, format='json')
            self.assertEqual(r.status_code, 201)
        self.grace.refresh_from_db()
        self.assertEqual(self.grace.status, 'pending')
        self.assertIn('reported by 3', self.grace.review_note)
        self.assertEqual(Report.objects.filter(content_type='singlesprofile').count(), 3)
        reviewer = User.objects.create_user('rev', 'rev@x.com', 'pw',
                                            role=Role.objects.create(name='M', capabilities=['handle_reports']))
        self.client.force_authenticate(reviewer)
        self.assertEqual(self.client.get('/api/admin/reports/').status_code, 200)   # the queue copes with it

    @mock.patch(TELL)
    def test_block_ends_the_match_and_hides_both_ways(self, _tell):
        self.interest(self.grace)
        self.interest(self.mark, as_=self.grace)
        self.client.post(f'/api/singles/profiles/{self.grace.id}/block/')
        self.assertIsNotNone(SinglesMatch.objects.get().ended_at)
        self.assertTrue(Block.objects.filter(blocker=self.mark.user, blocked=self.grace.user).exists())
        self.client.force_authenticate(self.grace.user)
        self.assertEqual(self.client.get(f'/api/singles/profiles/{self.mark.id}/').status_code, 404)

    def test_too_many_interests_too_fast_is_paused_for_review(self):
        women = [single(f'w{i}') for i in range(singles.FAST_INTERESTS)]
        with mock.patch.object(singles, 'DAILY_NEW', 1000):
            codes = [self.interest(w).status_code for w in women]
        self.assertEqual(codes[-1], 429)
        self.mark.refresh_from_db()
        self.assertEqual(self.mark.status, 'pending')
        self.assertIn('very many interests', self.mark.review_note)

    def test_a_report_needs_a_known_reason(self):
        r = self.client.post(f'/api/singles/profiles/{self.grace.id}/report/', {'reason': 'ugly'}, format='json')
        self.assertEqual(r.status_code, 400)


class EndingTests(Base):
    """Leaving, or a ban, ends every match — the chat closes for both rather
    than turning into an ordinary chat."""
    def setUp(self):
        super().setUp()
        self.grace = single('grace')
        with mock.patch(TELL):
            self.interest(self.grace)
            self.interest(self.mark, as_=self.grace)
        self.match = SinglesMatch.objects.get()

    def send(self, who):
        self.client.force_authenticate(who.user)
        return self.client.post(f'/api/conversations/{self.match.conversation_id}/send_message/',
                                {'content': 'Still there?'}, format='json')

    def test_leaving_closes_the_chat_for_the_other(self):
        with mock.patch('songs.views.singles.r2.delete'):
            self.client.delete('/api/singles/me/')                      # mark leaves
        self.match.refresh_from_db()
        self.assertIsNotNone(self.match.ended_at)
        self.assertNotIn(self.mark.id, (self.match.profile_a_id, self.match.profile_b_id))   # his profile is gone
        r = self.send(self.grace)
        self.assertEqual((r.status_code, r.data['code']), (403, 'unmatched'))

    def test_a_ban_closes_their_chats(self):
        reviewer = User.objects.create_user('rev', 'rev@x.com', 'pw',
                                            role=Role.objects.create(name='S', capabilities=['review_singles']))
        self.client.force_authenticate(reviewer)
        with mock.patch(TELL):
            self.client.post(f'/api/admin/singles/{self.mark.id}/ban/', {'reason': 'Asked for money'}, format='json')
        self.assertEqual(self.send(self.grace).data['code'], 'unmatched')

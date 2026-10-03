"""Single & Searching, phase 1: who may join (18+, verified, a week old, not
suspended or banned), a profile with its birth date and gender fixed,
contact details kept out, photos (four at most), sending it for review,
pausing and leaving — and the admins' review queue, approve / reject / ban,
each logged, each told to the person. The switch turns it all off for
members but not for the reviewers.

    python manage.py test songs.tests.test_singles_phase1 --settings=music.settings_test
"""
from datetime import date, timedelta
from unittest import mock

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from songs import app_settings, singles
from songs.models import AdminActionLog, Role, SinglesPhoto, SinglesProfile, User

ME = '/api/singles/me/'
UPLOAD = 'songs.views.singles.r2.upload_file'
DELETE = 'songs.views.singles.r2.delete'
TELL = 'songs.push.notify_user'


def years_ago(n, days=0):
    today = timezone.localdate()
    try:
        d = today.replace(year=today.year - n)
    except ValueError:            # 29 February
        d = today.replace(year=today.year - n, day=28)
    return d - timedelta(days=days)


def member(name, **extra):
    u = User.objects.create_user(name, f'{name}@x.com', 'pw', is_email_verified=True, **extra)
    User.objects.filter(pk=u.pk).update(date_joined=timezone.now() - timedelta(days=30))
    u.refresh_from_db()
    return u


def body(**extra):
    return {'agree_rules': True, 'first_name': 'Grace', 'birth_date': years_ago(27).isoformat(),
            'gender': 'woman', 'country': 'Kenya', 'town': 'Nairobi', 'baptised': 'yes',
            'about': 'Nurse. I sing alto.', **extra}


def image(name='a.jpg', kind='image/jpeg', size=10):
    return SimpleUploadedFile(name, b'x' * size, content_type=kind)


class Base(APITestCase):
    def setUp(self):
        cache.clear()
        self.grace = member('grace')
        self.client.force_authenticate(self.grace)

    def join(self, **extra):
        return self.client.post(ME, body(**extra), format='json')

    @mock.patch(UPLOAD, return_value='https://pub-test.r2.dev/singles/p.jpg')
    def add_photo(self, _upload):
        return self.client.post(ME + 'photos/', {'image': image()}, format='multipart')


class JoiningTests(Base):
    @override_settings(REQUIRE_EMAIL_VERIFICATION=True)
    def test_who_may_join(self):
        r = self.client.get(ME)
        self.assertEqual((r.data['eligible'], r.data['blockers'], r.data['profile']), (True, [], None))

        fresh = User.objects.create_user('fresh', 'f@x.com', 'pw', is_email_verified=True)
        self.client.force_authenticate(fresh)
        r = self.client.get(ME)
        self.assertEqual(r.data['blockers'], [singles.TOO_NEW])
        self.assertEqual(r.data['ready_on'], (fresh.date_joined + timedelta(days=7)).date().isoformat())
        self.assertEqual(self.join().status_code, 403)

        unverified = member('unverified')
        User.objects.filter(pk=unverified.pk).update(is_email_verified=False)
        suspended = member('suspended', is_suspended=True)
        for who, code in ((unverified, singles.NOT_VERIFIED), (suspended, singles.SUSPENDED)):
            self.client.force_authenticate(User.objects.get(pk=who.pk))
            r = self.join()
            self.assertEqual((r.status_code, r.data['blockers']), (403, [code]))

    def test_unverified_email_is_fine_while_the_app_does_not_ask_for_it(self):
        # No mail server yet: the app treats everyone as verified, and so does
        # Single & Searching — otherwise nobody could ever join (Ivy's bug).
        ivy = member('ivy')
        User.objects.filter(pk=ivy.pk).update(is_email_verified=False)
        self.client.force_authenticate(User.objects.get(pk=ivy.pk))
        r = self.client.get(ME)
        self.assertEqual((r.data['eligible'], r.data['blockers']), (True, []))
        self.assertEqual(self.join().status_code, 201)

    @override_settings(REQUIRE_EMAIL_VERIFICATION=True)
    def test_admins_skip_the_email_and_new_account_checks(self):
        admin = User.objects.create_user('boss', 'boss@x.com', 'pw', admin_role='super_admin')
        self.client.force_authenticate(admin)
        r = self.client.get(ME)
        self.assertEqual((r.data['eligible'], r.data['blockers']), (True, []))
        mod = User.objects.create_user('mod', 'mod@x.com', 'pw', role=Role.objects.create(name='R', capabilities=['review_singles']))
        self.client.force_authenticate(mod)
        self.assertEqual(self.client.get(ME).data['blockers'], [])
        suspended_admin = User.objects.create_user('sus', 'sus@x.com', 'pw', admin_role='moderator', is_suspended=True)
        self.client.force_authenticate(suspended_admin)
        self.assertEqual(self.client.get(ME).data['blockers'], [singles.SUSPENDED])   # suspension still counts

    def test_18_or_over_and_the_rules_agreed(self):
        r = self.join(birth_date=years_ago(18, days=-1).isoformat())         # 18 tomorrow
        self.assertEqual((r.status_code, r.data['code']), (403, 'under_18'))
        self.assertEqual(self.join(agree_rules=False).status_code, 400)
        self.assertEqual(self.join(gender='other').status_code, 400)
        r = self.join(birth_date=years_ago(18).isoformat())                  # 18 today
        self.assertEqual(r.status_code, 201)
        self.assertEqual((r.data['age'], r.data['status']), (18, 'draft'))
        self.assertEqual(self.join().status_code, 400)                        # only one each

    def test_contact_details_never_reach_a_profile(self):
        r = self.join(about='Call me on +254 712 345 678 or grace@mail.com, insta @gracie, see www.me.com. Isaiah 41:10',
                      prompts=[{'key': 'verse', 'answer': '1 Cor 13:4-7 — WhatsApp 0712345678'}])
        self.assertEqual(r.status_code, 201)
        about = r.data['about']
        for leak in ('712', 'mail.com', '@gracie', 'www'):
            self.assertNotIn(leak, about)
        self.assertIn('Isaiah 41:10', about)
        self.assertEqual(r.data['prompts'], [{'key': 'verse', 'answer': '1 Cor 13:4-7 — WhatsApp'}])

    def test_prompts_known_once_each_three_at_most(self):
        self.assertEqual(self.join(prompts=[{'key': 'favourite_food', 'answer': 'x'}]).status_code, 400)
        self.assertEqual(self.join(prompts=[{'key': 'verse', 'answer': 'a'}, {'key': 'verse', 'answer': 'b'}]).status_code, 400)
        four = [{'key': k, 'answer': 'yes'} for k in ('verse', 'sabbath', 'grateful', 'serve')]
        self.assertEqual(self.join(prompts=four).status_code, 400)
        self.assertEqual(self.join(prompts=four[:3]).status_code, 201)


class ProfileTests(Base):
    def setUp(self):
        super().setUp()
        self.assertEqual(self.join().status_code, 201)

    def test_birth_date_and_gender_stay_as_set(self):
        r = self.client.patch(ME, {'gender': 'man', 'birth_date': '1990-01-01'}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(set(r.data), {'gender', 'birth_date'})
        r = self.client.patch(ME, {'town': 'Kisumu', 'languages': ['English', 'english', 'Dholuo']}, format='json')
        self.assertEqual((r.data['town'], r.data['languages']), ('Kisumu', ['English', 'Dholuo']))
        self.assertEqual(self.client.patch(ME, {'first_name': ''}, format='json').status_code, 400)

    def test_photos_four_at_most_in_order_and_removed_from_storage(self):
        self.assertEqual(self.client.post(ME + 'photos/', {'image': image('a.pdf', 'application/pdf')},
                                          format='multipart').status_code, 400)
        ids = [self.add_photo().data['id'] for _ in range(4)]
        self.assertEqual(self.add_photo().status_code, 400)
        r = self.client.post(ME + 'photos/order/', {'ids': list(reversed(ids))}, format='json')
        self.assertEqual([p['id'] for p in r.data['photos']], list(reversed(ids)))
        self.assertEqual(self.client.post(ME + 'photos/order/', {'ids': ids[:2]}, format='json').status_code, 400)
        with mock.patch(DELETE) as gone:
            self.assertEqual(self.client.delete(f'{ME}photos/{ids[0]}/').status_code, 204)
        gone.assert_called_once()
        other = member('other')
        self.client.force_authenticate(other)
        self.client.post(ME, body(first_name='Ann'), format='json')
        self.assertEqual(self.client.delete(f'{ME}photos/{ids[1]}/').status_code, 404)    # not hers

    def test_sent_for_review_only_when_complete(self):
        r = self.client.post(ME + 'submit/')
        self.assertEqual((r.status_code, r.data['missing']), (400, ['photo']))
        self.add_photo()
        r = self.client.post(ME + 'submit/')
        self.assertEqual(r.data['status'], 'pending')
        self.assertEqual(self.client.get(ME).data['profile']['status'], 'pending')

    def test_pause_and_leave(self):
        self.assertTrue(self.client.post(ME + 'pause/', {'paused': True}, format='json').data['is_paused'])
        self.add_photo()
        with mock.patch(DELETE) as gone:
            self.assertEqual(self.client.delete(ME).status_code, 204)
        gone.assert_called_once_with('https://pub-test.r2.dev/singles/p.jpg')
        self.assertFalse(SinglesProfile.objects.exists())
        self.assertFalse(SinglesPhoto.objects.exists())
        self.assertIsNone(self.client.get(ME).data['profile'])

    def test_switched_off_for_members(self):
        app_settings.save('features', {'singles': False}, None)
        r = self.client.get(ME)
        self.assertEqual((r.status_code, r.data['code']), (403, 'feature_off'))
        self.assertEqual(self.client.delete(ME).status_code, 204)          # leaving still works


class ReviewTests(Base):
    def setUp(self):
        super().setUp()
        self.join()
        self.photo = self.add_photo().data['id']
        self.client.post(ME + 'submit/')
        self.profile = SinglesProfile.objects.get(user=self.grace)
        self.reviewer = member('reviewer', role=Role.objects.create(name='S', capabilities=['review_singles']))
        self.client.force_authenticate(self.reviewer)
        self.url = f'/api/admin/singles/{self.profile.id}/'

    def test_only_reviewers(self):
        self.client.force_authenticate(member('nosy'))
        self.assertEqual(self.client.get('/api/admin/singles/').status_code, 403)
        self.client.force_authenticate(member('quizzer', role=Role.objects.create(name='Q', capabilities=['manage_quiz'])))
        self.assertEqual(self.client.get('/api/admin/singles/').status_code, 403)

    @mock.patch(TELL)
    def test_approve_with_its_photos_logged_and_told(self, tell):
        r = self.client.get('/api/admin/singles/')
        self.assertEqual([p['id'] for p in r.data['results']], [self.profile.id])
        self.assertEqual(r.data['results'][0]['user']['username'], 'grace')
        r = self.client.post(self.url + 'review/', {'decision': 'approve'}, format='json')
        self.assertEqual(r.data['status'], 'approved')
        self.assertEqual(SinglesPhoto.objects.get(pk=self.photo).status, 'approved')
        self.assertTrue(AdminActionLog.objects.filter(action='singles_approve', target_id=self.profile.id).exists())
        self.assertIn('approved', tell.call_args[0][2])
        self.assertEqual(self.client.get('/api/admin/singles/').data['results'], [])

    @mock.patch(TELL)
    def test_a_new_photo_waits_on_an_approved_profile(self, tell):
        self.client.post(self.url + 'review/', {'decision': 'approve'}, format='json')
        self.client.force_authenticate(self.grace)
        new = self.add_photo().data['id']
        self.assertEqual(self.client.get(ME).data['profile']['status'], 'approved')     # still seen meanwhile
        self.client.force_authenticate(self.reviewer)
        self.assertEqual([p['id'] for p in self.client.get('/api/admin/singles/').data['results']], [self.profile.id])
        tell.reset_mock()
        self.client.post(self.url + 'review/', {'decision': 'approve', 'photos': {str(new): 'reject'}}, format='json')
        self.assertEqual(SinglesPhoto.objects.get(pk=new).status, 'rejected')
        tell.assert_not_called()                                   # nothing new to tell: still approved

    @mock.patch(TELL)
    def test_reject_needs_a_reason_the_person_reads(self, tell):
        self.assertEqual(self.client.post(self.url + 'review/', {'decision': 'reject'}, format='json').status_code, 400)
        r = self.client.post(self.url + 'review/', {'decision': 'reject', 'reason': 'Use a photo of your face'},
                             format='json')
        self.assertEqual((r.data['status'], r.data['review_note']), ('rejected', 'Use a photo of your face'))
        self.assertIn('Use a photo of your face', tell.call_args[0][2])
        self.client.force_authenticate(self.grace)
        self.assertEqual(self.client.get(ME).data['profile']['photos'], [])           # the rejected photo is gone
        self.assertEqual(self.client.post(ME + 'submit/').data['missing'], ['photo'])

    def test_no_approval_without_an_approved_photo(self):
        r = self.client.post(self.url + 'review/', {'decision': 'approve', 'photos': {str(self.photo): 'reject'}},
                             format='json')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(SinglesPhoto.objects.get(pk=self.photo).status, 'pending')    # nothing changed
        self.assertEqual(SinglesProfile.objects.get(pk=self.profile.pk).status, 'pending')

    @mock.patch(TELL)
    def test_ban_from_here_only_and_no_fresh_start(self, _tell):
        self.assertEqual(self.client.post(self.url + 'ban/', {}, format='json').status_code, 400)
        self.client.post(self.url + 'ban/', {'reason': 'Asked members for money'}, format='json')
        self.client.force_authenticate(self.grace)
        r = self.client.get(ME)
        self.assertEqual((r.data['blockers'], r.data['profile']), ([singles.BANNED], None))
        with mock.patch(DELETE):
            self.client.delete(ME)                                  # leaving wipes it but keeps the ban
        self.assertEqual(self.join().status_code, 403)
        self.assertEqual(SinglesProfile.objects.get(user=self.grace).about, '')
        self.assertFalse(User.objects.get(pk=self.grace.pk).is_suspended)   # the rest of the app is untouched
        self.client.force_authenticate(self.reviewer)
        self.assertEqual(self.client.post(self.url + 'unban/', {'reason': 'Appeal accepted'}, format='json').data['status'],
                         'draft')

    def test_reviewers_work_while_it_is_switched_off(self):
        app_settings.save('features', {'singles': False}, None)
        self.assertEqual(self.client.get('/api/admin/singles/').status_code, 200)


class RuleTests(APITestCase):
    def test_age_on_birthdays(self):
        self.assertEqual(singles.age_on(date(2000, 5, 10), date(2018, 5, 9)), 17)
        self.assertEqual(singles.age_on(date(2000, 5, 10), date(2018, 5, 10)), 18)

    def test_clean_keeps_scripture_and_drops_contacts(self):
        self.assertEqual(singles.clean('John 3:16, Psalm 23:1-6'), 'John 3:16, Psalm 23:1-6')
        self.assertEqual(singles.clean('text 0712 345 678 now'), 'text now')
        self.assertEqual(singles.clean('see https://x.co/a or bit.ly/z'), 'see or')

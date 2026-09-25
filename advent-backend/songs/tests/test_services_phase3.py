"""Services, phase 3 — trust: reviews (one each, not the owner's) with the
owner's reply, the stars on every listing, asking for the verified tick
(staff decide), listing under an organisation, and only owners change a
listing.

    python manage.py test songs.tests.test_services_phase3 --settings=music.settings_test
"""
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from songs.models import (
    User, Videostudio, ServiceReview, ServiceVerification, Organization, OrganizationMember, Block,
)

R2 = 'https://pub-test.r2.dev'


def listing(owner, name='Hope Clinic', **extra):
    return Videostudio.objects.create(created_by=owner, name=name, location='Kisumu', service_types=['clinic'], **extra)


class Base(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user('owner', 'o@x.com', 'x')
        self.ann = User.objects.create_user('ann', 'a@x.com', 'x')
        self.bob = User.objects.create_user('bob', 'b@x.com', 'x')
        self.s = listing(self.owner)
        self.url = f'/api/video-studios/{self.s.id}/'


class ReviewTests(Base):
    def review(self, user, rating, body=''):
        self.client.force_authenticate(user)
        return self.client.post(self.url + 'reviews/', {'rating': rating, 'body': body}, format='json')

    def test_one_each_changed_in_place_and_the_stars_everywhere(self):
        self.assertEqual(self.review(self.ann, 5, 'Kind nurses').status_code, 201)
        self.assertEqual(self.review(self.ann, 4).status_code, 200)            # changed, not a second
        self.assertEqual(self.review(self.bob, 3).status_code, 201)
        self.assertEqual(ServiceReview.objects.count(), 2)
        r = self.client.get(self.url + 'reviews/')
        self.assertEqual(r.data['summary'], {'count': 2, 'average': 3.5, 'spread': {'1': 0, '2': 0, '3': 1, '4': 1, '5': 0}})
        self.assertEqual(r.data['mine']['rating'], 3)
        self.assertEqual([x['user']['username'] for x in r.data['results']], ['ann'])
        page = self.client.get(self.url).data
        self.assertEqual((page['rating_avg'], page['rating_count']), (3.5, 2))
        row = self.client.get('/api/video-studios/').data['results'][0]
        self.assertEqual((row['rating_avg'], row['rating_count']), (3.5, 2))

    def test_not_ones_own_nor_signed_out_and_ratings_are_1_to_5(self):
        self.assertEqual(self.review(self.owner, 5).status_code, 403)
        self.assertEqual(self.review(self.ann, 6).status_code, 400)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.post(self.url + 'reviews/', {'rating': 5}, format='json').status_code, 401)
        self.assertFalse(self.client.get(self.url + 'reviews/').data['can_review'])

    def test_the_owner_replies_in_public(self):
        rid = self.review(self.ann, 2, 'Slow').data['id']
        self.client.force_authenticate(self.bob)
        self.assertEqual(self.client.post(f'{self.url}reviews/{rid}/reply/', {'reply': 'x'}, format='json').status_code, 403)
        self.client.force_authenticate(self.owner)
        r = self.client.post(f'{self.url}reviews/{rid}/reply/', {'reply': 'Sorry — we have more staff now.'}, format='json')
        self.assertEqual(r.data['reply'], 'Sorry — we have more staff now.')
        self.assertIsNotNone(r.data['replied_at'])
        self.assertTrue(self.client.get(self.url + 'reviews/').data['is_owner'])

    def test_taken_down_and_blocked_reviews_dont_count(self):
        self.review(self.ann, 1)
        self.review(self.bob, 5)
        ServiceReview.objects.filter(user=self.ann).update(is_removed=True)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(self.url).data['rating_count'], 1)
        viewer = User.objects.create_user('v', 'v@x.com', 'x')
        Block.objects.create(blocker=viewer, blocked=self.bob)
        self.client.force_authenticate(viewer)
        self.assertEqual(self.client.get(self.url + 'reviews/').data['summary']['count'], 0)

    def test_a_review_can_be_reported(self):
        rid = self.review(self.ann, 1).data['id']
        self.client.force_authenticate(self.bob)
        r = self.client.post('/api/reports/', {'content_type': 'servicereview', 'object_id': rid, 'reason': 'spam'},
                             format='json')
        self.assertIn(r.status_code, (200, 201))


@override_settings(R2_PUBLIC_BASE=R2)
class VerificationTests(Base):
    def ask(self, **extra):
        return self.client.post(self.url + 'verification/', {
            'legal_name': 'Hope Clinic Ltd', 'registration_number': 'KMPDC/123',
            'documents': [f'{R2}/cover/licence.jpg'], **extra}, format='json')

    def test_asking_and_staff_deciding(self):
        from songs.admin import _decide_verification
        self.client.force_authenticate(self.ann)
        self.assertEqual(self.ask().status_code, 403)                          # not theirs
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.get(self.url + 'verification/').data, {'status': None})
        self.assertEqual(self.ask(documents=[]).status_code, 400)
        self.assertEqual(self.ask(documents=['https://elsewhere.example/x.jpg']).status_code, 400)
        r = self.ask()
        self.assertEqual((r.status_code, r.data['status']), (201, 'pending'))
        self.assertEqual(self.ask().data['code'], 'pending')                  # one waiting at a time

        v = ServiceVerification.objects.get()
        staff = User.objects.create_user('staff', 's@x.com', 'x', is_staff=True)
        _decide_verification(v, ServiceVerification.REJECTED, staff, 'The licence photo is unreadable.')
        self.s.refresh_from_db()
        self.assertFalse(self.s.is_verified)
        r = self.client.get(self.url + 'verification/').data
        self.assertEqual((r['status'], r['decision_note']), ('rejected', 'The licence photo is unreadable.'))
        self.assertEqual(self.ask().status_code, 201)                          # may ask again
        _decide_verification(ServiceVerification.objects.first(), ServiceVerification.APPROVED, staff)
        self.s.refresh_from_db()
        self.assertTrue(self.s.is_verified)
        self.assertEqual(self.ask().data['code'], 'verified')


class OrganizationTests(Base):
    def test_listed_under_an_organisation_its_owner_belongs_to(self):
        org = Organization.objects.create(name='Kisumu Mission Hospital', slug='kmh', kind='ministry', is_verified=True)
        self.client.force_authenticate(self.owner)
        r = self.client.patch(self.url, {'organization_slug': 'kmh'}, format='json')
        self.assertEqual(r.status_code, 400)                                   # not a member
        OrganizationMember.objects.create(organization=org, user=self.owner, role='author', accepted_at=timezone.now())
        self.assertEqual(self.client.patch(self.url, {'organization_slug': 'kmh'}, format='json').status_code, 200)
        page = self.client.get(self.url).data
        self.assertEqual((page['organization']['slug'], page['organization']['is_verified']), ('kmh', True))
        self.assertEqual([s['id'] for s in self.client.get('/api/video-studios/', {'organization': 'kmh'}).data['results']],
                         [self.s.id])
        self.assertEqual(self.client.patch(self.url, {'organization_slug': ''}, format='json').status_code, 200)
        self.assertIsNone(self.client.get(self.url).data['organization'])

    def test_member_since(self):
        self.assertEqual(self.client.get(self.url).data['member_since'], self.owner.date_joined.year)


class OwnershipTests(Base):
    def test_only_the_owner_changes_or_removes_it(self):
        self.client.force_authenticate(self.ann)
        self.assertEqual(self.client.patch(self.url, {'name': 'Hijacked'}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(self.url).status_code, 403)
        self.s.refresh_from_db()
        self.assertEqual(self.s.name, 'Hope Clinic')


class HomeCountTests(Base):
    def test_reviews_dont_multiply_the_counts(self):
        for u in (self.ann, self.bob):
            ServiceReview.objects.create(service=self.s, user=u, rating=5)
        self.assertEqual(self.client.get('/api/video-studios/home/').data['counts'], {'media': 1})

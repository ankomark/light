"""Services, phases 4 and 5: finding the right one (near me, filters, sort,
saved, app-wide search) and the provider's side (bookings and quotes, how a
listing is found and reached, how quickly they answer).

    python manage.py test songs.tests.test_services_phase4_5 --settings=music.settings_test
"""
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from songs.models import User, Videostudio, ServiceReview, SavedService, ServiceBooking, ServiceEvent

NAIROBI = (-1.2921, 36.8219)
KISUMU = (-0.0917, 34.7680)
MOMBASA = (-4.0435, 39.6682)


def listing(owner, name, **extra):
    return Videostudio.objects.create(created_by=owner, name=name, location=extra.pop('location', 'Kenya'),
                                      service_types=extra.pop('service_types', ['other']), **extra)


class Base(APITestCase):
    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user('owner', 'o@x.com', 'x')
        self.me = User.objects.create_user('me', 'm@x.com', 'x')
        self.client.force_authenticate(self.me)

    def rows(self, **params):
        return self.client.get('/api/video-studios/', params).data['results']

    def names(self, **params):
        return [r['name'] for r in self.rows(**params)]


class FindingTests(Base):
    def test_near_me_nearest_first_with_the_distance(self):
        listing(self.owner, 'Mombasa', latitude=MOMBASA[0], longitude=MOMBASA[1])
        listing(self.owner, 'Kisumu', latitude=KISUMU[0], longitude=KISUMU[1])
        listing(self.owner, 'Unpinned')
        near = f'{NAIROBI[0]},{NAIROBI[1]}'
        rows = self.rows(sort='near', near=near)
        self.assertEqual([r['name'] for r in rows], ['Kisumu', 'Mombasa', 'Unpinned'])
        self.assertAlmostEqual(rows[0]['distance_km'], 265, delta=15)
        self.assertIsNone(rows[2]['distance_km'])
        self.assertIsNone(self.rows()[0]['distance_km'])                     # no "near": no distance

    def test_filters(self):
        a = listing(self.owner, 'Verified cheap', is_verified=True, service_rates=500,
                    opening_hours={'mon': ['08:00', '17:00']})
        b = listing(self.owner, 'Pricey', service_rates=9000, opening_hours={'sat': ['09:00', '13:00']})
        listing(self.owner, 'Unrated')
        ServiceReview.objects.create(service=a, user=self.me, rating=5)
        ServiceReview.objects.create(service=b, user=self.me, rating=2)
        self.assertEqual(self.names(verified=1), ['Verified cheap'])
        self.assertEqual(self.names(min_rating=4), ['Verified cheap'])
        self.assertEqual(self.names(max_price=1000), ['Verified cheap'])
        self.assertEqual(self.names(min_price=1000), ['Pricey'])
        self.assertEqual(self.names(open_at='mon,10:00'), ['Verified cheap'])
        self.assertEqual(self.names(open_at='mon,17:00'), [])                   # closing time
        self.assertEqual(self.names(open_at='sat,12:59'), ['Pricey'])
        self.assertEqual(self.names(sort='rating')[:2], ['Verified cheap', 'Pricey'])

    def test_saved(self):
        s = listing(self.owner, 'Keep me')
        listing(self.owner, 'Other')
        self.assertEqual(self.client.post(f'/api/video-studios/{s.id}/save/').data, {'is_saved': True})
        self.assertEqual(self.names(saved=1), ['Keep me'])
        self.assertTrue(self.client.get(f'/api/video-studios/{s.id}/').data['is_saved'])
        self.client.delete(f'/api/video-studios/{s.id}/save/')
        self.assertEqual(self.names(saved=1), [])

    def test_in_the_app_wide_search(self):
        listing(self.owner, 'Hope Dental Clinic', location='Kisumu')
        r = self.client.get('/api/explore/search/', {'q': 'dental'})
        self.assertEqual([s['name'] for s in r.data['services']], ['Hope Dental Clinic'])


class BookingTests(Base):
    def setUp(self):
        super().setUp()
        self.s = listing(self.owner, 'Hope Plumbers')
        self.url = f'/api/video-studios/{self.s.id}/bookings/'

    def ask(self, **data):
        return self.client.post(self.url, {'kind': 'booking', 'date': str(timezone.localdate() + timedelta(days=2)),
                                           'time': '10:00', 'note': 'Kitchen sink', **data}, format='json')

    def test_ask_answer_cancel(self):
        r = self.ask()
        self.assertEqual((r.status_code, r.data['status']), (201, 'pending'))
        bid = r.data['id']
        self.assertEqual([b['id'] for b in self.client.get('/api/video-studios/bookings/').data['results']], [bid])
        self.client.force_authenticate(self.owner)
        incoming = self.client.get('/api/video-studios/bookings/', {'role': 'incoming'}).data['results']
        self.assertEqual((incoming[0]['customer']['username'], incoming[0]['is_provider']), ('me', True))
        r = self.client.post(f'/api/video-studios/bookings/{bid}/respond/', {'accept': True, 'note': 'See you then'},
                             format='json')
        self.assertEqual((r.data['status'], r.data['reply_note']), ('accepted', 'See you then'))
        self.assertEqual(self.client.post(f'/api/video-studios/bookings/{bid}/respond/', {'accept': False},
                                          format='json').status_code, 400)          # answered already
        self.assertEqual(self.client.post(f'/api/video-studios/bookings/{bid}/cancel/').status_code, 403)
        self.client.force_authenticate(self.me)
        self.assertEqual(self.client.post(f'/api/video-studios/bookings/{bid}/cancel/').data['status'], 'cancelled')

    def test_what_isnt_a_request(self):
        self.assertEqual(self.ask(date='').status_code, 400)                          # a booking needs a day
        self.assertEqual(self.ask(date=str(timezone.localdate() - timedelta(days=2))).status_code, 400)
        self.assertEqual(self.ask(time='10am').status_code, 400)
        self.assertEqual(self.ask(kind='quote', date='', note='').status_code, 400)    # a quote says what for
        self.assertEqual(self.ask(kind='quote', date='', note='Rewire a house').status_code, 201)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.ask().status_code, 400)                                  # not of oneself
        other = User.objects.create_user('o2', 'o2@x.com', 'x')
        self.client.force_authenticate(other)
        bid = ServiceBooking.objects.first().id
        self.assertEqual(self.client.post(f'/api/video-studios/bookings/{bid}/respond/', {'accept': True},
                                          format='json').status_code, 403)

    def test_how_quickly_they_answer(self):
        now = timezone.now()
        for hours in (1, 2, 30):
            b = ServiceBooking.objects.create(service=self.s, customer=self.me, note='x', status='accepted')
            ServiceBooking.objects.filter(pk=b.pk).update(created_at=now - timedelta(hours=hours + 1),
                                                          responded_at=now - timedelta(hours=1))
        self.assertEqual(self.client.get(f'/api/video-studios/{self.s.id}/').data['responds_in_hours'], 2.0)


class EventTests(Base):
    def test_counted_once_a_day_for_views_never_for_the_owner_and_only_the_owner_sees(self):
        s = listing(self.owner, 'Hope Plumbers')
        url = f'/api/video-studios/{s.id}/events/'
        self.assertTrue(self.client.post(url, {'kind': 'view'}, format='json').data['counted'])
        self.assertFalse(self.client.post(url, {'kind': 'view'}, format='json').data['counted'])
        self.client.post(url, {'kind': 'call'}, format='json')
        self.client.post(url, {'kind': 'call'}, format='json')
        self.assertFalse(self.client.post(url, {'kind': 'hack'}, format='json').data['counted'])
        self.client.force_authenticate(None)
        self.assertTrue(self.client.post(url, {'kind': 'view'}, format='json').data['counted'])   # a visitor
        self.client.force_authenticate(self.owner)
        self.assertFalse(self.client.post(url, {'kind': 'view'}, format='json').data['counted'])
        ServiceBooking.objects.create(service=s, customer=self.me, note='x')
        r = self.client.get(f'/api/video-studios/{s.id}/insights/', {'days': 7})
        self.assertEqual((r.data['totals']['view'], r.data['totals']['call'], r.data['requests'], r.data['waiting']),
                         (2, 2, 1, 1))
        self.assertEqual((len(r.data['daily']), r.data['daily'][-1]['readers']), (7, 2))
        self.client.force_authenticate(self.me)
        self.assertEqual(self.client.get(f'/api/video-studios/{s.id}/insights/').status_code, 403)
        self.assertEqual(ServiceEvent.objects.count(), 2)

class ScanFixTests(Base):
    def test_a_listing_can_still_be_saved_after_its_owner_left_the_organisation(self):
        from songs.models import Organization, OrganizationMember
        org = Organization.objects.create(name='Mission Hospital', slug='mh', kind='ministry')
        m = OrganizationMember.objects.create(organization=org, user=self.me, role='author', accepted_at=timezone.now())
        s = listing(self.me, 'Clinic', organization=org)
        m.delete()                                                     # they left
        r = self.client.patch(f'/api/video-studios/{s.id}/', {'name': 'Clinic 2', 'organization_slug': 'mh'}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        other = Organization.objects.create(name='Other', slug='other', kind='church')
        r = self.client.patch(f'/api/video-studios/{s.id}/', {'organization_slug': 'other'}, format='json')
        self.assertEqual(r.status_code, 400)                          # a new one still needs membership

    def test_a_book_can_still_be_saved_after_its_author_left_the_organisation(self):
        from songs.models import Organization, OrganizationMember, Publication
        org = Organization.objects.create(name='Press', slug='press', kind='publisher')
        m = OrganizationMember.objects.create(organization=org, user=self.me, role='author', accepted_at=timezone.now())
        pub = Publication.objects.create(title='Book', author=self.me, status='draft', organization=org)
        m.delete()
        r = self.client.patch(f'/api/publications/{pub.id}/', {'title': 'Book 2', 'organization_slug': 'press'}, format='json')
        self.assertEqual(r.status_code, 200, r.data)

    def test_booking_today_west_of_the_server_and_a_form_post(self):
        s = listing(self.owner, 'Hope Plumbers')
        yesterday = str(timezone.localdate() - timedelta(days=1))    # "today" somewhere west of UTC
        r = self.client.post(f'/api/video-studios/{s.id}/bookings/', {'kind': 'booking', 'date': yesterday}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        two_ago = str(timezone.localdate() - timedelta(days=2))
        self.assertEqual(self.client.post(f'/api/video-studios/{s.id}/bookings/', {'kind': 'booking', 'date': two_ago},
                                          format='json').status_code, 400)
        r = self.client.post(f'/api/video-studios/{s.id}/bookings/', {'kind': 'quote', 'date': '', 'note': 'Rewire'})
        self.assertEqual(r.status_code, 201, r.data)                  # a form, not JSON

"""Services deep scan (2026-10-07): what it found, kept fixed.

    python manage.py test songs.tests.test_services_scan --settings=music.settings_test
"""
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from songs.models import ServiceBooking, ServiceReview, User, Videostudio


def listing(owner, name='Hope Clinic', **extra):
    return Videostudio.objects.create(created_by=owner, name=name, location='Kisumu', service_types=['clinic'], **extra)


def aged(user, days=30):
    User.objects.filter(pk=user.pk).update(date_joined=timezone.now() - timedelta(days=days))
    user.refresh_from_db()
    return user


class ServicesScanTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user('svcowner', 'so@x.com', 'pw')
        self.me = aged(User.objects.create_user('svcme', 'sm@x.com', 'pw'))
        self.s = listing(self.owner)
        self.client.force_authenticate(self.me)

    def test_best_rated_needs_more_than_one_review(self):
        lone = listing(self.owner, name='One review')
        busy = listing(self.owner, name='Fifty reviews')
        ServiceReview.objects.create(service=lone, user=self.me, rating=5)
        for i in range(50):
            ServiceReview.objects.create(service=busy, user=User.objects.create_user(f'r{i}', f'r{i}@x.com', 'pw'),
                                         rating=5 if i % 5 else 4)            # averages 4.8
        ids = [row['id'] for row in self.client.get('/api/video-studios/', {'sort': 'rating'}).data['results']]
        self.assertLess(ids.index(busy.id), ids.index(lone.id))

    def test_an_account_made_today_cannot_review(self):
        fresh = User.objects.create_user('svcfresh', 'sf@x.com', 'pw')
        self.client.force_authenticate(fresh)
        r = self.client.post(f'/api/video-studios/{self.s.id}/reviews/', {'rating': 1}, format='json')
        self.assertEqual((r.status_code, r.data.get('code')), (403, 'account_too_new'))
        self.client.force_authenticate(self.me)                   # a week-old account may
        r = self.client.post(f'/api/video-studios/{self.s.id}/reviews/', {'rating': 4}, format='json')
        self.assertEqual(r.status_code, 201, r.data)

    def test_a_customer_who_booked_is_marked(self):
        other = aged(User.objects.create_user('svcother', 'sx@x.com', 'pw'))
        ServiceBooking.objects.create(service=self.s, customer=self.me, kind='booking', status=ServiceBooking.ACCEPTED,
                                      note='x')
        ServiceReview.objects.create(service=self.s, user=self.me, rating=5)
        ServiceReview.objects.create(service=self.s, user=other, rating=3)
        self.client.force_authenticate(self.owner)
        rows = self.client.get(f'/api/video-studios/{self.s.id}/reviews/').data['results']
        self.assertEqual({r['user']['username']: r['booked'] for r in rows}, {'svcme': True, 'svcother': False})

    def test_a_lapsed_suspension_no_longer_blocks_a_booking(self):
        User.objects.filter(pk=self.me.pk).update(is_suspended=True, suspended_until=timezone.now() - timedelta(days=1))
        self.client.force_authenticate(User.objects.get(pk=self.me.pk))
        r = self.client.post(f'/api/video-studios/{self.s.id}/bookings/', {'kind': 'quote', 'note': 'How much?'},
                             format='json')
        self.assertEqual(r.status_code, 201, r.data)

    def test_old_embedded_pictures_are_served_only_as_pictures(self):
        import base64
        html = 'data:text/html;base64,' + base64.b64encode(b'<script>alert(1)</script>').decode()
        png = 'data:image/png;base64,' + base64.b64encode(b'\x89PNG\r\n\x1a\n').decode()
        Videostudio.objects.filter(pk=self.s.pk).update(logo=html, cover_image=png)
        self.assertEqual(self.client.get(f'/api/video-studios/{self.s.id}/logo/').status_code, 404)
        r = self.client.get(f'/api/video-studios/{self.s.id}/cover/')
        self.assertEqual((r.status_code, r['Content-Type'], r['X-Content-Type-Options']), (200, 'image/png', 'nosniff'))

    def test_my_listings_need_a_sign_in_not_a_500(self):
        self.client.force_authenticate(None)
        self.client.raise_request_exception = False
        self.assertIn(self.client.get('/api/video-studios/my_videostudios/').status_code, (401, 403))


class ServicesRescanTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.owner = aged(User.objects.create_user('rsowner', 'ro@x.com', 'pw'))
        self.client.force_authenticate(self.owner)

    def post(self, **extra):
        return self.client.post('/api/video-studios/', {'name': 'Clinic', 'location': 'Kisumu', **extra}, format='json')

    def test_a_non_numeric_user_id_is_an_empty_list_not_a_500(self):
        self.client.raise_request_exception = False
        r = self.client.get('/api/video-studios/', {'user_id': 'abc'})
        self.assertEqual((r.status_code, r.data['results']), (200, []))

    def test_a_listing_cannot_mark_itself_taken_down_or_sit_off_the_map(self):
        r = self.post(is_removed=True)
        self.assertEqual(r.status_code, 201, r.data)
        self.assertFalse(Videostudio.objects.get(pk=r.data['id']).is_removed)
        self.assertEqual(self.post(latitude=999, longitude=0).status_code, 400)
        self.assertEqual(self.post(latitude=0, longitude=-999).status_code, 400)
        self.assertEqual(self.post(latitude=-0.1, longitude=34.75).status_code, 201)

    def test_a_description_has_a_limit(self):
        self.assertEqual(self.post(description='x' * 5001).status_code, 400)
        self.assertEqual(self.post(description='x' * 5000).status_code, 201)

    def test_the_share_page_escapes_what_a_provider_wrote(self):
        s = listing(self.owner, name='<script>alert(1)</script>')
        r = self.client.get(f'/service/{s.id}/')
        self.assertEqual(r.status_code, 200)
        self.assertNotIn(b'<script>alert(1)</script>', r.content)

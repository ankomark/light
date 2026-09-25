"""Services, phase 2: a page for each service (gallery, opening hours), the
Services home (counts, featured, verified, new), and a shareable link.

    python manage.py test songs.tests.test_services_phase2 --settings=music.settings_test
"""
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from songs.models import User, Videostudio, Block

R2 = 'https://pub-test.r2.dev'


def listing(owner, name, **extra):
    return Videostudio.objects.create(created_by=owner, name=name, location=extra.pop('location', 'Nairobi'),
                                      service_types=extra.pop('service_types', ['other']), **extra)


@override_settings(R2_PUBLIC_BASE=R2)
class ServicePageTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user('owner', 'o@x.com', 'x')
        self.client.force_authenticate(self.owner)

    def create(self, **extra):
        return self.client.post('/api/video-studios/', {
            'name': 'Hope Clinic', 'location': 'Kisumu', 'category': 'health', 'service_types': ['clinic'], **extra,
        }, format='json')

    def test_gallery_and_hours_on_the_page(self):
        r = self.create(gallery=[f'{R2}/cover/1.jpg', f'{R2}/cover/2.jpg'],
                        opening_hours={'mon': ['08:00', '17:00'], 'sat': ['09:00', '13:00']})
        self.assertEqual(r.status_code, 201, r.data)
        page = self.client.get(f'/api/video-studios/{r.data["id"]}/').data
        self.assertEqual(page['gallery'], [f'{R2}/cover/1.jpg', f'{R2}/cover/2.jpg'])
        self.assertEqual(page['opening_hours'], {'mon': ['08:00', '17:00'], 'sat': ['09:00', '13:00']})
        self.assertTrue(page['is_owner'])

    def test_what_isnt_accepted(self):
        self.assertEqual(self.create(gallery=['https://elsewhere.example/x.jpg']).status_code, 400)
        self.assertEqual(self.create(gallery=[f'{R2}/c/{i}.jpg' for i in range(13)]).status_code, 400)
        self.assertEqual(self.create(opening_hours={'funday': ['08:00', '17:00']}).status_code, 400)
        self.assertEqual(self.create(opening_hours={'mon': ['17:00', '08:00']}).status_code, 400)
        self.assertEqual(self.create(opening_hours={'mon': ['8am', '5pm']}).status_code, 400)
        self.assertEqual(self.create(opening_hours={'fri': ['18:00', '24:00']}).status_code, 201)

    def test_featured_is_staffs_to_set(self):
        r = self.create(featured_at=timezone.now().isoformat())
        self.assertIsNone(Videostudio.objects.get(pk=r.data['id']).featured_at)


class ServicesHomeTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user('owner', 'o@x.com', 'x')
        self.viewer = User.objects.create_user('viewer', 'v@x.com', 'x')

    def test_counts_and_rows(self):
        listing(self.owner, 'Old plain', category='home')
        listing(self.owner, 'Verified clinic', category='health', is_verified=True)
        listing(self.owner, 'Picked hotel', category='hospitality', featured_at=timezone.now())
        listing(self.owner, 'Taken down', category='home', is_removed=True)
        r = self.client.get('/api/video-studios/home/')
        self.assertEqual(r.data['counts'], {'home': 1, 'health': 1, 'hospitality': 1})
        self.assertEqual([s['name'] for s in r.data['featured']], ['Picked hotel'])
        self.assertEqual([s['name'] for s in r.data['verified']], ['Verified clinic'])
        self.assertEqual([s['name'] for s in r.data['new']], ['Picked hotel', 'Verified clinic', 'Old plain'])

    def test_blocked_accounts_left_out(self):
        listing(self.owner, 'Theirs')
        Block.objects.create(blocker=self.viewer, blocked=self.owner)
        self.client.force_authenticate(self.viewer)
        r = self.client.get('/api/video-studios/home/')
        self.assertEqual((r.data['counts'], r.data['new']), ({}, []))


class SharePageTests(APITestCase):
    def test_a_shared_link_card(self):
        owner = User.objects.create_user('owner', 'o@x.com', 'x')
        s = listing(owner, 'Hope <Plumbers>', category='home', location='Kisumu', description='Fast & fair')
        r = self.client.get(f'/service/{s.id}/')
        self.assertEqual(r.status_code, 200)
        html = r.content.decode()
        self.assertIn('Hope &lt;Plumbers&gt; on Adventist Life', html)
        self.assertIn(f'streams://service/{s.id}', html)
        self.assertIn('Kisumu', html)
        Videostudio.objects.filter(pk=s.pk).update(is_removed=True)
        self.assertEqual(self.client.get(f'/service/{s.id}/').status_code, 404)

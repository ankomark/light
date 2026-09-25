"""Services, phase 1: every listing can be found (search and tags on the
server, across pages), listings from blocked or deactivated accounts don't
show, verified first, and pictures are our own uploads.

    python manage.py test songs.tests.test_services_phase1 --settings=music.settings_test
"""
from django.test import override_settings
from rest_framework.test import APITestCase

from songs.models import User, Videostudio, Block


def listing(owner, name, **extra):
    return Videostudio.objects.create(created_by=owner, name=name, location=extra.pop('location', 'Nairobi'),
                                      service_types=extra.pop('service_types', ['other']), **extra)


class Base(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user('owner', 'o@x.com', 'x')
        self.viewer = User.objects.create_user('viewer', 'v@x.com', 'x')
        self.client.force_authenticate(self.viewer)

    def names(self, **params):
        res = self.client.get('/api/video-studios/', params)
        rows = res.data['results'] if isinstance(res.data, dict) else res.data
        return [r['name'] for r in rows]


class SearchTests(Base):
    def test_search_reaches_past_the_first_page(self):
        for i in range(30):
            listing(self.owner, f'Studio {i}')
        listing(self.owner, 'Hope Plumbers', category='home', service_types=['plumbing'], location='Kisumu')
        self.assertEqual(self.names(search='hope'), ['Hope Plumbers'])
        self.assertEqual(self.names(search='kisumu'), ['Hope Plumbers'])
        self.assertEqual(self.names(search='plumb'), ['Hope Plumbers'])          # a tag
        self.assertEqual(self.names(tags='plumbing,electrical'), ['Hope Plumbers'])
        self.assertEqual(self.names(search='zzz'), [])
        self.assertEqual(self.names(search='hope', category='media'), [])        # with the category too

    def test_a_tag_matches_whole(self):
        listing(self.owner, 'Paint Co', service_types=['painting'])
        listing(self.owner, 'Other Co', service_types=['painting_art'])
        self.assertEqual(self.names(tags='painting'), ['Paint Co'])

    def test_verified_first_then_newest(self):
        listing(self.owner, 'Old verified', is_verified=True)
        listing(self.owner, 'New plain')
        self.assertEqual(self.names(), ['Old verified', 'New plain'])


class SafetyTests(Base):
    def test_blocked_and_deactivated_accounts_are_hidden(self):
        listing(self.owner, 'Blocked shop')
        gone = User.objects.create_user('gone', 'g@x.com', 'x', is_deactivated=True)
        listing(gone, 'Gone shop')
        mine = listing(self.viewer, 'My shop')
        self.assertEqual(sorted(self.names()), ['Blocked shop', 'My shop'])
        Block.objects.create(blocker=self.viewer, blocked=self.owner)
        self.assertEqual(self.names(), ['My shop'])
        # Deactivating yourself doesn't hide your own listing from you.
        User.objects.filter(pk=self.viewer.pk).update(is_deactivated=True)
        self.assertIn(mine.name, self.names())

    def test_a_listing_can_be_reported(self):
        s = listing(self.owner, 'Shady shop')
        res = self.client.post('/api/reports/', {'content_type': 'videostudio', 'object_id': s.id, 'reason': 'spam'},
                               format='json')
        self.assertIn(res.status_code, (200, 201))


@override_settings(R2_PUBLIC_BASE='https://pub-test.r2.dev')
class PictureTests(Base):
    def test_pictures_are_our_uploads(self):
        res = self.client.post('/api/video-studios/', {
            'name': 'Pixel', 'location': 'Nairobi', 'service_types': ['design'],
            'logo': 'https://tracker.example/p.png'}, format='json')
        self.assertEqual(res.status_code, 400)
        res = self.client.post('/api/video-studios/', {
            'name': 'Pixel', 'location': 'Nairobi', 'service_types': ['design'],
            'logo': 'https://pub-test.r2.dev/cover_images/l.jpg'}, format='json')
        self.assertEqual(res.status_code, 201)

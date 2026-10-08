"""Nobody edits or deletes what another member posted.

One member makes something; another signs in and tries PATCH and DELETE on
it. Every one must be refused (403/404/405) and the thing must be unchanged.
Covers the viewsets whose protection is code, not a stock permission.

    python manage.py test songs.tests.test_others_content --settings=music.settings_test
"""
from unittest import mock

from django.core.cache import cache
from rest_framework.test import APITestCase

from songs import models as m


class OthersContentTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.owner = m.User.objects.create_user('owner', 'o@x.com', 'pw-12345678', is_email_verified=True)
        self.other = m.User.objects.create_user('other', 'x@x.com', 'pw-12345678', is_email_verified=True)
        self.client.force_authenticate(self.other)

    def _cases(self):
        o = self.owner
        yield 'live event', m.LiveEvent.objects.create(user=o, youtube_url='https://youtu.be/dQw4w9WgXcQ', title='Mine'), \
            '/api/live-events/{pk}/', 'title'
        yield 'media station', m.MediaStation.objects.create(name='Mine', created_by=o), '/api/media-stations/{pk}/', 'name'
        yield 'community category', m.CommunityCategory.objects.create(name='Mine', slug='mine', created_by=o), \
            '/api/community-categories/{slug}/', 'name'
        yield 'service', m.Videostudio.objects.create(name='Mine', location='Nairobi', created_by=o), \
            '/api/video-studios/{pk}/', 'name'
        yield 'publication', m.Publication.objects.create(title='Mine', author=o), '/api/publications/{pk}/', 'title'
        yield 'album', m.Album.objects.create(artist=o, title='Mine'), '/api/albums/{pk}/', 'title'
        yield 'playlist', m.Playlist.objects.create(user=o, name='Mine'), '/api/playlists/{pk}/', 'name'
        yield 'notice', m.Notice.objects.create(title='Mine', body='b', created_by=o), '/api/notices/{pk}/', 'title'
        yield 'product category', m.ProductCategory.objects.create(name='Mine'), '/api/marketplace/categories/{pk}/', 'name'

    @mock.patch('songs.r2.delete', lambda *a, **k: None)
    def test_another_member_cannot_change_or_delete_it(self):
        allowed = []
        for label, obj, url_t, field in self._cases():
            url = url_t.format(pk=obj.pk, slug=getattr(obj, 'slug', ''))
            r = self.client.patch(url, {field: 'Changed by someone else'}, format='json')
            if r.status_code < 400:
                allowed.append(f'{label}: PATCH {r.status_code}')
            r = self.client.delete(url)
            if r.status_code < 400:
                allowed.append(f'{label}: DELETE {r.status_code}')
            if not type(obj).objects.filter(pk=obj.pk).exists():
                allowed.append(f'{label}: deleted')
            elif getattr(type(obj).objects.get(pk=obj.pk), field) != 'Mine':
                allowed.append(f'{label}: changed')
        self.assertEqual(allowed, [])

    def test_the_owner_can_still_edit_their_live_event(self):
        e = m.LiveEvent.objects.create(user=self.owner, youtube_url='https://youtu.be/dQw4w9WgXcQ', title='Mine')
        self.client.force_authenticate(self.owner)
        r = self.client.patch(f'/api/live-events/{e.pk}/', {'title': 'Renamed'}, format='json')
        self.assertEqual(r.status_code, 200)
        e.refresh_from_db()
        self.assertEqual(e.title, 'Renamed')

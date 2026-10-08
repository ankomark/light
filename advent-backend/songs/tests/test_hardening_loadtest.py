"""Hardening found by attacking the load-test stack (loadtest/security_probe.py).

    python manage.py test songs.tests.test_hardening_loadtest --settings=music.settings_test
"""
from unittest import mock

from django.test import override_settings
from rest_framework.test import APITestCase

from songs import r2
from songs.models import SocialPost, User

EVIL = 'https://attacker.example/pixel.png'


class HardeningTests(APITestCase):
    def setUp(self):
        self.me = User.objects.create_user('me', 'me@x.com', 'pw-12345678', is_email_verified=True)
        self.client.force_authenticate(self.me)

    @override_settings(R2_PUBLIC_BASE='', DEBUG=False)
    def test_outside_media_links_refused_even_if_storage_is_not_configured(self):
        r = self.client.post('/api/social-posts/', {'caption': 'hi', 'content_type': 'image',
                                                    'media_file': EVIL}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertFalse(SocialPost.objects.exists())

    @override_settings(R2_PUBLIC_BASE='https://media.example.org')
    def test_our_own_uploads_still_go_through(self):
        r = self.client.post('/api/social-posts/', {
            'caption': 'hi', 'content_type': 'image',
            'media_file': 'https://media.example.org/posts/a.jpg'}, format='json')
        self.assertLess(r.status_code, 300, r.content)

    def test_a_caption_over_the_apps_limit_is_refused(self):
        r = self.client.post('/api/social-posts/', {'caption': 'x' * 2201, 'content_type': 'image'}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_a_huge_body_is_refused_before_it_is_read(self):
        r = self.client.generic('POST', '/api/social-posts/', '{}', content_type='application/json',
                                CONTENT_LENGTH=str(3 * 1024 * 1024))
        self.assertEqual((r.status_code, r.json()['code']), (413, 'too_large'))

    @override_settings(R2_PUBLIC_BASE='https://media.example.org')
    def test_the_server_never_downloads_from_outside_its_storage(self):
        from songs.audio_tags import _fetch
        from songs.video_processing import _head
        with mock.patch('requests.get') as get:
            for fn, args in ((_fetch, (EVIL, 10)), (_head, (EVIL,)),
                             (_fetch, ('http://169.254.169.254/latest/meta-data/', 10))):
                with self.assertRaises(ValueError):
                    fn(*args)
            get.assert_not_called()
        self.assertTrue(r2.is_ours('https://media.example.org/tracks/a.mp3'))

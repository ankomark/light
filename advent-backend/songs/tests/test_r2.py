"""Tests for the R2 presign endpoint and service helpers.

    python manage.py test songs.tests.test_r2 --settings=music.settings_test

Presigning is pure local crypto (SigV4) — no network calls — so these run
against fake credentials.
"""
from urllib.parse import parse_qs, urlparse

from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from songs import r2
from songs.models import User

R2_TEST_SETTINGS = dict(
    R2_ACCESS_KEY_ID='testkey',
    R2_SECRET_ACCESS_KEY='testsecret',
    R2_ENDPOINT='https://testaccount.r2.cloudflarestorage.com',
    R2_BUCKET='test-bucket',
    R2_PUBLIC_BASE='https://pub-test.r2.dev',
)


@override_settings(**R2_TEST_SETTINGS)
class R2SignEndpointTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('uploader', 'u@x.com', 'x')

    def _sign(self, payload):
        self.client.force_authenticate(self.user)
        return self.client.post('/api/upload/r2-sign/', payload, format='json')

    def test_requires_auth(self):
        res = self.client.post('/api/upload/r2-sign/', {'type': 'image', 'content_type': 'image/jpeg'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_presign_shape_and_folder(self):
        res = self._sign({'type': 'avatar', 'content_type': 'image/jpeg', 'filename': 'me.JPG'})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        data = res.json()
        self.assertTrue(data['key'].startswith('avatars/'))
        self.assertTrue(data['key'].endswith('.jpg'))
        self.assertEqual(data['public_url'], f"https://pub-test.r2.dev/{data['key']}")
        self.assertEqual(data['content_type'], 'image/jpeg')
        # The presigned PUT must target our bucket/key and carry SigV4 params.
        parsed = urlparse(data['upload_url'])
        self.assertEqual(parsed.hostname, 'testaccount.r2.cloudflarestorage.com')
        self.assertEqual(parsed.path, f"/test-bucket/{data['key']}")
        qs = parse_qs(parsed.query)
        self.assertIn('X-Amz-Signature', qs)
        self.assertIn('X-Amz-Credential', qs)

    def test_each_type_maps_to_its_folder(self):
        for upload_type, folder in r2.FOLDER_MAP.items():
            ct = {'audio': 'audio/mpeg', 'video': 'video/mp4', 'story_video': 'video/mp4',
                  'chat_audio': 'audio/m4a', 'chat_file': 'application/pdf'}.get(upload_type, 'image/jpeg')
            res = self._sign({'type': upload_type, 'content_type': ct})
            self.assertEqual(res.status_code, status.HTTP_200_OK, upload_type)
            self.assertTrue(res.json()['key'].startswith(folder + '/'), upload_type)

    def test_unknown_type_rejected(self):
        res = self._sign({'type': 'malware', 'content_type': 'application/octet-stream'})
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_content_type_mismatch_rejected(self):
        # A video content type on an image slot must not sign.
        res = self._sign({'type': 'avatar', 'content_type': 'video/mp4'})
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_missing_content_type_rejected(self):
        res = self._sign({'type': 'image'})
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    @override_settings(R2_ACCESS_KEY_ID='')
    def test_unconfigured_returns_500(self):
        res = self._sign({'type': 'image', 'content_type': 'image/jpeg'})
        self.assertEqual(res.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)


@override_settings(**R2_TEST_SETTINGS)
class R2HelperTests(APITestCase):
    def test_is_r2_url(self):
        self.assertTrue(r2.is_r2_url('https://pub-test.r2.dev/avatars/x.jpg'))
        self.assertFalse(r2.is_r2_url('https://res.cloudinary.com/demo/image/upload/x.jpg'))
        self.assertFalse(r2.is_r2_url('avatars/x.jpg'))
        self.assertFalse(r2.is_r2_url(None))

    def test_key_from_url(self):
        self.assertEqual(r2.key_from_url('https://pub-test.r2.dev/chat/files/a.pdf'), 'chat/files/a.pdf')
        self.assertEqual(r2.key_from_url('https://pub-test.r2.dev/a.png?x=1'), 'a.png')
        self.assertIsNone(r2.key_from_url('https://elsewhere.com/a.pdf'))

    @override_settings(R2_PUBLIC_BASE='')
    def test_is_r2_url_unconfigured_never_matches(self):
        self.assertFalse(r2.is_r2_url('https://pub-test.r2.dev/a.jpg'))

    @override_settings(R2_ACCESS_KEY_ID='')
    def test_delete_noop_when_unconfigured(self):
        # Must not raise.
        r2.delete('https://pub-test.r2.dev/avatars/x.jpg')

    def test_extension_inference(self):
        self.assertEqual(r2._extension_for('image/jpeg', 'photo.JPEG'), '.jpeg')
        self.assertEqual(r2._extension_for('video/mp4', None), '.mp4')
        self.assertEqual(r2._extension_for('application/x-unknown-blob', 'no_ext_name'), '')
        # Hostile "extension" is ignored, falls back to content-type.
        self.assertEqual(r2._extension_for('image/png', 'a.<script>alert(1)</script>'), '.png')

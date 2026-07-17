"""Tests for media reference resolution (R2-only; Cloudinary decommissioned).

    python manage.py test songs.tests.test_media_refs --settings=music.settings_test
"""
from django.test import override_settings
from rest_framework.test import APITestCase

from songs import media
from songs.models import Profile, SocialPost, Track, User
from songs.serializers import SocialPostSerializer, TrackSerializer, SimpleUserSerializer

R2_URL = 'https://pub-test.r2.dev/social_media/videos/abc123.mp4'


@override_settings(R2_PUBLIC_BASE='https://pub-test.r2.dev')
class MediaResolveTests(APITestCase):
    def test_absolute_urls_pass_through(self):
        self.assertEqual(media.resolve(R2_URL), R2_URL)

    def test_legacy_public_ids_resolve_to_none(self):
        # Cloudinary is gone: a stray non-URL leftover must render as missing
        # media, not a broken URL.
        self.assertIsNone(media.resolve('audio/song123'))
        self.assertIsNone(media.resolve('profiles/old'))

    def test_legacy_dict_shape(self):
        self.assertEqual(
            media.resolve({'secure_url': 'https://x/y.jpg', 'public_id': 'p'}),
            'https://x/y.jpg',
        )
        self.assertIsNone(media.resolve({'public_id': 'p'}))

    def test_empty_values(self):
        self.assertIsNone(media.resolve(None))
        self.assertIsNone(media.resolve(''))


@override_settings(R2_PUBLIC_BASE='https://pub-test.r2.dev')
class SerializerMediaTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('artist', 'a@x.com', 'x')

    def test_track_audio_url_passthrough(self):
        track = Track.objects.create(
            title='T', artist=self.user,
            audio_file='https://pub-test.r2.dev/audio_uploads/t.mp3',
        )
        data = TrackSerializer(track).data
        self.assertEqual(data['audio_file'], 'https://pub-test.r2.dev/audio_uploads/t.mp3')

    def test_track_legacy_pid_renders_none(self):
        track = Track.objects.create(title='T', artist=self.user, audio_file='audio/old1')
        self.assertIsNone(TrackSerializer(track).data['audio_file'])

    def test_social_post_video_url_passthrough(self):
        post = SocialPost.objects.create(
            user=self.user, content_type='video', media_file=R2_URL,
            video_start_time=1.0, video_end_time=5.0,
        )
        s = SocialPostSerializer()
        # Trim windows must not mangle the URL (clips are trimmed client-side).
        self.assertEqual(s.get_media_url(post), R2_URL)
        self.assertEqual(s.get_optimized_url(post), R2_URL)

    def test_gallery_items(self):
        s = SocialPostSerializer()
        item = s._gallery_item({'url': R2_URL, 'width': 100, 'height': 200})
        self.assertEqual(item['media_url'], R2_URL)
        self.assertEqual(item['optimized_url'], R2_URL)
        self.assertEqual(item['width'], 100)
        # Legacy public_id-keyed items that aren't URLs drop out.
        self.assertIsNone(s._gallery_item({'public_id': 'social/legacy'}))
        # But an absolute URL under the legacy key still works.
        self.assertEqual(s._gallery_item({'public_id': R2_URL})['media_url'], R2_URL)

    def test_profile_picture_url_passthrough(self):
        Profile.objects.create(user=self.user, picture='https://pub-test.r2.dev/avatars/me.jpg')
        data = SimpleUserSerializer(self.user).data
        self.assertEqual(data['profile_picture'], 'https://pub-test.r2.dev/avatars/me.jpg')

    def test_profile_picture_legacy_pid_renders_none(self):
        Profile.objects.create(user=self.user, picture='profiles/old')
        self.assertIsNone(SimpleUserSerializer(self.user).data['profile_picture'])


@override_settings(R2_PUBLIC_BASE='https://pub-test.r2.dev')
class ProfileWriteWithR2UrlTests(APITestCase):
    """Profile create/update now receive the avatar as an R2 URL string (the app
    uploads to R2 first), not a multipart file. Guards the regression that broke
    both flows after the CloudinaryField -> CharField switch."""

    PIC = 'https://pub-test.r2.dev/profile_images/abc.jpg'

    def setUp(self):
        self.user = User.objects.create_user('pt', 'pt@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)

    def test_create_profile_with_url(self):
        res = self.client.post('/api/profiles/create_profile/', {
            'bio': 'hi', 'birth_date': '1990-01-01', 'location': 'NBO', 'picture': self.PIC,
        }, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['picture_url'], self.PIC)
        self.assertEqual(Profile.objects.get(user=self.user).picture, self.PIC)

    def test_update_profile_picture_and_fields(self):
        Profile.objects.create(user=self.user, picture=self.PIC)
        new_pic = self.PIC.replace('abc', 'xyz')
        res = self.client.patch('/api/profiles/update_me/', {
            'location': 'Kisumu', 'picture': new_pic,
        }, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['picture_url'], new_pic)
        self.assertEqual(res.data['location'], 'Kisumu')

    def test_update_without_picture_keeps_existing(self):
        Profile.objects.create(user=self.user, picture=self.PIC)
        res = self.client.patch('/api/profiles/update_me/', {'bio': 'changed'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(Profile.objects.get(user=self.user).picture, self.PIC)

"""Downloaded songs carry their title, artist, album and cover inside the file,
so the phone's music player shows them as they look in the app."""
import io
import struct
from unittest import mock

from django.test import SimpleTestCase, override_settings
from mutagen.id3 import ID3
from mutagen.mp4 import MP4
from rest_framework.test import APITestCase

from songs import audio_tags
from songs.audio_tags import safe_filename, tag_audio, tagged_download
from songs.models import Track, User

R2 = dict(
    R2_ACCESS_KEY_ID='k', R2_SECRET_ACCESS_KEY='s', R2_ENDPOINT='https://r2.example',
    R2_BUCKET='b', R2_PUBLIC_BASE='https://media.example.com',
)
AUDIO_URL = 'https://media.example.com/audio/abc.m4a'
COVER_URL = 'https://media.example.com/covers/c.jpg'


def _atom(kind, body=b''):
    return struct.pack('>I4s', 8 + len(body), kind) + body


def tiny_m4a():
    """The smallest MP4 container mutagen accepts: ftyp + moov(mvhd) + mdat."""
    mvhd = _atom(b'mvhd', b'\x00' * 12 + struct.pack('>II', 1000, 5000) + b'\x00' * 80)
    return (_atom(b'ftyp', b'M4A \x00\x00\x02\x00M4A mp42isom')
            + _atom(b'moov', mvhd) + _atom(b'mdat', b'\x00' * 64))


def tiny_mp3():
    return b'\xff\xfb\x90\x00' + b'\x00' * 400


class TagAudioTests(SimpleTestCase):
    def test_m4a_gets_title_artist_album_and_cover(self):
        out = tag_audio(tiny_m4a(), 'm4a', 'Amazing Grace', 'Choir', 'Hymns', b'\x89PNGcover', 'image/png')
        tags = MP4(io.BytesIO(out)).tags
        self.assertEqual(tags['\xa9nam'], ['Amazing Grace'])
        self.assertEqual(tags['\xa9ART'], ['Choir'])
        self.assertEqual(tags['\xa9alb'], ['Hymns'])
        self.assertEqual(bytes(tags['covr'][0]), b'\x89PNGcover')

    def test_mp3_gets_id3_with_cover(self):
        out = tag_audio(tiny_mp3(), 'mp3', 'Ngoma Yetu', 'Kwaya', None, b'jpegbytes')
        tags = ID3(io.BytesIO(out))
        self.assertEqual(tags['TIT2'].text, ['Ngoma Yetu'])
        self.assertEqual(tags['TPE1'].text, ['Kwaya'])
        self.assertEqual(tags.getall('APIC')[0].data, b'jpegbytes')

    def test_unknown_format_is_left_alone(self):
        self.assertEqual(tag_audio(b'RIFFwave', 'wav', 't', 'a'), b'RIFFwave')

    def test_filename_keeps_the_title_as_written(self):
        self.assertEqual(safe_filename('Amazing Grace (Live)', 'm4a'), 'Amazing Grace (Live).m4a')
        self.assertEqual(safe_filename('Wimbo: Nitaona/Mungu?', 'mp3'), 'Wimbo Nitaona Mungu.mp3')
        self.assertEqual(safe_filename('Café Ñandú', 'mp3'), 'Café Ñandú.mp3')
        self.assertEqual(safe_filename('   ', 'mp3'), 'Song.mp3')


class FakeResp:
    def __init__(self, body, ctype):
        self.body, self.headers = body, {'Content-Type': ctype}

    def raise_for_status(self):
        pass

    def iter_content(self, n):
        yield self.body


@override_settings(**R2)
class TaggedDownloadTests(APITestCase):
    def setUp(self):
        self.artist = User.objects.create_user('tg_artist', 'tga@x.com', 'x')
        self.track = Track.objects.create(
            title='Amazing Grace', artist=self.artist, album='Hymns',
            audio_file=AUDIO_URL, cover_image=COVER_URL,
        )
        self.client_mock = mock.MagicMock()
        patcher = mock.patch.object(audio_tags.r2, '_client', return_value=self.client_mock)
        patcher.start()
        self.addCleanup(patcher.stop)

    def fake_get(self, url, **kw):
        if url == AUDIO_URL:
            return FakeResp(tiny_m4a(), 'audio/mp4')
        if url == COVER_URL:
            return FakeResp(b'\xff\xd8jpeg', 'image/jpeg')
        raise AssertionError(f'unexpected fetch {url}')

    def test_first_download_tags_and_caches_in_r2(self):
        self.client_mock.head_object.side_effect = Exception('404')
        with mock.patch.object(audio_tags.requests, 'get', side_effect=self.fake_get):
            url, filename, tagged = tagged_download(self.track)
        self.assertTrue(tagged)
        self.assertEqual(filename, 'Amazing Grace.m4a')
        self.assertTrue(url.startswith('https://media.example.com/tagged/'))
        body = self.client_mock.put_object.call_args.kwargs['Body']
        tags = MP4(io.BytesIO(body)).tags
        self.assertEqual(tags['\xa9nam'], ['Amazing Grace'])
        self.assertEqual(tags['\xa9ART'], ['tg_artist'])
        self.assertEqual(bytes(tags['covr'][0]), b'\xff\xd8jpeg')

    def test_cached_copy_is_reused(self):
        with mock.patch.object(audio_tags.requests, 'get') as get:
            url, _, tagged = tagged_download(self.track)
        get.assert_not_called()
        self.client_mock.put_object.assert_not_called()
        self.assertTrue(tagged and '/tagged/' in url)

    def test_editing_the_song_makes_a_new_copy(self):
        first = tagged_download(self.track)[0]
        self.track.title = 'Amazing Grace (Live)'
        self.assertNotEqual(tagged_download(self.track)[0], first)

    def test_failure_falls_back_to_the_original(self):
        self.client_mock.head_object.side_effect = Exception('404')
        with mock.patch.object(audio_tags.requests, 'get', side_effect=OSError('down')):
            url, filename, tagged = tagged_download(self.track)
        self.assertEqual((url, tagged), (AUDIO_URL, False))
        self.assertEqual(filename, 'Amazing Grace.m4a')

    def test_never_fetches_urls_outside_our_storage(self):
        self.track.audio_file = 'http://169.254.169.254/latest/meta-data.mp3'
        with mock.patch.object(audio_tags.requests, 'get') as get:
            url, _, tagged = tagged_download(self.track)
        get.assert_not_called()
        self.assertFalse(tagged)

    def test_endpoint_returns_name_and_counts(self):
        self.client.force_authenticate(self.artist)
        with mock.patch.object(audio_tags.requests, 'get', side_effect=self.fake_get):
            res = self.client.get(f'/api/tracks/{self.track.id}/download/').json()
        self.assertEqual(res['filename'], 'Amazing Grace.m4a')
        self.assertTrue(res['tagged'])
        self.track.refresh_from_db()
        self.assertEqual(self.track.downloads, 1)

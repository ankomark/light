"""Song processing and the job queue it runs on.

The FFmpeg tests use a real FFmpeg on a generated tone (skipped where none
is installed); storage is faked, so nothing touches R2."""
import io
import os
import shutil
import subprocess
import tempfile
import unittest
from datetime import timedelta
from unittest import mock

from django.conf import settings
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from songs import audio_processing as ap
from songs import jobs
from songs.models import Job, Track, User


def _have_ffmpeg():
    try:
        return subprocess.run([settings.FFMPEG_BIN, '-version'], capture_output=True).returncode == 0
    except (FileNotFoundError, OSError):
        return False


HAVE_FFMPEG = _have_ffmpeg()
R2 = 'https://media.example.com'


def tone(path, seconds=4, volume=0.05):
    """A quiet 440 Hz tone, so normalisation has something to do."""
    subprocess.run([settings.FFMPEG_BIN, '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
                    '-i', f'sine=frequency=440:duration={seconds}', '-af', f'volume={volume}',
                    '-ac', '2', '-y', path], check=True)


def make_track(**kw):
    artist = kw.pop('artist', None) or User.objects.create_user(f'ap_{User.objects.count()}', f'ap{User.objects.count()}@x.com', 'x')
    return Track.objects.create(title=kw.pop('title', 'Hymn'), artist=artist,
                                audio_file=kw.pop('audio_file', f'{R2}/audio_uploads/a.mp3'), **kw)


# ── the queue ────────────────────────────────────────────────────────────────

class JobQueueTests(TestCase):
    def setUp(self):
        # Migrations seed jobs (the first chart refresh); start from an empty queue.
        Job.objects.all().delete()
        self.calls = []
        jobs._HANDLERS['t_ok'] = (lambda **p: self.calls.append(p), None)
        self.failed = []

        def boom(**p):
            raise RuntimeError('nope')
        jobs._HANDLERS['t_bad'] = (boom, lambda payload, err: self.failed.append(payload))

    def tearDown(self):
        jobs._HANDLERS.pop('t_ok', None)
        jobs._HANDLERS.pop('t_bad', None)

    def test_runs_a_job_once(self):
        jobs.enqueue('t_ok', x=1)
        self.assertTrue(jobs.run_next())
        self.assertFalse(jobs.run_next())
        self.assertEqual(self.calls, [{'x': 1}])
        self.assertEqual(Job.objects.get().status, Job.DONE)

    def test_same_key_while_queued_is_one_job_with_the_latest_payload(self):
        jobs.enqueue('t_ok', key='k', x=1)
        jobs.enqueue('t_ok', key='k', x=2)
        self.assertEqual(Job.objects.count(), 1)
        jobs.run_next()
        self.assertEqual(self.calls, [{'x': 2}])
        jobs.enqueue('t_ok', key='k', x=3)                    # done → new work allowed
        self.assertEqual(Job.objects.count(), 2)

    def test_failures_retry_later_then_give_up_and_call_the_hook(self):
        job = jobs.enqueue('t_bad', max_attempts=2, id=7)
        jobs.run_next()
        job.refresh_from_db()
        self.assertEqual((job.status, job.attempts), (Job.QUEUED, 1))
        self.assertGreater(job.run_after, timezone.now())    # backed off
        self.assertIn('nope', job.last_error)
        self.assertFalse(jobs.run_next())                     # not ready yet
        Job.objects.update(run_after=timezone.now())
        jobs.run_next()
        job.refresh_from_db()
        self.assertEqual((job.status, job.attempts), (Job.FAILED, 2))
        self.assertEqual(self.failed, [{'id': 7}])

    def test_unknown_kind_fails_without_crashing_the_worker(self):
        jobs.enqueue('nobody_handles_this', max_attempts=1)
        self.assertTrue(jobs.run_next())
        self.assertEqual(Job.objects.get().status, Job.FAILED)

    def test_orphaned_running_jobs_are_picked_up_again(self):
        job = jobs.enqueue('t_ok')
        Job.objects.filter(pk=job.pk).update(status=Job.RUNNING, locked_at=timezone.now() - timedelta(hours=1))
        self.assertEqual(jobs.requeue_stale(), 1)
        self.assertTrue(jobs.run_next())
        self.assertEqual(Job.objects.get().status, Job.DONE)

    def test_future_jobs_wait(self):
        jobs.enqueue('t_ok', run_after=timezone.now() + timedelta(minutes=5))
        self.assertFalse(jobs.run_next())


# ── what queues processing ───────────────────────────────────────────────────

class QueueingTests(TestCase):
    def jobs_for(self, track):
        return Job.objects.filter(kind='process_track', key=f'track:{track.pk}', status=Job.QUEUED)

    def test_a_new_song_is_queued(self):
        with self.captureOnCommitCallbacks(execute=True):
            track = make_track()
        self.assertEqual(self.jobs_for(track).count(), 1)
        self.assertEqual(track.processing_status, Track.PROCESSING_PENDING)

    def test_replacing_the_audio_drops_old_versions_and_queues_again(self):
        track = make_track()
        Track.objects.filter(pk=track.pk).update(
            processing_status=Track.PROCESSING_READY, audio_high=f'{R2}/tracks/1/v/256.m4a',
            cover_small=f'{R2}/tracks/1/v/cover_200.jpg', waveform=[1],
            processed_source=ap.source_of(track))
        Job.objects.all().delete()
        track.refresh_from_db()
        track.audio_file = f'{R2}/audio_uploads/b.mp3'
        with self.captureOnCommitCallbacks(execute=True):
            track.save()
        track.refresh_from_db()
        self.assertEqual((track.audio_high, track.waveform, track.processing_status), ('', None, Track.PROCESSING_PENDING))
        self.assertTrue(track.cover_small)                    # cover unchanged, kept
        self.assertEqual(self.jobs_for(track).count(), 1)

    def test_a_new_cover_only_drops_the_cover_sizes(self):
        track = make_track(cover_image=f'{R2}/c1.jpg')
        Track.objects.filter(pk=track.pk).update(
            processing_status=Track.PROCESSING_READY, audio_high=f'{R2}/tracks/1/v/256.m4a',
            cover_small=f'{R2}/x.jpg', processed_source=ap.source_of(track))
        track.refresh_from_db()
        track.cover_image = f'{R2}/c2.jpg'
        track.save()
        track.refresh_from_db()
        self.assertEqual((track.cover_small, track.audio_high), ('', f'{R2}/tracks/1/v/256.m4a'))

    def test_a_title_edit_on_a_processed_song_queues_nothing(self):
        track = make_track()
        Track.objects.filter(pk=track.pk).update(processing_status=Track.PROCESSING_READY,
                                                 processed_source=ap.source_of(track))
        Job.objects.all().delete()
        track.refresh_from_db()
        track.title = 'Renamed'
        with self.captureOnCommitCallbacks(execute=True):
            track.save()
        self.assertEqual(Job.objects.count(), 0)

    def test_deleting_a_song_deletes_its_processed_files(self):
        track = make_track()
        pk = track.pk
        with mock.patch('songs.r2.delete_prefix') as delete_prefix:
            track.delete()
        delete_prefix.assert_called_once_with(f'tracks/{pk}/')


# ── FFmpeg ───────────────────────────────────────────────────────────────────

@unittest.skipUnless(HAVE_FFMPEG, 'FFmpeg not installed')
class FfmpegTests(TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.src = os.path.join(self.tmp, 'in.wav')
        tone(self.src)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_quiet_song_is_measured_normalised_and_encoded_three_ways(self):
        before = ap.measure_loudness(self.src)
        self.assertLess(float(before['input_i']), -25)       # it really is quiet
        out = ap.encode_tiers(self.src, self.tmp, ap.loudness_filter(before))
        self.assertEqual(set(out), {'audio_low', 'audio_standard', 'audio_high'})
        sizes = [os.path.getsize(out[f]) for f in ('audio_low', 'audio_standard', 'audio_high')]
        self.assertEqual(sizes, sorted(sizes))                # 64 < 128 < 256 kbps
        after = float(ap.measure_loudness(out['audio_high'])['input_i'])
        self.assertAlmostEqual(after, ap.TARGET_LUFS, delta=1.5)
        self.assertAlmostEqual(ap.duration_ms(out['audio_high']), 4000, delta=150)
        with open(out['audio_low'], 'rb') as fh:
            head = fh.read(64)
        self.assertIn(b'ftyp', head)                          # an .m4a
        self.assertIn(b'moov', open(out['audio_low'], 'rb').read(4096))   # faststart: index up front

    def test_waveform_is_100_points_scaled_to_the_loudest(self):
        points = ap.waveform(self.src)
        self.assertEqual(len(points), ap.WAVEFORM_POINTS)
        self.assertEqual(max(points), 1.0)
        self.assertTrue(all(0 <= p <= 1 for p in points))

    def test_silence_is_left_alone(self):
        silent = os.path.join(self.tmp, 'silent.wav')
        subprocess.run([settings.FFMPEG_BIN, '-loglevel', 'error', '-f', 'lavfi', '-i',
                        'anullsrc=r=44100:cl=stereo', '-t', '2', '-y', silent], check=True)
        self.assertIsNone(ap.measure_loudness(silent))
        self.assertEqual(ap.loudness_filter(None), 'anull')

    def test_not_audio_is_an_error(self):
        junk = os.path.join(self.tmp, 'junk.mp3')
        with open(junk, 'wb') as fh:
            fh.write(b'not audio at all' * 100)
        with self.assertRaises(ap.ProcessingError):
            ap.encode_tiers(junk, self.tmp, 'anull')


class CoverTests(TestCase):
    def test_cover_sizes_are_square_jpegs(self):
        from PIL import Image
        buf = io.BytesIO()
        Image.new('RGB', (1200, 900), 'red').save(buf, 'PNG')
        out = ap.cover_sizes(buf.getvalue())
        for field, size in ap.COVER_SIZES:
            img = Image.open(io.BytesIO(out[field]))
            self.assertEqual((img.format, img.size), ('JPEG', (size, size)))


# ── the whole job, storage faked ─────────────────────────────────────────────

@unittest.skipUnless(HAVE_FFMPEG, 'FFmpeg not installed')
class ProcessTrackTests(TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        wav = os.path.join(self.tmp, 'in.wav')
        tone(wav, seconds=3)
        with open(wav, 'rb') as fh:
            self.audio = fh.read()
        from PIL import Image
        buf = io.BytesIO()
        Image.new('RGB', (800, 800), 'blue').save(buf, 'JPEG')
        self.cover = buf.getvalue()
        self.uploaded = {}

        def fetch(url, cap):
            return (self.cover if url.endswith('.jpg') else self.audio), ''

        def put_file(key, path, ct):
            self.uploaded[key] = os.path.getsize(path)
            return f'{R2}/{key}'

        def put_bytes(key, data, ct):
            self.uploaded[key] = len(data)
            return f'{R2}/{key}'

        patches = [
            mock.patch('songs.r2.is_configured', return_value=True),
            mock.patch('songs.r2.is_r2_url', side_effect=lambda u: bool(u) and u.startswith(R2)),
            mock.patch('songs.r2.key_from_url', side_effect=lambda u: u[len(R2) + 1:] if u and u.startswith(R2) else None),
            mock.patch('songs.audio_processing._fetch', side_effect=fetch),
            mock.patch('songs.r2.put_file', side_effect=put_file),
            mock.patch('songs.r2.put_bytes', side_effect=put_bytes),
            mock.patch('songs.r2.delete_prefix'),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        from songs import r2
        self.delete_prefix = r2.delete_prefix

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_processes_a_song_end_to_end(self):
        track = make_track(cover_image=f'{R2}/cover_images/c.jpg')
        ap.process_track(track.pk)
        track.refresh_from_db()
        self.assertEqual(track.processing_status, Track.PROCESSING_READY)
        for f in ('audio_low', 'audio_standard', 'audio_high', 'cover_small', 'cover_medium'):
            self.assertTrue(getattr(track, f).startswith(f'{R2}/tracks/{track.pk}/'), f)
        self.assertEqual(len(track.waveform), ap.WAVEFORM_POINTS)
        self.assertAlmostEqual(track.duration_ms, 3000, delta=150)
        self.assertLess(track.loudness_lufs, -25)
        self.assertEqual(len(self.uploaded), 5)

        self.uploaded.clear()
        ap.process_track(track.pk)                          # already done: nothing
        self.assertEqual(self.uploaded, {})

    def test_reprocessing_after_a_new_upload_deletes_the_old_version(self):
        track = make_track()
        ap.process_track(track.pk)
        track.refresh_from_db()
        old = track.audio_high.rsplit('/', 1)[0][len(R2) + 1:] + '/'
        track.audio_file = f'{R2}/audio_uploads/new.mp3'
        track.save()
        ap.process_track(track.pk)
        track.refresh_from_db()
        new = track.audio_high.rsplit('/', 1)[0][len(R2) + 1:] + '/'
        self.assertNotEqual(old, new)
        # Everything of this song's except the new version (the old one included).
        self.delete_prefix.assert_called_with(f'tracks/{track.pk}/', keep=new)
        self.assertTrue(old.startswith(f'tracks/{track.pk}/') and not old.startswith(new))

    def test_a_song_replaced_mid_processing_throws_the_work_away(self):
        track = make_track()
        real_encode = ap.encode_tiers

        def encode_then_replace(*a, **kw):
            out = real_encode(*a, **kw)
            Track.objects.filter(pk=track.pk).update(audio_file=f'{R2}/audio_uploads/other.mp3')
            return out
        with mock.patch('songs.audio_processing.encode_tiers', side_effect=encode_then_replace):
            ap.process_track(track.pk)
        track.refresh_from_db()
        self.assertEqual((track.processing_status, track.audio_high), (Track.PROCESSING_PENDING, ''))
        self.assertTrue(self.delete_prefix.called)

    def test_failing_for_good_marks_the_song_failed(self):
        track = make_track()
        Job.objects.all().delete()
        jobs.enqueue('process_track', key=f'track:{track.pk}', max_attempts=1, track_id=track.pk)
        with mock.patch('songs.audio_processing.encode_tiers', side_effect=ap.ProcessingError('bad file')):
            jobs.run_next()
        track.refresh_from_db()
        self.assertEqual(track.processing_status, Track.PROCESSING_FAILED)

    def test_only_our_storage_is_fetched(self):
        track = make_track(audio_file='https://evil.example/a.mp3')
        with self.assertRaises(ap.ProcessingError):
            ap.process_track(track.pk)


class ApiTests(APITestCase):
    def test_versions_on_rows_waveform_only_on_the_song(self):
        track = make_track()
        Track.objects.filter(pk=track.pk).update(
            processing_status=Track.PROCESSING_READY, audio_low=f'{R2}/tracks/1/v/64.m4a',
            audio_standard=f'{R2}/tracks/1/v/128.m4a', audio_high=f'{R2}/tracks/1/v/256.m4a',
            cover_small=f'{R2}/tracks/1/v/cover_200.jpg', waveform=[0.5, 1])
        self.client.force_authenticate(track.artist)
        row = self.client.get('/api/tracks/').json()['results'][0]
        self.assertEqual(row['audio_low'], f'{R2}/tracks/1/v/64.m4a')
        self.assertEqual(row['cover_small'], f'{R2}/tracks/1/v/cover_200.jpg')
        self.assertNotIn('waveform', row)
        one = self.client.get(f'/api/tracks/{track.pk}/').json()
        self.assertEqual((one['waveform'], one['processing_status']), ([0.5, 1], 'ready'))

    def test_unprocessed_rows_have_no_versions(self):
        track = make_track()
        self.client.force_authenticate(track.artist)
        row = self.client.get('/api/tracks/').json()['results'][0]
        self.assertIsNone(row['audio_low'])
        self.assertEqual(row['processing_status'], 'pending')

    def test_processing_fields_cannot_be_written(self):
        track = make_track()
        self.client.force_authenticate(track.artist)
        self.client.patch(f'/api/tracks/{track.pk}/', {'processing_status': 'ready', 'waveform': [1]}, format='json')
        track.refresh_from_db()
        self.assertEqual((track.processing_status, track.waveform), ('pending', None))

    def test_download_picks_the_requested_quality(self):
        track = make_track()
        Track.objects.filter(pk=track.pk).update(audio_standard=f'{R2}/tracks/1/v/128.m4a')
        self.client.force_authenticate(track.artist)
        with mock.patch('songs.audio_tags.r2.is_configured', return_value=False):
            std = self.client.get(f'/api/tracks/{track.pk}/download/?quality=standard').json()
            orig = self.client.get(f'/api/tracks/{track.pk}/download/').json()
            high = self.client.get(f'/api/tracks/{track.pk}/download/?quality=high').json()
        self.assertEqual(std['download_url'], f'{R2}/tracks/1/v/128.m4a')
        self.assertEqual(orig['download_url'], f'{R2}/audio_uploads/a.mp3')
        self.assertEqual(high['download_url'], f'{R2}/audio_uploads/a.mp3')   # not made yet: original


class DeletePrefixTests(TestCase):
    def test_keeps_the_current_version(self):
        from songs import r2
        client = mock.Mock()
        client.list_objects_v2.return_value = {'Contents': [
            {'Key': 'tracks/5/old/64.m4a'}, {'Key': 'tracks/5/new/64.m4a'}], 'IsTruncated': False}
        with mock.patch.object(r2, 'is_configured', return_value=True), \
                mock.patch.object(r2, '_client', return_value=client):
            r2.delete_prefix('tracks/5/', keep='tracks/5/new/')
        client.delete_objects.assert_called_once()
        deleted = client.delete_objects.call_args.kwargs['Delete']['Objects']
        self.assertEqual(deleted, [{'Key': 'tracks/5/old/64.m4a'}])


class WorkerCommandTests(TestCase):
    def test_once_drains_ready_jobs_and_exits(self):
        from django.core.management import call_command
        Job.objects.all().delete()   # the migration-seeded chart refresh
        done = []
        jobs._HANDLERS['t_cmd'] = (lambda **p: done.append(p['n']), None)
        self.addCleanup(jobs._HANDLERS.pop, 't_cmd', None)
        for n in range(3):
            jobs.enqueue('t_cmd', n=n)
        out = io.StringIO()
        call_command('run_worker', '--once', stdout=out)
        self.assertEqual(done, [0, 1, 2])
        self.assertIn('3 job(s)', out.getvalue())
        self.assertTrue(all(j.status == Job.DONE for j in Job.objects.filter(kind='t_cmd')))


class WaveformEndpointTests(APITestCase):
    def test_waveform_when_ready_null_before_404_when_gone(self):
        track = make_track()
        self.client.force_authenticate(track.artist)
        self.assertIsNone(self.client.get(f'/api/tracks/{track.pk}/waveform/').json()['waveform'])
        Track.objects.filter(pk=track.pk).update(waveform=[0.2, 1])
        res = self.client.get(f'/api/tracks/{track.pk}/waveform/')
        self.assertEqual(res.json()['waveform'], [0.2, 1])
        self.assertIn('max-age', res['Cache-Control'])
        Track.objects.filter(pk=track.pk).update(is_removed=True)
        self.assertEqual(self.client.get(f'/api/tracks/{track.pk}/waveform/').status_code, 404)

"""Turn an uploaded song into what the app streams.

Run by the job worker (`manage.py run_worker`) for every new or replaced
upload; the app plays the original file until this finishes. For each song:

  1. measure its loudness (EBU R128) and normalise it to -14 LUFS, so every
     song plays at the same volume — no reaching for the volume button
     between a quiet choir recording and a loud studio master;
  2. encode three AAC versions (.m4a, "faststart" so playback begins before
     the whole file arrives): 64 kbps for Data Saver, 128 standard, 256 high;
  3. read its length and a ~100-point waveform;
  4. make 200px and 600px covers for lists and the player.

Everything goes to R2 under tracks/<id>/<version>/, where <version> changes
whenever the audio or cover is replaced (old versions are deleted once the
new one is live), so each file can be cached forever.

Needs FFmpeg (settings.FFMPEG_BIN; `apt install ffmpeg` on the server) and R2.
"""
import hashlib
import io
import json
import logging
import os
import re
import subprocess
import tempfile
from array import array

from django.conf import settings

from . import media, r2
from .audio_tags import MAX_AUDIO_BYTES, MAX_COVER_BYTES, _fetch
from .jobs import handler
from .models import Track

logger = logging.getLogger(__name__)

TARGET_LUFS = -14.0
# Peaks stay below this after the gain (headroom for the AAC encoder).
PEAK_CEILING = -2.0
# A near-silent upload isn't pushed all the way up: its hiss would be too.
MAX_BOOST_DB = 15.0
TIERS = [('audio_low', 64), ('audio_standard', 128), ('audio_high', 256)]
# FFmpeg's AAC coder per tier: the slow, careful one ('twoloop') where every
# bit counts (64 kbps); 'fast' — about twice as quick, no audible difference —
# where there are bits to spare.
AAC_CODER = {64: 'twoloop', 128: 'fast', 256: 'fast'}
WAVEFORM_POINTS = 100
# The spectrum visualizer (see spectrum()): 16 bands, 10 times a second —
# about 50 KB for a 4-minute song, fetched once when Now Playing opens it.
SPECTRUM_FPS = 10
SPECTRUM_BANDS = 16
SPECTRUM_RATE = 11025          # enough for the top band (5 kHz)
SPECTRUM_WINDOW = 2048         # ~0.19 s: fine enough for the lowest band
SPECTRUM_LOW_HZ = 40
SPECTRUM_HIGH_HZ = 5000
SPECTRUM_RANGE_DB = 40         # a band's bar spans its loudest 40 dB
SPECTRUM_BOOST_DB = 30         # at most this much lift for a faint band
COVER_SIZES = [('cover_small', 200), ('cover_medium', 600)]
FFMPEG_TIMEOUT = 15 * 60


class ProcessingError(Exception):
    pass


def _ffmpeg(args, timeout=FFMPEG_TIMEOUT, want_stdout=False):
    cmd = [settings.FFMPEG_BIN, '-hide_banner', '-nostdin', *args]
    try:
        res = subprocess.run(cmd, capture_output=True, timeout=timeout, check=False)
    except FileNotFoundError as exc:
        raise ProcessingError(f'FFmpeg not found at {settings.FFMPEG_BIN!r}') from exc
    except subprocess.TimeoutExpired as exc:
        raise ProcessingError('FFmpeg timed out') from exc
    stderr = res.stderr.decode('utf-8', 'replace')
    if res.returncode != 0:
        raise ProcessingError(f'FFmpeg failed ({res.returncode}): {stderr[-1500:]}')
    return (res.stdout if want_stdout else None), stderr


def measure_loudness(path):
    """The song's integrated loudness (EBU R128, LUFS) and sample peak (dBFS),
    as {'input_i': str, 'input_tp': str}; None for silence.

    FFmpeg's ebur128 filter: the same measurement loudnorm makes, several times
    faster (loudnorm resamples everything to 192 kHz first)."""
    _, stderr = _ffmpeg(['-nostats', '-i', path, '-vn', '-af', 'ebur128=peak=sample:framelog=quiet',
                         '-f', 'null', '-'])
    i = re.findall(r'I:\s+(-?[\d.]+|-inf) LUFS', stderr)
    peak = re.findall(r'Peak:\s+(-?[\d.]+|-inf) dBFS', stderr)
    if not i or i[-1] == '-inf' or float(i[-1]) <= -69.0:   # the gate's floor: silence
        return None
    return {'input_i': i[-1], 'input_tp': peak[-1] if peak and peak[-1] != '-inf' else '-99'}


def gain_db(measured):
    """The linear gain to the target: as much as the peaks allow, and never
    more than MAX_BOOST_DB up."""
    loud, peak = float(measured['input_i']), float(measured['input_tp'])
    return min(TARGET_LUFS - loud, PEAK_CEILING - peak, MAX_BOOST_DB)


def loudness_filter(measured):
    """A plain linear gain (keeps the dynamics intact); nothing for silence."""
    if not measured:
        return 'anull'
    return f'volume={gain_db(measured):.2f}dB'


def encode_tiers(src, out_dir, filt):
    """Encode every tier, the gain applied to each. Returns {field: path}.

    One FFmpeg process per tier, side by side (the AAC encoder uses one core
    each), with the quicker coder where the bitrate allows: a 4-minute song
    went from ~30 s of encoding to ~9 s on the test box."""
    procs, outputs = [], {}
    for field, kbps in TIERS:
        path = os.path.join(out_dir, f'{kbps}.m4a')
        cmd = [settings.FFMPEG_BIN, '-hide_banner', '-nostdin', '-i', src, '-vn',
               '-af', f'{filt},aresample=44100', '-c:a', 'aac', '-aac_coder', AAC_CODER.get(kbps, 'twoloop'),
               '-b:a', f'{kbps}k', '-ac', '2',
               '-map_metadata', '-1', '-movflags', '+faststart', '-y', path]
        try:
            procs.append(subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE))
        except FileNotFoundError as exc:
            for p in procs:
                p.kill()
            raise ProcessingError(f'FFmpeg not found at {settings.FFMPEG_BIN!r}') from exc
        outputs[field] = path
    errors = []
    for p in procs:
        try:
            _, err = p.communicate(timeout=FFMPEG_TIMEOUT)
        except subprocess.TimeoutExpired:
            p.kill()
            errors.append('FFmpeg timed out')
            continue
        if p.returncode != 0:
            errors.append(f'FFmpeg failed ({p.returncode}): {err.decode("utf-8", "replace")[-1500:]}')
    if errors:
        raise ProcessingError(errors[0])
    return outputs


def waveform(src, points=WAVEFORM_POINTS):
    """Peak level per slice of the song, scaled so the loudest slice is 1."""
    pcm, _ = _ffmpeg(['-i', src, '-vn', '-ac', '1', '-ar', '4000', '-f', 's16le', '-acodec', 'pcm_s16le', '-'],
                     want_stdout=True)
    samples = array('h')
    samples.frombytes(pcm[: len(pcm) - (len(pcm) % 2)])
    if not samples:
        return []
    step = max(1, len(samples) // points)
    peaks = [max(abs(s) for s in samples[i:i + step]) for i in range(0, step * points, step) if samples[i:i + step]]
    top = max(peaks) or 1
    return [round(p / top, 3) for p in peaks]


def spectrum(src, fps=SPECTRUM_FPS, bands=SPECTRUM_BANDS):
    """The spectrum visualizer's data: how strong each of `bands` frequency
    bands (40 Hz bass → 5 kHz treble, spaced as the ear hears them) is,
    `fps` times a second, each 0..255. None for silence or a tiny clip.

    Each band is measured against its own loud moments, so the treble bars
    move too (music has far less energy up there than in the bass), but never
    boosted more than SPECTRUM_BOOST_DB past the song as a whole — so a
    quiet band stays quiet and a hushed passage looks hushed.

    {'v': 1, 'fps', 'bands', 'frames', 'data': base64 of frames×bands bytes}"""
    import base64

    import numpy as np

    pcm, _ = _ffmpeg(['-i', src, '-vn', '-ac', '1', '-ar', str(SPECTRUM_RATE), '-f', 's16le',
                      '-acodec', 'pcm_s16le', '-'], want_stdout=True)
    x = np.frombuffer(pcm[: len(pcm) - (len(pcm) % 2)], dtype='<i2').astype(np.float32) / 32768.0
    hop = SPECTRUM_RATE // fps
    frames = x.size // hop
    if frames < fps:                                   # under a second
        return None
    win = SPECTRUM_WINDOW
    x = np.concatenate([np.zeros(win // 2, np.float32), x, np.zeros(win, np.float32)])  # centred frames
    window = np.hanning(win).astype(np.float32)
    freqs = np.fft.rfftfreq(win, 1.0 / SPECTRUM_RATE)
    edges = np.geomspace(SPECTRUM_LOW_HZ, SPECTRUM_HIGH_HZ, bands + 1)
    # Each band's bins (at least one, so the narrow bass bands aren't empty).
    bins = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        sel = np.where((freqs >= lo) & (freqs < hi))[0]
        bins.append(sel if sel.size else np.array([int(np.argmin(np.abs(freqs - (lo + hi) / 2)))]))

    energy = np.empty((frames, bands), np.float32)
    offsets = np.arange(win)
    for start in range(0, frames, 512):                # in chunks: a long song stays small in memory
        idx = (np.arange(start, min(frames, start + 512)) * hop)[:, None] + offsets[None, :]
        power = np.abs(np.fft.rfft(x[idx] * window, axis=1)) ** 2
        for b, sel in enumerate(bins):
            energy[start:start + len(idx), b] = power[:, sel].mean(axis=1)

    db = 10 * np.log10(energy + 1e-12)
    overall = float(np.percentile(db, 98))
    if overall < -60:                                  # silence (normalised music sits far above)
        return None
    ref = np.maximum(np.percentile(db, 98, axis=0), overall - SPECTRUM_BOOST_DB)
    level = np.clip((db - ref + SPECTRUM_RANGE_DB) / SPECTRUM_RANGE_DB, 0, 1)
    data = np.round(level * 255).astype(np.uint8)
    return {'v': 1, 'fps': fps, 'bands': bands, 'frames': frames,
            'data': base64.b64encode(data.tobytes()).decode('ascii')}


def duration_ms(path):
    import mutagen
    try:
        length = mutagen.File(path).info.length
    except Exception:
        return None
    ms = int(round(length * 1000))
    return ms if 1000 <= ms <= 4 * 3600 * 1000 else None


def cover_sizes(data):
    """{field: jpeg bytes} for each cover size (square crop from the centre)."""
    from PIL import Image, ImageOps
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img).convert('RGB')
    out = {}
    for field, size in COVER_SIZES:
        thumb = ImageOps.fit(img, (size, size), Image.LANCZOS)
        buf = io.BytesIO()
        thumb.save(buf, 'JPEG', quality=82, optimize=True, progressive=True)
        out[field] = buf.getvalue()
    return out


def source_of(track):
    """What processing is made from; a change means processing again."""
    return f'{track.audio_file or ""}|{track.cover_image or ""}'


@handler('process_track', on_failure=lambda payload, error: Track.objects.filter(
    pk=payload.get('track_id')).update(processing_status=Track.PROCESSING_FAILED))
def process_track(track_id):
    track = Track.objects.filter(pk=track_id).first()
    if track is None or track.is_removed:
        return
    source = source_of(track)
    if track.processing_status == Track.PROCESSING_READY and track.processed_source == source:
        return  # already done for this upload
    if not r2.is_configured():
        raise ProcessingError('R2 is not configured')
    audio_url = media.resolve(track.audio_file)
    # Only our own storage is fetched server-side (see audio_tags).
    if not audio_url or not r2.is_r2_url(audio_url):
        raise ProcessingError(f'audio is not in our storage: {audio_url!r}')

    version = hashlib.sha1(source.encode('utf-8')).hexdigest()[:12]
    prefix = f'tracks/{track.id}/{version}/'
    fields = {}

    with tempfile.TemporaryDirectory(prefix='track-') as tmp:
        data, _ = _fetch(audio_url, MAX_AUDIO_BYTES)
        src = os.path.join(tmp, 'original')
        with open(src, 'wb') as fh:
            fh.write(data)
        del data

        measured = measure_loudness(src)
        tiers = encode_tiers(src, tmp, loudness_filter(measured))
        for field, path in tiers.items():
            fields[field] = r2.put_file(f'{prefix}{os.path.basename(path)}', path, 'audio/mp4')
        fields['waveform'] = waveform(tiers['audio_low'])
        fields['spectrum'] = _put_spectrum(prefix, tiers['audio_low'])
        length = duration_ms(tiers['audio_high'])
        if length:
            fields['duration_ms'] = length
        fields['loudness_lufs'] = float(measured['input_i']) if measured else None

    cover_url = media.resolve(track.cover_image) if track.cover_image else None
    if cover_url and r2.is_r2_url(cover_url):
        try:
            data, _ = _fetch(cover_url, MAX_COVER_BYTES)
            for field, jpeg in cover_sizes(data).items():
                size = dict(COVER_SIZES)[field]
                fields[field] = r2.put_bytes(f'{prefix}cover_{size}.jpg', jpeg, 'image/jpeg')
        except Exception as exc:  # a bad cover mustn't fail the song
            logger.warning('cover sizes failed for track %s: %s', track.id, exc)

    # Save only if the song wasn't replaced while we worked; if it was, its own
    # job is already queued and these files are dropped.
    updated = Track.objects.filter(pk=track.id, audio_file=track.audio_file, cover_image=track.cover_image).update(
        processing_status=Track.PROCESSING_READY, processed_source=source, **fields)
    if not updated:
        r2.delete_prefix(prefix)
        return
    # Earlier versions of this song (a replaced upload or cover). Found by
    # folder, not from the old URLs: replacing the audio clears those at once.
    r2.delete_prefix(f'tracks/{track.id}/', keep=prefix)


def _put_spectrum(prefix, path):
    """Upload the song's spectrum next to its audio; '' when it has none. The
    visualizer is decoration: a failure here never fails the song."""
    try:
        spec = spectrum(path)
    except Exception as exc:
        logger.warning('spectrum failed for %s: %s', prefix, exc)
        return ''
    if not spec:
        return ''
    return r2.put_bytes(f'{prefix}spectrum.json', json.dumps(spec, separators=(',', ':')).encode('ascii'),
                        'application/json')


@handler('track_spectrum')
def track_spectrum(track_id):
    """The spectrum for a song processed before the visualizer existed: from
    its 64 kbps version, into the same folder. (manage.py backfill_spectrum)"""
    track = Track.objects.filter(pk=track_id, processing_status=Track.PROCESSING_READY).first()
    if track is None or track.is_removed or track.spectrum or not track.audio_low:
        return
    low = media.resolve(track.audio_low)
    if not low or not r2.is_r2_url(low):
        return
    key = r2.key_from_url(low)
    if not key:
        return
    prefix = key.rsplit('/', 1)[0] + '/'
    with tempfile.TemporaryDirectory(prefix='spectrum-') as tmp:
        data, _ = _fetch(low, MAX_AUDIO_BYTES)
        path = os.path.join(tmp, 'low.m4a')
        with open(path, 'wb') as fh:
            fh.write(data)
        url = _put_spectrum(prefix, path)
    # Only if the song wasn't reprocessed meanwhile (that makes its own).
    if url:
        Track.objects.filter(pk=track.id, audio_low=track.audio_low, spectrum='').update(spectrum=url)


def queue_processing(track):
    from .jobs import enqueue
    return enqueue('process_track', key=f'track:{track.pk}', track_id=track.pk)

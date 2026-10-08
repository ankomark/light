"""Videos that start at once: the MP4 index ("moov") before the pictures.

A phone can begin playing an MP4 as soon as it has the file's index. Written
at the end — Android's encoder does that, so do most camera clips — the whole
file has to arrive before the first frame, and on a slow connection a feed
video sits black for seconds. The app's compressor already writes the index
first (patches/react-native-video-trim); this catches everything else: a trim
without the compress, the "compressing didn't help" fallback, builds without
the native module, and everything uploaded before.

    enqueue('faststart_video', key=f'post:{id}', post_id=id)

The job reads the first bytes of the file; if the index is already first it
stops there. Otherwise FFmpeg rewrites the file with the index first (a copy,
not a re-encode: seconds, no quality lost) under a new name — uploads are
cached as immutable, so the old name can't be overwritten — and the post is
pointed at it. Needs FFmpeg on the worker, as the audio processing does.
"""
import logging
import os
import struct
import tempfile

import requests

from . import media, r2
from .audio_processing import ProcessingError, _ffmpeg
from .jobs import handler
from .models import SocialPost

logger = logging.getLogger(__name__)

HEAD_BYTES = 64 * 1024          # enough to see the boxes before the pictures
MAX_VIDEO_BYTES = 300 * 1024 * 1024
FETCH_TIMEOUT = 60
FAST_MARK = '-fast'
# The container is kept: an iPhone's .mov stays a .mov.
CONTENT_TYPES = {'.mov': 'video/quicktime', '.m4v': 'video/x-m4v'}


def _is_rewritten(url):
    return os.path.splitext(url.split('?')[0])[0].endswith(FAST_MARK)


def index_first(head):
    """Whether these first bytes of an MP4/MOV show the index ('moov') before
    the pictures ('mdat'). None when it can't tell (not an MP4, too short)."""
    pos = 0
    while pos + 8 <= len(head):
        size, kind = struct.unpack('>I4s', head[pos:pos + 8])
        if size == 1:
            if pos + 16 > len(head):
                return None
            size = struct.unpack('>Q', head[pos + 8:pos + 16])[0]
        if kind == b'moov':
            return True
        if kind == b'mdat':
            return False
        if size < 8:            # 0 = "to the end of the file"; < 8 is not a box
            return None
        pos += size
    return None


def _head(url):
    from . import r2
    r2.require_ours(url)          # never an outside or internal address
    resp = requests.get(url, headers={'Range': f'bytes=0-{HEAD_BYTES - 1}'}, timeout=FETCH_TIMEOUT,
                        allow_redirects=False)
    resp.raise_for_status()
    return resp.content[:HEAD_BYTES]


def _download(url, path):
    from . import r2
    r2.require_ours(url)
    with requests.get(url, timeout=FETCH_TIMEOUT, stream=True, allow_redirects=False) as resp:
        resp.raise_for_status()
        got = 0
        with open(path, 'wb') as fh:
            for chunk in resp.iter_content(256 * 1024):
                got += len(chunk)
                if got > MAX_VIDEO_BYTES:
                    raise ProcessingError('video too large to rewrite')
                fh.write(chunk)


def _is_hevc(path):
    try:
        _, info = _ffmpeg(['-i', path, '-map', '0:v:0?', '-c', 'copy', '-t', '0', '-f', 'null', '-'])
    except ProcessingError:
        return False
    return 'Video: hevc' in info


@handler('faststart_video')
def faststart_video(post_id):
    post = SocialPost.objects.filter(pk=post_id, content_type='video').first()
    if post is None or post.is_removed or not post.media_file:
        return
    url = media.resolve(post.media_file)
    # Only our own storage is fetched server-side; done once already.
    if not url or not r2.is_r2_url(url) or _is_rewritten(url):
        return
    if not r2.is_configured():
        raise ProcessingError('R2 is not configured')
    if index_first(_head(url)) is not False:
        return                  # already starts at once (or not an MP4 we know)

    key = r2.key_from_url(url)
    stem, ext = os.path.splitext(key)
    ext = ext.lower() if ext.lower() in ('.mp4', '.mov', '.m4v') else '.mp4'
    with tempfile.TemporaryDirectory(prefix='video-') as tmp:
        src = os.path.join(tmp, f'in{ext}')
        out = os.path.join(tmp, f'out{ext}')
        _download(url, src)
        args = ['-i', src, '-map', '0', '-c', 'copy', '-movflags', '+faststart']
        # HEVC (iPhones record it) in an MP4 must be tagged 'hvc1': FFmpeg
        # writes 'hev1' by default, which iPhones and iPads will not play.
        if ext != '.mov' and _is_hevc(src):
            args += ['-tag:v', 'hvc1']
        _ffmpeg(args + ['-y', out])
        new_key = f'{stem}{FAST_MARK}{ext}'
        new_url = r2.put_file(new_key, out, CONTENT_TYPES.get(ext, 'video/mp4'))

    # Only if the post still has the file this job read. The old file is
    # kept: a feed saved on a phone, a story or a share may still point at it.
    moved = SocialPost.objects.filter(pk=post.pk, media_file=post.media_file).update(media_file=new_url)
    if moved:
        logger.info('faststart: post %s now starts at once (%s)', post.pk, new_key)


def queue_faststart(post):
    from .jobs import enqueue
    return enqueue('faststart_video', key=f'post:{post.pk}', post_id=post.pk)

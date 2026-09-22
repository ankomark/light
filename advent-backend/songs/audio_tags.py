"""Songs that keep their name and artwork outside the app.

A track saved to the phone used to arrive as `track_7.mp3` with no picture:
the phone's music player showed "track_7" and a blank square. Players and
the phone's media library read a song's title, artist, album and cover from
tags inside the file itself, so on download we write them in — ID3 for MP3,
MP4 atoms for M4A/AAC (what uploads are compressed to) — and keep the tagged
copy in R2 so each version of a song is tagged once, not per download.

Anything that goes wrong (R2 not configured, an unreadable file, a format we
don't tag) falls back to the original file: the download still works, it
just arrives untagged.
"""
import hashlib
import io
import logging
import mimetypes
import re

import requests
from django.conf import settings

from . import media, r2

logger = logging.getLogger(__name__)

MAX_AUDIO_BYTES = 80 * 1024 * 1024
MAX_COVER_BYTES = 6 * 1024 * 1024
FETCH_TIMEOUT = 30

MP3_EXTS = {'mp3'}
MP4_EXTS = {'m4a', 'mp4', 'aac', 'm4b'}

# Characters no phone file system accepts. Everything else — spaces, accents,
# other scripts — stays, so the saved file reads exactly like the song does
# in the app.
_UNSAFE = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def safe_filename(title, ext):
    name = _UNSAFE.sub(' ', (title or '').strip())
    name = re.sub(r'\s+', ' ', name).strip(' .')[:120] or 'Song'
    return f'{name}.{ext}'


def _ext(url):
    m = re.search(r'\.([a-z0-9]{2,4})(?:[?#]|$)', url or '', re.I)
    return m.group(1).lower() if m else 'mp3'


def _fetch(url, cap):
    resp = requests.get(url, timeout=FETCH_TIMEOUT, stream=True)
    resp.raise_for_status()
    buf = io.BytesIO()
    for chunk in resp.iter_content(64 * 1024):
        buf.write(chunk)
        if buf.tell() > cap:
            raise ValueError('file too large to tag')
    return buf.getvalue(), (resp.headers.get('Content-Type') or '').split(';')[0]


def tag_audio(data, ext, title, artist, album=None, cover=None, cover_mime='image/jpeg'):
    """Return `data` with title/artist/album/cover written in. Unknown
    formats come back unchanged."""
    ext = ext.lower()
    buf = io.BytesIO(data)
    if ext in MP3_EXTS:
        from mutagen.id3 import ID3, TIT2, TPE1, TALB, APIC, ID3NoHeaderError
        try:
            tags = ID3(buf)
        except ID3NoHeaderError:
            tags = ID3()
        buf.seek(0)
        tags.delall('APIC')
        tags.add(TIT2(encoding=3, text=title or ''))
        tags.add(TPE1(encoding=3, text=artist or ''))
        if album:
            tags.add(TALB(encoding=3, text=album))
        if cover:
            tags.add(APIC(encoding=3, mime=cover_mime or 'image/jpeg', type=3, desc='Cover', data=cover))
        tags.save(buf, v2_version=3)  # v2.3: what most phone players read
        return buf.getvalue()
    if ext in MP4_EXTS:
        from mutagen.mp4 import MP4, MP4Cover
        audio = MP4(buf)
        if audio.tags is None:
            audio.add_tags()
        audio.tags['\xa9nam'] = [title or '']
        audio.tags['\xa9ART'] = [artist or '']
        if album:
            audio.tags['\xa9alb'] = [album]
        if cover:
            fmt = MP4Cover.FORMAT_PNG if 'png' in (cover_mime or '') else MP4Cover.FORMAT_JPEG
            audio.tags['covr'] = [MP4Cover(cover, imageformat=fmt)]
        buf.seek(0)
        audio.save(buf)
        return buf.getvalue()
    return data


def tagged_download(track):
    """(url, filename, tagged) for downloading `track` with its name and cover
    inside the file. Cached in R2 per version of the song's details."""
    source = media.resolve(track.audio_file)
    ext = _ext(source)
    artist = track.artist.username if track.artist_id else ''
    filename = safe_filename(track.title, ext)
    # Only our own storage is ever fetched server-side: audio_file is a stored
    # URL, and fetching whatever it says would let anyone point the server at
    # an internal address.
    if (not source or ext not in MP3_EXTS | MP4_EXTS or not r2.is_configured()
            or not r2.is_r2_url(source)):
        return source, filename, False

    version = hashlib.sha1('|'.join(str(x) for x in (
        track.audio_file, track.cover_image, track.title, artist, track.album,
    )).encode('utf-8')).hexdigest()[:16]
    key = f'tagged/{track.id}-{version}.{ext}'
    client = r2._client()
    try:
        client.head_object(Bucket=settings.R2_BUCKET, Key=key)
        return r2.public_url(key), filename, True
    except Exception:
        pass  # not tagged yet

    try:
        audio, content_type = _fetch(source, MAX_AUDIO_BYTES)
        cover, cover_mime = None, None
        cover_url = media.resolve(track.cover_image) if track.cover_image else None
        if cover_url and r2.is_r2_url(cover_url):
            try:
                cover, cover_mime = _fetch(cover_url, MAX_COVER_BYTES)
            except Exception as e:
                logger.info('cover fetch failed for track %s: %s', track.id, e)
        tagged = tag_audio(audio, ext, track.title, artist, track.album, cover, cover_mime)
        client.put_object(
            Bucket=settings.R2_BUCKET, Key=key, Body=tagged,
            ContentType=content_type or mimetypes.guess_type(filename)[0] or 'audio/mpeg',
            ContentDisposition=f'attachment; filename="{filename.encode("ascii", "ignore").decode() or "song." + ext}"',
        )
        return r2.public_url(key), filename, True
    except Exception as e:
        logger.warning('tagging failed for track %s: %s', track.id, e)
        return source, filename, False

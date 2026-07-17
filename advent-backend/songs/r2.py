"""Cloudflare R2 (S3-compatible) media service.

Django is the control plane for media the same way it is for LiveKit: it mints
short-lived presigned PUT URLs and issues the occasional server command
(delete). Bytes never touch Django — the app uploads directly to R2 and then
sends the resulting public URL back through the normal API writes.

Everything is credential-guarded so dev/test environments without R2 keys keep
working (presigning raises a clear error at the endpoint; deletes no-op).
"""
import logging
import mimetypes
import uuid

import boto3
from botocore.config import Config
from django.conf import settings

logger = logging.getLogger(__name__)

# How long a presigned PUT stays valid. Long enough for a large video on a slow
# connection; short enough that a leaked URL goes stale quickly.
PRESIGN_TTL_SECONDS = 15 * 60

# Mirrors CloudinarySignView.FOLDER_MAP so new R2 keys land in the same logical
# prefixes as the historical Cloudinary folders (keeps the Phase-3 migration a
# straight per-folder copy).
FOLDER_MAP = {
    'audio': 'audio_uploads',
    'image': 'social_media/images',
    'video': 'social_media/videos',
    'story_video': 'stories/videos',
    'chat_image': 'chat/images',
    'chat_audio': 'chat/audio',
    'chat_file': 'chat/files',
    'profile': 'profile_images',
    'cover': 'cover_images',
    'avatar': 'avatars',
}

# Per-type content-type allowlist (prefix match). chat_file is intentionally
# broad — it carries arbitrary documents.
ALLOWED_CONTENT_TYPES = {
    'audio': ('audio/',),
    'image': ('image/',),
    'video': ('video/',),
    'story_video': ('video/',),
    'chat_image': ('image/',),
    'chat_audio': ('audio/', 'video/'),  # voice notes arrive as either
    'chat_file': ('',),  # any
    'profile': ('image/',),
    'cover': ('image/',),
    'avatar': ('image/',),
}


def is_configured():
    return bool(
        settings.R2_ACCESS_KEY_ID
        and settings.R2_SECRET_ACCESS_KEY
        and settings.R2_ENDPOINT
        and settings.R2_BUCKET
    )


_client_cache = {}


def _client():
    """Cached boto3 S3 client for R2. Keyed on the endpoint so tests that
    override settings get a fresh client."""
    key = (settings.R2_ENDPOINT, settings.R2_ACCESS_KEY_ID)
    client = _client_cache.get(key)
    if client is None:
        client = boto3.client(
            's3',
            endpoint_url=settings.R2_ENDPOINT,
            aws_access_key_id=settings.R2_ACCESS_KEY_ID,
            aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
            config=Config(signature_version='s3v4', region_name='auto'),
        )
        _client_cache[key] = client
    return client


def _extension_for(content_type, filename=None):
    """Best-effort file extension, preferring the client's filename."""
    if filename and '.' in filename:
        ext = '.' + filename.rsplit('.', 1)[-1].lower()
        # Guard against absurd/hostile "extensions" (e.g. a dotted sentence).
        if 1 < len(ext) <= 8 and ext[1:].isalnum():
            return ext
    return mimetypes.guess_extension(content_type or '') or ''


def content_type_allowed(upload_type, content_type):
    prefixes = ALLOWED_CONTENT_TYPES.get(upload_type)
    if prefixes is None:
        return False
    return any((content_type or '').startswith(p) for p in prefixes)


def presign_put(upload_type, content_type, filename=None):
    """Mint a presigned PUT for a direct app→R2 upload.

    Returns {upload_url, key, public_url, content_type, expires_in}. The
    Content-Type is part of the signature, so the client must send it verbatim
    on the PUT (same contract the Cloudinary signer had for `transformation`).
    """
    folder = FOLDER_MAP[upload_type]
    key = f"{folder}/{uuid.uuid4().hex}{_extension_for(content_type, filename)}"
    upload_url = _client().generate_presigned_url(
        'put_object',
        Params={
            'Bucket': settings.R2_BUCKET,
            'Key': key,
            'ContentType': content_type,
        },
        ExpiresIn=PRESIGN_TTL_SECONDS,
    )
    return {
        'upload_url': upload_url,
        'key': key,
        'public_url': public_url(key),
        'content_type': content_type,
        'expires_in': PRESIGN_TTL_SECONDS,
    }


def upload_file(fileobj, folder, content_type=None, filename=None):
    """Server-side upload for the legacy multipart endpoints (avatar/track/
    church-image/product-images/group attachments). Returns the public URL to
    store as the media reference."""
    if not is_configured():
        raise RuntimeError('R2 is not configured')
    ct = content_type or getattr(fileobj, 'content_type', None) or 'application/octet-stream'
    name = filename or getattr(fileobj, 'name', None)
    key = f"{folder}/{uuid.uuid4().hex}{_extension_for(ct, name)}"
    _client().upload_fileobj(
        fileobj, settings.R2_BUCKET, key, ExtraArgs={'ContentType': ct},
    )
    return public_url(key)


def public_url(key):
    return f"{settings.R2_PUBLIC_BASE.rstrip('/')}/{key}"


def is_r2_url(value):
    """True if `value` is a URL served from our R2 public base."""
    base = (settings.R2_PUBLIC_BASE or '').rstrip('/')
    return bool(base) and isinstance(value, str) and value.startswith(base + '/')


def key_from_url(url):
    """Extract the object key from one of our public URLs (else None)."""
    if not is_r2_url(url):
        return None
    base = settings.R2_PUBLIC_BASE.rstrip('/')
    return url[len(base) + 1:].split('?')[0] or None


def delete(key_or_url):
    """Best-effort delete by key or public URL. Never raises — mirrors the
    forgiving behavior of the Cloudinary destroy() call sites."""
    if not is_configured():
        return
    key = key_from_url(key_or_url) if str(key_or_url).startswith('http') else key_or_url
    if not key:
        return
    try:
        _client().delete_object(Bucket=settings.R2_BUCKET, Key=key)
    except Exception:
        logger.exception('R2 delete failed for key=%s', key)

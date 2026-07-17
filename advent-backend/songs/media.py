"""Media reference resolution.

Media columns store the absolute public URL of an R2 object (uploaded directly
by the app via presigned PUT — see songs/r2.py). Anything else is a leftover
from the decommissioned Cloudinary era (those references were blanked by
migration 0070; a stray survivor resolves to None rather than a broken URL).
"""


def is_absolute(value):
    return isinstance(value, str) and value.startswith(('http://', 'https://'))


def resolve(value):
    """Stored media reference → serveable URL (or None)."""
    if not value:
        return None
    # Legacy dict shape from the old server-side avatar endpoint.
    if isinstance(value, dict):
        url = value.get('secure_url') or value.get('url')
        return url if is_absolute(url) else None
    if is_absolute(value):
        return value
    return None

"""Blank all Cloudinary media references (dev-only test media).

Cloudinary is fully decommissioned in favor of R2. All media stored there was
development test data; rather than migrating assets, every reference to a
Cloudinary asset (bare public_id or res.cloudinary.com URL) is blanked. Rows
survive — only their media pointers are cleared. R2 URLs and non-media values
(YouTube links, base64 data URIs) are untouched.
"""
from django.db import migrations


def _is_cloudinary_ref(value):
    """A bare public_id (not a URL) or anything on a cloudinary domain."""
    if not value or not isinstance(value, str):
        return False
    if 'cloudinary' in value.lower():
        return True
    # Bare public_id: not an absolute URL, not a data URI.
    return not value.startswith(('http://', 'https://', 'data:'))


# (model, field): blank when the value is a bare public_id OR cloudinary URL.
REFERENCE_COLUMNS = [
    ('User', 'avatar'),
    ('Track', 'audio_file'),
    ('Track', 'cover_image'),
    ('Profile', 'picture'),
    ('SocialPost', 'media_file'),
    ('Story', 'media_file'),
    ('Church', 'image'),
    ('Group', 'cover_image'),
    ('GroupPostAttachment', 'file'),
    ('ProductImage', 'image'),
]

# (model, field): URL/text columns that may hold cloudinary URLs alongside
# other content (YouTube links, data URIs) — blank ONLY cloudinary values.
URL_COLUMNS = [
    ('SocialPost', 'song_audio_url'),
    ('Story', 'media_url'),
    ('Message', 'attachment'),
    ('MediaStation', 'logo'),
    ('Videostudio', 'logo'),
    ('Videostudio', 'cover_image'),
    ('Choir', 'profile_image'),
    ('Choir', 'cover_image'),
    ('ChoirMessage', 'attachment'),
    ('ChurchMessage', 'attachment'),
    ('GroupPost', 'attachment'),
    ('LiveEvent', 'thumbnail'),
    ('Publication', 'cover'),
]


def blank_refs(apps, schema_editor):
    for model_name, field in REFERENCE_COLUMNS:
        model = apps.get_model('songs', model_name)
        for row in model.objects.exclude(**{field: ''}).exclude(**{f'{field}__isnull': True}).iterator():
            if _is_cloudinary_ref(getattr(row, field)):
                setattr(row, field, '')
                row.save(update_fields=[field])

    for model_name, field in URL_COLUMNS:
        model = apps.get_model('songs', model_name)
        for row in model.objects.exclude(**{field: ''}).exclude(**{f'{field}__isnull': True}).iterator():
            value = getattr(row, field) or ''
            if 'cloudinary' in value.lower():
                setattr(row, field, '')
                row.save(update_fields=[field])

    # SocialPost.gallery: JSON list of {public_id, width, height}. Keep only
    # items whose reference survives the same rule.
    SocialPost = apps.get_model('songs', 'SocialPost')
    for post in SocialPost.objects.exclude(gallery=[]).iterator():
        gallery = post.gallery if isinstance(post.gallery, list) else []
        kept = [
            it for it in gallery
            if isinstance(it, dict) and not _is_cloudinary_ref(it.get('public_id'))
            and it.get('public_id')
        ]
        if kept != gallery:
            post.gallery = kept
            post.save(update_fields=['gallery'])


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0069_media_refs_to_char'),
    ]

    operations = [
        # Irreversible by design: the cleared references pointed at deleted media.
        migrations.RunPython(blank_refs, migrations.RunPython.noop),
    ]

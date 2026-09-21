"""Link existing posts to Hashtag rows.

Tag pages and trending tags now read SocialPost.hashtags instead of
substring-matching the old `tags` string. Without this backfill every post
made before the change would vanish from its tag page. Mentions are NOT
backfilled on purpose: that would send "you were mentioned" notifications
for posts that may be years old.
"""
from django.db import migrations

from songs.captions import extract_hashtags

BATCH = 500


def backfill(apps, schema_editor):
    SocialPost = apps.get_model('songs', 'SocialPost')
    Hashtag = apps.get_model('songs', 'Hashtag')
    Link = SocialPost.hashtags.through

    qs = (SocialPost.objects.exclude(caption='', tags='')
          .only('id', 'caption', 'tags').order_by('id'))
    cache = {}
    links = []
    for post in qs.iterator(chunk_size=BATCH):
        # The legacy tags string is space-separated words, with or without '#'.
        legacy = ' '.join(f'#{w.lstrip("#")}' for w in (post.tags or '').split())
        names = extract_hashtags(f'{post.caption or ""} {legacy}')
        if not names:
            continue
        missing = [n for n in names if n not in cache]
        if missing:
            Hashtag.objects.bulk_create([Hashtag(name=n) for n in missing], ignore_conflicts=True)
            cache.update({h.name: h.pk for h in Hashtag.objects.filter(name__in=missing)})
        links.extend(Link(socialpost_id=post.id, hashtag_id=cache[n]) for n in names if n in cache)
        if len(links) >= BATCH:
            Link.objects.bulk_create(links, ignore_conflicts=True)
            links = []
    if links:
        Link.objects.bulk_create(links, ignore_conflicts=True)


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0118_post_visibility_hashtags_mentions'),
    ]

    operations = [
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]

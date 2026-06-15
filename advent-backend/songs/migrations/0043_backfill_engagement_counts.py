from django.db import migrations
from django.db.models import Count, IntegerField, OuterRef, Subquery, Value
from django.db.models.functions import Coalesce


def backfill(apps, schema_editor):
    """Seed likes_count / comments_count from the existing rows in one UPDATE
    each (correlated subqueries), so the new denormalised columns are correct
    before signals take over for future writes."""
    SocialPost = apps.get_model('songs', 'SocialPost')
    PostLike = apps.get_model('songs', 'PostLike')
    PostComment = apps.get_model('songs', 'PostComment')

    likes_sq = (
        PostLike.objects.filter(post=OuterRef('pk'))
        .order_by().values('post').annotate(c=Count('*')).values('c')
    )
    comments_sq = (
        PostComment.objects.filter(post=OuterRef('pk'))
        .order_by().values('post').annotate(c=Count('*')).values('c')
    )

    SocialPost.objects.update(
        likes_count=Coalesce(Subquery(likes_sq, output_field=IntegerField()), Value(0)),
        comments_count=Coalesce(Subquery(comments_sq, output_field=IntegerField()), Value(0)),
    )


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0042_socialpost_comments_count_socialpost_likes_count'),
    ]

    operations = [
        migrations.RunPython(backfill, noop),
    ]

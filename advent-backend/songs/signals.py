"""Keep SocialPost.likes_count / comments_count in sync with the underlying
PostLike / PostComment rows.

Counters are updated with atomic F() expressions (race-safe under concurrency)
and clamped at zero on delete so a double-fired signal can't drive them negative.
QuerySet.delete() emits post_delete per instance, so toggles and cascades are
both covered.
"""
from django.db.models import F, Value
from django.db.models.functions import Greatest
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver

from .models import PostLike, PostComment, SocialPost


def _bump(post_id, field, delta):
    if not post_id:
        return
    if delta >= 0:
        SocialPost.objects.filter(pk=post_id).update(**{field: F(field) + delta})
    else:
        SocialPost.objects.filter(pk=post_id).update(
            **{field: Greatest(F(field) - abs(delta), Value(0))}
        )


@receiver(post_save, sender=PostLike)
def like_created(sender, instance, created, **kwargs):
    if created:
        _bump(instance.post_id, 'likes_count', 1)


@receiver(post_delete, sender=PostLike)
def like_deleted(sender, instance, **kwargs):
    _bump(instance.post_id, 'likes_count', -1)


@receiver(post_save, sender=PostComment)
def comment_created(sender, instance, created, **kwargs):
    if created:
        _bump(instance.post_id, 'comments_count', 1)


@receiver(post_delete, sender=PostComment)
def comment_deleted(sender, instance, **kwargs):
    _bump(instance.post_id, 'comments_count', -1)

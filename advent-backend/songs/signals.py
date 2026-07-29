"""Keep SocialPost.likes_count / comments_count in sync with the underlying
PostLike / PostComment rows, and User.total_likes in sync with every like a
user's content receives.

Counters are updated with atomic F() expressions (race-safe under concurrency)
and clamped at zero on delete so a double-fired signal can't drive them negative.
QuerySet.delete() emits post_delete per instance, so toggles and cascades are
both covered.
"""
from django.db.models import F, Value
from django.db.models.functions import Greatest
from django.db.models.signals import post_save, post_delete, pre_delete
from django.dispatch import receiver

from .models import (
    Like, LiveBroadcast, PostLike, PostComment, PublicationLike,
    Publication, SocialPost, Track, User,
)


def _bump(post_id, field, delta):
    if not post_id:
        return
    if delta >= 0:
        SocialPost.objects.filter(pk=post_id).update(**{field: F(field) + delta})
    else:
        SocialPost.objects.filter(pk=post_id).update(
            **{field: Greatest(F(field) - abs(delta), Value(0))}
        )


def credit_user_likes(user_id, delta):
    """Move a user's lifetime like total by `delta`, clamped at zero.

    Public because live broadcasts have no per-like row to hang a signal on —
    their ❤️ reactions arrive as a batched counter bump, so songs/views/live.py
    calls this directly.
    """
    if not user_id or not delta:
        return
    if delta >= 0:
        User.objects.filter(pk=user_id).update(total_likes=F('total_likes') + delta)
    else:
        User.objects.filter(pk=user_id).update(
            total_likes=Greatest(F('total_likes') - abs(delta), Value(0))
        )


def _bump_author_likes(model, content_id, owner_field, delta):
    """Move the content owner's lifetime like total by `delta`.

    Resolves the owner with a values_list so we never load the whole row. On a
    cascade delete (content removed -> its likes go with it) Django deletes the
    likes before the parent, so the lookup still finds the owner; if it doesn't,
    the parent is already gone and there is nothing left to attribute.
    """
    if not content_id:
        return
    owner_id = (
        model.objects.filter(pk=content_id)
        .values_list(owner_field, flat=True)
        .first()
    )
    credit_user_likes(owner_id, delta)


@receiver(post_save, sender=PostLike)
def like_created(sender, instance, created, **kwargs):
    if created:
        _bump(instance.post_id, 'likes_count', 1)
        _bump_author_likes(SocialPost, instance.post_id, 'user_id', 1)


@receiver(post_delete, sender=PostLike)
def like_deleted(sender, instance, **kwargs):
    _bump(instance.post_id, 'likes_count', -1)
    _bump_author_likes(SocialPost, instance.post_id, 'user_id', -1)


@receiver(post_save, sender=Like)
def track_like_created(sender, instance, created, **kwargs):
    if created:
        _bump_author_likes(Track, instance.track_id, 'artist_id', 1)


@receiver(post_delete, sender=Like)
def track_like_deleted(sender, instance, **kwargs):
    _bump_author_likes(Track, instance.track_id, 'artist_id', -1)


@receiver(post_save, sender=PublicationLike)
def publication_like_created(sender, instance, created, **kwargs):
    if created:
        _bump_author_likes(Publication, instance.publication_id, 'author_id', 1)


@receiver(post_delete, sender=PublicationLike)
def publication_like_deleted(sender, instance, **kwargs):
    _bump_author_likes(Publication, instance.publication_id, 'author_id', -1)


@receiver(pre_delete, sender=LiveBroadcast)
def broadcast_deleted(sender, instance, **kwargs):
    """Hearts a broadcast collected are credited as they arrive (see the `react`
    endpoint), so deleting the broadcast has to hand them back — the same way
    deleting a post drops the likes it had gathered.

    pre_delete, not post_delete: the row is still readable here, so the amount
    handed back is the stored tally rather than whatever `like_count` happened
    to be on the caller's in-memory copy. `react` moves that column with an
    UPDATE, so any instance loaded before a viewer reacted is already stale.
    """
    stored = (
        LiveBroadcast.objects.filter(pk=instance.pk)
        .values_list('like_count', flat=True)
        .first()
    )
    credit_user_likes(instance.host_id, -(stored or 0))


@receiver(post_save, sender=PostComment)
def comment_created(sender, instance, created, **kwargs):
    if created:
        _bump(instance.post_id, 'comments_count', 1)


@receiver(post_delete, sender=PostComment)
def comment_deleted(sender, instance, **kwargs):
    _bump(instance.post_id, 'comments_count', -1)

"""Comments on posts and on tracks: creating them (with replies and
@mentions), reactions, and the notifications both produce.

Posts and tracks run the same comment section, so the rules live here once,
parameterised by a CommentKind that says which models and fields to use.
Every comment endpoint goes through create_comment(), so a reply or a mention
behaves the same whichever route the client used.
"""
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Callable

from django.db.models import Count, Q

from .captions import extract_mentions
from .models import (
    Comment, CommentReaction, Notification, PostComment, TrackCommentReaction, User,
    blocked_ids_for, can_view_post,
)
from .push import notify_user

REACTIONS = CommentReaction.REACTIONS
LIKE = CommentReaction.LIKE


@dataclass(frozen=True)
class CommentKind:
    comment_model: type
    reaction_model: type
    target_field: str            # 'post' / 'track' on the comment
    owner: Callable              # target -> the user it belongs to
    can_view: Callable           # (user, target) -> bool
    notification_fields: Callable  # (target, comment) -> Notification kwargs
    push_data: Callable          # (target, comment) -> push payload
    owner_message: Callable      # (username, target) -> "x commented on …"


POST = CommentKind(
    comment_model=PostComment,
    reaction_model=CommentReaction,
    target_field='post',
    owner=lambda post: post.user,
    can_view=can_view_post,
    notification_fields=lambda post, c: {'post': post, 'comment': c},
    push_data=lambda post, c: {'postId': post.id, 'commentId': c.id},
    owner_message=lambda name, post: f"{name} commented on your post",
)

TRACK = CommentKind(
    comment_model=Comment,
    reaction_model=TrackCommentReaction,
    target_field='track',
    owner=lambda track: track.artist,
    # Tracks have no per-item privacy; a removed track is gone for everyone.
    can_view=lambda user, track: not track.is_removed,
    notification_fields=lambda track, c: {'track': track, 'track_comment': c},
    push_data=lambda track, c: {'trackId': track.id, 'trackCommentId': c.id},
    owner_message=lambda name, track: f"{name} commented on your track {track.title}",
)


def _target(kind, comment):
    return getattr(comment, kind.target_field)


def _notify(kind, recipient, sender, notification_type, message, target, comment):
    Notification.objects.create(
        recipient=recipient, sender=sender, message=message,
        notification_type=notification_type, **kind.notification_fields(target, comment),
    )
    # The tap opens the post/track with this exact comment in view.
    notify_user(recipient, notification_type, message, data=kind.push_data(target, comment))


def _mentioned_users(kind, comment):
    """@names that resolve to real accounts who may see the target and haven't
    blocked (or been blocked by) the author."""
    names = extract_mentions(comment.content)
    if not names:
        return []
    match = Q()
    for n in names:
        match |= Q(username__iexact=n)
    qs = User.objects.filter(match).exclude(pk=comment.user_id).exclude(is_deactivated=True)
    blocked = blocked_ids_for(comment.user)
    if blocked:
        qs = qs.exclude(pk__in=blocked)
    target = _target(kind, comment)
    return [u for u in qs.distinct() if kind.can_view(u, target)]


def create_comment(kind, user, target, content, parent=None):
    """Create a comment (or a reply, when `parent` is given) and notify: the
    person replied to, anyone @mentioned, and the owner — each at most once,
    the most specific reason winning."""
    reply_to = None
    if parent is not None:
        reply_to = parent.user
        # One level of threading: a reply to a reply joins the top comment's
        # thread, addressed to the person it answers.
        if parent.parent_id:
            parent = parent.parent
    comment = kind.comment_model.objects.create(
        **{kind.target_field: target}, user=user, content=content, parent=parent, reply_to=reply_to,
    )

    told = {user.pk} | blocked_ids_for(user)

    if reply_to is not None and reply_to.pk not in told:
        _notify(kind, reply_to, user, 'comment_reply', f"{user.username} replied to your comment", target, comment)
        told.add(reply_to.pk)

    mentioned = _mentioned_users(kind, comment)
    comment.mentions.set(mentioned)
    for u in mentioned:
        if u.pk not in told:
            _notify(kind, u, user, 'mention', f"{user.username} mentioned you in a comment", target, comment)
            told.add(u.pk)

    owner = kind.owner(target)
    if owner.pk not in told:
        _notify(kind, owner, user, 'comment', kind.owner_message(user.username, target), target, comment)

    return comment


def create_post_comment(user, post, content, parent=None):
    return create_comment(POST, user, post, content, parent)


def set_reaction(user, comment, emoji, kind=POST):
    """Toggle/replace `user`'s reaction on `comment`. Same emoji again (or
    None) removes it. Returns the emoji now set, or None."""
    model = kind.reaction_model
    existing = model.objects.filter(comment=comment, user=user).first()
    if emoji is None or (existing and existing.emoji == emoji):
        if existing:
            existing.delete()
        return None
    if existing:
        existing.emoji = emoji
        existing.save(update_fields=['emoji'])
        return emoji
    model.objects.create(comment=comment, user=user, emoji=emoji)
    # Only the first reaction notifies — switching ❤️ to 😂 isn't news.
    author = comment.user
    if author.pk != user.pk and author.pk not in blocked_ids_for(user):
        verb = 'liked' if emoji == LIKE else f'reacted {emoji} to'
        _notify(kind, author, user, 'comment_like', f"{user.username} {verb} your comment",
                _target(kind, comment), comment)
    return emoji


def reaction_summaries(comment_ids, user, kind=POST):
    """{comment_id: {'total', 'top': [up to 3 emoji, most used first], 'mine'}}
    for a page of comments, in two queries however many comments there are."""
    ids = list(comment_ids)
    out = {cid: {'total': 0, 'top': [], 'mine': None} for cid in ids}
    if not ids:
        return out
    model = kind.reaction_model
    # Counted in SQL: a popular comment can carry thousands of reactions, and
    # only the per-emoji totals are needed.
    counts = defaultdict(Counter)
    for row in (model.objects.filter(comment_id__in=ids)
                .values('comment_id', 'emoji').annotate(n=Count('id')).order_by()):
        counts[row['comment_id']][row['emoji']] = row['n']
    for cid, c in counts.items():
        out[cid]['total'] = sum(c.values())
        out[cid]['top'] = [e for e, _ in c.most_common(3)]
    if getattr(user, 'is_authenticated', False):
        for cid, emoji in (model.objects.filter(comment_id__in=ids, user=user)
                           .values_list('comment_id', 'emoji')):
            out[cid]['mine'] = emoji
    return out

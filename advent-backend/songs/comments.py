"""Post comments: creating them (with replies and @mentions), reactions, and
the notifications both produce.

Both comment endpoints — POST /social-posts/<id>/comment/ (the feed's) and
POST /social-posts/<id>/comments/ — go through create_post_comment(), so a
reply or a mention behaves the same whichever one the client used.
"""
from collections import Counter, defaultdict

from django.db.models import Count, Q

from .captions import extract_mentions
from .models import (
    CommentReaction, Notification, PostComment, User, blocked_ids_for, can_view_post,
)
from .push import notify_user


def _notify(recipient, sender, kind, message, post, comment):
    Notification.objects.create(
        recipient=recipient, sender=sender, message=message,
        notification_type=kind, post=post, comment=comment,
    )
    # postId + commentId: the tap opens the post with this comment in view.
    notify_user(recipient, kind, message, data={'postId': post.id, 'commentId': comment.id})


def _mentioned_users(comment):
    """@names in the comment that resolve to real accounts who may see the
    post and haven't blocked (or been blocked by) the author."""
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
    return [u for u in qs.distinct() if can_view_post(u, comment.post)]


def create_post_comment(user, post, content, parent=None):
    """Create a comment (or a reply, when `parent` is given) and notify:
    the person replied to, anyone @mentioned, and the post's author — each
    at most once, the most specific reason winning."""
    reply_to = None
    if parent is not None:
        reply_to = parent.user
        # One level of threading: a reply to a reply joins the top comment's
        # thread, addressed to the person it answers.
        if parent.parent_id:
            parent = parent.parent
    comment = PostComment.objects.create(
        post=post, user=user, content=content, parent=parent, reply_to=reply_to,
    )

    blocked = blocked_ids_for(user)
    told = {user.pk} | blocked

    if reply_to is not None and reply_to.pk not in told:
        _notify(reply_to, user, 'comment_reply', f"{user.username} replied to your comment", post, comment)
        told.add(reply_to.pk)

    mentioned = _mentioned_users(comment)
    comment.mentions.set(mentioned)
    for u in mentioned:
        if u.pk not in told:
            _notify(u, user, 'mention', f"{user.username} mentioned you in a comment", post, comment)
            told.add(u.pk)

    if post.user_id not in told:
        _notify(post.user, user, 'comment', f"{user.username} commented on your post", post, comment)

    return comment


def set_reaction(user, comment, emoji):
    """Toggle/replace `user`'s reaction on `comment`. Same emoji again (or
    None) removes it. Returns the emoji now set, or None."""
    existing = CommentReaction.objects.filter(comment=comment, user=user).first()
    if emoji is None or (existing and existing.emoji == emoji):
        if existing:
            existing.delete()
        return None
    if existing:
        existing.emoji = emoji
        existing.save(update_fields=['emoji'])
        return emoji
    CommentReaction.objects.create(comment=comment, user=user, emoji=emoji)
    # Only the first reaction notifies — switching ❤️ to 😂 isn't news.
    author = comment.user
    if author.pk != user.pk and author.pk not in blocked_ids_for(user):
        verb = 'liked' if emoji == CommentReaction.LIKE else f'reacted {emoji} to'
        _notify(author, user, 'comment_like', f"{user.username} {verb} your comment", comment.post, comment)
    return emoji


def reaction_summaries(comment_ids, user):
    """{comment_id: {'total', 'top': [up to 3 emoji, most used first], 'mine'}}
    for a page of comments, in two queries however many comments there are."""
    ids = list(comment_ids)
    out = {cid: {'total': 0, 'top': [], 'mine': None} for cid in ids}
    if not ids:
        return out
    # Counted in SQL: a popular comment can carry thousands of reactions, and
    # only the per-emoji totals are needed.
    counts = defaultdict(Counter)
    for row in (CommentReaction.objects.filter(comment_id__in=ids)
                .values('comment_id', 'emoji').annotate(n=Count('id')).order_by()):
        counts[row['comment_id']][row['emoji']] = row['n']
    for cid, c in counts.items():
        out[cid]['total'] = sum(c.values())
        out[cid]['top'] = [e for e, _ in c.most_common(3)]
    if getattr(user, 'is_authenticated', False):
        for cid, emoji in (CommentReaction.objects.filter(comment_id__in=ids, user=user)
                           .values_list('comment_id', 'emoji')):
            out[cid]['mine'] = emoji
    return out

"""Keep a post's hashtag and mention relations in step with its caption."""
from .captions import extract_hashtags, extract_mentions
from .models import Hashtag, Notification, SocialPost, User, blocked_ids_for, can_view_post
from .push import notify_user


def _mentionable(post, usernames):
    """The users a caption's @names resolve to who may actually be told about
    it: real accounts, not the author, not blocked either way, and able to
    see the post — a followers-only post doesn't ping non-followers, and an
    "only me" post pings nobody."""
    if not usernames or post.visibility == SocialPost.VISIBILITY_PRIVATE:
        return []
    from django.db.models import Q
    match = Q()
    for name in usernames:
        match |= Q(username__iexact=name)
    qs = User.objects.filter(match).exclude(pk=post.user_id).exclude(is_deactivated=True)
    blocked = blocked_ids_for(post.user)
    if blocked:
        qs = qs.exclude(pk__in=blocked)
    # Only people who could actually open the post: its own visibility AND
    # its author's account privacy (a private account's post is hidden from
    # non-followers even when the post itself says "everyone").
    return [u for u in qs.distinct() if can_view_post(u, post)]


def sync_post_links(post, notify=True):
    """Rewrite `post`'s hashtags + mentions from its caption and notify anyone
    newly mentioned. Safe to call on every save: existing mentions are not
    notified again, so editing a caption doesn't re-ping everyone in it."""
    caption = post.caption or ''

    tags = extract_hashtags(caption)
    if tags:
        existing = {h.name: h for h in Hashtag.objects.filter(name__in=tags)}
        missing = [Hashtag(name=t) for t in tags if t not in existing]
        if missing:
            Hashtag.objects.bulk_create(missing, ignore_conflicts=True)
            existing = {h.name: h for h in Hashtag.objects.filter(name__in=tags)}
        post.hashtags.set([existing[t] for t in tags if t in existing])
    else:
        post.hashtags.clear()

    # The legacy `tags` string still feeds the ranked feed's taste model;
    # keep it filled from the caption when the client didn't send its own.
    if tags and not (post.tags or '').strip():
        SocialPost.objects.filter(pk=post.pk).update(tags=' '.join(tags)[:200])

    before = set(post.mentions.values_list('pk', flat=True))
    users = _mentionable(post, extract_mentions(caption))
    post.mentions.set(users)

    if not notify:
        return
    author = post.user
    for u in users:
        if u.pk in before:
            continue
        msg = f"{author.username} mentioned you in a post"
        Notification.objects.create(
            recipient=u, sender=author, message=msg,
            notification_type='mention', post=post,
        )
        notify_user(u, 'mention', msg, data={'postId': post.id})

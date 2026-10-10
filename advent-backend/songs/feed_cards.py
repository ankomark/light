"""New books, products and services as posts in the feed.

When something goes up — a book published for the first time, a product put
on sale, a service listed — it is posted to its owner's feed as that thing's
card, so their followers see it like any post. The owner may say no: the
create / publish request carries `share_to_feed`, on unless they switch it
off ("false", "0", "no", "off" or false).

One card per thing: publishing a book again after unpublishing it, or saving
a product twice, never posts a second card. A card goes with its thing (the
post's foreign key cascades), and the For You feed spaces cards out (feed.py,
space_cards).
"""
import logging

from .models import SocialPost

logger = logging.getLogger(__name__)

OFF = {'false', '0', 'no', 'off'}


def wanted(request):
    """Did the owner leave "also share to my feed" on? (On unless said otherwise.)"""
    data = getattr(request, 'data', None) or {}
    try:
        value = data.get('share_to_feed', True)
    except AttributeError:
        return True
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() not in OFF


def _post(user, **fields):
    """The card, unless this thing already has one. Never lets a failure here
    undo the publish that caused it."""
    from .views.social import _bump_feed_version
    try:
        kind = fields['content_type']
        key = {k: v for k, v in fields.items() if k in ('publication', 'product', 'service')}
        if SocialPost.objects.filter(content_type=kind, **key).exists():
            return None
        post = SocialPost.objects.create(user=user, visibility=SocialPost.VISIBILITY_PUBLIC, **fields)
        _bump_feed_version(user.id)
        return post
    except Exception:  # noqa: BLE001
        logger.exception('feed card for %s failed', fields.get('content_type'))
        return None


def post_book(publication, request=None):
    """A book out for the first time. Skipped for drafts, takedowns and
    books whose author switched sharing off."""
    if publication.status != 'published' or publication.is_removed:
        return None
    if request is not None and not wanted(request):
        return None
    return _post(publication.author, content_type='book', publication=publication,
                 media_file=publication.cover or '', thumbnail=publication.cover or '',
                 width=600, height=900)


def post_product(product, request=None):
    if product.is_removed or not product.is_available:
        return None
    if request is not None and not wanted(request):
        return None
    return _post(product.seller, content_type='product', product=product)


def post_service(service, request=None):
    if service.is_removed:
        return None
    if request is not None and not wanted(request):
        return None
    return _post(service.created_by, content_type='service', service=service)

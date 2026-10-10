"""Paid promotions: a post, a profile, a product, a book or a service shown to
more people, for a fixed package (a price for a number of views over some
days), paid by M-Pesa through the ticketing server's platform till.

    unpaid ──pay──▶ paying ──paid──▶ review ──approve──▶ active ──▶ done
                      └──failed──▶ unpaid        └──reject──▶ rejected (refund due)

Nothing runs before an admin has looked at it (manage_promotions): paid reach
on a church app has to be something the admins are happy to show.

Delivery: the app asks `serve` for a couple of promotions to place among the
feed's posts, marked "Sponsored". A view is counted when the app says it was
on screen (`seen`), once a day per person; a promotion is done when its views
are delivered or its days are up — short of its views, it is flagged for a
refund of the difference. Promotions are paced: the one furthest behind its
schedule is shown first.
"""
import logging
import secrets
from datetime import timedelta
from types import SimpleNamespace

from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

from .models import Product, Promotion, PromotionPackage, PromotionView, Publication, SocialPost, User, Videostudio

logger = logging.getLogger(__name__)

LIVE = (Promotion.PAYING, Promotion.REVIEW, Promotion.ACTIVE)

KENYA_COUNTIES = (
    'Baringo', 'Bomet', 'Bungoma', 'Busia', 'Elgeyo-Marakwet', 'Embu', 'Garissa', 'Homa Bay', 'Isiolo',
    'Kajiado', 'Kakamega', 'Kericho', 'Kiambu', 'Kilifi', 'Kirinyaga', 'Kisii', 'Kisumu', 'Kitui', 'Kwale',
    'Laikipia', 'Lamu', 'Machakos', 'Makueni', 'Mandera', 'Marsabit', 'Meru', 'Migori', 'Mombasa',
    "Murang'a", 'Nairobi', 'Nakuru', 'Nandi', 'Narok', 'Nyamira', 'Nyandarua', 'Nyeri', 'Samburu', 'Siaya',
    'Taita-Taveta', 'Tana River', 'Tharaka-Nithi', 'Trans Nzoia', 'Turkana', 'Uasin Gishu', 'Vihiga',
    'Wajir', 'West Pokot',
)


class Refused(Exception):
    """Not possible as asked. `code` for the app; the message is safe to show."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


# ── buying ───────────────────────────────────────────────────────────────────

def _target(owner, kind, target_id):
    """The thing to promote, if `owner` may promote it: {field: object}."""
    if kind == Promotion.KIND_PROFILE:
        return {}
    try:
        target_id = int(target_id)
    except (TypeError, ValueError):
        raise Refused('target', 'What should be promoted?')
    if kind == Promotion.KIND_POST:
        post = SocialPost.objects.filter(pk=target_id, user=owner, is_removed=False).first()
        if not post:
            raise Refused('target', 'You can only promote your own posts.')
        if post.visibility != SocialPost.VISIBILITY_PUBLIC:
            raise Refused('not_public', 'Only a post everyone can see can be promoted.')
        return {'post': post}
    if kind == Promotion.KIND_PRODUCT:
        product = Product.objects.filter(pk=target_id, seller=owner, is_removed=False).first()
        if not product or not product.is_available:
            raise Refused('target', 'You can only promote your own products that are on sale.')
        return {'product': product}
    if kind == Promotion.KIND_BOOK:
        pub = Publication.objects.filter(pk=target_id, author=owner, is_removed=False, status='published').first()
        if not pub:
            raise Refused('target', 'You can only promote your own published books.')
        return {'publication': pub}
    if kind == Promotion.KIND_SERVICE:
        service = Videostudio.objects.filter(pk=target_id, created_by=owner, is_removed=False).first()
        if not service:
            raise Refused('target', 'You can only promote your own services.')
        return {'service': service}
    raise Refused('kind', 'That cannot be promoted.')


def clean_counties(counties):
    if not counties:
        return []
    if not isinstance(counties, (list, tuple)):
        raise Refused('counties', 'Choose counties from the list.')
    known = {c.lower(): c for c in KENYA_COUNTIES}
    out = []
    for c in counties:
        name = known.get(str(c).strip().lower())
        if not name:
            raise Refused('counties', f'{c} is not a county.')
        if name not in out:
            out.append(name)
    return out


def create(owner, kind, target_id, package_key, counties=None):
    package = PromotionPackage.objects.filter(key=package_key, is_active=True).first()
    if not package:
        raise Refused('package', 'Choose one of the packages.')
    target = _target(owner, kind, target_id)
    same = Promotion.objects.filter(owner=owner, kind=kind, status__in=LIVE, **target)
    if same.exists():
        raise Refused('already', 'This is already being promoted.')
    return Promotion.objects.create(
        owner=owner, kind=kind, package=package, price=package.price, views_target=package.views,
        days=package.days, counties=clean_counties(counties), **target,
    )


def pay(promotion, phone):
    """Prompt `phone` to pay for it, through the ticketing server."""
    from . import ticketing_staff
    if promotion.status not in (Promotion.UNPAID, Promotion.PAYING):
        raise Refused('paid', 'This promotion has been paid for.')
    if not promotion.payment_reference:
        promotion.payment_reference = f'PROMO{promotion.pk}X{secrets.token_hex(3)}'
    try:
        answer = ticketing_staff.call(promotion.owner, 'post', 'payments/', body={
            'reference': promotion.payment_reference, 'amount': promotion.price, 'phone': phone,
            'purpose': 'promotion', 'description': 'Promotion',
        })
    except ticketing_staff.TicketingUnavailable:
        raise Refused('unavailable', 'Payments are not available right now. Try again in a minute.')
    except ticketing_staff.TicketingError as exc:
        raise Refused('payment', str(exc) or 'M-Pesa refused that. Check the number and try again.')
    promotion.status = Promotion.PAYING
    promotion.payment_phone = str(phone)[:12]
    promotion.payment_note = ''
    promotion.save(update_fields=['status', 'payment_reference', 'payment_phone', 'payment_note', 'updated_at'])
    return _apply_payment(promotion, answer)


def check_payment(promotion):
    """How the payment stands now (the ticketing server asks M-Pesa when its
    answer is late). Only a promotion waiting on M-Pesa is asked about."""
    from . import ticketing_staff
    if promotion.status != Promotion.PAYING or not promotion.payment_reference:
        return promotion
    try:
        answer = ticketing_staff.call(promotion.owner, 'get', f'payments/{promotion.payment_reference}/')
    except (ticketing_staff.TicketingUnavailable, ticketing_staff.TicketingError) as exc:
        logger.warning('[promotion] %s payment check failed: %s', promotion.pk, exc)
        return promotion
    return _apply_payment(promotion, answer)


def reconcile_payments(owner=None, older_than=timedelta(seconds=30), limit=20):
    """Promotions still waiting on M-Pesa that nobody is watching (the app
    was closed while paying): ask how the payment stands. Without this a paid
    one stays 'paying' and never reaches the admins. Run on the owner's list,
    the admins' queue and by cron."""
    rows = Promotion.objects.filter(status=Promotion.PAYING, updated_at__lte=timezone.now() - older_than)
    if owner is not None:
        rows = rows.filter(owner=owner)
    for p in rows.select_related('owner')[:limit]:
        check_payment(p)


def _apply_payment(promotion, answer):
    state = (answer or {}).get('status')
    if state == 'paid':
        with transaction.atomic():
            moved = Promotion.objects.filter(pk=promotion.pk, status=Promotion.PAYING).update(
                status=Promotion.REVIEW, paid_at=timezone.now(),
                mpesa_receipt=(answer.get('mpesa_receipt') or '')[:20], payment_note='')
        promotion.refresh_from_db()
        if moved:
            logger.info('[promotion] %s paid (%s)', promotion.pk, promotion.mpesa_receipt)
    elif state in ('failed', 'expired'):
        Promotion.objects.filter(pk=promotion.pk, status=Promotion.PAYING).update(
            status=Promotion.UNPAID, payment_note=(answer.get('result_desc') or state)[:255])
        promotion.refresh_from_db()
    return promotion


def cancel(promotion):
    if promotion.status != Promotion.UNPAID:
        raise Refused('paid', 'Only an unpaid promotion can be cancelled.')
    promotion.status = Promotion.CANCELLED
    promotion.save(update_fields=['status', 'updated_at'])
    return promotion


# ── review ───────────────────────────────────────────────────────────────────

def _tell(promotion, message):
    from .push import notify_user
    try:
        notify_user(promotion.owner, 'promotion', message,
                    data={'type': 'promotion', 'promotion_id': promotion.pk})
    except Exception:  # noqa: BLE001
        logger.exception('[promotion] push failed')


def approve(promotion, admin):
    if promotion.status != Promotion.REVIEW:
        raise Refused('state', 'Only a paid promotion waiting for review can be approved.')
    now = timezone.now()
    promotion.status = Promotion.ACTIVE
    promotion.reviewed_by, promotion.reviewed_at = admin, now
    promotion.starts_at, promotion.ends_at = now, now + timedelta(days=promotion.days)
    promotion.save()
    _tell(promotion, 'Your promotion was approved and is now running.')
    return promotion


def reject(promotion, admin, note):
    if promotion.status != Promotion.REVIEW:
        raise Refused('state', 'Only a paid promotion waiting for review can be declined.')
    note = (note or '').strip()
    if not note:
        raise Refused('note', 'Say why, so they can fix it.')
    promotion.status = Promotion.REJECTED
    promotion.reviewed_by, promotion.reviewed_at = admin, timezone.now()
    promotion.review_note = note[:500]
    promotion.refund_due = True
    promotion.save()
    _tell(promotion, f'Your promotion was not approved: {note[:120]}. Your payment will be refunded.')
    return promotion


def finish_expired(now=None):
    """Promotions whose days are up: done; short of their views, a refund of
    the difference is due. Cheap; run on serve and by cron."""
    now = now or timezone.now()
    for promo in Promotion.objects.filter(status=Promotion.ACTIVE, ends_at__lte=now):
        _finish(promo)


def _finish(promotion):
    with transaction.atomic():
        row = Promotion.objects.select_for_update().filter(pk=promotion.pk, status=Promotion.ACTIVE).first()
        if row is None:
            return                                 # already finished
        row.status = Promotion.DONE
        row.refund_due = row.views < row.views_target
        row.save(update_fields=['status', 'refund_due', 'updated_at'])
    promotion.refresh_from_db()
    _tell(promotion, f'Your promotion has finished: {promotion.views:,} views, {promotion.clicks:,} taps.')


def refund_owed(promotion):
    """KES owed back: everything for a declined one, the undelivered share
    of a finished one."""
    if not promotion.refund_due:
        return 0
    if promotion.status == Promotion.REJECTED:
        return promotion.price
    short = max(0, promotion.views_target - promotion.views)
    return round(promotion.price * short / max(1, promotion.views_target))


# ── delivery ─────────────────────────────────────────────────────────────────

def _matches(promotion, location):
    if not promotion.counties:
        return True
    where = (location or '').lower()
    return any(c.lower() in where for c in promotion.counties)


def _still_showable(p):
    if p.owner.is_deactivated:
        return False
    if p.kind == Promotion.KIND_POST:
        return bool(p.post) and not p.post.is_removed and p.post.visibility == SocialPost.VISIBILITY_PUBLIC
    if p.kind == Promotion.KIND_PRODUCT:
        return bool(p.product) and not p.product.is_removed and p.product.is_available
    if p.kind == Promotion.KIND_BOOK:
        return bool(p.publication) and not p.publication.is_removed and p.publication.status == 'published'
    if p.kind == Promotion.KIND_SERVICE:
        return bool(p.service) and not p.service.is_removed
    return True


def _behind(p, now):
    """How far behind schedule (lower = more behind)."""
    total = (p.ends_at - p.starts_at).total_seconds() or 1
    elapsed = max(0.0, (now - p.starts_at).total_seconds()) / total
    return p.views / max(1, p.views_target) - elapsed


def serve(viewer, count=2, request=None):
    """Up to `count` promotions for `viewer` to see now, as the app draws them."""
    from .models import blocked_ids_for
    now = timezone.now()
    finish_expired(now)
    seen_today = PromotionView.objects.filter(user=viewer, day=timezone.localdate()).values_list(
        'promotion_id', flat=True)
    blocked = blocked_ids_for(viewer)
    from .models import Profile
    location = Profile.objects.filter(user=viewer).values_list('location', flat=True).first() or ''
    candidates = (
        Promotion.objects.filter(status=Promotion.ACTIVE, starts_at__lte=now, ends_at__gt=now)
        .exclude(owner=viewer).exclude(pk__in=list(seen_today))
        .select_related('owner__profile', 'post', 'product__seller', 'publication__author', 'service')
    )
    if blocked:
        candidates = candidates.exclude(owner_id__in=blocked)
    chosen = [p for p in candidates if _matches(p, location) and _still_showable(p)]
    chosen.sort(key=lambda p: _behind(p, now))
    return [item(p, viewer, request) for p in chosen[:max(0, min(int(count), 4))]]


def item(promotion, viewer, request=None):
    """A promotion as the feed draws it: what it is, marked as sponsored."""
    from .serializers.social import SocialPostSerializer, product_card, service_card
    from .views.social import feed_post_queryset
    p = promotion
    out = {'promotion_id': p.pk, 'kind': p.kind, 'owner': {'id': p.owner_id, 'username': p.owner.username}}
    if p.kind == Promotion.KIND_POST:
        row = feed_post_queryset(viewer).filter(pk=p.post_id).first()
        ctx = {'request': request or SimpleNamespace(user=viewer)}
        out['post'] = SocialPostSerializer(row, context=ctx).data if row else None
    elif p.kind == Promotion.KIND_PRODUCT:
        out['product'] = product_card(SimpleNamespace(content_type='product', product_id=p.product_id, product=p.product))
    elif p.kind == Promotion.KIND_SERVICE:
        out['service'] = service_card(SimpleNamespace(content_type='service', service_id=p.service_id, service=p.service))
    elif p.kind == Promotion.KIND_BOOK:
        out['book'] = SocialPostSerializer().get_book(SimpleNamespace(
            content_type='book', publication_id=p.publication_id, publication=p.publication,
            book_chapter=None, book_quote='', book_block=None))
    elif p.kind == Promotion.KIND_PROFILE:
        prof = getattr(p.owner, 'profile', None)
        from .media import resolve
        out['profile'] = {
            'id': p.owner_id, 'username': p.owner.username,
            'display_name': getattr(prof, 'display_name', '') or '',
            'bio': (getattr(prof, 'bio', '') or '')[:160],
            'picture': resolve(getattr(prof, 'picture', '') or '') or '',
            'followers': p.owner.followers.count(),
            'is_following': p.owner.followers.filter(pk=viewer.pk).exists(),
        }
    return out


def seen(promotion, viewer):
    """The app showed it on screen: one view, once a day per person."""
    if promotion.status != Promotion.ACTIVE or promotion.owner_id == viewer.pk:
        return False
    try:
        with transaction.atomic():
            PromotionView.objects.create(promotion=promotion, user=viewer, day=timezone.localdate())
    except IntegrityError:
        return False
    Promotion.objects.filter(pk=promotion.pk).update(views=F('views') + 1)
    promotion.refresh_from_db(fields=['views', 'views_target', 'status'])
    if promotion.views >= promotion.views_target:
        _finish(promotion)
    return True


def tapped(promotion, viewer, action='open'):
    """A tap on it (opening it), or a follow from it. Counted once a day per person each."""
    if promotion.owner_id == viewer.pk:
        return
    if action == 'follow':
        # Once per person: following and unfollowing from the card again and
        # again must not inflate what the owner sees.
        from django.core.cache import cache
        if cache.add(f'promo:follow:{promotion.pk}:{viewer.pk}', 1, 60 * 60 * 24 * 60):
            Promotion.objects.filter(pk=promotion.pk).update(follows=F('follows') + 1)
        return
    moved = PromotionView.objects.filter(promotion=promotion, user=viewer, day=timezone.localdate(),
                                         clicked=False).update(clicked=True)
    if moved:
        Promotion.objects.filter(pk=promotion.pk).update(clicks=F('clicks') + 1)


def summary(promotion):
    """The owner's / an admin's view of one promotion."""
    p = promotion
    target = None
    if p.kind == Promotion.KIND_POST and p.post_id:
        target = {'id': p.post_id, 'caption': (p.post.caption or '')[:80], 'content_type': p.post.content_type}
    elif p.kind == Promotion.KIND_PRODUCT and p.product_id:
        target = {'id': p.product_id, 'slug': p.product.slug, 'title': p.product.title}
    elif p.kind == Promotion.KIND_BOOK and p.publication_id:
        target = {'id': p.publication_id, 'title': p.publication.title}
    elif p.kind == Promotion.KIND_SERVICE and p.service_id:
        target = {'id': p.service_id, 'name': p.service.name}
    elif p.kind == Promotion.KIND_PROFILE:
        target = {'id': p.owner_id, 'username': p.owner.username}
    return {
        'id': p.pk, 'kind': p.kind, 'status': p.status, 'target': target,
        'owner': {'id': p.owner_id, 'username': p.owner.username},
        'package': {'key': p.package.key, 'name': p.package.name},
        'price': p.price, 'views_target': p.views_target, 'days': p.days, 'counties': p.counties,
        'views': p.views, 'clicks': p.clicks, 'follows': p.follows,
        'payment_note': p.payment_note, 'mpesa_receipt': p.mpesa_receipt,
        'paid_at': p.paid_at, 'starts_at': p.starts_at, 'ends_at': p.ends_at,
        'review_note': p.review_note, 'refund_due': p.refund_due, 'refund_owed': refund_owed(p),
        'created_at': p.created_at,
    }

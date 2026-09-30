"""Wishlist alerts: a saved item came down in price, or is back in stock.

Called when a seller changes a product (ProductSerializer.update — the full
form and the dashboard's quick edit both go through it). Everyone who has
the product on their wishlist hears once, at most once a day for any one
product, and never the seller themself.
"""
from django.core.cache import cache

from .models import User
from .push import notify_many

ONCE_PER = 24 * 60 * 60
MAX_TOLD = 500


def buyable(available, quantity):
    return bool(available) and (quantity or 0) > 0


def tell_wishers(product, old_price, old_quantity, old_available):
    """Push to the wishers when the change is news to them. Returns how many
    were told (for tests)."""
    now = buyable(product.is_available, product.quantity)
    was = buyable(old_available, old_quantity)
    if not now:
        return 0
    dropped = old_price is not None and product.price < old_price
    if was and not dropped:
        return 0
    if was:
        message = (f'"{product.title}" is now {product.currency} {product.price:,.2f} '
                   f'(was {old_price:,.2f}).')
    else:
        message = f'"{product.title}" is back in stock.'

    # Who has not heard about this product today — then one batched send
    # (two queries, off the request thread) rather than a lookup and a thread
    # per person inside the seller's save.
    wishers = (User.objects.filter(wishlist__products=product)
               .exclude(pk=product.seller_id).values_list('pk', flat=True).distinct()[:MAX_TOLD])
    fresh = [uid for uid in wishers if cache.add(f'market:wish:{product.pk}:{uid}', 1, ONCE_PER)]
    if not fresh:
        return 0
    try:
        notify_many(fresh, 'market_wish', message,
                    data={'type': 'market_wish', 'slug': product.slug})
    except Exception:  # noqa: BLE001 — an alert never undoes an edit
        return 0
    return len(fresh)

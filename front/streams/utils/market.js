// Money, orders and sellers — what every marketplace screen needs, once.
//
// Prices are in each seller's own currency, so a cart or an order can hold
// shillings and dollars together. Nothing here ever adds different currencies
// into one number: totals are kept per currency (`totalsOf`), as the server
// sends them (`totals` on a cart or an order).

export const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', KES: 'Ksh ', NGN: '₦' };

/** "Ksh 1,200.00", "$90.00" — money arrives as strings (DRF decimals). */
export const formatPrice = (price, currency = 'USD') => {
  const code = currency || 'USD';
  const symbol = CURRENCY_SYMBOLS[code] ?? `${code} `;
  const n = typeof price === 'number' ? price : parseFloat(price);
  const value = Number.isFinite(n) ? n : 0;
  return `${symbol}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/** [{currency, amount}] from [[currency, amount]] — one entry per currency. */
export const totalsOf = (pairs) => {
  const sums = new Map();
  pairs.forEach(([currency, amount]) => {
    const key = currency || 'USD';
    sums.set(key, (sums.get(key) || 0) + (parseFloat(amount) || 0));
  });
  return [...sums].map(([currency, amount]) => ({ currency, amount }));
};

/** "Ksh 2,400.00 + $90.00" */
export const formatTotals = (totals = []) =>
  totals.length ? totals.map((x) => formatPrice(x.amount, x.currency)).join(' + ') : formatPrice(0);

/** A cart's totals, worked out from its lines — so they follow a change made
 *  on the phone at once, before the server has answered. */
export const cartTotals = (cart) => totalsOf((cart?.items || []).map((i) => [
  i.product?.currency, (parseFloat(i.product?.price) || 0) * (i.quantity || 0),
]));

/** How many things are in the cart (quantities, not lines). */
export const cartCount = (cart) => (cart?.items || []).reduce((n, i) => n + (i.quantity || 0), 0);

// ── order lines ──────────────────────────────────────────────────────────────
// An order line keeps what was bought (title, picture, currency) even when
// the product has since been edited or deleted; older servers only had the
// product, so both are read.

export const lineTitle = (item) => item?.title || item?.product?.title || '';
export const lineImage = (item) => item?.image_url || item?.product?.images?.[0]?.image_url || null;
export const lineCurrency = (item) => item?.currency || item?.product?.currency || 'USD';
export const lineUnit = (item) => parseFloat(item?.price_at_purchase ?? item?.product?.price ?? 0) || 0;

export const orderTotals = (order) => (order?.totals?.length
  ? order.totals
  : totalsOf((order?.items || []).map((i) => [lineCurrency(i), lineUnit(i) * i.quantity])));

/** An order's lines by seller — the buyer pays each seller directly, and the
 *  payment and contact details are the seller's (carried on the product). */
export const groupBySeller = (items = []) => {
  const groups = new Map();
  items.forEach((item) => {
    const seller = item.product?.seller;
    const key = seller?.id ?? item.seller ?? 'unknown';
    if (!groups.has(key)) {
      groups.set(key, {
        sellerId: seller?.id ?? item.seller ?? null,
        sellerName: seller?.username || '',
        product: item.product || {},
        items: [],
        currency: lineCurrency(item),
      });
    }
    const group = groups.get(key);
    group.items.push(item);
    if (!group.product?.id && item.product) group.product = item.product;
  });
  return [...groups.values()].map((g) => {
    // Lines called off are not owed; a part called off altogether keeps
    // its old total, to say what it was.
    const live = g.items.filter((i) => !i.cancelled_at);
    return {
      ...g,
      totals: totalsOf((live.length ? live : g.items).map((i) => [lineCurrency(i), lineUnit(i) * i.quantity])),
    };
  });
};

export const hasPaymentInfo = (p) =>
  !!(p?.mpesa_number || p?.till_number || p?.bank_details || p?.payment_instructions);

/** The error a marketplace request came back with, in the server's words
 *  when it gave some (stock limits say exactly how many are left). */
export const marketError = (e, fallback) =>
  e?.response?.data?.error || e?.response?.data?.detail || e?.data?.error || fallback;

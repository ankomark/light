// The cart and the wishlist, held on the phone and shared by every screen.
//
// Adding to the cart, changing a quantity, removing a line and tapping a
// wishlist heart all show at once; the server hears about it behind that, and
// its answer replaces the guess. When it says no (out of stock, offline) the
// change is taken back and the caller is told why.
//
// Kept on disk per user (screenCache), so the cart opens with what was in it
// last time, even with no connection — "offline" is said as offline, never
// as an empty cart.
import { useEffect, useState } from 'react';
import {
  fetchCart, addToCart, updateCartItem, removeFromCart,
  fetchWishlist, addToWishlist, removeFromWishlist,
} from '../services/api';
import { peekCache, readCache, writeCache, userKey } from './screenCache';

const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

const state = {
  user: undefined,
  cart: null,            // { items: [...], ... } as the server shapes it
  cartOffline: false,
  wishlist: null,        // { products: [...] }
  recent: [],            // products opened lately, newest first (lean)
};
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn({ ...state }));

const cartKey = () => userKey(state.user, 'market:cart');
const wishKey = () => userKey(state.user, 'market:wishlist');
const recentKey = () => userKey(state.user, 'market:recent');
const RECENT_MAX = 12;

const setCart = (cart, { keep = true } = {}) => {
  state.cart = cart;
  if (keep && cart) writeCache(cartKey(), cart);
  emit();
};
const setWishlist = (wishlist) => {
  state.wishlist = wishlist;
  if (wishlist) writeCache(wishKey(), wishlist);
  emit();
};

/** Whose cart this is. Switching accounts shows that account's own. */
export const useMarketUser = (userId) => {
  useEffect(() => {
    if (state.user === userId) return;
    state.user = userId;
    state.cart = peekCache(cartKey());
    state.wishlist = peekCache(wishKey());
    state.recent = peekCache(recentKey()) || [];
    emit();
    readCache(recentKey(), KEEP_MS).then((kept) => {
      if (kept?.length && !state.recent.length) { state.recent = kept; emit(); }
    });
    if (!userId) return;
    readCache(cartKey(), KEEP_MS).then((kept) => { if (kept && !state.cart) setCart(kept, { keep: false }); });
    readCache(wishKey(), KEEP_MS).then((kept) => { if (kept && !state.wishlist) setWishlist(kept); });
  }, [userId]);
};

export const useMarket = () => {
  const [snapshot, setSnapshot] = useState(() => ({ ...state }));
  useEffect(() => {
    listeners.add(setSnapshot);
    setSnapshot({ ...state });
    return () => listeners.delete(setSnapshot);
  }, []);
  return snapshot;
};

// ── the cart ─────────────────────────────────────────────────────────────────

// Changes on their way to the server. While any is, a cart read from the
// server may predate it, so it is not shown; one more read follows the last.
let busy = 0;
let rereadAfter = false;
let settled = [];
const working = async (fn) => {
  busy += 1;
  try {
    const out = await fn();
    // It reached the server: whatever was said about being offline is over.
    if (state.cartOffline) { state.cartOffline = false; emit(); }
    return out;
  } finally {
    busy -= 1;
    if (!busy) { settled.forEach((fn) => fn()); settled = []; }
    if (!busy && rereadAfter) {
      rereadAfter = false;
      refreshCart().catch(() => {});
    }
  }
};

/** Whether a change to the cart is still on its way to the server. */
export const cartBusy = () => busy > 0;

/** Resolves once every change on its way to the server has got there (or
 *  been refused), so checkout orders what the phone shows. */
export const whenCartSettled = () => (busy ? new Promise((done) => { settled.push(done); }) : Promise.resolve());

/** Ask the server for the cart. Offline, the kept one stays and says so. */
export const refreshCart = async () => {
  try {
    const cart = await fetchCart();
    state.cartOffline = false;
    if (busy) {
      // Older than a change in flight: keep what is shown, read again after.
      rereadAfter = true;
      emit();
      return state.cart;
    }
    setCart(cart);
    return cart;
  } catch (e) {
    state.cartOffline = true;
    emit();
    throw e;
  }
};

const leanProduct = (p) => ({
  id: p.id, slug: p.slug, title: p.title, price: p.price, currency: p.currency,
  quantity: p.quantity, is_available: p.is_available, is_digital: p.is_digital,
  seller: p.seller, images: (p.images || []).slice(0, 1),
});

/** Change only the lines `fn` changes, leaving everything else as it is
 *  now (not as it was when the change began). */
const editLines = (fn) => setCart({ ...(state.cart || {}), items: fn(state.cart?.items || []) });

/** Put `quantity` of `product` in the cart. Shown at once; throws (after
 *  taking back just this) when the server refuses; the error says why. */
export const addProductToCart = async (product, quantity = 1) => {
  const had = (state.cart?.items || []).some((i) => i.product?.id === product.id);
  editLines((items) => (had
    ? items.map((i) => (i.product?.id === product.id ? { ...i, quantity: i.quantity + quantity } : i))
    : [{ id: `new-${product.id}`, product: leanProduct(product), quantity, pending: true }, ...items]));
  try {
    await working(() => addToCart(product.id, quantity));
    // The real line (its id, the stock now) comes with the server's cart.
    rereadAfter = true;
    if (!busy) { rereadAfter = false; refreshCart().catch(() => {}); }
  } catch (e) {
    editLines((items) => items
      .map((i) => (i.product?.id === product.id ? { ...i, quantity: i.quantity - quantity } : i))
      .filter((i) => i.quantity > 0));
    throw e;
  }
};

// Quantity changes, per line: the newest number wins, and they go one at a
// time, so quick taps never reach the server out of order. A refusal puts
// back the last number the server took, for that line only.
const sends = new Map();   // line id -> { want, confirmed, running }

export const setCartQuantity = (item, quantity) => {
  if (quantity < 1) return Promise.resolve();
  let send = sends.get(item.id);
  if (!send) {
    const now = (state.cart?.items || []).find((i) => i.id === item.id);
    send = { confirmed: now ? now.quantity : item.quantity, want: quantity, running: null };
    sends.set(item.id, send);
  }
  send.want = quantity;
  editLines((items) => items.map((i) => (i.id === item.id ? { ...i, quantity } : i)));
  if (!send.running) {
    send.running = working(async () => {
      try {
        while (send.want !== send.confirmed) {
          const value = send.want;
          await updateCartItem(item.id, value);
          send.confirmed = value;
        }
      } catch (e) {
        const back = send.confirmed;
        editLines((items) => items.map((i) => (i.id === item.id ? { ...i, quantity: back } : i)));
        throw e;
      } finally {
        sends.delete(item.id);
      }
    });
  }
  return send.running;
};

export const removeCartLine = async (item) => {
  const at = (state.cart?.items || []).findIndex((i) => i.id === item.id);
  const line = at >= 0 ? state.cart.items[at] : item;
  editLines((items) => items.filter((i) => i.id !== item.id));
  try {
    await working(() => removeFromCart(item.id));
  } catch (e) {
    // Back where it was, among the lines as they are now.
    editLines((items) => {
      const next = [...items];
      next.splice(Math.max(0, Math.min(at, next.length)), 0, line);
      return next;
    });
    throw e;
  }
};

/** After checkout the server has emptied the cart; so does the phone. */
export const emptyCart = () => setCart({ ...(state.cart || {}), items: [] });

// ── the wishlist ─────────────────────────────────────────────────────────────

export const refreshWishlist = async () => {
  const wishlist = await fetchWishlist();
  setWishlist(wishlist);
  return wishlist;
};

export const isWished = (snapshot, productId) =>
  !!(snapshot.wishlist?.products || []).some((p) => p.id === productId);

/** Heart on or off, at once; taken back if the server refuses. */
export const toggleWish = async (product, on) => {
  const before = state.wishlist;
  const products = (before?.products || []).filter((p) => p.id !== product.id);
  setWishlist({ ...(before || {}), products: on ? [leanProduct(product), ...products] : products });
  try {
    if (on) await addToWishlist(product.id);
    else await removeFromWishlist(product.id);
  } catch (e) {
    setWishlist(before);
    throw e;
  }
};

// ── recently viewed ──────────────────────────────────────────────────────────

/** A product was opened: first in "Recently viewed", kept on this phone only. */
export const rememberViewed = (product) => {
  if (!product?.id) return;
  state.recent = [leanProduct(product), ...state.recent.filter((p) => p.id !== product.id)]
    .slice(0, RECENT_MAX);
  writeCache(recentKey(), state.recent);
  emit();
};

/** For tests. */
export const resetMarketStore = () => {
  busy = 0;
  rereadAfter = false;
  settled = [];
  sends.clear();
  state.user = undefined;
  state.cart = null;
  state.cartOffline = false;
  state.wishlist = null;
  state.recent = [];
  emit();
};

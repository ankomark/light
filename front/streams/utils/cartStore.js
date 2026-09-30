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

/** Ask the server for the cart. Offline, the kept one stays and says so. */
export const refreshCart = async () => {
  try {
    const cart = await fetchCart();
    state.cartOffline = false;
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

/** Put `quantity` of `product` in the cart. Shown at once; throws (after
 *  taking it back) when the server refuses — the error says why. */
export const addProductToCart = async (product, quantity = 1) => {
  const before = state.cart;
  const items = [...(before?.items || [])];
  const at = items.findIndex((i) => i.product?.id === product.id);
  if (at >= 0) items[at] = { ...items[at], quantity: items[at].quantity + quantity };
  else items.unshift({ id: `new-${product.id}`, product: leanProduct(product), quantity, pending: true });
  setCart({ ...(before || {}), items });
  try {
    await addToCart(product.id, quantity);
    // The real line (its id, the stock now) comes with the server's cart.
    refreshCart().catch(() => {});
  } catch (e) {
    setCart(before);
    throw e;
  }
};

export const setCartQuantity = async (item, quantity) => {
  if (quantity < 1) return;
  const before = state.cart;
  setCart({
    ...before,
    items: (before?.items || []).map((i) => (i.id === item.id ? { ...i, quantity } : i)),
  });
  try {
    await updateCartItem(item.id, quantity);
  } catch (e) {
    setCart(before);
    throw e;
  }
};

export const removeCartLine = async (item) => {
  const before = state.cart;
  setCart({ ...before, items: (before?.items || []).filter((i) => i.id !== item.id) });
  try {
    await removeFromCart(item.id);
  } catch (e) {
    setCart(before);
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
  state.user = undefined;
  state.cart = null;
  state.cartOffline = false;
  state.wishlist = null;
  state.recent = [];
  emit();
};

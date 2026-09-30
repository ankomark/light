// What the marketplace's front page shows — what people are selling, newest
// first, and the categories — loaded so that opening the page is instant:
//
// - warmMarket() fills the phone's copy in the background soon after the app
//   starts (and fetches the first photos), so even the first open of the day
//   paints products straight away;
// - the page then shows that copy at once and refreshes behind it.
//
// Products and categories are asked for separately: one failing must never
// leave the page without the other (they used to come together or not at all).
import { Image } from 'expo-image';
import { fetchProducts, fetchProductCategories } from '../services/api';
import { readCache, writeCache } from './screenCache';

export const MARKET_HOME_KEY = 'market:home:v2';
export const HOME_PAGE_SIZE = 20;
const FRESH_MS = 5 * 60 * 1000;          // a copy younger than this is not re-fetched by the warm-up
const PHOTOS_AHEAD = 12;

const listOf = (data) => (Array.isArray(data) ? data : (data?.results || []));

const STRIP_SIZE = 10;
const CATEGORY_ROWS = 3;

/** { products, next, categories, popular, rows } — whatever arrived. Throws
 *  only if the products and the categories both failed (so a kept page is
 *  kept rather than emptied).
 *
 *  `popular` (most viewed) is the spotlight; `rows` are the fullest
 *  categories, each a row of its own that scrolls sideways. */
export const loadMarketHome = async () => {
  const [products, categories, popular] = await Promise.allSettled([
    fetchProducts(1, { page_size: HOME_PAGE_SIZE }),
    fetchProductCategories(),
    fetchProducts(1, { page_size: STRIP_SIZE, sort: 'popular' }),
  ]);
  if (products.status === 'rejected' && categories.status === 'rejected') throw products.reason;
  const cats = categories.status === 'fulfilled'
    // Only categories with something in them (older servers send no count).
    ? listOf(categories.value).filter((c) => c.product_count == null || c.product_count > 0)
    : null;

  // A row for each of the fullest categories (two or more things in them).
  const top = (cats || []).filter((c) => (c.product_count ?? 0) >= 2).slice(0, CATEGORY_ROWS);
  const rows = (await Promise.allSettled(
    top.map((c) => fetchProducts(1, { page_size: STRIP_SIZE, category: c.id })),
  )).map((r, i) => ({ category: top[i], products: r.status === 'fulfilled' ? r.value?.results || [] : [] }))
    .filter((r) => r.products.length);

  return {
    products: products.status === 'fulfilled' ? products.value?.results || [] : null,
    next: products.status === 'fulfilled' ? !!products.value?.next : false,
    categories: cats,
    popular: popular.status === 'fulfilled' ? popular.value?.results || [] : null,
    rows: cats ? rows : null,
    at: Date.now(),
  };
};

/** A fresh load laid over the kept one: what failed this time keeps its
 *  last copy instead of going empty. */
export const mergeHome = (fresh, kept) => ({
  ...fresh,
  products: fresh.products ?? kept?.products ?? [],
  categories: fresh.categories ?? kept?.categories ?? [],
  popular: fresh.popular ?? kept?.popular ?? [],
  rows: fresh.rows ?? kept?.rows ?? [],
});

/** The photos of the first products, fetched into the image cache. */
export const prefetchPhotos = (products = []) => {
  const urls = products.map((p) => p.images?.[0]?.image_url).filter(Boolean).slice(0, PHOTOS_AHEAD);
  if (urls.length) Image.prefetch?.(urls)?.catch?.(() => {});
};

/** Fill the marketplace's copy on the phone, unless a fresh one is there. */
export const warmMarket = async () => {
  try {
    const kept = await readCache(MARKET_HOME_KEY, 7 * 24 * 60 * 60 * 1000);
    if (kept?.at && Date.now() - kept.at < FRESH_MS) return kept;
    const merged = mergeHome(await loadMarketHome(), kept);
    writeCache(MARKET_HOME_KEY, merged);
    prefetchPhotos([...(merged.popular || []).slice(0, 4), ...merged.products]);
    return merged;
  } catch {
    return null;   // offline: the page will try again when opened
  }
};

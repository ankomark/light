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

/** { products, next, categories } — whichever of the two arrived. Throws
 *  only if neither did (so a cached page is kept rather than emptied). */
export const loadMarketHome = async () => {
  const [products, categories] = await Promise.allSettled([
    fetchProducts(1, { page_size: HOME_PAGE_SIZE }),
    fetchProductCategories(),
  ]);
  if (products.status === 'rejected' && categories.status === 'rejected') throw products.reason;
  const cats = categories.status === 'fulfilled' ? listOf(categories.value) : null;
  return {
    products: products.status === 'fulfilled' ? products.value?.results || [] : null,
    next: products.status === 'fulfilled' ? !!products.value?.next : false,
    // Only categories with something in them (older servers send no count).
    categories: cats ? cats.filter((c) => c.product_count == null || c.product_count > 0) : null,
    at: Date.now(),
  };
};

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
    const fresh = await loadMarketHome();
    // Keep what did not come this time from the copy already kept.
    const merged = {
      ...fresh,
      products: fresh.products ?? kept?.products ?? [],
      categories: fresh.categories ?? kept?.categories ?? [],
    };
    writeCache(MARKET_HOME_KEY, merged);
    prefetchPhotos(merged.products);
    return merged;
  } catch {
    return null;   // offline: the page will try again when opened
  }
};

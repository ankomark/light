// Favourite hymns: the ones a user keeps close for singing and memorising.
//
// Saved on the phone (the hymnals are bundled with the app, so this works with
// no signal — in church, say) as [{ lang, number, at }], newest first. One
// shared store: the ♡ on a hymn and the Favourites list update together.
import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HYMNAL_ORDER } from '../utils/hymnals';

const KEY = 'hymnFavorites:v1';

let items = [];
let loaded = false;
let loading = null;
const subscribers = new Set();

const publish = () => {
  items = items.slice();           // a new identity, so hooks re-render
  subscribers.forEach((fn) => fn());
};

const valid = (f) => f && typeof f.lang === 'string' && Number.isFinite(Number(f.number));

export const loadHymnFavorites = () => {
  if (!loading) {
    loading = AsyncStorage.getItem(KEY)
      .then((raw) => {
        const stored = raw ? JSON.parse(raw) : [];
        items = Array.isArray(stored)
          ? stored.filter(valid).map((f) => ({ lang: f.lang, number: Number(f.number), at: Number(f.at) || 0 }))
          : [];
      })
      .catch(() => { items = []; })
      .finally(() => { loaded = true; publish(); });
  }
  return loading;
};

const save = () => AsyncStorage.setItem(KEY, JSON.stringify(items)).catch(() => {});

const same = (lang, number) => (f) => f.lang === lang && f.number === Number(number);

export const isHymnFavorite = (lang, number) => items.some(same(lang, number));

/** Add or remove; resolves to whether it's a favourite now. */
export const toggleHymnFavorite = async (lang, number) => {
  await loadHymnFavorites();             // never lose what's stored to an early tap
  const on = !isHymnFavorite(lang, number);
  items = on
    ? [{ lang, number: Number(number), at: Date.now() }, ...items]
    : items.filter((f) => !same(lang, number)(f));
  publish();
  save();
  return on;
};

const subscribe = (fn) => {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
};
const snapshot = () => items;

/** { favorites, loaded, isFavorite(lang, number), toggle(lang, number) } */
export const useHymnFavorites = () => {
  useEffect(() => { loadHymnFavorites(); }, []);
  const favorites = useSyncExternalStore(subscribe, snapshot, snapshot);
  return {
    favorites,
    loaded,
    isFavorite: (lang, number) => favorites.some(same(lang, number)),
    toggle: toggleHymnFavorite,
  };
};

// How the Favourites list can be ordered.
export const FAVORITE_SORTS = ['recent', 'number', 'title', 'hymnal'];

// A title as it sorts: no leading quotes or punctuation ("'Tis so sweet" under T).
// (A plain character list, not \p{L}: not every phone's JS engine has those.)
const sortTitle = (title) => String(title || '').replace(/^[\s"'“”‘’«»¡¿([{.,;:!?*-]+/, '');
const book = (lang) => { const i = HYMNAL_ORDER.indexOf(lang); return i < 0 ? HYMNAL_ORDER.length : i; };

/** Sort favourite rows ({ lang, hymn, at }), given newest-first as the store
 *  keeps them, into a new array by `sort`. Ties fall back to the hymnal
 *  order, then the number, so the order is stable. */
export const sortFavorites = (rows, sort = 'recent') => {
  // Recent is the store's own order: timestamps can tie (two taps in one
  // millisecond, a clock change), the order they were added in can't.
  if (!FAVORITE_SORTS.includes(sort) || sort === 'recent') return [...rows];
  const byBookThenNumber = (a, b) => book(a.lang) - book(b.lang) || a.hymn.number - b.hymn.number;
  const cmp = {
    number: (a, b) => a.hymn.number - b.hymn.number || book(a.lang) - book(b.lang),
    title: (a, b) => sortTitle(a.hymn.title).localeCompare(sortTitle(b.hymn.title), undefined, { sensitivity: 'base' })
      || byBookThenNumber(a, b),
    hymnal: byBookThenNumber,
  }[sort];
  return [...rows].sort(cmp);
};

// Test-only reset.
export const __resetHymnFavorites = () => {
  items = [];
  loaded = false;
  loading = null;
  publish();
};

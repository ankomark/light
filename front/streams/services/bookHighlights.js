// Highlights and notes in books — on the phone first, synced to the account.
//
// A highlight is made on the phone (with its own id), shown at once, kept per
// book on the phone, and queued for the server; the queue is sent when there
// is signal. Opening a book fetches its highlights from the account (another
// phone's included) and merges them in — a change still waiting to be sent
// stays as it is, and the newer change wins on the server.
import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchBookHighlights, syncBookHighlights } from './api';

const BOOK_PREFIX = 'bookhl:v1:';
const OUTBOX = 'bookhl:outbox:v1';
const BATCH = 100;

const books = new Map();        // pubId → { cid: highlight }
const subs = new Set();
let outbox = null;              // [{ op, client_id, ... }]
let outboxLoad = null;
let flushing = null;
const EMPTY = [];
const lists = new Map();        // pubId → the array last handed out (stable between changes)

const publish = (pubId) => {
  lists.delete(pubId);
  subs.forEach((fn) => fn());
};

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const loadOutbox = () => {
  if (!outboxLoad) {
    outboxLoad = AsyncStorage.getItem(OUTBOX)
      .then((raw) => { const v = raw ? JSON.parse(raw) : []; outbox = Array.isArray(v) ? v : []; })
      .catch(() => { outbox = []; });
  }
  return outboxLoad;
};
const saveOutbox = () => AsyncStorage.setItem(OUTBOX, JSON.stringify(outbox)).catch(() => {});
const saveBook = (pubId) => AsyncStorage.setItem(BOOK_PREFIX + pubId, JSON.stringify(books.get(pubId) || {})).catch(() => {});

const queue = async (op) => {
  await loadOutbox();
  // One pending change per highlight: the latest.
  outbox = [...outbox.filter((o) => o.client_id !== op.client_id), op];
  saveOutbox();
  flushHighlights().catch(() => {});
};

/** Send what's waiting. Keeps it on a network failure. */
export const flushHighlights = () => {
  if (flushing) return flushing;
  flushing = (async () => {
    await loadOutbox();
    while (outbox.length) {
      const batch = outbox.slice(0, BATCH);
      try {
        await syncBookHighlights(batch);
      } catch (err) {
        // Refused (bad data, a book gone): dropped, not retried for ever.
        // No answer (offline) or signed out: kept for later.
        if (!(err?.status >= 400 && err?.status < 500 && err.status !== 401 && err.status !== 429)) break;
      }
      // What was sent goes. A change made to one of them meanwhile replaced
      // its op with a new one — not in this batch, so it stays to be sent.
      outbox = outbox.filter((o) => !batch.includes(o));
      saveOutbox();
    }
  })().finally(() => { flushing = null; });
  return flushing;
};

/** A book's highlights: from the phone at once, then the account's merged in. */
export const loadBookHighlights = async (pubId, { remote = true } = {}) => {
  if (!books.has(pubId)) {
    try {
      const raw = await AsyncStorage.getItem(BOOK_PREFIX + pubId);
      const v = raw ? JSON.parse(raw) : {};
      books.set(pubId, v && typeof v === 'object' ? v : {});
    } catch {
      books.set(pubId, {});
    }
    publish(pubId);
  }
  if (!remote) return;
  let rows;
  try {
    rows = (await fetchBookHighlights({ publication: pubId }))?.results || [];
  } catch {
    return;                                                // offline: the phone's copy stands
  }
  await loadOutbox();
  const pending = new Set(outbox.map((o) => o.client_id));
  const next = {};
  Object.values(books.get(pubId) || {}).forEach((h) => { if (pending.has(h.client_id)) next[h.client_id] = h; });
  rows.forEach((r) => {
    if (pending.has(r.client_id) || r.deleted) return;
    next[r.client_id] = {
      client_id: r.client_id, publication: pubId, chapter_id: r.chapter_id, block: r.block,
      quote: r.quote, color: r.color, note: r.note, collection: r.collection || '', at: Date.parse(r.updated_at) || Date.now(),
    };
  });
  books.set(pubId, next);
  saveBook(pubId);
  publish(pubId);
};

/** Make or change a highlight (colour and/or note, and the reader's own
 *  collection for it). Neither colour nor note left → removed. */
export const saveHighlight = async (pubId, { client_id, chapter_id, block, quote, color = '', note = '', collection = '' }) => {
  if (!books.has(pubId)) await loadBookHighlights(pubId, { remote: false });
  const cid = client_id || newId();
  const at = Date.now();
  if (!color && !String(note).trim()) return removeHighlight(pubId, cid);
  const h = { client_id: cid, publication: pubId, chapter_id, block, quote, color, note, collection, at };
  books.set(pubId, { ...books.get(pubId), [cid]: h });
  saveBook(pubId);
  publish(pubId);
  await queue({ op: 'upsert', ...h, at: new Date(at).toISOString() });
  return h;
};

export const removeHighlight = async (pubId, cid) => {
  if (!books.has(pubId)) await loadBookHighlights(pubId, { remote: false });
  const next = { ...books.get(pubId) };
  delete next[cid];
  books.set(pubId, next);
  saveBook(pubId);
  publish(pubId);
  await queue({ op: 'delete', client_id: cid, at: new Date().toISOString() });
  return null;
};

const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };

/** A book's highlights, live. */
export const useBookHighlights = (pubId) => {
  useEffect(() => { if (pubId != null) loadBookHighlights(pubId); }, [pubId]);
  const snap = () => {
    if (pubId == null || !books.has(pubId)) return EMPTY;
    if (!lists.has(pubId)) lists.set(pubId, Object.values(books.get(pubId)));
    return lists.get(pubId);
  };
  return useSyncExternalStore(subscribe, snap, snap);
};

/** On logout: every book's highlights and what's waiting are the leaving
 *  account's. */
export const clearBookHighlights = async () => {
  books.clear();
  lists.clear();
  outbox = [];
  outboxLoad = Promise.resolve();
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(BOOK_PREFIX) || k === OUTBOX);
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch {
    // best-effort
  }
  subs.forEach((fn) => fn());
};

export const __pendingHighlightOps = async () => { await loadOutbox(); return outbox.map((o) => ({ ...o })); };
export const __resetBookHighlights = () => {
  books.clear(); lists.clear(); outbox = null; outboxLoad = null; flushing = null;
};

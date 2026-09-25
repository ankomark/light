// Publishing, fast and offline: the book page and its chapters kept on the
// phone.
//
//   - The book page (a publication with its table of contents, no chapter
//     bodies) goes through the screen cache: it paints at once on a return
//     visit and refreshes behind.
//   - Chapters are fetched one at a time and kept on the phone, so a chapter
//     read once opens instantly and with no signal, and a whole book can be
//     downloaded before a journey.
//
// Knowing a kept chapter is current costs nothing: the server gives chapters
// new ids whenever a book is saved, so a kept chapter whose id still matches
// the table of contents is exactly what's published.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchPublication, fetchPublicationChapter } from './api';
import { peekCache, readCache, writeCache, dropCache, userKey } from '../utils/screenCache';

const CH_PREFIX = 'pubch:v1:';
const CH_INDEX = 'pubch:v1:index';
// Chapters kept on the phone, most recently read first. Bodies can carry
// images, so the shelf is capped.
export const MAX_KEPT_CHAPTERS = 120;

// ── Lists changed ───────────────────────────────────────────────────────────
// After a write (publish, edit, delete, like, save) the list must not paint
// its old rows for a minute: it reloads on its next focus.
let changedAt = 0;
export const notePublicationsChanged = () => { changedAt = Date.now(); };
export const publicationsChangedSince = (t) => changedAt > t;

// ── The book page ───────────────────────────────────────────────────────────
export const bookKey = (userId, id) => userKey(userId, `pub:${id}`);

export const peekBook = (userId, id) => peekCache(bookKey(userId, id));
export const readBook = (userId, id) => readCache(bookKey(userId, id));

/** The book page from the server, kept for next time. */
export const fetchBook = async (userId, id) => {
  const book = await fetchPublication(id, { toc: true });
  writeCache(bookKey(userId, id), book);
  return book;
};

export const forgetBook = (userId, id) => dropCache(bookKey(userId, id));

/** A change the reader made (liked it, saved it) kept on the cached page too. */
export const patchBook = (userId, id, patch) => {
  const book = peekBook(userId, id);
  if (book) writeCache(bookKey(userId, id), { ...book, ...patch });
};

// ── Chapters ────────────────────────────────────────────────────────────────
const memory = new Map();          // key → chapter, this session
let index = null;                  // [key, …], most recent first
let indexLoad = null;

const chKey = (pubId, i) => `${CH_PREFIX}${pubId}:${i}`;

const loadIndex = () => {
  if (!indexLoad) {
    indexLoad = AsyncStorage.getItem(CH_INDEX)
      .then((raw) => { const v = raw ? JSON.parse(raw) : []; index = Array.isArray(v) ? v : []; })
      .catch(() => { index = []; });
  }
  return indexLoad;
};

// Bumped on logout: a save still on its way must not write after the shelf
// was cleared.
let generation = 0;

const remember = async (key) => {
  const gen = generation;
  await loadIndex();
  if (gen !== generation) return;
  index = [key, ...index.filter((k) => k !== key)];
  const dropped = index.slice(MAX_KEPT_CHAPTERS);
  index = index.slice(0, MAX_KEPT_CHAPTERS);
  AsyncStorage.setItem(CH_INDEX, JSON.stringify(index)).catch(() => {});
  if (dropped.length) {
    dropped.forEach((k) => memory.delete(k));
    AsyncStorage.multiRemove(dropped).catch(() => {});
  }
};

const store = (key, chapter) => {
  memory.set(key, chapter);
  AsyncStorage.setItem(key, JSON.stringify(chapter)).catch(() => {});
  remember(key);
};

/** The kept copy of chapter `i`, or null. `chapterId`, when known, must match
 *  (a different id means the book was edited since). */
export const keptChapter = async (pubId, i, chapterId) => {
  const key = chKey(pubId, i);
  let ch = memory.get(key);
  if (!ch) {
    try {
      const raw = await AsyncStorage.getItem(key);
      ch = raw ? JSON.parse(raw) : null;
    } catch {
      ch = null;
    }
    if (ch) memory.set(key, ch);
  }
  if (!ch || typeof ch.body !== 'string') return null;
  if (chapterId != null && ch.id !== chapterId) return null;
  return ch;
};

/**
 * Chapter `i` of a book: { chapter, stale }.
 *   - kept and current → straight from the phone, no network;
 *   - otherwise fetched and kept;
 *   - offline with an older copy kept → that copy, marked stale.
 * `fallback` is the chapter with its body when the book page carried one
 * (a server from before chapters were served singly).
 */
export const loadChapter = async (pubId, i, chapterId, fallback = null) => {
  const current = await keptChapter(pubId, i, chapterId);
  if (current) return { chapter: current, stale: false };
  if (fallback && typeof fallback.body === 'string') {
    store(chKey(pubId, i), fallback);
    return { chapter: fallback, stale: false };
  }
  try {
    const res = await fetchPublicationChapter(pubId, i);
    const ch = res?.chapter;
    if (!ch || typeof ch.body !== 'string') throw new Error('no chapter');
    store(chKey(pubId, i), ch);
    return { chapter: ch, stale: false };
  } catch (err) {
    const older = await keptChapter(pubId, i, null);
    if (older) return { chapter: older, stale: true };
    throw err;
  }
};

/** Which of a book's chapters are on the phone and current. */
export const keptChapterCount = async (pubId, chapters = []) => {
  let n = 0;
  for (let i = 0; i < chapters.length; i += 1) {
    if (await keptChapter(pubId, i, chapters[i]?.id)) n += 1;
  }
  return n;
};

/** Keep a whole book for reading offline. `onProgress(done, total)`.
 *  Stops at the first failure (the chapters kept so far stay kept). */
export const downloadBook = async (pubId, chapters = [], onProgress) => {
  let done = 0;
  for (let i = 0; i < chapters.length; i += 1) {
    const { stale } = await loadChapter(pubId, i, chapters[i]?.id);
    if (stale) throw new Error('offline');       // an older copy isn't the book
    done += 1;
    onProgress?.(done, chapters.length);
  }
  return done;
};

/** Drop every kept chapter — on logout, since a kept chapter can be the
 *  author's own draft. */
export const forgetKeptChapters = async () => {
  generation += 1;
  memory.clear();
  index = [];
  indexLoad = Promise.resolve();
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(CH_PREFIX));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch {
    // best-effort
  }
};

// Test-only reset.
export const __resetPublicationStore = () => {
  memory.clear();
  index = null;
  indexLoad = null;
  changedAt = 0;
};

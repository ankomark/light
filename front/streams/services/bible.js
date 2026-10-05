// Bible text from the Free Use Bible API (bible.helloao.org) — see
// utils/bibleVersions.js for the versions and their licences.
//
//   GET /api/<version>/books.json        the books, named in that language
//   GET /api/<version>/<BOOK>/<n>.json   a chapter: headings and verses
//
// Everything read is kept on the phone (a version's books, each chapter), so
// a chapter read once opens instantly and with no signal. The texts are
// public domain or openly licensed, so keeping copies is allowed.
//
// Kept as FILES (documentDirectory/bible/), not in AsyncStorage: on Android
// AsyncStorage is one 6 MB database shared by the whole app - a few books of
// a few versions filled it, and from then on every save failed silently,
// Bible notes and highlights included. Copies saved there by older builds
// are moved over once (moveOldCopies).
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { BIBLE_BOOKS, EKEGUSII_BOOK_NAMES, getBibleVersion } from '../utils/bibleVersions';

const BASE = 'https://bible.helloao.org/api';
const PREFIX = 'bible:v1:';
const MEMORY_CHAPTERS = 30;
// A request that hasn't answered by then isn't going to (a dead connection):
// say so and offer Retry rather than spin.
const FETCH_TIMEOUT_MS = 15000;

const memBooks = new Map();
const memChapters = new Map();

const getJson = async (url) => {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

const fetchWithTimeout = async (url) => {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
  } finally {
    clearTimeout(timer);
  }
};

// ── Saved copies: files (AsyncStorage only where there is no file system) ──
const DIR = FileSystem?.documentDirectory ? `${FileSystem.documentDirectory}bible/` : null;
const fileFor = (key) => `${DIR}${String(key).replace(/[^A-Za-z0-9_.-]/g, '_')}.json`;
let dirReady = null;
const ensureDir = () => {
  if (!dirReady) {
    dirReady = FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  }
  return dirReady;
};

const readStored = async (key) => {
  if (DIR) {
    await moveOldCopies();
    try {
      const raw = await FileSystem.readAsStringAsync(fileFor(key));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;   // not saved yet
    }
  }
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const store = async (key, value) => {
  try {
    if (DIR) {
      await ensureDir();
      await FileSystem.writeAsStringAsync(fileFor(key), JSON.stringify(value));
    } else {
      await AsyncStorage.setItem(PREFIX + key, JSON.stringify(value));
    }
  } catch { /* a copy we couldn't keep: it is fetched again next time */ }
};

/** Older builds kept every chapter in AsyncStorage: move them to files (so
 *  offline reading keeps working) and free that space. Once per install. */
const MOVED_KEY = `${PREFIX}moved-to-files`;
let moving = null;
export const moveOldCopies = () => {
  if (!DIR) return Promise.resolve();
  if (!moving) {
    moving = (async () => {
      try {
        if (await AsyncStorage.getItem(MOVED_KEY)) return;
        const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX) && k !== MOVED_KEY);
        await ensureDir();
        for (let i = 0; i < keys.length; i += 20) {
          const batch = keys.slice(i, i + 20);
          const rows = await AsyncStorage.multiGet(batch);
          for (const [k, raw] of rows) {
            if (raw) {
              await FileSystem.writeAsStringAsync(fileFor(k.slice(PREFIX.length)), raw).catch(() => {});
            }
          }
          await AsyncStorage.multiRemove(batch);
        }
        await AsyncStorage.setItem(MOVED_KEY, '1');
      } catch { /* tried again next start */ }
    })();
  }
  return moving;
};

const ENGLISH = new Map(BIBLE_BOOKS.map((b) => [b.id, b.english]));

/** A version's books: [{ id, name, english, chapters, order }] in order. */
export const fetchBibleBooks = async (versionId) => {
  // A `web` version (Ekegusii) has nothing to fetch: its names are known.
  if (getBibleVersion(versionId).web) {
    return BIBLE_BOOKS.map((b) => ({ ...b, name: EKEGUSII_BOOK_NAMES[b.id] || b.english }));
  }
  if (memBooks.has(versionId)) return memBooks.get(versionId);
  const stored = await readStored(`books:${versionId}`);
  if (stored) {
    memBooks.set(versionId, stored);
    return stored;
  }
  const data = await getJson(`${BASE}/${encodeURIComponent(versionId)}/books.json`);
  const books = (data?.books || [])
    .filter((b) => ENGLISH.has(b.id))                 // the 66 (no deuterocanon)
    .sort((a, b) => a.order - b.order)
    .map((b) => ({
      id: b.id,
      name: b.commonName || b.name || ENGLISH.get(b.id),
      english: ENGLISH.get(b.id),
      chapters: b.numberOfChapters,
      order: BIBLE_BOOKS.find((x) => x.id === b.id).order,
    }));
  if (!books.length) throw new Error('no books');
  memBooks.set(versionId, books);
  store(`books:${versionId}`, books);
  return books;
};

// Printed Bibles' paragraph marks (the KJV has them) aren't for reading.
const clean = (s) => String(s).replace(/¶\s*/g, '');

/**
 * The API's chapter content → what the reader draws:
 *   [{ type: 'heading', text }, { type: 'verse', number, parts: [{ text, jesus }] }]
 * A verse's content mixes plain strings, { text, wordsOfJesus }, { text,
 * poem }, { lineBreak } and footnote markers ({ noteId }, dropped).
 */
export const parseChapter = (content = []) => {
  const out = [];
  for (const item of content) {
    if (!item) continue;
    if (item.type === 'heading' || item.type === 'hebrew_subtitle') {
      const text = clean((item.content || []).filter((c) => typeof c === 'string' || c?.text).map((c) => c.text ?? c).join(' ')).trim();
      if (text) out.push({ type: 'heading', text });
    } else if (item.type === 'verse') {
      // Each piece with what goes before it: poetry lines (Psalms) start a
      // new line — a second-level line indented, as printed — prose a space.
      const pieces = [];
      let breakNext = false;
      for (const c of item.content || []) {
        if (c?.lineBreak) { breakNext = true; continue; }
        const text = typeof c === 'string' ? c : c?.text;
        if (!text) continue;                             // footnote markers
        const poem = typeof c === 'object' ? c.poem : 0;
        const sep = !pieces.length ? '' : (poem || breakNext) ? `\n${poem > 1 ? ' ' : ''}` : ' ';
        pieces.push({ text: sep + clean(text), jesus: typeof c === 'object' && !!c.wordsOfJesus });
        breakNext = false;
      }
      // Neighbouring pieces of the same kind become one part.
      const merged = [];
      for (const p of pieces) {
        const last = merged[merged.length - 1];
        if (last && last.jesus === p.jesus) last.text += p.text;
        else merged.push({ ...p });
      }
      const tidy = (s) => s.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n');
      const kept = merged
        .map((p, i) => ({ ...p, text: i === 0 ? tidy(p.text).replace(/^\s+/, '') : tidy(p.text) }))
        .filter((p) => p.text.trim());
      if (kept.length) kept[kept.length - 1].text = kept[kept.length - 1].text.replace(/\s+$/, '');
      kept.forEach((p) => { if (!p.jesus) delete p.jesus; });
      if (kept.length) out.push({ type: 'verse', number: item.number, parts: kept });
    }
  }
  return out;
};

/** A chapter: { items (see parseChapter), verseCount }. From the phone when read before. */
export const fetchBibleChapter = async (versionId, bookId, chapter) => {
  const key = `ch:${versionId}:${bookId}:${chapter}`;
  if (memChapters.has(key)) return memChapters.get(key);
  let data = await readStored(key);
  if (!data) {
    const json = await getJson(`${BASE}/${encodeURIComponent(versionId)}/${bookId}/${chapter}.json`);
    const items = parseChapter(json?.chapter?.content);
    if (!items.some((i) => i.type === 'verse')) throw new Error('empty chapter');
    data = { items, verseCount: items.filter((i) => i.type === 'verse').length };
    store(key, data);
  }
  memChapters.set(key, data);
  if (memChapters.size > MEMORY_CHAPTERS) memChapters.delete(memChapters.keys().next().value);
  return data;
};

/** A `web` version's chapter page (Ekegusii: eBible's own), fetched to be
 *  shown and nothing more — never stored: the text isn't ours to keep. */
export const fetchWebChapterPage = async (url) => {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  if (!/class=["']verse["']/.test(html)) throw new Error('not a chapter page');
  return html;
};

// Test-only reset.
export const __resetBibleCache = () => {
  memBooks.clear();
  memChapters.clear();
  moving = null;
  dirReady = null;
};

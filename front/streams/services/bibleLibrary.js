// The reader's own Bible: favourite passages, highlights, notes, bookmarked
// chapters and reading history. One shared store (the reading page, the
// "My Bible" page and the Bible home all update together), saved on the
// phone and working offline.
//
// Marks belong to the verse, not to a version: a highlight on John 3:16 shows
// in every version, as in the popular Bible apps. A favourite (or a note)
// also keeps the words as they read when it was saved, in that version, so
// My Bible can show them.
//
// Every entry has an id and a time, so this can sync to the account later
// without reshaping anything.
import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'bibleLibrary:v1';
export const HISTORY_MAX = 100;
export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'orange'];

const EMPTY = { favorites: [], highlights: {}, notes: [], bookmarks: [], history: [] };

let state = EMPTY;
let loaded = false;
let loading = null;
const subscribers = new Set();

const publish = () => subscribers.forEach((fn) => fn());
const save = () => AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {});
const change = (next) => {
  state = { ...state, ...next };
  publish();
  save();
};

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const sortNums = (list) => [...new Set((list || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);

/** A verse's key: "JHN.3.16". */
export const verseRef = (bookId, chapter, verse) => `${bookId}.${Number(chapter)}.${Number(verse)}`;
const samePassage = (a, b) => a.bookId === b.bookId && Number(a.chapter) === Number(b.chapter)
  && sortNums(a.verses).join(',') === sortNums(b.verses).join(',');

/** "Yohana 3:16", "John 3:16-18", "John 3:16, 18, 20-21"; a whole chapter
 *  with no verses: "John 3". */
export const formatRef = (bookName, chapter, verses = []) => {
  const nums = sortNums(verses);
  if (!nums.length) return `${bookName} ${chapter}`;
  const runs = [];
  for (const n of nums) {
    const last = runs[runs.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else runs.push([n, n]);
  }
  return `${bookName} ${chapter}:${runs.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ')}`;
};

// ── Loading ────────────────────────────────────────────────────────────────

const clean = (raw) => {
  const list = (x) => (Array.isArray(x) ? x.filter((e) => e && e.bookId && e.chapter) : []);
  const map = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
  return {
    favorites: list(raw?.favorites),
    highlights: Object.fromEntries(Object.entries(map(raw?.highlights))
      .filter(([, h]) => h && HIGHLIGHT_COLORS.includes(h.color))),
    notes: list(raw?.notes).filter((n) => typeof n.note === 'string'),
    bookmarks: list(raw?.bookmarks),
    history: list(raw?.history).slice(0, HISTORY_MAX),
  };
};

export const loadBibleLibrary = () => {
  if (!loading) {
    loading = AsyncStorage.getItem(KEY)
      .then((raw) => {
        try {
          state = raw ? clean(JSON.parse(raw)) : EMPTY;
        } catch {
          // Unreadable: the next change would overwrite it, so a copy is
          // kept aside first — a reader's notes aren't ours to lose.
          state = EMPTY;
          return AsyncStorage.setItem(`${KEY}:unreadable`, raw).catch(() => {});
        }
        return undefined;
      })
      .catch(() => { state = EMPTY; })
      .finally(() => { loaded = true; publish(); });
  }
  return loading;
};

// Every change waits for what's saved, so an early tap never wipes it.
const ready = (fn) => async (...args) => { await loadBibleLibrary(); return fn(...args); };

// ── Favourites (passages) ──────────────────────────────────────────────────

/** Add the passage, or remove it when it's already a favourite. Resolves to
 *  whether it's a favourite now. passage: { bookId, bookName, chapter,
 *  verses, text, versionId } */
export const toggleFavorite = ready((passage) => {
  const found = state.favorites.find((f) => samePassage(f, passage));
  if (found) {
    change({ favorites: state.favorites.filter((f) => f !== found) });
    return false;
  }
  const entry = { id: newId(), ...passage, verses: sortNums(passage.verses), at: Date.now() };
  change({ favorites: [entry, ...state.favorites] });
  return true;
});

export const removeFavorite = ready((id) => change({ favorites: state.favorites.filter((f) => f.id !== id) }));

// ── Highlights (per verse) ─────────────────────────────────────────────────

/** Colour each verse (or clear it with color null). verses: [{ bookId,
 *  bookName, chapter, verse, text, versionId }] */
export const setHighlight = ready((verses, color) => {
  const highlights = { ...state.highlights };
  for (const v of verses) {
    const ref = verseRef(v.bookId, v.chapter, v.verse);
    if (!color) delete highlights[ref];
    else {
      highlights[ref] = {
        color, at: Date.now(), bookId: v.bookId, bookName: v.bookName, chapter: Number(v.chapter),
        verse: Number(v.verse), text: v.text || '', versionId: v.versionId,
      };
    }
  }
  change({ highlights });
});

// ── Notes (on a passage) ───────────────────────────────────────────────────

/** Save a note on a passage (one note per passage; saving again edits it).
 *  An empty note deletes it. Resolves to the note, or null. */
export const saveNote = ready((passage, note) => {
  const text = String(note || '').trim();
  const found = state.notes.find((n) => samePassage(n, passage));
  if (!text) {
    if (found) change({ notes: state.notes.filter((n) => n !== found) });
    return null;
  }
  const now = Date.now();
  const entry = found
    ? { ...found, note: text, updatedAt: now }
    : { id: newId(), ...passage, verses: sortNums(passage.verses), note: text, at: now, updatedAt: now };
  change({ notes: [entry, ...state.notes.filter((n) => n !== found)] });
  return entry;
});

export const removeNote = ready((id) => change({ notes: state.notes.filter((n) => n.id !== id) }));

// ── Bookmarks (chapters) ───────────────────────────────────────────────────

/** Bookmark the chapter, or take the bookmark off. Resolves to whether it's
 *  bookmarked now. chapterRef: { bookId, bookName, chapter, versionId } */
export const toggleBookmark = ready((chapterRef) => {
  const found = state.bookmarks.find((b) => b.bookId === chapterRef.bookId && Number(b.chapter) === Number(chapterRef.chapter));
  if (found) {
    change({ bookmarks: state.bookmarks.filter((b) => b !== found) });
    return false;
  }
  change({ bookmarks: [{ id: newId(), ...chapterRef, chapter: Number(chapterRef.chapter), at: Date.now() }, ...state.bookmarks] });
  return true;
});

export const removeBookmark = ready((id) => change({ bookmarks: state.bookmarks.filter((b) => b.id !== id) }));

// ── History (and "continue reading") ───────────────────────────────────────

/** A chapter was opened: first in the history (once), capped. */
export const recordReading = ready((chapterRef) => {
  const entry = { ...chapterRef, chapter: Number(chapterRef.chapter), at: Date.now() };
  const rest = state.history.filter((h) => !(h.bookId === entry.bookId && Number(h.chapter) === entry.chapter));
  change({ history: [entry, ...rest].slice(0, HISTORY_MAX) });
});

export const clearHistory = ready(() => change({ history: [] }));

/** Put back something just removed (the Undo after a delete), at the place
 *  it had in its list. */
export const restoreEntry = ready((kind, entry, index = 0) => {
  if (kind === 'highlights') {
    change({ highlights: { ...state.highlights, [verseRef(entry.bookId, entry.chapter, entry.verse)]: entry } });
  } else if (Array.isArray(state[kind]) && !state[kind].some((e) => e.id === entry.id)) {
    const list = [...state[kind]];
    list.splice(Math.max(0, Math.min(index, list.length)), 0, entry);
    change({ [kind]: list });
  }
});

// ── Reading it ─────────────────────────────────────────────────────────────

const subscribe = (fn) => {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
};
const snapshot = () => state;

/** Everything, live. */
export const useBibleLibrary = () => {
  useEffect(() => { loadBibleLibrary(); }, []);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
};

/** What a chapter's verses carry: { highlight: {verse: color}, favorite:
 *  Set<verse>, notes: {verse: note} (a note shows on its passage's first
 *  verse) }. */
export const chapterMarks = (lib, bookId, chapter) => {
  const ch = Number(chapter);
  const highlight = {};
  const prefix = `${bookId}.${ch}.`;
  for (const [ref, h] of Object.entries(lib.highlights)) {
    if (ref.startsWith(prefix)) highlight[Number(ref.slice(prefix.length))] = h.color;
  }
  const favorite = new Set();
  lib.favorites.filter((f) => f.bookId === bookId && Number(f.chapter) === ch)
    .forEach((f) => (f.verses || []).forEach((v) => favorite.add(v)));
  const notes = {};
  lib.notes.filter((n) => n.bookId === bookId && Number(n.chapter) === ch)
    // Newest first, so when two notes start on one verse its mark opens the latest.
    .forEach((n) => { if (n.verses?.length && !notes[n.verses[0]]) notes[n.verses[0]] = n; });
  return { highlight, favorite, notes };
};

/** The favourite / note for exactly this passage, if there is one. */
export const findFavorite = (lib, passage) => lib.favorites.find((f) => samePassage(f, passage)) || null;
export const findNote = (lib, passage) => lib.notes.find((n) => samePassage(n, passage)) || null;

// Test-only reset.
export const __resetBibleLibrary = () => {
  state = EMPTY;
  loaded = false;
  loading = null;
  publish();
};

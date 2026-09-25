import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  __resetBibleLibrary, loadBibleLibrary, toggleFavorite, removeFavorite, setHighlight, saveNote,
  toggleBookmark, recordReading, clearHistory, restoreEntry, chapterMarks, findFavorite, findNote,
  formatRef, verseRef, HISTORY_MAX,
} from '../bibleLibrary';

const KEY = 'bibleLibrary:v1';
let lib;
const read = async () => { lib = JSON.parse(await AsyncStorage.getItem(KEY)); return lib; };
const passage = (verses, extra = {}) => ({
  bookId: 'JHN', bookName: 'John', chapter: 3, verses, text: 'For God so loved the world', versionId: 'eng_kjv', ...extra,
});
const verse = (v, extra = {}) => ({ bookId: 'JHN', bookName: 'John', chapter: 3, verse: v, text: `v${v}`, versionId: 'eng_kjv', ...extra });

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetBibleLibrary();
});

test('references read the way people write them', () => {
  expect(formatRef('John', 3, [16])).toBe('John 3:16');
  expect(formatRef('John', 3, [18, 16, 17])).toBe('John 3:16-18');
  expect(formatRef('Yohana', 3, [16, 18, 20, 21])).toBe('Yohana 3:16, 18, 20-21');
  expect(formatRef('John', 3, [])).toBe('John 3');
  expect(verseRef('JHN', '3', '16')).toBe('JHN.3.16');
});

test('favourite a passage (its words kept), tap again to remove', async () => {
  expect(await toggleFavorite(passage([17, 16]))).toBe(true);
  const [fav] = (await read()).favorites;
  expect(fav).toMatchObject({ bookId: 'JHN', chapter: 3, verses: [16, 17], text: 'For God so loved the world', versionId: 'eng_kjv' });
  expect(fav.id).toBeTruthy();
  expect(await toggleFavorite(passage([16, 17]))).toBe(false);      // the same passage, any order
  expect((await read()).favorites).toEqual([]);
  await toggleFavorite(passage([16]));
  const { id } = (await read()).favorites[0];
  await removeFavorite(id);
  expect((await read()).favorites).toEqual([]);
});

test('highlights belong to the verse: set, recolour, clear', async () => {
  await setHighlight([verse(16), verse(17)], 'yellow');
  await setHighlight([verse(17)], 'green');
  expect(Object.fromEntries(Object.entries((await read()).highlights).map(([k, h]) => [k, h.color])))
    .toEqual({ 'JHN.3.16': 'yellow', 'JHN.3.17': 'green' });
  await setHighlight([verse(16)], null);
  expect(Object.keys((await read()).highlights)).toEqual(['JHN.3.17']);
});

test('one note per passage: write, edit, and an empty note deletes it', async () => {
  const first = await saveNote(passage([16]), '  God’s love  ');
  expect(first.note).toBe('God’s love');
  const edited = await saveNote(passage([16]), 'God’s love for all');
  expect(edited.id).toBe(first.id);
  expect((await read()).notes).toHaveLength(1);
  expect((await read()).notes[0].note).toBe('God’s love for all');
  expect(await saveNote(passage([16]), '   ')).toBeNull();
  expect((await read()).notes).toEqual([]);
});

test('bookmark a chapter, and take it off', async () => {
  const ch = { bookId: 'PSA', bookName: 'Psalms', chapter: 23, versionId: 'guz_bsk' };
  expect(await toggleBookmark(ch)).toBe(true);
  expect((await read()).bookmarks[0]).toMatchObject({ bookId: 'PSA', chapter: 23, versionId: 'guz_bsk' });
  expect(await toggleBookmark({ ...ch, versionId: 'eng_kjv' })).toBe(false);   // the chapter, whatever version
  expect((await read()).bookmarks).toEqual([]);
});

test('history: newest first, a chapter once, capped', async () => {
  await recordReading({ bookId: 'GEN', bookName: 'Genesis', chapter: 1, versionId: 'eng_kjv' });
  await recordReading({ bookId: 'JHN', bookName: 'John', chapter: 3, versionId: 'eng_kjv' });
  await recordReading({ bookId: 'GEN', bookName: 'Genesis', chapter: 1, versionId: 'luo_bib' });
  expect((await read()).history.map((h) => `${h.bookId}${h.chapter}:${h.versionId}`)).toEqual(['GEN1:luo_bib', 'JHN3:eng_kjv']);
  for (let i = 1; i <= HISTORY_MAX + 5; i += 1) await recordReading({ bookId: 'PSA', bookName: 'Psalms', chapter: i, versionId: 'eng_kjv' });
  expect((await read()).history).toHaveLength(HISTORY_MAX);
  expect(lib.history[0].chapter).toBe(HISTORY_MAX + 5);
  await clearHistory();
  expect((await read()).history).toEqual([]);
});

test('undo puts a removed entry back where it was', async () => {
  await toggleFavorite(passage([1]));
  await toggleFavorite(passage([2]));
  const removed = (await read()).favorites[1];
  await removeFavorite(removed.id);
  await restoreEntry('favorites', removed, 1);
  expect((await read()).favorites.map((f) => f.verses[0])).toEqual([2, 1]);
  await setHighlight([verse(5)], 'pink');
  const h = (await read()).highlights['JHN.3.5'];
  await setHighlight([verse(5)], null);
  await restoreEntry('highlights', h);
  expect((await read()).highlights['JHN.3.5'].color).toBe('pink');
});

test('a chapter’s marks, for drawing its verses', async () => {
  await setHighlight([verse(16)], 'blue');
  await toggleFavorite(passage([16, 17]));
  await saveNote(passage([18, 19]), 'Light');
  await setHighlight([verse(1, { chapter: 4 })], 'pink');                  // another chapter
  const { loadBibleLibrary: load } = require('../bibleLibrary');
  await load();
  const marks = chapterMarks({ ...JSON.parse(await AsyncStorage.getItem(KEY)) }, 'JHN', 3);
  expect(marks.highlight).toEqual({ 16: 'blue' });
  expect([...marks.favorite].sort()).toEqual([16, 17]);
  expect(Object.keys(marks.notes)).toEqual(['18']);                        // shown on its first verse
  expect(findFavorite(await read(), passage([17, 16]))).toBeTruthy();
  expect(findNote(lib, passage([18, 19])).note).toBe('Light');
  expect(findNote(lib, passage([18]))).toBeNull();
});

test('two notes starting on one verse: its mark opens the newer', async () => {
  await saveNote(passage([16]), 'Older');
  await saveNote(passage([16, 17, 18]), 'Newer');
  expect(chapterMarks(await read(), 'JHN', 3).notes[16].note).toBe('Newer');
});

test('it all comes back after a restart; damaged data is ignored', async () => {
  await toggleFavorite(passage([16]));
  __resetBibleLibrary();
  await loadBibleLibrary();
  expect(await toggleFavorite(passage([16]))).toBe(false);                 // it was still there
  await AsyncStorage.setItem(KEY, '{broken');
  __resetBibleLibrary();
  await loadBibleLibrary();
  expect(await toggleFavorite(passage([16]))).toBe(true);
  expect(await AsyncStorage.getItem(`${KEY}:unreadable`)).toBe('{broken');   // kept aside, not lost
  await AsyncStorage.setItem(KEY, JSON.stringify({ favorites: [null, { nope: 1 }], highlights: { 'JHN.3.1': { color: 'plaid' } }, history: 'x' }));
  __resetBibleLibrary();
  await loadBibleLibrary();
  await recordReading({ bookId: 'GEN', bookName: 'Genesis', chapter: 1, versionId: 'eng_kjv' });
  expect(await read()).toMatchObject({ favorites: [], highlights: {}, history: [{ bookId: 'GEN' }] });
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  __resetHymnFavorites, isHymnFavorite, loadHymnFavorites, toggleHymnFavorite,
} from '../hymnFavorites';

const KEY = 'hymnFavorites:v1';

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetHymnFavorites();
});

test('add, newest first, saved on the phone; tap again to remove', async () => {
  expect(await toggleHymnFavorite('en', 100)).toBe(true);
  expect(await toggleHymnFavorite('sw', 12)).toBe(true);
  const saved = JSON.parse(await AsyncStorage.getItem(KEY));
  expect(saved.map((f) => [f.lang, f.number])).toEqual([['sw', 12], ['en', 100]]);
  expect(isHymnFavorite('en', 100)).toBe(true);
  expect(isHymnFavorite('sw', 100)).toBe(false);               // same number, another hymnal
  expect(await toggleHymnFavorite('en', 100)).toBe(false);
  expect(JSON.parse(await AsyncStorage.getItem(KEY)).map((f) => f.number)).toEqual([12]);
});

test('they come back after the app restarts', async () => {
  await toggleHymnFavorite('dho', 7);
  __resetHymnFavorites();                                      // a fresh launch
  expect(isHymnFavorite('dho', 7)).toBe(false);
  await loadHymnFavorites();
  expect(isHymnFavorite('dho', 7)).toBe(true);
});

test('a tap before they have loaded keeps the saved ones', async () => {
  await AsyncStorage.setItem(KEY, JSON.stringify([{ lang: 'en', number: 1, at: 1 }]));
  expect(await toggleHymnFavorite('en', 2)).toBe(true);        // nothing loaded yet
  expect(isHymnFavorite('en', 1)).toBe(true);
  expect(isHymnFavorite('en', 2)).toBe(true);
});

test('damaged saved data is ignored, not a crash', async () => {
  await AsyncStorage.setItem(KEY, '{not json');
  await loadHymnFavorites();
  expect(isHymnFavorite('en', 1)).toBe(false);
  __resetHymnFavorites();
  await AsyncStorage.setItem(KEY, JSON.stringify([{ lang: 'en', number: 3 }, { nope: true }, 'x']));
  await loadHymnFavorites();
  expect(isHymnFavorite('en', 3)).toBe(true);
});

describe('sorting favourites', () => {
  const row = (lang, number, title, at) => ({ lang, at, hymn: { number, title } });
  // Newest first, as the store keeps them.
  const rows = [
    row('en', 12, 'amazing Grace', 400),
    row('sw', 5, 'Bwana Yesu', 300),
    row('dho', 5, 'Nyasaye', 200),
    row('en', 100, '"Tis So Sweet', 100),
  ];
  const ids = (list) => list.map((r) => `${r.lang}${r.hymn.number}`);
  const { sortFavorites } = require('../hymnFavorites');

  test('recent: newest added first, even when two were added in the same instant', () => {
    expect(ids(sortFavorites(rows, 'recent'))).toEqual(['en12', 'sw5', 'dho5', 'en100']);
    const sameTime = rows.map((r) => ({ ...r, at: 5 }));
    expect(ids(sortFavorites(sameTime, 'recent'))).toEqual(['en12', 'sw5', 'dho5', 'en100']);
    expect(ids(sortFavorites(rows, 'nonsense'))).toEqual(ids(rows));      // an unknown sort: as added
  });
  test('number: lowest first, same number in hymnal order', () => {
    expect(ids(sortFavorites(rows, 'number'))).toEqual(['sw5', 'dho5', 'en12', 'en100']);
  });
  test('title: A-Z, ignoring case and leading quotes', () => {
    expect(ids(sortFavorites(rows, 'title'))).toEqual(['en12', 'sw5', 'dho5', 'en100']);
  });
  test('hymnal: English, Kiswahili, Dholuo, Ekegusii, then by number', () => {
    expect(ids(sortFavorites(rows, 'hymnal'))).toEqual(['en12', 'en100', 'sw5', 'dho5']);
  });
  test('it never changes the list it was given', () => {
    const before = ids(rows);
    sortFavorites(rows, 'number');
    expect(ids(rows)).toEqual(before);
  });
});

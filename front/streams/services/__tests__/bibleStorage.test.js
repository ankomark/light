/**
 * Bible chapters are kept as files, not in AsyncStorage (one 6 MB database
 * on Android, shared by the whole app - a few books filled it and every save
 * after failed, notes included). Older copies move over once; a request that
 * never answers gives up instead of spinning.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockFiles = {};
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  makeDirectoryAsync: jest.fn(async () => {}),
  readAsStringAsync: jest.fn(async (path) => {
    if (!(path in mockFiles)) throw new Error('no file');
    return mockFiles[path];
  }),
  writeAsStringAsync: jest.fn(async (path, text) => { mockFiles[path] = text; }),
}));

const { fetchBibleChapter, moveOldCopies, __resetBibleCache } = require('../bible');

const chapterJson = {
  chapter: { content: [{ type: 'verse', number: 1, content: ['In the beginning God created the heaven and the earth.'] }] },
};

beforeEach(async () => {
  await AsyncStorage.clear();
  Object.keys(mockFiles).forEach((k) => delete mockFiles[k]);
  __resetBibleCache();
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => chapterJson }));
});

test('a chapter read is kept as a file, and opens from it with no network', async () => {
  await fetchBibleChapter('eng_kjv', 'GEN', 1);
  expect(Object.keys(mockFiles)).toContain('file:///docs/bible/ch_eng_kjv_GEN_1.json');
  expect(await AsyncStorage.getItem('bible:v1:ch:eng_kjv:GEN:1')).toBeNull();     // not in the shared store
  __resetBibleCache();
  global.fetch = jest.fn(async () => { throw new Error('offline'); });
  const again = await fetchBibleChapter('eng_kjv', 'GEN', 1);
  expect(again.verseCount).toBe(1);
  expect(global.fetch).not.toHaveBeenCalled();
});

test("an older build's saved chapters move to files once, and leave the shared store", async () => {
  await AsyncStorage.setItem('bible:v1:ch:eng_kjv:JHN:3', JSON.stringify({ items: [], verseCount: 36 }));
  await AsyncStorage.setItem('bibleLibrary:v1', '{"notes":[]}');                 // not the Bible text: stays
  await moveOldCopies();
  expect(mockFiles['file:///docs/bible/ch_eng_kjv_JHN_3.json']).toContain('"verseCount":36');
  expect(await AsyncStorage.getItem('bible:v1:ch:eng_kjv:JHN:3')).toBeNull();
  expect(await AsyncStorage.getItem('bibleLibrary:v1')).toBe('{"notes":[]}');
});

test('a request that never answers gives up (so the reader can offer Retry)', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn((url, opts) => new Promise((resolve, reject) => {
    opts?.signal?.addEventListener?.('abort', () => reject(new Error('aborted')));
  }));
  const pending = fetchBibleChapter('eng_kjv', 'EXO', 2);
  const outcome = pending.then(() => 'loaded', () => 'gave up');
  await jest.advanceTimersByTimeAsync(16000);
  expect(await outcome).toBe('gave up');
  jest.useRealTimers();
});

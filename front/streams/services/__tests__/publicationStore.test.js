import AsyncStorage from '@react-native-async-storage/async-storage';

const mockFetchChapter = jest.fn();
const mockFetchPublication = jest.fn();
jest.mock('../api', () => ({
  fetchPublicationChapter: (...a) => mockFetchChapter(...a),
  fetchPublication: (...a) => mockFetchPublication(...a),
}));

const store = require('../publicationStore');

const ch = (id, body = `body ${id}`) => ({ id, order: id, title: `Ch ${id}`, body });
const offline = () => Object.assign(new Error('Network Error'), {});

beforeEach(async () => {
  await AsyncStorage.clear();
  store.__resetPublicationStore();
  mockFetchChapter.mockReset();
  mockFetchPublication.mockReset();
});

test('a chapter is fetched once, then read from the phone with no network', async () => {
  mockFetchChapter.mockResolvedValueOnce({ index: 0, count: 2, chapter: ch(11) });
  expect(await store.loadChapter(7, 0, 11)).toEqual({ chapter: ch(11), stale: false });
  store.__resetPublicationStore();                     // a cold start: memory gone, disk kept
  expect(await store.loadChapter(7, 0, 11)).toEqual({ chapter: ch(11), stale: false });
  expect(mockFetchChapter).toHaveBeenCalledTimes(1);
});

test('an edited book (new chapter ids) is fetched again', async () => {
  mockFetchChapter.mockResolvedValueOnce({ chapter: ch(11, 'old') }).mockResolvedValueOnce({ chapter: ch(21, 'new') });
  await store.loadChapter(7, 0, 11);
  const { chapter } = await store.loadChapter(7, 0, 21);
  expect(chapter.body).toBe('new');
  expect(mockFetchChapter).toHaveBeenCalledTimes(2);
});

test('chapters keep their id across edits now: the version decides', async () => {
  mockFetchChapter
    .mockResolvedValueOnce({ chapter: { ...ch(11, 'v1'), version: 1 } })
    .mockResolvedValueOnce({ chapter: { ...ch(11, 'v2'), version: 2 } });
  await store.loadChapter(7, 0, { id: 11, version: 1 });
  expect((await store.loadChapter(7, 0, { id: 11, version: 1 })).chapter.body).toBe('v1');   // kept, current
  expect((await store.loadChapter(7, 0, { id: 11, version: 2 })).chapter.body).toBe('v2');   // edited: fetched
  expect(mockFetchChapter).toHaveBeenCalledTimes(2);
});

test('offline: an older kept copy is shown, marked stale; nothing kept → the error', async () => {
  mockFetchChapter.mockResolvedValueOnce({ chapter: ch(11, 'old') });
  await store.loadChapter(7, 0, 11);
  mockFetchChapter.mockRejectedValue(offline());
  expect(await store.loadChapter(7, 0, 21)).toEqual({ chapter: ch(11, 'old'), stale: true });
  await expect(store.loadChapter(7, 1, 22)).rejects.toThrow('Network Error');
});

test('a body the book page already carried is used (and kept) without a request', async () => {
  const { chapter } = await store.loadChapter(7, 0, 11, ch(11, 'from the page'));
  expect(chapter.body).toBe('from the page');
  expect(mockFetchChapter).not.toHaveBeenCalled();
  expect(await store.keptChapter(7, 0, 11)).toMatchObject({ body: 'from the page' });
});

test('the shelf is capped: the least recently read chapters go first', async () => {
  mockFetchChapter.mockImplementation(async (id, i) => ({ chapter: ch(1000 + i) }));
  for (let i = 0; i < store.MAX_KEPT_CHAPTERS + 3; i += 1) await store.loadChapter(9, i, 1000 + i);
  await new Promise((r) => setTimeout(r, 0));
  store.__resetPublicationStore();
  expect(await store.keptChapter(9, 0, 1000)).toBeNull();
  expect(await store.keptChapter(9, 2, 1002)).toBeNull();
  expect(await store.keptChapter(9, 3, 1003)).not.toBeNull();
  expect(await store.keptChapter(9, store.MAX_KEPT_CHAPTERS + 2, 1000 + store.MAX_KEPT_CHAPTERS + 2)).not.toBeNull();
});

test('download a whole book; it stops (and says so) when the signal goes', async () => {
  const toc = [{ id: 1 }, { id: 2 }, { id: 3 }];
  mockFetchChapter.mockImplementation(async (id, i) => ({ chapter: ch(i + 1) }));
  const seen = [];
  expect(await store.downloadBook(5, toc, (d, n) => seen.push(`${d}/${n}`))).toBe(3);
  expect(seen).toEqual(['1/3', '2/3', '3/3']);
  expect(await store.keptChapterCount(5, toc)).toBe(3);

  const edited = [{ id: 1 }, { id: 9 }, { id: 3 }];      // chapter 2 changed; we're offline
  mockFetchChapter.mockRejectedValue(offline());
  await expect(store.downloadBook(5, edited)).rejects.toThrow('offline');
  expect(await store.keptChapterCount(5, edited)).toBe(2);
});

test('logging out forgets every kept chapter (they can be drafts)', async () => {
  mockFetchChapter.mockResolvedValue({ chapter: ch(11) });
  await store.loadChapter(7, 0, 11);
  await store.forgetKeptChapters();
  expect(await store.keptChapter(7, 0, 11)).toBeNull();
  expect((await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('pubch:'))).toEqual([]);
});

test('the book page is kept per account, and patched after a like', async () => {
  mockFetchPublication.mockResolvedValue({ id: 3, title: 'B', is_liked: false, chapters: [] });
  await store.fetchBook(1, 3);
  expect(mockFetchPublication).toHaveBeenCalledWith(3, { toc: true });
  expect(store.peekBook(1, 3).title).toBe('B');
  expect(store.peekBook(2, 3)).toBeNull();
  store.patchBook(1, 3, { is_liked: true });
  expect(store.peekBook(1, 3).is_liked).toBe(true);
  store.forgetBook(1, 3);
  expect(store.peekBook(1, 3)).toBeNull();
});

test('lists know when something changed since they loaded', () => {
  const loadedAt = Date.now() - 10;
  expect(store.publicationsChangedSince(loadedAt)).toBe(false);
  store.notePublicationsChanged();
  expect(store.publicationsChangedSince(loadedAt)).toBe(true);
});

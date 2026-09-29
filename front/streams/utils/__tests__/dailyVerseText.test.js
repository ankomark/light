/**
 * The verse of the day in the reader's own Bible: which version, and how its
 * text is lifted from the chapter the reader would load.
 */
const mockBible = { fetchBibleBooks: jest.fn(), fetchBibleChapter: jest.fn() };
jest.mock('../../services/bible', () => ({
  fetchBibleBooks: (...a) => mockBible.fetchBibleBooks(...a),
  fetchBibleChapter: (...a) => mockBible.fetchBibleChapter(...a),
}));

const { versionForVerse, translateVerse, bookIdFor } = require('../dailyVerseText');

const kjv = { book: 'Psalms', chapter: 23, verse: 1, text: 'The LORD is my shepherd; I shall not want.', reference: 'Psalms 23:1' };

beforeEach(() => {
  mockBible.fetchBibleBooks.mockReset();
  mockBible.fetchBibleChapter.mockReset();
  mockBible.fetchBibleBooks.mockResolvedValue([{ id: 'PSA', name: 'Zaburi' }, { id: 'JHN', name: 'Yohana' }]);
});

describe('versionForVerse', () => {
  test("the reader's own choice wins", () => {
    expect(versionForVerse('ENGWEBP', 'en')).toBe('ENGWEBP');
    expect(versionForVerse('luo_bib', 'sw')).toBe('luo_bib');
  });

  test('a Swahili app with the Bible never changed reads in Swahili', () => {
    expect(versionForVerse('eng_kjv', 'sw')).toBe('swh_bib');
    expect(versionForVerse(undefined, 'sw')).toBe('swh_bib');
  });

  test('an English app with nothing chosen stays with the KJV', () => {
    expect(versionForVerse('eng_kjv', 'en')).toBe('eng_kjv');
    expect(versionForVerse(undefined, 'en')).toBe('eng_kjv');
  });

  test('a version with no text to lift (Ekegusii) or an unknown one is passed over', () => {
    expect(versionForVerse('guz_bsk', 'en')).toBe('eng_kjv');
    expect(versionForVerse('guz_bsk', 'sw')).toBe('swh_bib');
    expect(versionForVerse('nonsense', 'en')).toBe('eng_kjv');
  });
});

describe('translateVerse', () => {
  test('the KJV needs no fetching: the server sent it', async () => {
    expect(await translateVerse(kjv, 'eng_kjv')).toBeNull();
    expect(mockBible.fetchBibleChapter).not.toHaveBeenCalled();
  });

  test('poetry lines become one line, with the book named in the language', async () => {
    mockBible.fetchBibleChapter.mockResolvedValue({ items: [
      { type: 'heading', text: 'Bwana ni Mchungaji' },
      { type: 'verse', number: 1, parts: [{ text: 'Bwana ndiye mchungaji wangu,\n sitapungukiwa na kitu.' }] },
      { type: 'verse', number: 2, parts: [{ text: 'Hunilaza.' }] },
    ] });
    const out = await translateVerse(kjv, 'swh_bib');
    expect(mockBible.fetchBibleChapter).toHaveBeenCalledWith('swh_bib', 'PSA', 23);
    expect(out).toEqual({
      text: 'Bwana ndiye mchungaji wangu, sitapungukiwa na kitu.',
      reference: 'Zaburi 23:1', bookName: 'Zaburi', versionId: 'swh_bib', abbr: 'NENO', lang: 'sw',
    });
  });

  test("speech marks that belong to the surrounding passage are dropped", async () => {
    mockBible.fetchBibleChapter.mockResolvedValue({ items: [
      { type: 'verse', number: 16, parts: [{ text: '“Kwa maana jinsi hii Mungu aliupenda ulimwengu' }, { text: ', awe na uzima wa milele.', jesus: true }] },
    ] });
    const out = await translateVerse({ ...kjv, book: 'John', chapter: 3, verse: 16 }, 'swh_bib');
    expect(out.text).toBe('Kwa maana jinsi hii Mungu aliupenda ulimwengu, awe na uzima wa milele.');
    expect(out.reference).toBe('Yohana 3:16');
  });

  test('a verse the version lacks is an error, so the KJV is shown instead', async () => {
    mockBible.fetchBibleChapter.mockResolvedValue({ items: [{ type: 'verse', number: 2, parts: [{ text: 'x' }] }] });
    await expect(translateVerse(kjv, 'swh_bib')).rejects.toThrow();
  });

  test('the server and the reader agree on every book name', () => {
    expect(bookIdFor('Song of Solomon')).toBe('SNG');
    expect(bookIdFor('Nowhere')).toBeNull();
  });
});

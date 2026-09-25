import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  parseChapter, fetchBibleBooks, fetchBibleChapter, fetchWebChapterPage, __resetBibleCache,
} from '../bible';
import {
  BIBLE_LANGUAGES, BIBLE_BOOKS, getBibleVersion, DEFAULT_BIBLE_VERSION, webChapterUrl, staysInReader, EKEGUSII_BOOK_NAMES,
  styleWebChapter,
} from '../../utils/bibleVersions';

// Shapes exactly as the Free Use Bible API sends them (Dholuo John 3,
// Kiswahili Psalm 23, KJV, Luganda John 1).
const LUO_JHN3 = [
  { type: 'heading', content: ['Yesu owuoyo gi Nikodemo'] },
  { type: 'verse', number: 1, content: ['Ne nitie ngʼat moro ma ja-Farisai ma nyinge Nikodemo.'] },
  { type: 'verse', number: 3, content: ['Yesu nodwoke kawacho niya,', { text: '“Awachoni adier, ni onge ngʼama nyalo neno pinyruoth Nyasaye.”', wordsOfJesus: true }] },
  { type: 'line_break' },
];
const SWH_PSA23 = [
  { type: 'heading', content: ['Bwana Mchungaji Wetu'] },
  { type: 'hebrew_subtitle', content: ['Zaburi ya Daudi.'] },
  { type: 'verse', number: 1, content: [{ text: 'Bwana ndiye mchungaji wangu,', poem: 1 }, { text: 'sitapungukiwa na kitu.', poem: 2 }] },
];

describe('reading a chapter', () => {
  test('headings, verses, and Jesus’s words marked for red letters', () => {
    expect(parseChapter(LUO_JHN3)).toEqual([
      { type: 'heading', text: 'Yesu owuoyo gi Nikodemo' },
      { type: 'verse', number: 1, parts: [{ text: 'Ne nitie ngʼat moro ma ja-Farisai ma nyinge Nikodemo.' }] },
      { type: 'verse', number: 3, parts: [
        { text: 'Yesu nodwoke kawacho niya,' },
        { text: ' “Awachoni adier, ni onge ngʼama nyalo neno pinyruoth Nyasaye.”', jesus: true },
      ] },
    ]);
  });

  test('poetry keeps its lines, the second level indented', () => {
    const [h1, h2, v1] = parseChapter(SWH_PSA23);
    expect([h1.text, h2.text]).toEqual(['Bwana Mchungaji Wetu', 'Zaburi ya Daudi.']);
    expect(v1.parts).toEqual([{ text: 'Bwana ndiye mchungaji wangu,\n sitapungukiwa na kitu.' }]);
  });

  test('footnote markers go, paragraph marks go, line breaks become new lines', () => {
    const [v] = parseChapter([
      { type: 'verse', number: 1, content: ['Kigambo yaliwo. Kigambo', { noteId: 0 }, 'yali ne Katonda.'] },
    ]);
    expect(v.parts).toEqual([{ text: 'Kigambo yaliwo. Kigambo yali ne Katonda.' }]);
    const [kjv] = parseChapter([
      { type: 'verse', number: 16, content: [{ text: '¶ For God so loved the world,', wordsOfJesus: true }, { lineBreak: true }, { text: 'that he gave', wordsOfJesus: true }] },
    ]);
    expect(kjv.parts).toEqual([{ text: 'For God so loved the world,\nthat he gave', jesus: true }]);
    expect(parseChapter([{ type: 'verse', number: 2, content: [{ noteId: 1 }] }, null, { type: 'x' }])).toEqual([]);
  });
});

describe('fetching, and keeping what was read', () => {
  const books = { books: [
    { id: 'GEN', name: 'Chakruok', commonName: 'Chakruok', order: 1, numberOfChapters: 50 },
    { id: 'TOB', name: 'Tobit', order: 67, numberOfChapters: 14 },           // deuterocanon: not listed
    { id: 'JHN', name: 'Johana', commonName: 'Johana', order: 43, numberOfChapters: 21 },
  ] };
  const chapter = { chapter: { content: LUO_JHN3 } };

  beforeEach(async () => {
    await AsyncStorage.clear();
    __resetBibleCache();
    global.fetch = jest.fn(async (url) => ({
      ok: true, json: async () => (url.endsWith('books.json') ? books : chapter),
    }));
  });

  test('books come named in the language, in order, with their English names', async () => {
    const list = await fetchBibleBooks('luo_bib');
    expect(global.fetch).toHaveBeenCalledWith('https://bible.helloao.org/api/luo_bib/books.json');
    expect(list.map((b) => [b.id, b.name, b.english, b.chapters])).toEqual([
      ['GEN', 'Chakruok', 'Genesis', 50], ['JHN', 'Johana', 'John', 21],
    ]);
  });

  test('a chapter read once opens again with no connection', async () => {
    const first = await fetchBibleChapter('luo_bib', 'JHN', 3);
    expect(global.fetch).toHaveBeenCalledWith('https://bible.helloao.org/api/luo_bib/JHN/3.json');
    expect(first.verseCount).toBe(2);
    __resetBibleCache();                                         // the app restarted…
    global.fetch = jest.fn(async () => { throw new Error('offline'); });   // …with no signal
    expect(await fetchBibleChapter('luo_bib', 'JHN', 3)).toEqual(first);
    expect((await fetchBibleBooks('luo_bib').catch(() => 'failed'))).toBe('failed');   // never loaded
  });

  test('a failed or empty answer is an error, and nothing is kept', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    await expect(fetchBibleChapter('luo_bib', 'JHN', 4)).rejects.toThrow('HTTP 503');
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ chapter: { content: [] } }) }));
    await expect(fetchBibleChapter('luo_bib', 'JHN', 4)).rejects.toThrow('empty chapter');
    expect(await AsyncStorage.getItem('bible:v1:ch:luo_bib:JHN:4')).toBeNull();
  });
});

describe('the versions offered', () => {
  test('every version has a credit line, ids are unique, KJV is the default', () => {
    const all = BIBLE_LANGUAGES.flatMap((l) => l.versions);
    expect(new Set(all.map((v) => v.id)).size).toBe(all.length);
    all.forEach((v) => expect(v.credit).toBeTruthy());
    expect(getBibleVersion('nope').id).toBe(DEFAULT_BIBLE_VERSION);
    expect(getBibleVersion('luo_bib')).toMatchObject({ language: 'Dholuo', abbr: 'DHOLUO' });
    // The languages asked for: Kiswahili, Dholuo, Ekegusii (eBible's pages, online).
    expect(BIBLE_LANGUAGES.map((l) => l.name)).toEqual(expect.arrayContaining(['Kiswahili', 'Dholuo', 'Ekegusii']));
    expect(getBibleVersion('guz_bsk').web).toBe('https://ebible.org/guz/');
    expect(BIBLE_BOOKS).toHaveLength(66);
  });
});

describe('Ekegusii: eBible’s own pages, never copied', () => {
  const guz = getBibleVersion('guz_bsk');

  test('each chapter is eBible’s page for it (Psalms with three digits)', () => {
    expect(webChapterUrl(guz, 'JHN', 3)).toBe('https://ebible.org/guz/JHN03.htm');
    expect(webChapterUrl(guz, 'GEN', 50)).toBe('https://ebible.org/guz/GEN50.htm');
    expect(webChapterUrl(guz, 'PSA', 23)).toBe('https://ebible.org/guz/PSA023.htm');
    expect(webChapterUrl(guz, 'PSA', 119)).toBe('https://ebible.org/guz/PSA119.htm');
  });

  test('only that chapter opens in the reader; its footnote jumps too; the rest goes outside', () => {
    const page = 'https://ebible.org/guz/JHN03.htm';
    expect(staysInReader(page, page)).toBe(true);
    expect(staysInReader('https://eBible.org/guz/JHN03.htm#FN1', page)).toBe(true);
    expect(staysInReader('about:blank', page)).toBe(true);
    expect(staysInReader('data:text/html;charset=utf-8,x', page)).toBe(true);        // the page as handed over
    expect(staysInReader('https://ebible.org/guz/JHN04.htm', page)).toBe(false);   // our Next does that
    expect(staysInReader('https://ebible.org/guz/copyright.htm', page)).toBe(false);
    expect(staysInReader('https://example.com/', page)).toBe(false);
  });

  test('its books are named in Ekegusii, with nothing fetched', async () => {
    global.fetch = jest.fn();
    const list = await fetchBibleBooks('guz_bsk');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(list).toHaveLength(66);
    expect(list[0]).toMatchObject({ id: 'GEN', name: 'Omochakano', english: 'Genesis', chapters: 50 });
    expect(list.find((b) => b.id === 'JHN').name).toBe('Yohana');
    expect(Object.keys(EKEGUSII_BOOK_NAMES)).toHaveLength(66);
  });

  test('our look goes into the page itself, last in its head, so it always wins', () => {
    const css = 'body * { color: inherit !important; }';
    const out = styleWebChapter('<html><head><link rel="stylesheet" href="x.css" /></head><body>t</body></html>', css, 'https://ebible.org/guz/GEN27.htm');
    expect(out).toBe('<html><head><link rel="stylesheet" href="x.css" /><base href="https://ebible.org/guz/GEN27.htm"><style>' + css + '</style></head><body>t</body></html>');
    // A page without a head still gets it, before its body.
    expect(styleWebChapter('<body class="c">t</body>', css, 'u')).toBe('<head><base href="u"><style>' + css + '</style></head><body class="c">t</body>');
  });

  test('a chapter page is fetched to show, never stored; a wrong page is an error', async () => {
    await AsyncStorage.clear();
    global.fetch = jest.fn(async () => ({ ok: true, text: async () => '<span class="verse" id="V1">Ⅰ</span>Narengeo' }));
    expect(await fetchWebChapterPage('https://ebible.org/guz/GEN27.htm')).toContain('Narengeo');
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
    global.fetch = jest.fn(async () => ({ ok: true, text: async () => '<html>Not found</html>' }));
    await expect(fetchWebChapterPage('https://ebible.org/guz/XXX01.htm')).rejects.toThrow('not a chapter page');
    global.fetch = jest.fn(async () => ({ ok: false, status: 404, text: async () => '' }));
    await expect(fetchWebChapterPage('https://ebible.org/guz/XXX01.htm')).rejects.toThrow('HTTP 404');
  });
});

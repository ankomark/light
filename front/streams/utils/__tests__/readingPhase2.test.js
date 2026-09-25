import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('expo-font', () => ({ loadAsync: jest.fn(async () => {}), isLoaded: jest.fn(() => true) }));
const mockSync = jest.fn();
const mockFetch = jest.fn();
jest.mock('../../services/api', () => ({
  syncBookHighlights: (...a) => mockSync(...a),
  fetchBookHighlights: (...a) => mockFetch(...a),
}));

const { splitBlocks, plainText, findBlock } = require('../chapterBlocks');
const settings = require('../readerSettings');
const hl = require('../../services/bookHighlights');
const { bookFraction } = require('../../pages/ChapterReader');

beforeEach(async () => {
  await AsyncStorage.clear();
  settings.__resetReaderSettings();
  hl.__resetBookHighlights();
  mockSync.mockReset().mockResolvedValue({ applied: [] });
  mockFetch.mockReset().mockResolvedValue({ results: [] });
});

describe('paragraphs', () => {
  test('blank lines split paragraphs; a code block stays whole', () => {
    const md = '# Title\n\nFirst line\nsame paragraph\n\n```\ncode\n\nstill code\n```\n\n\n- one\n- two';
    expect(splitBlocks(md)).toEqual(['# Title', 'First line\nsame paragraph', '```\ncode\n\nstill code\n```', '- one\n- two']);
  });

  test('plain words for quotes and reading aloud', () => {
    expect(plainText('## **Grace** and [peace](http://x.y) ![p](http://img)\n> to _you_')).toBe('Grace and peace to you');
  });

  test('a highlight is found again after the author edits', () => {
    const before = ['Intro.', 'The Lord is my shepherd.', 'End.'];
    const h = { block: 1, quote: 'The Lord is my shepherd.' };
    expect(findBlock(before, h)).toBe(1);
    const after = ['A new first paragraph.', 'Intro.', 'The Lord is my shepherd.', 'End.'];   // moved down
    expect(findBlock(after, h)).toBe(2);
    expect(findBlock(['Intro.', 'Rewritten entirely.'], h)).toBe(-1);                         // gone
  });
});

describe('reader settings', () => {
  const author = { bg: '#0A1628', text: '#E8ECF3', fontFamily: 'Lora_400Regular', scale: 2 };

  test('by default the book keeps its author\'s look (and size nudge)', () => {
    const look = settings.resolveReadingLook(settings.DEFAULT_READER_SETTINGS, author);
    expect(look).toMatchObject({ bg: '#0A1628', text: '#E8ECF3', fontFamily: 'Lora_400Regular', size: 17 + 2 });
  });

  test('the reader\'s own choices win, and are kept', async () => {
    settings.setReaderSetting('theme', 'sepia');
    settings.setReaderSetting('font', 'sans');
    settings.setReaderSetting('size', 4);
    settings.setReaderSetting('lineHeight', 2);
    const s = JSON.parse(await AsyncStorage.getItem('reader:settings:v1'));
    const look = settings.resolveReadingLook(s, author);
    expect(look).toMatchObject({ bg: '#F1E4CB', fontFamily: undefined, size: 25, lineHeight: 50 });
  });

  test('nonsense kept on the phone falls back to defaults', async () => {
    await AsyncStorage.setItem('reader:settings:v1', JSON.stringify({ theme: 'neon', size: 99, font: 'comic' }));
    settings.__resetReaderSettings();
    await settings.loadReaderSettings();
    settings.setReaderSetting('margin', 2);                       // triggers a clean save
    expect(JSON.parse(await AsyncStorage.getItem('reader:settings:v1'))).toMatchObject({ theme: 'author', size: 1, font: 'author', margin: 2 });
  });
});

test('book progress is by words', () => {
  const chapters = [{ word_count: 100 }, { word_count: 300 }, { word_count: 600 }];
  expect(bookFraction(chapters, 1, 0.5)).toBeCloseTo(0.25);
  expect(bookFraction(chapters, 2, 1)).toBe(1);
});

describe('highlights on the phone', () => {
  const mark = { chapter_id: 51, block: 2, quote: 'Grace', color: 'yellow' };

  test('made at once, kept on the phone, and sent', async () => {
    const h = await hl.saveHighlight(5, mark);
    expect(h.client_id).toBeTruthy();
    await hl.flushHighlights();
    expect(mockSync).toHaveBeenCalledWith([expect.objectContaining({ op: 'upsert', client_id: h.client_id, color: 'yellow', publication: 5 })]);
    expect(await hl.__pendingHighlightOps()).toEqual([]);
    hl.__resetBookHighlights();
    await hl.loadBookHighlights(5, { remote: false });           // a restart, offline
    await hl.loadBookHighlights(5, { remote: false });
    expect(JSON.parse(await AsyncStorage.getItem('bookhl:v1:5'))[h.client_id].color).toBe('yellow');
  });

  test('offline: the change waits, and survives the server copy until sent', async () => {
    mockSync.mockRejectedValue(new Error('Network Error'));
    const h = await hl.saveHighlight(5, mark);
    await hl.flushHighlights();
    expect((await hl.__pendingHighlightOps()).length).toBe(1);
    // The account (another phone) knows another highlight; ours isn't there yet.
    mockFetch.mockResolvedValue({ results: [{ client_id: 'other', chapter_id: 51, block: 0, quote: 'Peace', color: 'green', note: '', updated_at: '2026-09-25T10:00:00Z' }] });
    await hl.loadBookHighlights(5);
    const kept = JSON.parse(await AsyncStorage.getItem('bookhl:v1:5'));
    expect(Object.keys(kept).sort()).toEqual([h.client_id, 'other'].sort());
  });

  test('neither colour nor note left: removed, and the removal is sent', async () => {
    const h = await hl.saveHighlight(5, mark);
    await hl.saveHighlight(5, { ...mark, client_id: h.client_id, color: '', note: '' });
    const ops = mockSync.mock.calls.flatMap((c) => c[0]);
    expect(ops[ops.length - 1]).toMatchObject({ op: 'delete', client_id: h.client_id });
    expect(JSON.parse(await AsyncStorage.getItem('bookhl:v1:5'))).toEqual({});
  });

  test('logging out clears them all', async () => {
    mockSync.mockRejectedValue(new Error('Network Error'));
    await hl.saveHighlight(5, mark);
    await hl.clearBookHighlights();
    expect(await hl.__pendingHighlightOps()).toEqual([]);
    expect((await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('bookhl'))).toEqual([]);
  });
});

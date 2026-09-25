import React, { useState } from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.setTimeout(20000);

// A small stand-in for the phone's stack: the 'bible' screens' params, top
// last. The top screen is drawn; push / back / setParams change the stack.
let mockStack = [{}];
let mockRedraw = () => {};
let mockLeftBible = false;
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: mockStack[mockStack.length - 1] }),
  useNavigation: () => ({
    push: (name, params) => { mockStack.push(params); mockRedraw(); },
    setParams: (p) => { mockStack[mockStack.length - 1] = { ...mockStack[mockStack.length - 1], ...p }; mockRedraw(); },
    goBack: () => { if (mockStack.length > 1) mockStack.pop(); else mockLeftBible = true; mockRedraw(); },
    canGoBack: () => true,
  }),
}));

const mockBooks = {
  eng_kjv: [{ id: 'GEN', name: 'Genesis', english: 'Genesis', chapters: 50, order: 1 },
    { id: 'JHN', name: 'John', english: 'John', chapters: 21, order: 43 }],
  luo_bib: [{ id: 'GEN', name: 'Chakruok', english: 'Genesis', chapters: 50, order: 1 },
    { id: 'JHN', name: 'Johana', english: 'John', chapters: 21, order: 43 }],
  guz_bsk: [{ id: 'GEN', name: 'Omochakano', english: 'Genesis', chapters: 50, order: 1 },
    { id: 'JHN', name: 'Yohana', english: 'John', chapters: 21, order: 43 }],
};
const mockChapter = {
  eng_kjv: { items: [
    { type: 'verse', number: 16, parts: [{ text: 'For God so loved the world', jesus: true }] },
    { type: 'verse', number: 17, parts: [{ text: 'For God sent not his Son', jesus: true }] },
  ] },
  luo_bib: { items: [
    { type: 'heading', text: 'Yesu owuoyo gi Nikodemo' },
    { type: 'verse', number: 16, parts: [{ text: 'Nimar Nyasaye nohero piny', jesus: true }] },
  ] },
};
const mockFetchChapter = jest.fn(async (v) => mockChapter[v]);
// eBible's chapter page, as its HTML comes.
const mockFetchPage = jest.fn(async (url) => `<html><head><link rel="stylesheet" href="liberationsans.css" /></head>
<body><ul class='tnav'></ul><div class='p'><span class="verse" id="V1">Ⅰ&#160;</span>Page ${url}</div></body></html>`);

jest.mock('../../services/bible', () => ({
  fetchBibleBooks: async (v) => mockBooks[v],
  fetchBibleChapter: (...a) => mockFetchChapter(...a),
  fetchWebChapterPage: (url) => mockFetchPage(url),
}));
// The WebView: remembers its props, so a test can load / fail / navigate it.
let mockWeb = null;
jest.mock('react-native-webview', () => {
  const { View } = require('react-native');
  return { WebView: (props) => { mockWeb = props; return <View testID={props.testID} />; } };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
});
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(async () => {}) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../context/I18nContext', () => ({
  useI18n: () => ({ t: (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k) }),
}));

const BibleReaderBare = require('../BibleReader').default;
const { PreferencesProvider } = require('../../context/PreferencesContext');
const BibleReader = () => {
  const [, redraw] = useState(0);
  mockRedraw = () => redraw((n) => n + 1);
  // One screen per stack entry, as the navigator would mount it.
  return <PreferencesProvider><BibleReaderBare key={mockStack.length} /></PreferencesProvider>;
};

beforeEach(async () => {
  await AsyncStorage.clear();
  require('../../services/bibleLibrary').__resetBibleLibrary();
  mockFetchChapter.mockClear();
  mockStack = [{}];
  mockLeftBible = false;
});

test('back goes up one step at a time — reading, chapters, books — never straight out', async () => {
  const r = render(<BibleReader />);
  await waitFor(() => expect(r.getByText('John')).toBeTruthy());
  fireEvent.press(r.getByText('John'));
  expect(mockStack).toEqual([{}, { bookId: 'JHN' }]);                          // the chapters: a new screen
  await act(async () => { fireEvent.press(r.getByText('3')); });
  expect(mockStack).toEqual([{}, { bookId: 'JHN' }, { bookId: 'JHN', chapter: 3 }]);
  expect(r.getByText('For God so loved the world')).toBeTruthy();

  // Next and Previous turn the page in place: back still leads to the chapters.
  await act(async () => { fireEvent.press(r.getByText('common.next')); });
  expect(mockStack).toEqual([{}, { bookId: 'JHN' }, { bookId: 'JHN', chapter: 4 }]);
  expect(mockFetchChapter).toHaveBeenLastCalledWith('eng_kjv', 'JHN', 4);

  await act(async () => { mockStack.pop(); mockRedraw(); });                 // a back swipe
  expect(r.getByText('bible.selectChapter')).toBeTruthy();
  await act(async () => { mockStack.pop(); mockRedraw(); });                 // and another
  expect(r.getByText('Genesis')).toBeTruthy();
  expect(mockLeftBible).toBe(false);
});


test('every version is a card at the top; the chosen one is marked', async () => {
  const r = render(<BibleReader />);
  await waitFor(() => expect(r.getByText('John')).toBeTruthy());
  for (const id of ['eng_kjv', 'swh_bib', 'swh_onmm', 'swh_ulb', 'luo_bib', 'guz_bsk', 'kik_bib', 'lug_bib', 'BSB']) {
    expect(r.getByTestId(`bible-version-${id}`)).toBeTruthy();
  }
  expect(r.getByTestId('bible-version-eng_kjv').props.accessibilityState).toEqual({ checked: true });
  expect(r.getByTestId('bible-version-luo_bib').props.accessibilityState).toEqual({ checked: false });
  expect(r.getByText('Dholuo')).toBeTruthy();                                // the card's language
});

test('switching to Dholuo mid-chapter: the same chapter, the book in Dholuo, red letters, the credit', async () => {
  const r = render(<BibleReader />);
  await waitFor(() => expect(r.getByText('John')).toBeTruthy());
  expect(r.getByText('King James Version')).toBeTruthy();                    // the default
  fireEvent.press(r.getByText('John'));
  await act(async () => { fireEvent.press(r.getByText('3')); });
  expect(mockFetchChapter).toHaveBeenLastCalledWith('eng_kjv', 'JHN', 3);
  expect(r.getByText('For God so loved the world')).toBeTruthy();
  expect(r.getByText('King James Version · Public domain')).toBeTruthy();

  await act(async () => { fireEvent.press(r.getByTestId('bible-version-luo_bib')); });
  expect(mockFetchChapter).toHaveBeenLastCalledWith('luo_bib', 'JHN', 3);
  await waitFor(() => expect(r.getAllByText('Johana 3')).toHaveLength(2));   // top bar and page title
  expect(r.getByText('Yesu owuoyo gi Nikodemo')).toBeTruthy();
  const words = r.getByText('Nimar Nyasaye nohero piny');
  expect([].concat(words.props.style).filter(Boolean)).toEqual(expect.arrayContaining([expect.objectContaining({ color: '#FF7A7A' })]));
  expect(r.getByText('Dholuo Bible © 2020 Biblica, Inc. · CC BY-SA 4.0')).toBeTruthy();
  expect(r.getByTestId('bible-version-luo_bib').props.accessibilityState).toEqual({ checked: true });

  // Remembered for next time.
  await waitFor(async () => expect(JSON.parse(await AsyncStorage.getItem('pref:bibleVersion'))).toBe('luo_bib'));
});

test('book search finds a Dholuo book by its English name too', async () => {
  await AsyncStorage.setItem('pref:bibleVersion', JSON.stringify('luo_bib'));
  const r = render(<BibleReader />);
  await waitFor(() => expect(r.getByText('Johana')).toBeTruthy());
  fireEvent.changeText(r.getByPlaceholderText('bible.searchPlaceholder'), 'john');
  expect(r.getByText('Johana')).toBeTruthy();
  expect(r.queryByText('Chakruok')).toBeNull();
});

test('Ekegusii mid-chapter: eBible’s own page in our reader, dressed like it, links kept in check', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const r = render(<BibleReader />);
  await waitFor(() => expect(r.getByText('John')).toBeTruthy());
  fireEvent.press(r.getByText('John'));
  await act(async () => { fireEvent.press(r.getByText('3')); });
  await act(async () => { fireEvent.press(r.getByTestId('bible-version-guz_bsk')); });

  expect(r.getByTestId('bible-version-guz_bsk').props.accessibilityState).toEqual({ checked: true });
  // eBible's page, fetched, with our look built into it (not injected as it loads).
  expect(mockFetchPage).toHaveBeenLastCalledWith('https://ebible.org/guz/JHN03.htm');
  expect(mockWeb.source.baseUrl).toBe('https://ebible.org/guz/JHN03.htm');
  const html = mockWeb.source.html;
  expect(html).toContain('Page https://ebible.org/guz/JHN03.htm');
  // Ours comes after eBible's stylesheet in the head, so it always wins.
  expect(html.indexOf('<style>')).toBeGreaterThan(html.indexOf('liberationsans.css'));
  expect(html.indexOf('<style>')).toBeLessThan(html.indexOf('</head>'));
  // eBible's colours (black text, navy notes, a yellow pop-up) all replaced by ours.
  expect(html).toContain('body * { color: inherit !important; background: transparent !important');
  expect(html).toContain('body .popup, body .crpopup');
  expect(html).toContain('.tnav');                                              // eBible's arrows hidden
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  expect(css).not.toMatch(/color:\s*(black|blue|navy)/i);
  expect(mockFetchChapter).toHaveBeenLastCalledWith('eng_kjv', 'JHN', 3);         // nothing fetched for it
  expect(r.getByText('Ebibilia Enchenu © 2021 Bible Society of Kenya · from eBible.org')).toBeTruthy();

  // A footnote stays; a link away opens outside.
  expect(mockWeb.onShouldStartLoadWithRequest({ url: 'https://ebible.org/guz/JHN03.htm#FN2' })).toBe(true);
  expect(mockWeb.onShouldStartLoadWithRequest({ url: 'https://ebible.org/guz/copyright.htm' })).toBe(false);
  expect(open).toHaveBeenCalledWith('https://ebible.org/guz/copyright.htm');

  // Next is ours: chapter 4's page.
  await act(async () => { fireEvent.press(r.getByText('common.next')); });
  await waitFor(() => expect(mockWeb.source.baseUrl).toBe('https://ebible.org/guz/JHN04.htm'));

  // No internet: said plainly, with a retry.
  mockFetchPage.mockRejectedValueOnce(new Error('offline'));
  await act(async () => { fireEvent.press(r.getByText('common.previous')); });
  await waitFor(() => expect(r.getByText('bible.onlineOnly')).toBeTruthy());
  await act(async () => { fireEvent.press(r.getByText('common.retry')); });
  await waitFor(() => expect(mockWeb.source.baseUrl).toBe('https://ebible.org/guz/JHN03.htm'));
  // A page that fails to show once fetched says the same.
  await act(async () => { mockWeb.onError({ nativeEvent: {} }); });
  expect(r.getByText('bible.onlineOnly')).toBeTruthy();
  open.mockRestore();
});

test('Ekegusii books are listed in Ekegusii, its chapter titled so', async () => {
  await AsyncStorage.setItem('pref:bibleVersion', JSON.stringify('guz_bsk'));
  const r = render(<BibleReader />);
  await waitFor(() => expect(r.getByText('Omochakano')).toBeTruthy());
  fireEvent.press(r.getByText('Yohana'));
  await act(async () => { fireEvent.press(r.getByText('3')); });
  expect(r.getAllByText('Yohana 3').length).toBeGreaterThan(0);
  await waitFor(() => expect(mockWeb.source.baseUrl).toBe('https://ebible.org/guz/JHN03.htm'));
});

describe('verse tools: highlight, favourite, note, share', () => {
  const { Share } = require('react-native');
  const openJohn3 = async (r) => {
    await waitFor(() => expect(r.getByText('John')).toBeTruthy());
    fireEvent.press(r.getByText('John'));
    await act(async () => { fireEvent.press(r.getByText('3')); });
  };
  const styleOf = (node) => [].concat(node.props.style).flat(Infinity).filter(Boolean).reduce((a, x) => ({ ...a, ...x }), {});

  test('tap verses to select them; the bar names the passage; highlight colours them', async () => {
    const r = render(<BibleReader />);
    await openJohn3(r);
    expect(r.getByText('bible.tapVerseHint')).toBeTruthy();
    fireEvent.press(r.getByTestId('bible-verse-17'));
    fireEvent.press(r.getByTestId('bible-verse-16'));
    expect(r.getByText('John 3:16-17')).toBeTruthy();
    await act(async () => { fireEvent.press(r.getByTestId('bible-highlight-yellow')); });
    expect(r.queryByTestId('bible-verse-actions')).toBeNull();                       // done: the bar goes
    await waitFor(() => expect(styleOf(r.getByTestId('bible-verse-16')).backgroundColor).toBe('rgba(255,214,10,0.24)'));
    expect(styleOf(r.getByTestId('bible-verse-17')).backgroundColor).toBe('rgba(255,214,10,0.24)');
    // Selecting it again shows its colour, and it can be cleared.
    fireEvent.press(r.getByTestId('bible-verse-16'));
    expect(r.getByTestId('bible-highlight-yellow').props.accessibilityState).toEqual({ checked: true });
    await act(async () => { fireEvent.press(r.getByTestId('bible-highlight-clear')); });
    await waitFor(() => expect(styleOf(r.getByTestId('bible-verse-16')).backgroundColor).toBeUndefined());
  });

  test('favourite a verse: a heart marks it; again removes it', async () => {
    const r = render(<BibleReader />);
    await openJohn3(r);
    fireEvent.press(r.getByTestId('bible-verse-16'));
    await act(async () => { fireEvent.press(r.getByTestId('bible-action-favorite')); });
    await waitFor(() => expect(r.getByText('♥ ')).toBeTruthy());
    const saved = JSON.parse(await AsyncStorage.getItem('bibleLibrary:v1')).favorites[0];
    expect(saved).toMatchObject({ bookId: 'JHN', chapter: 3, verses: [16], text: 'For God so loved the world', versionId: 'eng_kjv' });
    fireEvent.press(r.getByTestId('bible-verse-16'));
    expect(r.getByText('bible.favorited')).toBeTruthy();
    await act(async () => { fireEvent.press(r.getByTestId('bible-action-favorite')); });
    await waitFor(() => expect(r.queryByText('♥ ')).toBeNull());
  });

  test('write a note on a verse; its mark opens it again to edit', async () => {
    const r = render(<BibleReader />);
    await openJohn3(r);
    fireEvent.press(r.getByTestId('bible-verse-17'));
    fireEvent.press(r.getByTestId('bible-action-note'));
    fireEvent.changeText(r.getByTestId('bible-note-input'), 'He came to save');
    await act(async () => { fireEvent.press(r.getByTestId('bible-note-save')); });
    await waitFor(() => expect(r.getByTestId('bible-note-mark-17')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByTestId('bible-note-mark-17')); });
    expect(r.getByTestId('bible-note-input').props.value).toBe('He came to save');
    await act(async () => { fireEvent.press(r.getByTestId('bible-note-delete')); });
    await waitFor(() => expect(r.queryByTestId('bible-note-mark-17')).toBeNull());
  });

  test('share (or copy) sends the words with the reference and version', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    const r = render(<BibleReader />);
    await openJohn3(r);
    fireEvent.press(r.getByTestId('bible-verse-16'));
    await act(async () => { fireEvent.press(r.getByTestId('bible-action-share')); });
    expect(share).toHaveBeenCalledWith({ message: '“For God so loved the world”\n— John 3:16 (KJV)' });
    share.mockRestore();
  });

  test('text size steps up and down, and is remembered', async () => {
    const r = render(<BibleReader />);
    await openJohn3(r);
    expect(styleOf(r.getByTestId('bible-verse-16')).fontSize).toBe(18);
    await act(async () => { fireEvent.press(r.getByTestId('bible-text-larger')); });
    expect(styleOf(r.getByTestId('bible-verse-16')).fontSize).toBe(20);
    await waitFor(async () => expect(JSON.parse(await AsyncStorage.getItem('pref:bibleTextSize'))).toBe(20));
    await act(async () => { fireEvent.press(r.getByTestId('bible-text-smaller')); });
    await act(async () => { fireEvent.press(r.getByTestId('bible-text-smaller')); });
    expect(styleOf(r.getByTestId('bible-verse-16')).fontSize).toBe(16);
  });
});

describe('bookmarks, history and continue reading', () => {
  test('bookmark a chapter; the Bible home continues where you left off', async () => {
    const r = render(<BibleReader />);
    await waitFor(() => expect(r.getByText('John')).toBeTruthy());
    expect(r.queryByTestId('bible-continue')).toBeNull();                          // nothing read yet
    fireEvent.press(r.getByText('John'));
    await act(async () => { fireEvent.press(r.getByText('3')); });
    await act(async () => { fireEvent.press(r.getByTestId('bible-bookmark')); });
    expect(r.getByTestId('bible-bookmark').props.accessibilityState).toEqual({ selected: true });

    await act(async () => { mockStack.pop(); mockStack.pop(); mockRedraw(); });      // back home
    await waitFor(() => expect(r.getByTestId('bible-continue')).toBeTruthy());
    expect(r.getByText('John 3 · KJV')).toBeTruthy();
    expect(r.getByTestId('bible-shelf-bookmarks').props.accessibilityLabel).toBe('bible.tab.bookmarks, 1');
    expect(r.getByTestId('bible-shelf-history').props.accessibilityLabel).toBe('bible.tab.history, 1');
    await act(async () => { fireEvent.press(r.getByTestId('bible-continue')); });
    expect(mockStack[mockStack.length - 1]).toEqual({ bookId: 'JHN', chapter: 3 });
  });

  test('opened at a verse (from My Bible), it scrolls there and flashes it', async () => {
    mockStack = [{}, { bookId: 'JHN', chapter: 3, verse: 17 }];
    const r = render(<BibleReader />);
    await waitFor(() => expect(r.getByTestId('bible-verse-17')).toBeTruthy());
    await act(async () => { fireEvent(r.getByTestId('bible-verse-17'), 'layout', { nativeEvent: { layout: { y: 300 } } }); });
    const flash = [].concat(r.getByTestId('bible-verse-17').props.style).flat(Infinity).filter(Boolean)
      .reduce((a, x) => ({ ...a, ...x }), {});
    expect(flash.backgroundColor).toBe('rgba(244,162,97,0.35)');
  });

  test('Next after opening at a verse: the next chapter opens at its top', async () => {
    mockStack = [{}, { bookId: 'JHN', chapter: 3, verse: 17 }];
    const r = render(<BibleReader />);
    await waitFor(() => expect(r.getByTestId('bible-verse-17')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByText('common.next')); });
    expect(mockStack[mockStack.length - 1]).toEqual({ bookId: 'JHN', chapter: 4 });
    expect(mockStack[mockStack.length - 1].verse).toBeUndefined();
  });
});

/**
 * The verse of the day: paints the kept copy at once (the morning push lands
 * here), has yesterday ready before "Earlier" is pressed, shares from a
 * labelled button, and offers Retry only when there is nothing to show.
 */
import React from 'react';
import { Share, ActivityIndicator } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { format, subDays } from 'date-fns';
import { writeCache, dropCache, peekCache } from '../../utils/screenCache';

jest.setTimeout(20000);

const mockApi = { fetchDailyVerse: jest.fn() };
jest.mock('../../services/api', () => ({ fetchDailyVerse: (...a) => mockApi.fetchDailyVerse(...a) }));
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
let mockLang = 'en';
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT, resolvedLanguage: mockLang }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});

const mockSpeech = { speak: jest.fn(), stop: jest.fn() };
jest.mock('expo-speech', () => ({
  speak: (...a) => mockSpeech.speak(...a),
  stop: (...a) => mockSpeech.stop(...a),
}));
const mockHaptics = { selectionAsync: jest.fn(async () => {}), impactAsync: jest.fn(async () => {}) };
jest.mock('expo-haptics', () => ({
  selectionAsync: (...a) => mockHaptics.selectionAsync(...a),
  impactAsync: (...a) => mockHaptics.impactAsync(...a),
  ImpactFeedbackStyle: { Light: 'light' },
}));

const mockCapture = jest.fn(async () => 'file:///tmp/verse.png');
jest.mock('react-native-view-shot', () => ({ captureRef: (...a) => mockCapture(...a) }));
const mockSharing = { isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) };
jest.mock('expo-sharing', () => ({
  isAvailableAsync: (...a) => mockSharing.isAvailableAsync(...a),
  shareAsync: (...a) => mockSharing.shareAsync(...a),
}));
const mockMedia = {
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  saveToLibraryAsync: jest.fn(async () => {}),
};
jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: (...a) => mockMedia.requestPermissionsAsync(...a),
  saveToLibraryAsync: (...a) => mockMedia.saveToLibraryAsync(...a),
}));
const mockClipboard = { setStringAsync: jest.fn(async () => true) };
jest.mock('expo-clipboard', () => ({ setStringAsync: (...a) => mockClipboard.setStringAsync(...a) }));

let mockPrefs = {};
jest.mock('../../context/PreferencesContext', () => ({ usePreferences: () => ({ preferences: mockPrefs }) }));
const mockBible = { fetchBibleBooks: jest.fn(), fetchBibleChapter: jest.fn() };
jest.mock('../../services/bible', () => ({
  fetchBibleBooks: (...a) => mockBible.fetchBibleBooks(...a),
  fetchBibleChapter: (...a) => mockBible.fetchBibleChapter(...a),
}));

const mockPublish = jest.fn(async () => {});
jest.mock('../../widgets/verseWidgetStore', () => ({ publishWidgetVerse: (...a) => mockPublish(...a) }));

const DailyVerse = require('../DailyVerse').default;
const { bookIdFor } = require('../DailyVerse');
const bibleLibrary = require('../../services/bibleLibrary');

const day = (back) => format(subDays(new Date(), back), 'yyyy-MM-dd');
const verse = (back, ref) => ({
  date: day(back), reference: ref, book: 'Psalms', chapter: 23, verse: 1,
  text: `Text of ${ref}`, is_today: back === 0,
});

beforeEach(() => {
  mockApi.fetchDailyVerse.mockReset();
  mockSpeech.speak.mockClear();
  mockSpeech.stop.mockClear();
  mockHaptics.selectionAsync.mockClear();
  mockCapture.mockClear();
  mockCapture.mockImplementation(async () => 'file:///tmp/verse.png');
  mockSharing.shareAsync.mockClear();
  mockMedia.requestPermissionsAsync.mockClear();
  mockMedia.requestPermissionsAsync.mockImplementation(async () => ({ granted: true }));
  mockMedia.saveToLibraryAsync.mockClear();
  mockClipboard.setStringAsync.mockClear();
  mockLang = 'en';
  mockPrefs = {};
  mockBible.fetchBibleBooks.mockReset();
  mockBible.fetchBibleChapter.mockReset();
  mockBible.fetchBibleBooks.mockResolvedValue([{ id: 'PSA', name: 'Zaburi' }, { id: 'JHN', name: 'Yohana' }]);
  mockBible.fetchBibleChapter.mockImplementation(async (v, book, ch) => ({ items: [
    { type: 'verse', number: 1, parts: [{ text: `${v} ${book} ${ch}:1 maandishi` }] },
  ] }));
  bibleLibrary.__resetBibleLibrary();
  for (let i = 0; i <= 15; i += 1) dropCache(`verse:${day(i)}`);
});

test('the kept copy is painted at once, with no spinner', async () => {
  writeCache(`verse:${day(0)}`, verse(0, 'Psalms 23:1'));
  mockApi.fetchDailyVerse.mockImplementation(() => new Promise(() => {}));   // never answers

  const screen = render(<DailyVerse />);
  expect(screen.getByText('Text of Psalms 23:1')).toBeTruthy();
  expect(screen.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
});

test('today is asked for without a date, so the server decides what today is', async () => {
  mockApi.fetchDailyVerse.mockImplementation(async (d) => (d ? verse(1, 'John 3:16') : verse(0, 'Psalms 23:1')));
  const screen = render(<DailyVerse />);
  await waitFor(() => expect(screen.getByText('Text of Psalms 23:1')).toBeTruthy());
  expect(mockApi.fetchDailyVerse).toHaveBeenCalledWith(null);
});

test('yesterday is fetched ahead, so Earlier shows it without a spinner', async () => {
  mockApi.fetchDailyVerse.mockImplementation(async (d) => (d ? verse(1, 'John 3:16') : verse(0, 'Psalms 23:1')));
  const screen = render(<DailyVerse />);
  await waitFor(() => expect(peekCache(`verse:${day(1)}`)?.reference).toBe('John 3:16'));
  expect(mockApi.fetchDailyVerse).toHaveBeenCalledWith(day(1));

  fireEvent.press(screen.getByText('verse.earlier'));
  expect(screen.getByText('Text of John 3:16')).toBeTruthy();
  expect(screen.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
});

test('with nothing kept and no network, Retry loads it', async () => {
  mockApi.fetchDailyVerse.mockRejectedValueOnce(new Error('offline'));
  const screen = render(<DailyVerse />);
  await waitFor(() => expect(screen.getByText('verse.failed')).toBeTruthy());

  mockApi.fetchDailyVerse.mockImplementation(async () => verse(0, 'Psalms 23:1'));
  fireEvent.press(screen.getByText('common.retry'));
  await waitFor(() => expect(screen.getByText('Text of Psalms 23:1')).toBeTruthy());
});

const today = async (nav) => {
  mockApi.fetchDailyVerse.mockImplementation(async (d) => (d ? verse(1, 'John 3:16') : verse(0, 'Psalms 23:1')));
  const screen = render(<DailyVerse navigation={nav} />);
  await waitFor(() => expect(screen.getByText('Text of Psalms 23:1')).toBeTruthy());
  return screen;
};

test('Listen reads the verse and its reference as words, and a second press stops it', async () => {
  const screen = await today();
  fireEvent.press(screen.getByLabelText('verse.listen'));
  expect(mockSpeech.speak).toHaveBeenCalledWith(
    'Text of Psalms 23:1 ... Psalms, chapter 23, verse 1.',
    expect.objectContaining({ language: 'en' }),
  );

  mockSpeech.stop.mockClear();
  fireEvent.press(screen.getByLabelText('verse.stop'));
  expect(mockSpeech.stop).toHaveBeenCalled();
  expect(screen.getByLabelText('verse.listen')).toBeTruthy();
});

test('the voice stops when the day changes', async () => {
  const screen = await today();
  fireEvent.press(screen.getByLabelText('verse.listen'));
  mockSpeech.stop.mockClear();
  fireEvent.press(screen.getByText('verse.earlier'));
  await waitFor(() => expect(screen.getByText('Text of John 3:16')).toBeTruthy());
  expect(mockSpeech.stop).toHaveBeenCalled();
  expect(screen.getByLabelText('verse.listen')).toBeTruthy();
});

test('Read chapter opens the reader at the verse, as My Bible does', async () => {
  const nav = { push: jest.fn() };
  const screen = await today(nav);
  fireEvent.press(screen.getByLabelText('verse.readChapter'));
  expect(nav.push).toHaveBeenCalledWith('bible', { bookId: 'PSA', chapter: 23, verse: 1 });
});

test('changing day is felt, and pressing Today on today is not', async () => {
  const screen = await today();
  const buttons = screen.getAllByText('verse.today');     // the card's label, then the button
  fireEvent.press(buttons[buttons.length - 1]);            // already today
  expect(mockHaptics.selectionAsync).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('verse.earlier'));
  expect(mockHaptics.selectionAsync).toHaveBeenCalledTimes(1);
});

test("the server's book names map to the reader's codes", () => {
  expect(bookIdFor('Psalms')).toBe('PSA');
  expect(bookIdFor('1 Corinthians')).toBe('1CO');
  expect(bookIdFor('Song of Solomon')).toBe('SNG');
  expect(bookIdFor('Revelation')).toBe('REV');
  expect(bookIdFor('Nowhere')).toBeNull();
});

const MESSAGE = '“Text of Psalms 23:1”\n— Psalms 23:1';
const openSheet = async () => {
  const screen = await today();
  expect(screen.getByText('verse.shareShort')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('verse.share'));
  await waitFor(() => expect(screen.getByTestId('verse-share-sheet')).toBeTruthy());
  return screen;
};

test('Share opens a sheet whose preview is the picture, with the date, not "Today"', async () => {
  const screen = await openSheet();
  expect(screen.getByText(`verse.title · ${format(new Date(), 'd MMMM yyyy')}`)).toBeTruthy();
  expect(screen.getAllByText('Text of Psalms 23:1')).toHaveLength(2);   // the screen and the card
});

test('Share as picture captures the card and hands the image to the share sheet', async () => {
  const screen = await openSheet();
  fireEvent.press(screen.getByTestId('verse-share-image'));
  await waitFor(() => expect(mockSharing.shareAsync).toHaveBeenCalledWith(
    'file:///tmp/verse.png', expect.objectContaining({ mimeType: 'image/png' }),
  ));
  expect(mockCapture).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ format: 'png' }));
});

test('a picture that cannot be made falls back to the text, not to an error', async () => {
  const spy = jest.spyOn(Share, 'share').mockResolvedValue({});
  mockCapture.mockRejectedValueOnce(new Error('no native module'));
  const screen = await openSheet();
  fireEvent.press(screen.getByTestId('verse-share-image'));
  await waitFor(() => expect(spy).toHaveBeenCalledWith({ message: MESSAGE }));
  expect(mockSharing.shareAsync).not.toHaveBeenCalled();
  spy.mockRestore();
});

test('Text shares the verse with its reference', async () => {
  const spy = jest.spyOn(Share, 'share').mockResolvedValue({});
  const screen = await openSheet();
  fireEvent.press(screen.getByTestId('verse-share-text'));
  expect(spy).toHaveBeenCalledWith({ message: MESSAGE });
  spy.mockRestore();
});

test('Save asks only to add photos, saves the picture and says so', async () => {
  const screen = await openSheet();
  fireEvent.press(screen.getByTestId('verse-save'));
  await waitFor(() => expect(screen.getByText('verse.saved')).toBeTruthy());
  expect(mockMedia.requestPermissionsAsync).toHaveBeenCalledWith(true, ['photo']);
  expect(mockMedia.saveToLibraryAsync).toHaveBeenCalledWith('file:///tmp/verse.png');
});

test('Save without permission explains, and saves nothing', async () => {
  mockMedia.requestPermissionsAsync.mockImplementation(async () => ({ granted: false }));
  const screen = await openSheet();
  fireEvent.press(screen.getByTestId('verse-save'));
  await waitFor(() => expect(screen.getByText('verse.savePermission')).toBeTruthy());
  expect(mockMedia.saveToLibraryAsync).not.toHaveBeenCalled();
});

test('Copy in the sheet puts the verse on the clipboard', async () => {
  const screen = await openSheet();
  fireEvent.press(screen.getByTestId('verse-copy'));
  await waitFor(() => expect(screen.getByText('verse.copied')).toBeTruthy());
  expect(mockClipboard.setStringAsync).toHaveBeenCalledWith(MESSAGE);
});

test('long-pressing the verse copies it', async () => {
  const screen = await today();
  fireEvent(screen.getByText('Text of Psalms 23:1'), 'longPress');
  await waitFor(() => expect(screen.getByText('verse.copied')).toBeTruthy());
  expect(mockClipboard.setStringAsync).toHaveBeenCalledWith(MESSAGE);
});

const withExtras = (extra) => {
  mockApi.fetchDailyVerse.mockImplementation(async (d) => (d
    ? { ...verse(1, 'John 3:16'), reflection: { en: 'Yesterday line', sw: 'Mstari wa jana' } }
    : { ...verse(0, 'Psalms 23:1'), ...extra }));
};
const REFLECTION = { en: 'With the Shepherd leading, you have enough.', sw: 'Mchungaji akiongoza, unatosha.' };

test("the reflection sits under the verse, in the reader's language", async () => {
  withExtras({ reflection: REFLECTION });
  let screen = render(<DailyVerse />);
  await waitFor(() => expect(screen.getByText(REFLECTION.en)).toBeTruthy());
  screen.unmount();

  mockLang = 'sw';
  dropCache(`verse:${day(0)}`);
  screen = render(<DailyVerse />);
  await waitFor(() => expect(screen.getByText(REFLECTION.sw)).toBeTruthy());
  expect(screen.queryByText(REFLECTION.en)).toBeNull();
});

test('a verse from an older server, with no reflection, still shows whole', async () => {
  withExtras({});
  const screen = render(<DailyVerse />);
  await waitFor(() => expect(screen.getByText('Text of Psalms 23:1')).toBeTruthy());
});

test('the streak shows from the second day, and only on today', async () => {
  withExtras({ streak: { current: 5, best: 9 } });
  const screen = render(<DailyVerse />);
  await waitFor(() => expect(screen.getByText('verse.streak:5')).toBeTruthy());

  fireEvent.press(screen.getByText('verse.earlier'));
  await waitFor(() => expect(screen.getByText('Text of John 3:16')).toBeTruthy());
  expect(screen.queryByText(/verse\.streak/)).toBeNull();
});

test('a first day is not called a streak', async () => {
  withExtras({ streak: { current: 1, best: 1 } });
  const screen = render(<DailyVerse />);
  await waitFor(() => expect(screen.getByText('Text of Psalms 23:1')).toBeTruthy());
  expect(screen.queryByText(/verse\.streak/)).toBeNull();
});

test('Favourite keeps the verse in My Bible, and a second press lets it go', async () => {
  // Read My Bible from inside the same tree the screen is in.
  let lib = null;
  const Probe = () => { lib = bibleLibrary.useBibleLibrary(); return null; };
  withExtras({});
  const screen = render(<><DailyVerse /><Probe /></>);
  await waitFor(() => expect(screen.getByText('Text of Psalms 23:1')).toBeTruthy());

  fireEvent.press(screen.getByLabelText('verse.keep'));
  await waitFor(() => expect(screen.getByText('verse.kept')).toBeTruthy());
  expect(lib.favorites).toHaveLength(1);
  expect(lib.favorites[0]).toEqual(expect.objectContaining({
    bookId: 'PSA', chapter: 23, verses: [1], text: 'Text of Psalms 23:1', versionId: 'eng_kjv',
  }));
  expect(screen.getByLabelText('verse.keep').props.accessibilityState).toEqual({ selected: true });

  fireEvent.press(screen.getByLabelText('verse.keep'));
  await waitFor(() => expect(screen.getByText('verse.unkept')).toBeTruthy());
  expect(lib.favorites).toHaveLength(0);
});

describe('in the reader\'s own Bible', () => {
  test('a Swahili reader sees the verse in Swahili, with the version named', async () => {
    mockLang = 'sw';
    withExtras({});
    const screen = render(<DailyVerse />);
    await waitFor(() => expect(screen.getByText('swh_bib PSA 23:1 maandishi')).toBeTruthy());
    expect(screen.getByText('Zaburi 23:1 · NENO')).toBeTruthy();
    expect(screen.queryByText('Text of Psalms 23:1')).toBeNull();     // no English first
  });

  test('a version chosen in the reader is the one used, whatever the app language', async () => {
    mockPrefs = { bibleVersion: 'ENGWEBP' };
    withExtras({});
    const screen = render(<DailyVerse />);
    await waitFor(() => expect(screen.getByText('ENGWEBP PSA 23:1 maandishi')).toBeTruthy());
    expect(screen.getByText('Zaburi 23:1 · WEB')).toBeTruthy();
  });

  test('when the translation cannot be had, the KJV is shown rather than nothing', async () => {
    mockLang = 'sw';
    mockBible.fetchBibleChapter.mockRejectedValue(new Error('offline'));
    withExtras({});
    const screen = render(<DailyVerse />);
    await waitFor(() => expect(screen.getByText('Text of Psalms 23:1')).toBeTruthy());
    expect(screen.getByText('Psalms 23:1')).toBeTruthy();
  });

  test('Listen reads a Swahili verse in Swahili, reference and all', async () => {
    mockLang = 'sw';
    withExtras({});
    const screen = render(<DailyVerse />);
    await waitFor(() => expect(screen.getByText('swh_bib PSA 23:1 maandishi')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('verse.listen'));
    expect(mockSpeech.speak).toHaveBeenCalledWith(
      'swh_bib PSA 23:1 maandishi ... Zaburi, sura 23, mstari 1.',
      expect.objectContaining({ language: 'sw' }),
    );
  });

  test('copy and favourite carry the words that were shown', async () => {
    mockLang = 'sw';
    let lib = null;
    const Probe = () => { lib = bibleLibrary.useBibleLibrary(); return null; };
    withExtras({});
    const screen = render(<><DailyVerse /><Probe /></>);
    await waitFor(() => expect(screen.getByText('swh_bib PSA 23:1 maandishi')).toBeTruthy());

    fireEvent(screen.getByText('swh_bib PSA 23:1 maandishi'), 'longPress');
    await waitFor(() => expect(mockClipboard.setStringAsync).toHaveBeenCalledWith(
      '“swh_bib PSA 23:1 maandishi”\n— Zaburi 23:1 · NENO',
    ));

    fireEvent.press(screen.getByLabelText('verse.keep'));
    await waitFor(() => expect(lib.favorites).toHaveLength(1));
    expect(lib.favorites[0]).toEqual(expect.objectContaining({
      bookId: 'PSA', bookName: 'Zaburi', versionId: 'swh_bib', text: 'swh_bib PSA 23:1 maandishi',
    }));
  });
});

test("today's verse, as shown, is handed to the home-screen widget; earlier days are not", async () => {
  mockLang = 'sw';
  mockPublish.mockClear();
  withExtras({});
  const screen = render(<DailyVerse />);
  await waitFor(() => expect(mockPublish).toHaveBeenCalledWith(expect.objectContaining({
    text: 'swh_bib PSA 23:1 maandishi', reference: 'Zaburi 23:1 · NENO', versionId: 'swh_bib', title: 'verse.title',
  })));
  const calls = mockPublish.mock.calls.length;
  fireEvent.press(screen.getByText('verse.earlier'));
  await waitFor(() => expect(screen.getByText('swh_bib PSA 23:1 maandishi')).toBeTruthy());
  expect(mockPublish).toHaveBeenCalledTimes(calls);
});

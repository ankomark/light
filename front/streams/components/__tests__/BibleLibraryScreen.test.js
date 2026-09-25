import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

let mockParams = {};
const mockPush = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: mockParams }),
  useNavigation: () => ({ push: mockPush, goBack: jest.fn() }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../context/I18nContext', () => ({
  useI18n: () => ({ t: (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k) }),
}));
const mockConfirm = jest.fn();
jest.mock('../../utils/adminConfirm', () => ({ confirmAction: (...a) => mockConfirm(...a) }));

const lib = require('../../services/bibleLibrary');
const BibleLibraryScreen = require('../BibleLibraryScreen').default;

const passage = (verses, extra = {}) => ({
  bookId: 'JHN', bookName: 'John', chapter: 3, verses, text: 'For God so loved the world', versionId: 'eng_kjv', ...extra,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  lib.__resetBibleLibrary();
  mockParams = {};
  mockPush.mockClear();
  mockConfirm.mockReset();
});

test('opens on the tab it was asked for, and an entry opens the reader at its verse', async () => {
  await lib.saveNote(passage([16, 17]), 'God’s love');
  mockParams = { tab: 'notes' };
  const r = render(<BibleLibraryScreen />);
  await waitFor(() => expect(r.getByText('John 3:16-17')).toBeTruthy());
  expect(r.getByText('God’s love')).toBeTruthy();
  fireEvent.press(r.getByText('John 3:16-17'));
  expect(mockPush).toHaveBeenCalledWith('bible', { bookId: 'JHN', chapter: 3, verse: 16 });
});

test('an unknown tab falls back to favourites; a bookmark opens its chapter with no verse', async () => {
  await lib.toggleBookmark({ bookId: 'JHN', bookName: 'John', chapter: 3, versionId: 'eng_kjv' });
  mockParams = { tab: 'nonsense' };
  const r = render(<BibleLibraryScreen />);
  expect(r.getByText('bible.empty.favorites')).toBeTruthy();
  fireEvent.press(r.getByTestId('bible-lib-tab-bookmarks'));
  await waitFor(() => expect(r.getByText('John 3')).toBeTruthy());
  fireEvent.press(r.getByText('John 3'));
  expect(mockPush).toHaveBeenCalledWith('bible', { bookId: 'JHN', chapter: 3 });
});

test('remove an entry, then Undo puts it back', async () => {
  await lib.toggleFavorite(passage([16]));
  await lib.toggleFavorite(passage([17], { text: 'For God sent not his Son' }));
  const r = render(<BibleLibraryScreen />);
  await waitFor(() => expect(r.getByText('John 3:16')).toBeTruthy());
  const { id } = lib.findFavorite(JSON.parse(await AsyncStorage.getItem('bibleLibrary:v1')), passage([16]));
  await act(async () => { fireEvent.press(r.getByTestId(`bible-lib-remove-${id}`)); });
  expect(r.queryByText('John 3:16')).toBeNull();
  expect(r.getByText('bible.removed:John 3:16')).toBeTruthy();
  await act(async () => { fireEvent.press(r.getByText('bible.undo')); });
  expect(r.getByText('John 3:16')).toBeTruthy();
  expect(r.queryByTestId('bible-lib-undo')).toBeNull();
});

test('a highlight can be removed and restored with its colour', async () => {
  await lib.setHighlight([{ bookId: 'JHN', bookName: 'John', chapter: 3, verse: 16, text: 'v16', versionId: 'eng_kjv' }], 'green');
  const r = render(<BibleLibraryScreen />);
  fireEvent.press(r.getByTestId('bible-lib-tab-highlights'));
  await waitFor(() => expect(r.getByText('John 3:16')).toBeTruthy());
  await act(async () => { fireEvent.press(r.getByTestId('bible-lib-remove-JHN.3.16')); });
  expect(r.queryByText('John 3:16')).toBeNull();
  await act(async () => { fireEvent.press(r.getByText('bible.undo')); });
  expect(JSON.parse(await AsyncStorage.getItem('bibleLibrary:v1')).highlights['JHN.3.16'].color).toBe('green');
});

test('share sends the words, reference, version and note', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({});
  await lib.saveNote(passage([16]), 'Memorise');
  mockParams = { tab: 'notes' };
  const r = render(<BibleLibraryScreen />);
  await waitFor(() => expect(r.getByText('John 3:16')).toBeTruthy());
  fireEvent.press(r.getByLabelText('bible.shareCopy'));
  expect(share).toHaveBeenCalledWith({ message: '“For God so loved the world”\n— John 3:16 (KJV)\n\nMemorise' });
  share.mockRestore();
});

test('clear history asks first (works on web too); cancelling keeps it', async () => {
  await lib.recordReading({ bookId: 'JHN', bookName: 'John', chapter: 3, versionId: 'eng_kjv' });
  mockParams = { tab: 'history' };
  const r = render(<BibleLibraryScreen />);
  await waitFor(() => expect(r.getByText('John 3')).toBeTruthy());

  mockConfirm.mockResolvedValueOnce(false);
  await act(async () => { fireEvent.press(r.getByLabelText('bible.clearHistory')); });
  expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'bible.clearHistory', destructive: true }));
  expect(r.getByText('John 3')).toBeTruthy();

  mockConfirm.mockResolvedValueOnce(true);
  await act(async () => { fireEvent.press(r.getByLabelText('bible.clearHistory')); });
  expect(r.queryByText('John 3')).toBeNull();
  expect(r.getByText('bible.empty.history')).toBeTruthy();
});

test('search narrows a long list by reference, words or note', async () => {
  for (const v of [1, 2, 3]) await lib.toggleFavorite(passage([v], { text: `plain ${v}` }));
  await lib.toggleFavorite(passage([16], { text: 'For God so loved the world' }));
  const r = render(<BibleLibraryScreen />);
  await waitFor(() => expect(r.getByPlaceholderText('bible.librarySearch')).toBeTruthy());
  fireEvent.changeText(r.getByPlaceholderText('bible.librarySearch'), 'LOVED');
  expect(r.getByText('John 3:16')).toBeTruthy();
  expect(r.queryByText('John 3:1')).toBeNull();
  fireEvent.changeText(r.getByPlaceholderText('bible.librarySearch'), 'zzz');
  expect(r.getByText('bible.libraryNoMatch')).toBeTruthy();
});

/**
 * Word puzzle phase 2: a letter bought on a tile, tap-to-spell (and letter
 * buttons for a screen reader), the finished verse with Read in Bible and
 * Share, and the sheet of words found.
 */
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { writeCache, dropCache, userKey } from '../../utils/screenCache';
import { wordKey } from '../../utils/puzzleKeys';

jest.setTimeout(20000);

const mockApi = {
  fetchNextPuzzle: jest.fn(), fetchPuzzleLevel: jest.fn(), claimPuzzleWord: jest.fn(async () => ({})),
  buyPuzzleHint: jest.fn(), buyPuzzleLetter: jest.fn(),
  fetchCoinWallet: jest.fn(async () => ({ balance: 1, day_streak: 0 })),
};
jest.mock('../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 7 } }) }));
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
jest.mock('../../context/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { quizMusic: false, quizSound: false }, setPreference: jest.fn() }),
}));
jest.mock('../../services/quizSound', () => new Proxy({}, { get: () => () => {} }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, initialWindowMetrics: null };
});

const PuzzlePlay = require('../PuzzlePlay').default;
const KEY = userKey(7, 'puzzle:current');
const level = (extra) => ({
  id: 3, level: 4, letters: 'GRACE', rows: 1, cols: 5, layout: ['#####'], band: 'simple',
  theme: { name: 'The Gospels', slug: 'the-gospels' },
  slots: [{ length: 5, row: 0, col: 0, dir: 'across', key: wordKey(3, 'GRACE') }],
  revealed: [], found: [], bonus: [], shown: [],
  bonus_total: 2, bonus_keys: [wordKey(3, 'RACE')], hints_used: 0, is_complete: false, verse: null,
  wallet: {
    balance: 240, day_streak: 3, played_today: true, coins_per_word: 5, coins_per_bonus_word: 2,
    hint_cost: 15, letter_cost: 5,
  },
  ...extra,
});
const open = (nav = {}) => render(
  <PuzzlePlay navigation={{ goBack: jest.fn(), push: jest.fn(), addListener: () => () => {}, ...nav }} route={{}} />,
);

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockClear());
  mockApi.fetchNextPuzzle.mockImplementation(() => new Promise(() => {}));
  dropCache(KEY);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
});

test('a blank tile, picked, is sold as one letter for the letter price', async () => {
  writeCache(KEY, level());
  mockApi.buyPuzzleLetter.mockResolvedValue({ row: 0, col: 2, letter: 'A', cost: 5, balance: 235, letters_used: 1 });
  const screen = open();
  expect(screen.getByLabelText('puzzle.hintFor:15')).toBeTruthy();
  fireEvent.press(screen.getByTestId('tile-0,2'));
  expect(screen.getByLabelText('puzzle.letterFor:5')).toBeTruthy();
  fireEvent.press(screen.getByTestId('puzzle-hint'));
  await waitFor(() => expect(screen.getByText('A')).toBeTruthy());
  expect(mockApi.buyPuzzleLetter).toHaveBeenCalledWith(3, 0, 2);
  expect(mockApi.buyPuzzleHint).not.toHaveBeenCalled();
  expect(screen.getByText('235')).toBeTruthy();
  // Back to the word hint, and the tile is no longer for sale.
  expect(screen.getByLabelText('puzzle.hintFor:15')).toBeTruthy();
  expect(screen.queryByTestId('tile-0,2')).toBeNull();
});

test('a letter without the coins says what it costs', async () => {
  writeCache(KEY, level());
  mockApi.buyPuzzleLetter.mockRejectedValue({ response: { data: { code: 'not_enough_coins', cost: 5 } } });
  const screen = open();
  fireEvent.press(screen.getByTestId('tile-0,0'));
  fireEvent.press(screen.getByTestId('puzzle-hint'));
  await waitFor(() => expect(screen.getByText('puzzle.letterNoCoins:5')).toBeTruthy());
});

test('a screen reader spells with letter buttons, and the tick sends the word', async () => {
  AccessibilityInfo.isScreenReaderEnabled.mockResolvedValue(true);
  writeCache(KEY, level());
  const screen = open();
  await waitFor(() => expect(screen.getByTestId('reader-letters')).toBeTruthy());
  'GRACE'.split('').forEach((l) => fireEvent.press(screen.getByLabelText(`puzzle.a11y.letter:${l}`)));
  // Tapping the last letter again takes it back; tapping it once more restores it.
  fireEvent.press(screen.getByLabelText('puzzle.a11y.letter:E'));
  expect(screen.getByText('GRAC')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('puzzle.a11y.letter:E'));
  fireEvent.press(screen.getByTestId('tap-submit'));
  await waitFor(() => expect(mockApi.claimPuzzleWord).toHaveBeenCalledWith(3, 'GRACE'));
  expect(screen.getByLabelText(/puzzle.a11y.board:1,GRACE,/)).toBeTruthy();
});

test('the cross clears tapped letters without sending anything', async () => {
  AccessibilityInfo.isScreenReaderEnabled.mockResolvedValue(true);
  writeCache(KEY, level());
  const screen = open();
  await waitFor(() => expect(screen.getByTestId('reader-letters')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('puzzle.a11y.letter:G'));
  fireEvent.press(screen.getByTestId('tap-clear'));
  expect(screen.queryByTestId('tap-submit')).toBeNull();
  expect(mockApi.claimPuzzleWord).not.toHaveBeenCalled();
});

test('the board is described for a screen reader', () => {
  writeCache(KEY, level({ found: [] }));
  const screen = open();
  expect(screen.getByLabelText('puzzle.a11y.board:1,puzzle.a11y.none,puzzle.a11y.leftOf:1,5')).toBeTruthy();
});

describe('a finished level', () => {
  const verse = {
    reference: 'Psalms 23:1', text: 'The LORD is my shepherd; I shall not want.',
    book: 'Psalms', book_number: 19, chapter: 23, verse: 1,
  };

  test('opens its verse in the Bible, at the verse', () => {
    writeCache(KEY, level({ is_complete: true, found: ['GRACE'], verse }));
    const push = jest.fn();
    const screen = open({ push });
    fireEvent.press(screen.getByTestId('puzzle-read'));
    expect(push).toHaveBeenCalledWith('bible', { bookId: 'PSA', chapter: 23, verse: 1 });
  });

  test('shares as a picture, with the board and no letters', () => {
    writeCache(KEY, level({ is_complete: true, found: ['GRACE'], verse }));
    const screen = open();
    fireEvent.press(screen.getByTestId('puzzle-share'));
    expect(screen.getByTestId('share-sheet')).toBeTruthy();
    expect(screen.getByTestId('puzzle-card-board')).toBeTruthy();
  });
});

test('the words sheet lists the answers and bonus words found', async () => {
  writeCache(KEY, level({ found: ['GRACE'], bonus: ['RACE'], bonus_total: 3 }));
  const screen = open();
  fireEvent.press(screen.getByTestId('puzzle-words-open'));
  await waitFor(() => expect(screen.getByTestId('puzzle-words')).toBeTruthy());
  expect(screen.getByTestId('found-word-GRACE')).toBeTruthy();
  expect(screen.getByTestId('found-word-RACE')).toBeTruthy();
  expect(screen.getByText('puzzle.words.bonusLeft:2')).toBeTruthy();
});

test('finishing lights the board', async () => {
  writeCache(KEY, level());
  AccessibilityInfo.isScreenReaderEnabled.mockResolvedValue(true);
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  const screen = open();
  await waitFor(() => expect(screen.getByTestId('reader-letters')).toBeTruthy());
  'GRACE'.split('').forEach((l) => fireEvent.press(screen.getByLabelText(`puzzle.a11y.letter:${l}`)));
  await act(async () => { fireEvent.press(screen.getByTestId('tap-submit')); });
  expect(announce).toHaveBeenCalledWith('puzzle.solved');
});

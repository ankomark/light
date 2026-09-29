/**
 * Fixes from reviewing the word puzzle: finds the server never heard about
 * are sent again, coins shown for unanswered finds are not taken back by a
 * total sent meanwhile, a picked tile that fills is let go, and the music
 * stops when the screen is left.
 */
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { writeCache, peekCache, dropCache, userKey } from '../../utils/screenCache';
import { wordKey } from '../../utils/puzzleKeys';

jest.setTimeout(20000);

const mockApi = {
  fetchNextPuzzle: jest.fn(), fetchPuzzleLevel: jest.fn(), fetchDailyPuzzle: jest.fn(),
  claimPuzzleWord: jest.fn(), buyPuzzleHint: jest.fn(), buyPuzzleLetter: jest.fn(),
  fetchCoinWallet: jest.fn(async () => ({ balance: 1, day_streak: 0 })),
};
jest.mock('../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 7, username: 'mark' } }) }));
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
jest.mock('../../context/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { quizMusic: true, quizSound: false }, setPreference: jest.fn() }),
}));
const mockSound = { playLoop: jest.fn(), stopLoop: jest.fn() };
jest.mock('../../services/quizSound', () => new Proxy({}, {
  get: (_, k) => (...a) => (mockSound[k] ? mockSound[k](...a) : undefined),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, initialWindowMetrics: null };
});

const PuzzlePlay = require('../PuzzlePlay').default;
const KEY = userKey(7, 'puzzle:current');
const UNSENT = userKey(7, 'puzzle:unsent');

const board = (extra) => ({
  id: 3, level: 4, letters: 'GRACE', rows: 1, cols: 5, layout: ['#####'], band: 'simple',
  theme: { name: 'The Gospels', slug: 'the-gospels' },
  slots: [{ length: 5, row: 0, col: 0, dir: 'across', key: wordKey(3, 'GRACE') }],
  revealed: [], found: [], bonus: [], shown: [], bonus_total: 1, bonus_keys: [wordKey(3, 'RACE')],
  hints_used: 0, letters_used: 0, is_complete: false, verse: null,
  wallet: { balance: 240, day_streak: 3, coins_per_word: 5, coins_per_bonus_word: 2, hint_cost: 15, letter_cost: 5 },
  ...extra,
});
const nav = (extra) => ({
  goBack: jest.fn(), push: jest.fn(), navigate: jest.fn(), popTo: jest.fn(),
  addListener: () => () => {}, ...extra,
});
const spell = (screen, word) => {
  word.split('').forEach((l) => fireEvent.press(screen.getByLabelText(`puzzle.a11y.letter:${l}`)));
  fireEvent.press(screen.getByTestId('tap-submit'));
};

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockReset());
  Object.values(mockSound).forEach((f) => f.mockClear());
  mockApi.fetchCoinWallet.mockResolvedValue({ balance: 1, day_streak: 0 });
  dropCache(KEY);
  dropCache(UNSENT);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
});

test('a find the server never got is kept, and sent again with its board', async () => {
  writeCache(KEY, board());
  mockApi.fetchNextPuzzle.mockImplementation(() => new Promise(() => {}));
  mockApi.claimPuzzleWord.mockRejectedValue(new Error('offline'));
  const first = render(<PuzzlePlay navigation={nav()} route={{}} />);
  await waitFor(() => expect(first.getByTestId('reader-letters')).toBeTruthy());
  spell(first, 'GRACE');
  await waitFor(() => expect(peekCache(UNSENT)).toEqual([{ id: 3, word: 'GRACE' }]));
  expect(mockApi.claimPuzzleWord).toHaveBeenCalledTimes(2);   // tried, and tried again
  first.unmount();

  // Next time: the server's board lacks it; it goes back on, and is sent.
  dropCache(KEY);
  mockApi.claimPuzzleWord.mockReset();
  mockApi.claimPuzzleWord.mockResolvedValue({ correct: true, is_complete: true });
  mockApi.fetchNextPuzzle.mockResolvedValue(board());
  const again = render(<PuzzlePlay navigation={nav()} route={{}} />);
  await waitFor(() => expect(mockApi.claimPuzzleWord).toHaveBeenCalledWith(3, 'GRACE'));
  expect(again.getByLabelText(/puzzle.a11y.board:1,GRACE,/)).toBeTruthy();
  expect(peekCache(UNSENT)).toEqual([]);
});

test("a total from the server keeps the coins of finds it hasn't answered yet", async () => {
  writeCache(KEY, board());
  mockApi.fetchNextPuzzle.mockImplementation(() => new Promise(() => {}));
  let answerFirst;
  mockApi.claimPuzzleWord
    .mockImplementationOnce(() => new Promise((r) => { answerFirst = r; }))
    .mockImplementation(() => new Promise(() => {}));
  const screen = render(<PuzzlePlay navigation={nav()} route={{}} />);
  await waitFor(() => expect(screen.getByTestId('reader-letters')).toBeTruthy());
  spell(screen, 'GRACE');                 // +5 → 245, and the board is done
  spell(screen, 'RACE');                  // +2 → 247, a bonus word
  expect(screen.getByText('247')).toBeTruthy();
  await waitFor(() => expect(answerFirst).toBeTruthy());
  // The server's total counts GRACE and its finish, not RACE yet.
  await act(async () => { answerFirst({ correct: true, is_complete: true, balance: 290, completion_bonus: 45 }); });
  await waitFor(() => expect(screen.getByText('292')).toBeTruthy());
});

test('a tile picked for its letter is let go once a word fills it', async () => {
  writeCache(KEY, board());
  mockApi.fetchNextPuzzle.mockImplementation(() => new Promise(() => {}));
  mockApi.claimPuzzleWord.mockImplementation(() => new Promise(() => {}));
  const screen = render(<PuzzlePlay navigation={nav()} route={{}} />);
  await waitFor(() => expect(screen.getByTestId('reader-letters')).toBeTruthy());
  fireEvent.press(screen.getByTestId('tile-0,2'));
  expect(screen.getByLabelText('puzzle.letterFor:5')).toBeTruthy();
  spell(screen, 'GRACE');
  await waitFor(() => expect(screen.getByLabelText('puzzle.hintFor:15')).toBeTruthy());
});

test('the music stops when the screen is left, and starts again on return', () => {
  writeCache(KEY, board());
  mockApi.fetchNextPuzzle.mockImplementation(() => new Promise(() => {}));
  const listeners = {};
  render(<PuzzlePlay navigation={nav({ addListener: (e, fn) => { listeners[e] = fn; return () => {}; } })} route={{}} />);
  mockSound.stopLoop.mockClear();
  mockSound.playLoop.mockClear();
  listeners.blur();
  expect(mockSound.stopLoop).toHaveBeenCalled();
  listeners.focus();
  expect(mockSound.playLoop).toHaveBeenCalled();
});

test('a regular level never lands in the daily slot', async () => {
  const { dailyKey } = require('../PuzzleThemes');
  dropCache(dailyKey(7, 'en'));
  mockApi.fetchDailyPuzzle.mockResolvedValue(board({ id: 3 }));   // no `day`: not a daily board
  render(<PuzzlePlay navigation={nav()} route={{ params: { daily: true } }} />);
  await waitFor(() => expect(mockApi.fetchDailyPuzzle).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 50));
  expect(peekCache(dailyKey(7, 'en'))).toBeFalsy();
});

/**
 * Word puzzle phase 4: challenging a friend to a board, the two results side
 * by side, and the Daily Puzzle's leaderboard.
 */
import React from 'react';
import { AccessibilityInfo, Share } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { dropCache, userKey } from '../../utils/screenCache';
import { wordKey } from '../../utils/puzzleKeys';

jest.setTimeout(20000);

const mockApi = {
  fetchNextPuzzle: jest.fn(), fetchPuzzleLevel: jest.fn(), fetchDailyPuzzle: jest.fn(),
  fetchPuzzle: jest.fn(), fetchPuzzleVersus: jest.fn(), fetchPuzzleDailyBoard: jest.fn(),
  fetchGroups: jest.fn(async () => ({ results: [{ slug: 'choir', name: 'Choir' }] })),
  claimPuzzleWord: jest.fn(async () => ({})), buyPuzzleHint: jest.fn(), buyPuzzleLetter: jest.fn(),
  fetchCoinWallet: jest.fn(async () => ({ balance: 1, day_streak: 0 })),
};
jest.mock('../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 7, username: 'mark' } }) }));
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
const PuzzleBoardSheet = require('../../components/PuzzleBoardSheet').default;

const board = (extra) => ({
  id: 42, level: 4, letters: 'GRACE', rows: 1, cols: 5, layout: ['#####'], band: 'simple',
  theme: { name: 'The Gospels', slug: 'the-gospels' },
  slots: [{ length: 5, row: 0, col: 0, dir: 'across', key: wordKey(42, 'GRACE') }],
  revealed: [], found: [], bonus: [], shown: [], bonus_total: 0, bonus_keys: [],
  hints_used: 0, letters_used: 0, is_complete: false, verse: null,
  wallet: { balance: 240, day_streak: 3, coins_per_word: 5, hint_cost: 15, letter_cost: 5 },
  ...extra,
});
const nav = () => ({
  goBack: jest.fn(), push: jest.fn(), navigate: jest.fn(), popTo: jest.fn(), addListener: () => () => {},
});

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockClear());
  ['everyone', 'following', 'group:choir'].forEach((s) => dropCache(userKey(7, `puzzle:board:${s}`)));
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
});

test('a challenge link opens that board, naming who sent it', async () => {
  mockApi.fetchPuzzle.mockResolvedValue(board());
  const screen = render(<PuzzlePlay navigation={nav()} route={{ params: { puzzleId: '42', from: 'ivy' } }} />);
  await waitFor(() => expect(screen.getByText('The Gospels')).toBeTruthy(), { timeout: 8000 });
  expect(mockApi.fetchPuzzle).toHaveBeenCalledWith(42, { from: 'ivy' });
  expect(mockApi.fetchNextPuzzle).not.toHaveBeenCalled();
});

test('finishing a challenge shows the two results side by side', async () => {
  mockApi.fetchPuzzle.mockResolvedValue(board());
  mockApi.claimPuzzleWord.mockResolvedValue({ correct: true, is_complete: true, stars: 3, seconds: 70 });
  mockApi.fetchPuzzleVersus.mockResolvedValue({
    verdict: 'won',
    me: { username: 'mark', is_complete: true, stars: 3, seconds: 70, found: 1, total: 1 },
    them: { username: 'ivy', is_complete: true, stars: 2, seconds: 95, found: 1, total: 1 },
  });
  const screen = render(<PuzzlePlay navigation={nav()} route={{ params: { puzzleId: '42', from: 'ivy' } }} />);
  await waitFor(() => expect(screen.getByTestId('reader-letters')).toBeTruthy(), { timeout: 8000 });
  'GRACE'.split('').forEach((l) => fireEvent.press(screen.getByLabelText(`puzzle.a11y.letter:${l}`)));
  fireEvent.press(screen.getByTestId('tap-submit'));
  await waitFor(() => expect(screen.getByTestId('puzzle-versus')).toBeTruthy());
  // Asked only after our own last word was recorded.
  expect(mockApi.claimPuzzleWord).toHaveBeenCalled();
  expect(mockApi.fetchPuzzleVersus).toHaveBeenCalledWith(42, 'ivy');
  expect(screen.getByText('puzzle.versus.won:ivy')).toBeTruthy();
  expect(screen.getByText('1:35')).toBeTruthy();
});

test('Challenge a friend shares a link to this board, naming me', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({});
  mockApi.fetchPuzzleLevel.mockResolvedValue(board({ is_complete: true, found: ['GRACE'], stars: 3, seconds: 61 }));
  const screen = render(
    <PuzzlePlay navigation={nav()} route={{ params: { theme: 'the-gospels', level: 4 } }} />,
  );
  await waitFor(() => expect(screen.getByTestId('puzzle-challenge')).toBeTruthy(), { timeout: 8000 });
  fireEvent.press(screen.getByTestId('puzzle-challenge'));
  const { message } = share.mock.calls[0][0];
  expect(message).toContain('streams://puzzle/42?from=mark');
  expect(message).toContain('★★★');
  expect(message).toContain('1:01');
});

test('the daily board has a leaderboard button; a level does not', async () => {
  mockApi.fetchDailyPuzzle.mockResolvedValue(board({ day: '2026-09-29', is_complete: true, found: ['GRACE'] }));
  mockApi.fetchPuzzleDailyBoard.mockResolvedValue({ results: [], me: null });
  const screen = render(<PuzzlePlay navigation={nav()} route={{ params: { daily: true } }} />);
  await waitFor(() => expect(screen.getByTestId('puzzle-board-open')).toBeTruthy(), { timeout: 8000 });
  fireEvent.press(screen.getByTestId('puzzle-board-open'));
  await waitFor(() => expect(mockApi.fetchPuzzleDailyBoard).toHaveBeenCalledWith('everyone'));
});

describe('the leaderboard sheet', () => {
  const row = (id, username, seconds, stars) => ({ id, user: { username }, seconds, stars });

  test('ranks the day, and switches to the people I follow and my groups', async () => {
    mockApi.fetchPuzzleDailyBoard.mockResolvedValue({
      results: [row(1, 'ivy', 80, 3), row(2, 'mark', 95, 3)], me: { rank: 2, of: 2, seconds: 95, stars: 3 },
    });
    const screen = render(<PuzzleBoardSheet visible onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('ivy')).toBeTruthy());
    expect(screen.getByText('1:20')).toBeTruthy();
    expect(screen.getByText('puzzle.board.me:2,2')).toBeTruthy();
    mockApi.fetchPuzzleDailyBoard.mockResolvedValue({ results: [], me: null });
    fireEvent.press(screen.getByTestId('puzzle-board-following'));
    await waitFor(() => expect(mockApi.fetchPuzzleDailyBoard).toHaveBeenLastCalledWith('following'));
    await waitFor(() => expect(screen.getByText('puzzle.board.empty')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('puzzle-board-group:choir')).toBeTruthy());
    fireEvent.press(screen.getByTestId('puzzle-board-group:choir'));
    await waitFor(() => expect(mockApi.fetchPuzzleDailyBoard).toHaveBeenLastCalledWith('group:choir'));
  });
});

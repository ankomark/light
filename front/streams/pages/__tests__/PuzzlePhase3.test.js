/**
 * Word puzzle phase 3: the themes screen with the Daily Puzzle, the levels
 * map with stars, and the play screen taking its orders from both.
 */
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { writeCache, dropCache, userKey } from '../../utils/screenCache';
import { wordKey, starsFor, applyFind } from '../../utils/puzzleKeys';

jest.setTimeout(20000);

const mockApi = {
  fetchNextPuzzle: jest.fn(), fetchPuzzleLevel: jest.fn(), fetchDailyPuzzle: jest.fn(),
  fetchPuzzleThemes: jest.fn(), fetchPuzzleLevels: jest.fn(),
  claimPuzzleWord: jest.fn(async () => ({})), buyPuzzleHint: jest.fn(), buyPuzzleLetter: jest.fn(),
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
const { default: PuzzleThemes, dailyKey } = require('../PuzzleThemes');
const PuzzleLevels = require('../PuzzleLevels').default;

const board = (extra) => ({
  id: 3, level: 4, letters: 'GRACE', rows: 1, cols: 5, layout: ['#####'], band: 'simple',
  theme: { name: 'The Gospels', slug: 'the-gospels' },
  slots: [{ length: 5, row: 0, col: 0, dir: 'across', key: wordKey(3, 'GRACE') }],
  revealed: [], found: [], bonus: [], shown: [], bonus_total: 0, bonus_keys: [],
  hints_used: 0, letters_used: 0, is_complete: false, verse: null,
  wallet: { balance: 240, day_streak: 3, coins_per_word: 5, hint_cost: 15, letter_cost: 5 },
  ...extra,
});
const nav = (extra) => ({
  goBack: jest.fn(), push: jest.fn(), navigate: jest.fn(), popTo: jest.fn(),
  addListener: () => () => {}, ...extra,
});

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockReset());
  mockApi.claimPuzzleWord.mockResolvedValue({});
  dropCache(userKey(7, 'puzzle:current'));
  dropCache(dailyKey(7, 'en'));
  dropCache(userKey(7, 'puzzle:themes:en'));
  dropCache(userKey(7, 'puzzle:levels:en:the-gospels'));
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
});

describe('stars', () => {
  test('the same rule as the server', () => {
    expect(starsFor({})).toBe(3);
    expect(starsFor({ letters_used: 3 })).toBe(2);
    expect(starsFor({ hints_used: 1 })).toBe(2);
    expect(starsFor({ hints_used: 1, letters_used: 1 })).toBe(1);
  });

  test('a board finished here has its stars at once', () => {
    const out = applyFind(board({ letters_used: 1 }), 'GRACE');
    expect(out.done).toBe(true);
    expect(out.puzzle.stars).toBe(2);
  });
});

describe('the themes screen', () => {
  const themes = [
    { slug: 'the-gospels', name: 'The Gospels', icon: 'book', levels_completed: 2, next_level: 3, stars: 5 },
  ];

  test('lists the themes and opens a theme on its map', async () => {
    mockApi.fetchPuzzleThemes.mockResolvedValue(themes);
    const n = nav();
    const screen = render(<PuzzleThemes navigation={n} />);
    await waitFor(() => expect(screen.getByTestId('puzzle-theme-the-gospels')).toBeTruthy());
    expect(screen.getByText('★ 5')).toBeTruthy();
    fireEvent.press(screen.getByTestId('puzzle-theme-the-gospels'));
    expect(n.navigate).toHaveBeenCalledWith('PuzzleLevels', { slug: 'the-gospels', name: 'The Gospels' });
  });

  test('the Daily Puzzle goes back to the game with its orders', async () => {
    mockApi.fetchPuzzleThemes.mockResolvedValue(themes);
    const n = nav();
    const screen = render(<PuzzleThemes navigation={n} />);
    fireEvent.press(screen.getByTestId('puzzle-daily'));
    expect(n.popTo).toHaveBeenCalledWith('PuzzlePlay', expect.objectContaining({ daily: true }));
  });

  test("today's finished daily board shows its time", async () => {
    writeCache(dailyKey(7, 'en'), board({ is_complete: true, seconds: 134, stars: 3 }));
    mockApi.fetchPuzzleThemes.mockResolvedValue(themes);
    const screen = render(<PuzzleThemes navigation={nav()} />);
    expect(screen.getByText('puzzle.daily.solved:2:14,★★★')).toBeTruthy();
  });
});

describe('the levels map', () => {
  test('every level reached with its stars, the next to play, and a few locked', async () => {
    mockApi.fetchPuzzleLevels.mockResolvedValue({
      theme: { name: 'The Gospels', levels_completed: 2, stars: 5 },
      next_level: 3,
      levels: [
        { level: 1, stars: 3, is_complete: true },
        { level: 2, stars: 2, is_complete: true },
        { level: 3, stars: 0, is_complete: false },
      ],
    });
    const n = nav();
    const screen = render(<PuzzleLevels navigation={n} route={{ params: { slug: 'the-gospels' } }} />);
    await waitFor(() => expect(screen.getByTestId('puzzle-level-3')).toBeTruthy());
    expect(screen.getByText('★★★')).toBeTruthy();
    expect(screen.getByText('★★☆')).toBeTruthy();
    expect(screen.getByLabelText('puzzle.levels.locked:4')).toBeTruthy();
    fireEvent.press(screen.getByTestId('puzzle-level-2'));
    expect(n.popTo).toHaveBeenCalledWith('PuzzlePlay', expect.objectContaining({ theme: 'the-gospels', level: 2 }));
  });
});

describe('the play screen', () => {
  test('plays the Daily Puzzle when asked, and keeps it finished', async () => {
    mockApi.fetchDailyPuzzle.mockResolvedValue(board({ day: '2026-09-29' }));
    const screen = render(<PuzzlePlay navigation={nav()} route={{ params: { daily: true } }} />);
    await waitFor(() => expect(screen.getByText('puzzle.daily.title')).toBeTruthy());
    expect(mockApi.fetchNextPuzzle).not.toHaveBeenCalled();
    mockApi.claimPuzzleWord.mockResolvedValue({ correct: true, is_complete: true, stars: 3, seconds: 95 });
    await waitFor(() => expect(screen.getByTestId('reader-letters')).toBeTruthy());
    'GRACE'.split('').forEach((l) => fireEvent.press(screen.getByLabelText(`puzzle.a11y.letter:${l}`)));
    fireEvent.press(screen.getByTestId('tap-submit'));
    await waitFor(() => expect(mockApi.claimPuzzleWord).toHaveBeenCalled());
    const { peekCache } = require('../../utils/screenCache');
    await waitFor(() => expect(peekCache(dailyKey(7, 'en'))?.is_complete).toBe(true));
  });

  test('a level off the map goes on to that theme\'s next level', async () => {
    mockApi.fetchPuzzleLevel.mockResolvedValue(board({ is_complete: true, found: ['GRACE'], stars: 3 }));
    const screen = render(
      <PuzzlePlay navigation={nav()} route={{ params: { theme: 'the-gospels', level: 4 } }} />,
    );
    await waitFor(() => expect(screen.getByText('puzzle.nextLevel')).toBeTruthy(), { timeout: 8000 });
    expect(mockApi.fetchPuzzleLevel).toHaveBeenLastCalledWith('the-gospels', 4, 'en');
    expect(screen.getByLabelText('puzzle.starsOf:3')).toBeTruthy();
    mockApi.fetchPuzzleLevel.mockResolvedValue(board({ id: 4, level: 5 }));
    fireEvent.press(screen.getByText('puzzle.nextLevel'));
    await waitFor(() => expect(mockApi.fetchPuzzleLevel).toHaveBeenLastCalledWith('the-gospels', 5, 'en'));
    expect(mockApi.fetchNextPuzzle).not.toHaveBeenCalled();
  });

  test('the grid button opens the themes', () => {
    writeCache(userKey(7, 'puzzle:current'), board());
    mockApi.fetchNextPuzzle.mockImplementation(() => new Promise(() => {}));
    const n = nav();
    const screen = render(<PuzzlePlay navigation={n} route={{}} />);
    fireEvent.press(screen.getByTestId('puzzle-themes-open'));
    expect(n.navigate).toHaveBeenCalledWith('PuzzleThemes');
  });

  test('new orders for the open board load the level asked for', async () => {
    writeCache(userKey(7, 'puzzle:current'), board());
    mockApi.fetchNextPuzzle.mockImplementation(() => new Promise(() => {}));
    mockApi.fetchPuzzleLevel.mockResolvedValue(board({ id: 9, level: 2 }));
    const n = nav();
    const screen = render(<PuzzlePlay navigation={n} route={{}} />);
    screen.rerender(<PuzzlePlay navigation={n} route={{ params: { theme: 'the-gospels', level: 2, nonce: 1 } }} />);
    await waitFor(() => expect(mockApi.fetchPuzzleLevel).toHaveBeenCalledWith('the-gospels', 2, 'en'));
  });
});

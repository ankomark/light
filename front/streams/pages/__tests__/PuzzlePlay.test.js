/**
 * The word puzzle opens on the level in hand — kept on the phone — with the
 * purse and streak that came with it, and says plainly when it cannot load.
 */
import React from 'react';
import { ActivityIndicator } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { writeCache, dropCache, userKey } from '../../utils/screenCache';

jest.setTimeout(20000);

const mockApi = {
  fetchNextPuzzle: jest.fn(), fetchPuzzleLevel: jest.fn(), claimPuzzleWord: jest.fn(),
  buyPuzzleHint: jest.fn(), fetchCoinWallet: jest.fn(async () => ({ balance: 1, day_streak: 0 })),
};
jest.mock('../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 7 } }) }));
// One `t` for the life of the test, as the real provider memoises it.
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
jest.mock('../../context/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { quizMusic: false, quizSound: false }, setPreference: jest.fn() }),
}));
jest.mock('../../services/quizSound', () => new Proxy({}, { get: () => () => {} }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});

const PuzzlePlay = require('../PuzzlePlay').default;
const KEY = userKey(7, 'puzzle:current');
const level = (extra) => ({
  id: 3, level: 4, letters: 'GRACE', rows: 1, cols: 5, layout: ['#####'], band: 'simple',
  theme: { name: 'The Gospels', slug: 'the-gospels' },
  slots: [{ length: 5, row: 0, col: 0, dir: 'across', key: 'k' }], revealed: [], found: [], bonus: [],
  bonus_total: 2, bonus_keys: [], hints_used: 0, is_complete: false, verse: null,
  wallet: { balance: 240, day_streak: 3, played_today: true, coins_per_word: 5, coins_per_bonus_word: 2 },
  ...extra,
});

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockClear());
  dropCache(KEY);
});

test('the level in hand shows at once, no spinner', () => {
  writeCache(KEY, level());
  mockApi.fetchNextPuzzle.mockImplementation(() => new Promise(() => {}));
  const screen = render(<PuzzlePlay navigation={{ goBack: jest.fn() }} route={{}} />);
  expect(screen.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
  expect(screen.getByText('The Gospels')).toBeTruthy();
});

test('the purse and streak come with the level — one request, not two', async () => {
  mockApi.fetchNextPuzzle.mockResolvedValue(level());
  const screen = render(<PuzzlePlay navigation={{ goBack: jest.fn() }} route={{}} />);
  await waitFor(() => expect(screen.getByText('240')).toBeTruthy(), { timeout: 8000 });
  expect(screen.getByLabelText('puzzle.dayStreak:3')).toBeTruthy();
  await new Promise((r) => setTimeout(r, 1700));
  expect(mockApi.fetchCoinWallet).not.toHaveBeenCalled();
});

test("a level that won't load says so in the app's words", async () => {
  mockApi.fetchNextPuzzle.mockRejectedValue({ response: { data: { detail: 'Theme "x" has no usable words.' } } });
  const screen = render(<PuzzlePlay navigation={{ goBack: jest.fn() }} route={{}} />);
  await waitFor(() => expect(screen.getByText('puzzle.loadFailed')).toBeTruthy());
  expect(screen.queryByText(/usable/)).toBeNull();
});

/**
 * Word puzzle phase 5: what a found word means, and the puzzle in Swahili.
 */
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { dropCache, userKey } from '../../utils/screenCache';
import { wordKey } from '../../utils/puzzleKeys';

jest.setTimeout(20000);

const mockApi = {
  fetchNextPuzzle: jest.fn(), fetchPuzzleLevel: jest.fn(), fetchDailyPuzzle: jest.fn(),
  fetchPuzzleThemes: jest.fn(async () => []), fetchPuzzleMeaning: jest.fn(),
  claimPuzzleWord: jest.fn(async () => ({})), buyPuzzleHint: jest.fn(), buyPuzzleLetter: jest.fn(),
  fetchCoinWallet: jest.fn(async () => ({ balance: 1, day_streak: 0 })),
};
jest.mock('../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 7, username: 'mark' } }) }));
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
let mockLanguage = 'en';
jest.mock('../../context/I18nContext', () => ({
  useI18n: () => ({ t: mockT, resolvedLanguage: mockLanguage }),
}));
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
const PuzzleThemes = require('../PuzzleThemes').default;
const PuzzleWordsSheet = require('../../components/PuzzleWordsSheet').default;

const board = (extra) => ({
  id: 42, level: 4, letters: 'GRACE', rows: 1, cols: 5, layout: ['#####'], band: 'simple',
  theme: { name: 'The Gospels', slug: 'the-gospels' },
  slots: [{ length: 5, row: 0, col: 0, dir: 'across', key: wordKey(42, 'GRACE') }],
  revealed: [], found: ['SMOTE'], bonus: ['RACE'], shown: [], bonus_total: 2, bonus_keys: [],
  hints_used: 0, letters_used: 0, is_complete: false, verse: null, language: 'en',
  ...extra,
});
const nav = () => ({
  goBack: jest.fn(), push: jest.fn(), navigate: jest.fn(), popTo: jest.fn(), addListener: () => () => {},
});

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockClear());
  mockLanguage = 'en';
  ['en', 'sw'].forEach((l) => ['SMOTE', 'RACE'].forEach((w) => dropCache(`puzzle:meaning:en:${l}:${w}`)));
  dropCache(userKey(7, 'puzzle:current'));
  dropCache(userKey(7, 'puzzle:current:sw'));
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
});

describe('what a word means', () => {
  test('tap a found word: its meaning, with a verse it is in', async () => {
    mockApi.fetchPuzzleMeaning.mockResolvedValue({
      word: 'SMOTE', meaning: 'struck; hit hard', source: 'glossary',
      reference: 'Exodus 2:12', verse: 'he slew the Egyptian',
    });
    const screen = render(<PuzzleWordsSheet visible onClose={jest.fn()} puzzle={board()} />);
    fireEvent.press(screen.getByTestId('found-word-SMOTE'));
    await waitFor(() => expect(screen.getByText('struck; hit hard')).toBeTruthy());
    expect(mockApi.fetchPuzzleMeaning).toHaveBeenCalledWith(42, 'SMOTE', 'en');
    expect(screen.getByText(/Exodus 2:12/)).toBeTruthy();
    // Asked once: the second time it is on the phone.
    fireEvent.press(screen.getByTestId('found-word-SMOTE'));
    fireEvent.press(screen.getByTestId('found-word-SMOTE'));
    expect(mockApi.fetchPuzzleMeaning).toHaveBeenCalledTimes(1);
    expect(screen.getByText('struck; hit hard')).toBeTruthy();
  });

  test('in Swahili, explained in Swahili', async () => {
    mockLanguage = 'sw';
    mockApi.fetchPuzzleMeaning.mockResolvedValue({ word: 'RACE', meaning: 'mbio', source: 'ai' });
    const screen = render(<PuzzleWordsSheet visible onClose={jest.fn()} puzzle={board()} />);
    fireEvent.press(screen.getByTestId('found-word-RACE'));
    await waitFor(() => expect(screen.getByText('mbio')).toBeTruthy());
    expect(mockApi.fetchPuzzleMeaning).toHaveBeenCalledWith(42, 'RACE', 'sw');
  });

  test('when the AI is spent for the day, it says so', async () => {
    mockApi.fetchPuzzleMeaning.mockRejectedValue({ response: { data: { code: 'ai_limit' } } });
    const screen = render(<PuzzleWordsSheet visible onClose={jest.fn()} puzzle={board()} />);
    fireEvent.press(screen.getByTestId('found-word-RACE'));
    await waitFor(() => expect(screen.getByText('puzzle.meaning.limit')).toBeTruthy());
  });
});

describe('the puzzle in Swahili', () => {
  test('a Swahili reader is given the Swahili board, kept apart from the English one', async () => {
    mockLanguage = 'sw';
    mockApi.fetchNextPuzzle.mockResolvedValue(board({ language: 'sw', theme: { name: 'Zaburi 23' } }));
    const screen = render(<PuzzlePlay navigation={nav()} route={{}} />);
    await waitFor(() => expect(screen.getByText('Zaburi 23')).toBeTruthy(), { timeout: 8000 });
    expect(mockApi.fetchNextPuzzle).toHaveBeenCalledWith('sw');
    const { peekCache } = require('../../utils/screenCache');
    expect(peekCache(userKey(7, 'puzzle:current:sw'))?.language).toBe('sw');
    expect(peekCache(userKey(7, 'puzzle:current'))).toBeFalsy();
  });

  test('the themes are asked for in Swahili', async () => {
    mockLanguage = 'sw';
    render(<PuzzleThemes navigation={nav()} />);
    await waitFor(() => expect(mockApi.fetchPuzzleThemes).toHaveBeenCalledWith('sw'));
  });
});

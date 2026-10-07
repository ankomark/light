/**
 * The quiz in the reader's language: the app asks for Swahili when it is in
 * Swahili, keeps the two languages' quizzes apart, and can open a Swahili
 * reference in the Bible reader.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { dropCache } from '../../utils/screenCache';
import { quizKeys, quizLanguage, todayIso } from '../../utils/quizCache';
import { parseReference } from '../../utils/dailyVerseText';

jest.setTimeout(20000);

const mockApi = {
  fetchDailyQuiz: jest.fn(),
  submitDailyQuiz: jest.fn(),
  fetchQuizLeaderboard: jest.fn(async () => ({ results: [], me: null })),
  fetchQuizBests: jest.fn(async () => ({})),
  fetchQuizStats: jest.fn(async () => null),
  startQuizSession: jest.fn(),
};
jest.mock('../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
jest.mock('../../services/bible', () => ({
  fetchBibleBooks: jest.fn(async () => [{ id: 'PSA', name: 'Zaburi' }, { id: 'JHN', name: 'Yohana' }]),
}));
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 7, username: 'mark' } }) }));
let mockLang = 'sw';
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: (k) => k, resolvedLanguage: mockLang }) }));
jest.mock('../../context/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { quizMusic: false, quizSound: false }, setPreference: jest.fn() }),
}));
jest.mock('../../services/quizSound', () => new Proxy({}, { get: () => () => {} }));
jest.mock('../../utils/quizDraft', () => ({
  loadDraft: jest.fn(async () => null), saveDraft: jest.fn(), clearDraft: jest.fn(),
}));
jest.mock('../../utils/adminConfirm', () => ({ confirmAction: jest.fn(async () => true), notify: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), initialWindowMetrics: null };
});
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (fn) => require('react').useEffect(fn, []) }));

const BibleQuiz = require('../BibleQuiz').default;
const QuizHome = require('../QuizHome').default;
const { default: QuizPlay } = require('../QuizPlay');

const swQuiz = (extra) => ({
  id: 2, date: todayIso(), language: 'sw',
  questions: [{ id: 1, order: 0, difficulty: 'simple', prompt: 'Mstari huu unatoka kitabu gani?', passage: 'P', choices: ['Zaburi', 'Mwanzo', 'Yohana', 'Matendo'] }],
  my_attempt: null, ...extra,
});

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockReset());
  mockApi.fetchQuizLeaderboard.mockResolvedValue({ results: [], me: null });
  mockApi.fetchQuizBests.mockResolvedValue({});
  mockApi.fetchQuizStats.mockResolvedValue(null);
  mockLang = 'sw';
  ['en', 'sw'].forEach((l) => dropCache(quizKeys(7, l).daily));
});

test('only Swahili is its own quiz; every other language plays in English', () => {
  expect(quizLanguage('sw')).toBe('sw');
  expect(quizLanguage('en')).toBe('en');
  expect(quizLanguage('luo')).toBe('en');
  expect(quizKeys(7, 'sw').daily).not.toBe(quizKeys(7, 'en').daily);
});

test('in Swahili, the hub and the quiz ask for the Swahili quiz, and submit in it', async () => {
  mockApi.fetchDailyQuiz.mockResolvedValue(swQuiz());
  mockApi.submitDailyQuiz.mockResolvedValue({ attempt: {}, score: 1, total: 1, points: 10, longest_streak: 1, results: [] });
  render(<QuizHome navigation={{ navigate: jest.fn() }} />);
  await waitFor(() => expect(mockApi.fetchDailyQuiz).toHaveBeenCalledWith(undefined, 'sw'));

  const screen = render(<BibleQuiz navigation={{ goBack: jest.fn(), push: jest.fn() }} />);
  await waitFor(() => expect(screen.getByText('Mstari huu unatoka kitabu gani?')).toBeTruthy(), { timeout: 8000 });
  fireEvent.press(screen.getByLabelText('A. Zaburi'));
  fireEvent.press(screen.getByText('quiz.submit'));
  await waitFor(() => expect(mockApi.submitDailyQuiz).toHaveBeenCalled());
  expect(mockApi.submitDailyQuiz.mock.calls[0][2]).toBe('sw');
});

test('a Swahili reference opens in the Bible reader', async () => {
  mockApi.fetchDailyQuiz.mockResolvedValue(swQuiz({
    my_attempt: { score: 1, total: 1, points: 10, longest_streak: 1, results: [
      { question_id: 1, chosen_index: 0, answer_index: 0, correct: true, reference: 'Zaburi 23:1', explanation: 'Bwana ndiye mchungaji wangu — Zaburi 23:1', points_earned: 10 },
    ] },
  }));
  const push = jest.fn();
  const screen = render(<BibleQuiz navigation={{ goBack: jest.fn(), push }} />);
  await waitFor(() => expect(screen.getByLabelText('quiz.readInBible: Zaburi 23:1')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('quiz.readInBible: Zaburi 23:1'));
  expect(push).toHaveBeenCalledWith('bible', { bookId: 'PSA', chapter: 23, verse: 1 });
});

test('practice runs are asked for in the same language', async () => {
  mockApi.startQuizSession.mockResolvedValue({ id: 1, is_finished: true, score: 0, points: 0, longest_streak: 0, total_questions: 10, questions: [], mode_config: { label: 'Speed' } });
  render(<QuizPlay navigation={{ goBack: jest.fn() }} route={{ params: { mode: 'speed' } }} />);
  await waitFor(() => expect(mockApi.startQuizSession).toHaveBeenCalledWith('speed', 'sw', { category: undefined }));
});

test('references in other languages are placed with the names given', () => {
  const names = new Map([['Zaburi', 'PSA']]);
  expect(parseReference('Zaburi 23:1', names)).toEqual({ bookId: 'PSA', chapter: 23, verse: 1 });
  expect(parseReference('Zaburi 23:1')).toBeNull();
  expect(parseReference('Psalms 23:1', names)).toEqual({ bookId: 'PSA', chapter: 23, verse: 1 });
});

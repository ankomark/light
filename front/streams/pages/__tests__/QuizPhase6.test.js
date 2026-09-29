/**
 * Bible quiz phase 6: spaced review and practice by section — reached from
 * the hub and the progress screen, played through QuizPlay.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { dropCache, writeCache, userKey } from '../../utils/screenCache';
import { quizKeys } from '../../utils/quizCache';

jest.setTimeout(20000);

const mockApi = {
  fetchDailyQuiz: jest.fn(async () => null),
  fetchQuizBests: jest.fn(async () => ({})),
  fetchQuizStats: jest.fn(),
  fetchQuizProgress: jest.fn(async () => ({})),
  startQuizSession: jest.fn(),
  answerQuizSession: jest.fn(),
  finishQuizSession: jest.fn(async () => ({})),
  fetchQuizDuel: jest.fn(),
};
jest.mock('../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 7, username: 'mark' } }) }));
const mockT = (k, p) => {
  if (k === 'quiz.progress.weekdays') return 'M,T,W,T,F,S,S';
  return p ? `${k}:${Object.values(p).join(',')}` : k;
};
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT, resolvedLanguage: 'en' }) }));
jest.mock('../../context/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { quizMusic: false, quizSound: false }, setPreference: jest.fn() }),
}));
jest.mock('../../services/quizSound', () => new Proxy({}, { get: () => () => {} }));
jest.mock('../../utils/adminConfirm', () => ({ confirmAction: jest.fn(async () => true), notify: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (fn) => require('react').useEffect(fn, []) }));

const { default: QuizHome, weakestSection, SECTIONS } = require('../QuizHome');
const QuizProgress = require('../QuizProgress').default;
const { default: QuizPlay } = require('../QuizPlay');

const stats = (extra) => ({
  total_coins: 100, level: 1, level_progress: 0.2, coins_to_next: 80, day_streak: 0, played_today: false,
  days_played: 2, best_day: 50, best_run: 3, freeze: { available: false }, review_due: 0, ...extra,
});
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn() });

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockClear());
  dropCache(userKey(7, 'quiz:progress'));
  Object.values(quizKeys(7)).forEach(dropCache);
});

describe('the section to recommend', () => {
  test('the weakest with enough answers to judge', () => {
    expect(weakestSection([
      { category: 'gospels', answered: 20, accuracy: 0.9 },
      { category: 'law', answered: 12, accuracy: 0.5 },
      { category: 'acts', answered: 2, accuracy: 0.0 },              // too few to judge
    ])).toBe('law');
  });

  test('nothing to recommend from a single section, or none', () => {
    expect(weakestSection([{ category: 'law', answered: 30, accuracy: 0.2 }])).toBeNull();
    expect(weakestSection(undefined)).toBeNull();
  });
});

describe('the hub', () => {
  test('review time appears when questions are due, and starts a review', async () => {
    mockApi.fetchQuizStats.mockResolvedValue(stats({ review_due: 6 }));
    const n = nav();
    const screen = render(<QuizHome navigation={n} />);
    await waitFor(() => expect(screen.getByText('quiz.reviewBody:6')).toBeTruthy(), { timeout: 8000 });
    fireEvent.press(screen.getByTestId('review-card'));
    expect(n.navigate).toHaveBeenCalledWith('QuizPlay', { mode: 'review' });
  });

  test('no review card when nothing is due', async () => {
    mockApi.fetchQuizStats.mockResolvedValue(stats({ review_due: 0 }));
    const screen = render(<QuizHome navigation={nav()} />);
    await waitFor(() => expect(screen.getByText('quiz.sections')).toBeTruthy());
    expect(screen.queryByTestId('review-card')).toBeNull();
  });

  test('every section can be practised, and the weakest is recommended', async () => {
    writeCache(userKey(7, 'quiz:progress'), { strengths: [
      { category: 'gospels', answered: 20, accuracy: 0.9 },
      { category: 'minor_prophets', answered: 10, accuracy: 0.3 },
    ] });
    mockApi.fetchQuizStats.mockResolvedValue(stats());
    const n = nav();
    const screen = render(<QuizHome navigation={n} />);
    await waitFor(() => expect(screen.getByText('quiz.sections')).toBeTruthy());
    SECTIONS.forEach((s) => expect(screen.getByText(`quiz.section.${s}`)).toBeTruthy());
    expect(screen.getByLabelText('quiz.section.minor_prophets, quiz.recommended')).toBeTruthy();
    fireEvent.press(screen.getByText('quiz.section.acts'));
    expect(n.navigate).toHaveBeenCalledWith('QuizPlay', { mode: 'section', category: 'acts' });
  });
});

describe('the progress screen', () => {
  test('a section opens its practice, and the weakest has its own button', async () => {
    mockApi.fetchQuizProgress.mockResolvedValue({
      history: [], days: [], badges: [], freeze: {},
      strengths: [
        { category: 'gospels', answered: 20, correct: 18, accuracy: 0.9 },
        { category: 'law', answered: 10, correct: 3, accuracy: 0.3 },
      ],
    });
    const n = nav();
    const screen = render(<QuizProgress navigation={n} />);
    await waitFor(() => expect(screen.getByText('quiz.practiseNow:quiz.section.law')).toBeTruthy());
    fireEvent.press(screen.getByText('quiz.practiseNow:quiz.section.law'));
    expect(n.navigate).toHaveBeenCalledWith('QuizPlay', { mode: 'section', category: 'law' });
    fireEvent.press(screen.getByText('quiz.section.gospels'));
    expect(n.navigate).toHaveBeenCalledWith('QuizPlay', { mode: 'section', category: 'gospels' });
  });
});

describe('playing them', () => {
  const finished = (mode) => ({
    id: 3, mode, is_finished: true, score: 7, points: 40, longest_streak: 3, answered: 10,
    total_questions: 10, questions: [], mode_config: { label: mode },
  });

  test('a section run is asked for by its section, and named for it', async () => {
    mockApi.startQuizSession.mockResolvedValue(finished('section'));
    const screen = render(<QuizPlay navigation={nav()} route={{ params: { mode: 'section', category: 'gospels' } }} />);
    await waitFor(() => expect(screen.getByText('quiz.sectionDone')).toBeTruthy());
    expect(mockApi.startQuizSession).toHaveBeenCalledWith('section', 'en', { category: 'gospels' });
    expect(screen.getByText('quiz.section.gospels')).toBeTruthy();
    expect(screen.queryByText('quiz.challenge.send')).toBeNull();          // nothing to challenge
  });

  test('a finished review says so', async () => {
    mockApi.startQuizSession.mockResolvedValue(finished('review'));
    const screen = render(<QuizPlay navigation={nav()} route={{ params: { mode: 'review' } }} />);
    await waitFor(() => expect(screen.getByText('quiz.reviewDone')).toBeTruthy());
  });

  test('nothing due is explained, not an error', async () => {
    mockApi.startQuizSession.mockRejectedValue({ response: { data: { code: 'nothing_due' } } });
    const screen = render(<QuizPlay navigation={nav()} route={{ params: { mode: 'review' } }} />);
    await waitFor(() => expect(screen.getByText('quiz.reviewNothingDue')).toBeTruthy());
  });
});

describe('duels', () => {
  const over = { id: 8, mode: 'duel', is_finished: true, score: 8, points: 180, longest_streak: 5,
    answered: 10, total_questions: 10, questions: [], mode_config: { label: 'Duel' } };

  test('a duel link plays that run, and ends side by side', async () => {
    mockApi.startQuizSession.mockResolvedValue(over);
    mockApi.fetchQuizDuel.mockResolvedValue({
      verdict: 'won',
      me: { username: 'ivy', score: 8, points: 180, marks: [true, true, false] },
      them: { username: 'mark', score: 6, points: 150, marks: [true, false, false] },
    });
    const screen = render(<QuizPlay navigation={nav()}
      route={{ params: { mode: 'duel', of: '41', from: 'mark', score: '150' } }} />);
    await waitFor(() => expect(screen.getByTestId('duel-card')).toBeTruthy(), { timeout: 8000 });
    expect(mockApi.startQuizSession).toHaveBeenCalledWith('duel', 'en', { category: undefined, of: '41' });
    expect(mockApi.fetchQuizDuel).toHaveBeenCalledWith(8);
    expect(screen.getByText('quiz.duel.won:mark')).toBeTruthy();
    expect(screen.getByText('quiz.duel.you')).toBeTruthy();
    expect(screen.queryByText(/quiz\.challenge\.(won|lost)/)).toBeNull();      // the card says it
  });

  test("a duel that can't be played says why", async () => {
    mockApi.startQuizSession.mockRejectedValue({ response: { data: { code: 'already_played' } } });
    const screen = render(<QuizPlay navigation={nav()} route={{ params: { mode: 'duel', of: '41' } }} />);
    await waitFor(() => expect(screen.getByText('quiz.duel.already_played')).toBeTruthy());
  });
});

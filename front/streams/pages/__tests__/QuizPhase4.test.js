/**
 * Bible quiz phase 4: the progress screen (calendar, scores, badges,
 * strengths) and buying back a broken streak from the hub.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { format, subDays } from 'date-fns';
import { dropCache, userKey } from '../../utils/screenCache';
import { quizKeys } from '../../utils/quizCache';

jest.setTimeout(20000);

const mockApi = {
  fetchQuizProgress: jest.fn(),
  fetchDailyQuiz: jest.fn(async () => null),
  fetchQuizBests: jest.fn(async () => ({})),
  fetchQuizStats: jest.fn(),
  buyStreakFreeze: jest.fn(),
};
jest.mock('../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 7, username: 'mark' } }) }));
const mockT = (k, p) => {
  if (k === 'quiz.progress.weekdays') return 'M,T,W,T,F,S,S';
  return p ? `${k}:${Object.values(p).join(',')}` : k;
};
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
const mockConfirm = jest.fn(async () => true);
const mockNotify = jest.fn();
jest.mock('../../utils/adminConfirm', () => ({
  confirmAction: (...a) => mockConfirm(...a),
  notify: (...a) => mockNotify(...a),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (fn) => require('react').useEffect(fn, []) }));

const { default: QuizProgress, calendarWeeks } = require('../QuizProgress');
const QuizHome = require('../QuizHome').default;

const iso = (d) => format(d, 'yyyy-MM-dd');
const today = new Date();
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn() });

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockClear());
  mockConfirm.mockReset();
  mockConfirm.mockImplementation(async () => true);
  mockNotify.mockClear();
  dropCache(userKey(7, 'quiz:progress'));
  Object.values(quizKeys(7)).forEach(dropCache);
});

describe('the calendar', () => {
  test('twelve weeks, Monday first, ending this week', () => {
    const weeks = calendarWeeks([], today);
    expect(weeks).toHaveLength(12);
    weeks.forEach((w) => expect(w).toHaveLength(7));
    expect(new Date(`${weeks[0][0].date}T12:00:00`).getDay()).toBe(1);   // a Monday
    expect(weeks[11].some((d) => d.today)).toBe(true);
  });

  test('each day says what happened on it', () => {
    const days = [
      { date: iso(subDays(today, 1)), quiz: true, frozen: false },
      { date: iso(subDays(today, 2)), quiz: false, frozen: true },
      { date: iso(subDays(today, 3)), quiz: false, frozen: false },
    ];
    const flat = calendarWeeks(days, today).flat();
    const state = (d) => flat.find((x) => x.date === iso(subDays(today, d))).state;
    expect(state(1)).toBe('quiz');
    expect(state(2)).toBe('frozen');
    expect(state(3)).toBe('played');
    expect(state(4)).toBe('none');
  });
});

describe('the progress screen', () => {
  const progress = {
    history: [
      { date: iso(subDays(today, 1)), score: 16, total: 20, points: 200 },
      { date: iso(today), score: 18, total: 20, points: 240 },
    ],
    days: [],
    badges: [
      { key: 'first_quiz', earned: true, progress: 1, target: 1 },
      { key: 'coins_1000', earned: false, progress: 440, target: 1000 },
    ],
    strengths: [
      { category: 'gospels', answered: 20, correct: 18, accuracy: 0.9 },
      { category: 'minor_prophets', answered: 10, correct: 4, accuracy: 0.4 },
    ],
    freeze: { available: false },
  };

  test('shows scores, badges and where you are strongest', async () => {
    mockApi.fetchQuizProgress.mockResolvedValue(progress);
    const screen = render(<QuizProgress navigation={nav()} />);
    await waitFor(() => expect(screen.getByText('quiz.progress.title')).toBeTruthy(), { timeout: 8000 });
    expect(screen.getByText('quiz.progress.average:17.0,20')).toBeTruthy();
    expect(screen.getByLabelText('quiz.badge.coins_1000. quiz.badge.coins_1000.how. 440 / 1000')).toBeTruthy();
    expect(screen.getByLabelText('quiz.badge.first_quiz. quiz.badge.first_quiz.how. quiz.progress.earned')).toBeTruthy();
    expect(screen.getByText('90%')).toBeTruthy();
    expect(screen.getByText('quiz.progress.bestAndWorst:quiz.section.gospels,quiz.section.minor_prophets')).toBeTruthy();
  });

  test('before any play, it says what will appear', async () => {
    mockApi.fetchQuizProgress.mockResolvedValue({ ...progress, history: [], strengths: [] });
    const screen = render(<QuizProgress navigation={nav()} />);
    await waitFor(() => expect(screen.getByText('quiz.progress.noScores')).toBeTruthy());
    expect(screen.getByText('quiz.progress.noStrengths')).toBeTruthy();
  });

  test('a failed load offers to try again', async () => {
    mockApi.fetchQuizProgress.mockRejectedValueOnce(new Error('offline'));
    const screen = render(<QuizProgress navigation={nav()} />);
    await waitFor(() => expect(screen.getByText('quiz.progress.failed')).toBeTruthy());
    mockApi.fetchQuizProgress.mockResolvedValue(progress);
    fireEvent.press(screen.getByText('common.retry'));
    await waitFor(() => expect(screen.getByText('quiz.progress.title')).toBeTruthy());
  });
});

describe('the hub', () => {
  const stats = (freeze) => ({
    total_coins: 400, level: 2, level_progress: 0.5, coins_to_next: 100, day_streak: 0,
    played_today: false, days_played: 5, best_day: 200, best_run: 6, freeze,
  });

  test('leads to the progress screen', async () => {
    mockApi.fetchQuizStats.mockResolvedValue(stats({ available: false }));
    const n = nav();
    const screen = render(<QuizHome navigation={n} />);
    await waitFor(() => expect(screen.getByText('quiz.progress.title')).toBeTruthy());
    fireEvent.press(screen.getByText('quiz.progress.title'));
    expect(n.navigate).toHaveBeenCalledWith('QuizProgress');
  });

  test('a streak broken yesterday can be restored, after asking', async () => {
    mockApi.fetchQuizStats.mockResolvedValue(stats({ available: true, run: 12, cost: 150, balance: 400, affordable: true }));
    mockApi.buyStreakFreeze.mockResolvedValue({ day_streak: 13 });
    const screen = render(<QuizHome navigation={nav()} />);
    await waitFor(() => expect(screen.getByText('quiz.freeze.title:12')).toBeTruthy());
    fireEvent.press(screen.getByText('quiz.freeze.restoreFor:150'));
    await waitFor(() => expect(mockApi.buyStreakFreeze).toHaveBeenCalled());
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'quiz.freeze.confirmTitle:12' }));
    await waitFor(() => expect(mockNotify).toHaveBeenCalledWith('quiz.freeze.doneTitle', 'quiz.freeze.doneBody:13'));
  });

  test('saying no spends nothing', async () => {
    mockConfirm.mockResolvedValue(false);
    mockApi.fetchQuizStats.mockResolvedValue(stats({ available: true, run: 12, cost: 150, balance: 400, affordable: true }));
    const screen = render(<QuizHome navigation={nav()} />);
    await waitFor(() => expect(screen.getByText('quiz.freeze.restoreFor:150')).toBeTruthy());
    fireEvent.press(screen.getByText('quiz.freeze.restoreFor:150'));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockApi.buyStreakFreeze).not.toHaveBeenCalled();
  });

  test('without the coins, it says how many more', async () => {
    mockApi.fetchQuizStats.mockResolvedValue(stats({ available: true, run: 4, cost: 150, balance: 90, affordable: false }));
    const screen = render(<QuizHome navigation={nav()} />);
    await waitFor(() => expect(screen.getByText('quiz.freeze.short:60')).toBeTruthy());
    fireEvent.press(screen.getByText('quiz.freeze.short:60'));
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  test('no offer, no card', async () => {
    mockApi.fetchQuizStats.mockResolvedValue(stats({ available: false, reason: 'not_needed' }));
    const screen = render(<QuizHome navigation={nav()} />);
    await waitFor(() => expect(screen.getByText('quiz.progress.title')).toBeTruthy());
    expect(screen.queryByTestId('freeze-offer')).toBeNull();
  });
});

/**
 * Speed and Streak answer at once: the verdict is on screen the moment a
 * choice is tapped, with no wait on the server, which records and scores
 * behind the play; the results wait for it.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.setTimeout(20000);

const mockApi = {
  startQuizSession: jest.fn(),
  answerQuizSession: jest.fn(),
  finishQuizSession: jest.fn(async () => ({})),
  askQuizWhy: jest.fn(),
  buyQuizHint: jest.fn(),
};
jest.mock('../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 7, username: 'mark' } }) }));
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT, resolvedLanguage: 'en' }) }));
jest.mock('../../context/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { quizMusic: false, quizSound: false }, setPreference: jest.fn() }),
}));
const mockSound = {};
jest.mock('../../services/quizSound', () => new Proxy({}, {
  get: (_, k) => { mockSound[k] = mockSound[k] || jest.fn(); return mockSound[k]; },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), initialWindowMetrics: null };
});

const { default: QuizPlay } = require('../QuizPlay');

const q = (id, answer, extra) => ({
  id, difficulty: 'simple', prompt: `Prompt ${id}`, passage: '', choices: ['A1', 'B1', 'C1', 'D1'],
  answer_index: answer, reference: `John ${id}:1`, explanation: `Why ${id}`, ...extra,
});
const run = (mode, questions, extra) => ({
  id: 9, mode, score: 0, answered: 0, points: 0, streak: 0, longest_streak: 0, is_finished: false,
  total_questions: questions.length, questions,
  mode_config: { label: mode, time_limit: null, ends_on_wrong: mode === 'streak' }, ...extra,
});
const brief = (points, extra) => ({
  correct: true, timed_out: false, points_earned: 12,
  session: { score: 1, answered: 1, points, streak: 1, longest_streak: 1, is_finished: false, ...extra },
});

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockReset());
  mockApi.finishQuizSession.mockResolvedValue({});
});

test('the verdict shows at once, while the server has not answered yet', async () => {
  mockApi.startQuizSession.mockResolvedValue(run('streak', [q(1, 2), q(2, 0)]));
  mockApi.answerQuizSession.mockImplementation(() => new Promise(() => {}));   // never answers
  const screen = render(<QuizPlay navigation={{ goBack: jest.fn() }} route={{ params: { mode: 'streak' } }} />);
  await waitFor(() => expect(screen.getByText('Prompt 1')).toBeTruthy(), { timeout: 8000 });

  fireEvent.press(screen.getByText('C1'));
  expect(screen.getByText('quiz.correct')).toBeTruthy();              // no waiting
  expect(screen.getByText('Why 1')).toBeTruthy();
  expect(mockSound.correctFeedback).toHaveBeenCalled();
  // Recorded behind the play: queued, so it follows a moment after.
  await waitFor(() => expect(mockApi.answerQuizSession)
    .toHaveBeenCalledWith(9, 1, 2, expect.any(Number), { brief: true }));
});

test('a wrong answer shows the right one at once, and ends a Streak run', async () => {
  mockApi.startQuizSession.mockResolvedValue(run('streak', [q(1, 2), q(2, 0)]));
  mockApi.answerQuizSession.mockResolvedValue(brief(0, { score: 0, is_finished: true }));
  const screen = render(<QuizPlay navigation={{ goBack: jest.fn() }} route={{ params: { mode: 'streak' } }} />);
  await waitFor(() => expect(screen.getByText('Prompt 1')).toBeTruthy());
  fireEvent.press(screen.getByText('A1'));
  expect(screen.getByText('quiz.notQuite')).toBeTruthy();
  expect(screen.getByText('quiz.seeResults')).toBeTruthy();             // no second question
  await act(async () => { fireEvent.press(screen.getByText('quiz.seeResults')); });
  await waitFor(() => expect(screen.getByText('quiz.runEnded')).toBeTruthy());
});

test("the coins arrive when the server confirms them", async () => {
  let resolve;
  mockApi.startQuizSession.mockResolvedValue(run('streak', [q(1, 2), q(2, 0)]));
  mockApi.answerQuizSession.mockImplementation(() => new Promise((r) => { resolve = r; }));
  const screen = render(<QuizPlay navigation={{ goBack: jest.fn() }} route={{ params: { mode: 'streak' } }} />);
  await waitFor(() => expect(screen.getByText('Prompt 1')).toBeTruthy());
  fireEvent.press(screen.getByText('C1'));
  expect(screen.queryByText('+12')).toBeNull();
  await waitFor(() => expect(typeof resolve).toBe('function'));        // the send is under way
  await act(async () => { resolve(brief(12)); });
  await waitFor(() => expect(screen.getByText('+12')).toBeTruthy());
});

test('answers reach the server in the order they were given', async () => {
  const order = [];
  mockApi.startQuizSession.mockResolvedValue(run('speed', [q(1, 0), q(2, 0), q(3, 0)]));
  mockApi.answerQuizSession.mockImplementation(async (id, qid) => { order.push(qid); return brief(10); });
  const screen = render(<QuizPlay navigation={{ goBack: jest.fn() }} route={{ params: { mode: 'speed' } }} />);
  await waitFor(() => expect(screen.getByText('Prompt 1')).toBeTruthy());
  for (const n of [1, 2, 3]) {
    fireEvent.press(screen.getByText('A1'));
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { fireEvent.press(screen.getByText(n < 3 ? 'quiz.next' : 'quiz.seeResults')); });
  }
  await waitFor(() => expect(screen.getByText('quiz.timeUp')).toBeTruthy());
  expect(order).toEqual([1, 2, 3]);
});

test('a server from before instant answers is still waited for', async () => {
  mockApi.startQuizSession.mockResolvedValue(run('speed', [q(1, undefined), q(2, undefined)]));
  mockApi.answerQuizSession.mockResolvedValue({
    correct: false, timed_out: false, answer_index: 3, reference: 'R', explanation: 'E', points_earned: 0,
    session: { score: 0, answered: 1, points: 0, streak: 0, longest_streak: 0, is_finished: false },
  });
  const screen = render(<QuizPlay navigation={{ goBack: jest.fn() }} route={{ params: { mode: 'speed' } }} />);
  await waitFor(() => expect(screen.getByText('Prompt 1')).toBeTruthy());
  fireEvent.press(screen.getByText('A1'));
  await waitFor(() => expect(screen.getByText('quiz.notQuite')).toBeTruthy());
  expect(mockApi.answerQuizSession).toHaveBeenCalledWith(9, 1, 0, expect.any(Number));
});

test('"Why?" after an answer is asked only once the answer is on the server', async () => {
  const order = [];
  let recorded;
  mockApi.startQuizSession.mockResolvedValue(run('speed', [q(1, 0), q(2, 0)], { language: 'en' }));
  mockApi.answerQuizSession.mockImplementation(() => new Promise((r) => {
    recorded = () => { order.push('recorded'); r(brief(10)); };
  }));
  mockApi.askQuizWhy.mockImplementation(async () => { order.push('asked'); return { text: 'Because.' }; });
  const screen = render(<QuizPlay navigation={{ goBack: jest.fn() }} route={{ params: { mode: 'speed' } }} />);
  await waitFor(() => expect(screen.getByText('Prompt 1')).toBeTruthy());
  fireEvent.press(screen.getByText('A1'));
  fireEvent.press(screen.getByText('quiz.why.button'));
  await waitFor(() => expect(typeof recorded).toBe('function'));
  expect(mockApi.askQuizWhy).not.toHaveBeenCalled();
  await act(async () => { recorded(); });
  await waitFor(() => expect(screen.getByText('Because.')).toBeTruthy());
  expect(order).toEqual(['recorded', 'asked']);
  expect(mockApi.askQuizWhy).toHaveBeenCalledWith(1, 'why', 'en');
});

test('three right in a row shows the combo', async () => {
  mockApi.startQuizSession.mockResolvedValue(run('speed', [q(1, 0), q(2, 0), q(3, 0), q(4, 0)]));
  mockApi.answerQuizSession.mockResolvedValue(brief(10));
  const screen = render(<QuizPlay navigation={{ goBack: jest.fn() }} route={{ params: { mode: 'speed' } }} />);
  await waitFor(() => expect(screen.getByText('Prompt 1')).toBeTruthy());
  for (const n of [1, 2, 3]) {
    fireEvent.press(screen.getByText('A1'));
    if (n < 3) {
      expect(screen.queryByText(/quiz\.combo/)).toBeNull();
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { fireEvent.press(screen.getByText('quiz.next')); });
    }
  }
  expect(screen.getByText('quiz.combo:3')).toBeTruthy();
});

test('50/50 takes two wrong answers away, bought from the server', async () => {
  mockApi.startQuizSession.mockResolvedValue(run('speed', [q(1, 2), q(2, 0)]));
  mockApi.buyQuizHint.mockResolvedValue({ removed: [0, 3], cost: 15, balance: 85 });
  const screen = render(<QuizPlay navigation={{ goBack: jest.fn() }} route={{ params: { mode: 'speed' } }} />);
  await waitFor(() => expect(screen.getByText('Prompt 1')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByLabelText('quiz.hint.label:15')); });
  expect(mockApi.buyQuizHint).toHaveBeenCalledWith(9, 1);
  await waitFor(() => expect(screen.getByText('A1')).toBeTruthy());
  const disabled = (label) => {
    let node = screen.getByText(label);
    while (node && node.props.accessibilityState === undefined) node = node.parent;
    return node?.props.accessibilityState?.disabled;
  };
  expect(disabled('A1')).toBe(true);
  expect(disabled('D1')).toBe(true);
  expect(disabled('C1')).toBe(false);
});

test('without the coins, 50/50 says so', async () => {
  mockApi.startQuizSession.mockResolvedValue(run('speed', [q(1, 2)]));
  mockApi.buyQuizHint.mockRejectedValue({ response: { data: { code: 'not_enough_coins' } } });
  const screen = render(<QuizPlay navigation={{ goBack: jest.fn() }} route={{ params: { mode: 'speed' } }} />);
  await waitFor(() => expect(screen.getByText('Prompt 1')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByLabelText('quiz.hint.label:15')); });
  await waitFor(() => expect(screen.getByText('quiz.hint.noCoins')).toBeTruthy());
});

test('no 50/50 on a true-or-false question', async () => {
  mockApi.startQuizSession.mockResolvedValue(run('speed', [q(1, 0, { choices: ['True', 'False'] })]));
  const screen = render(<QuizPlay navigation={{ goBack: jest.fn() }} route={{ params: { mode: 'speed' } }} />);
  await waitFor(() => expect(screen.getByText('Prompt 1')).toBeTruthy());
  expect(screen.queryByLabelText('quiz.hint.label:15')).toBeNull();
});

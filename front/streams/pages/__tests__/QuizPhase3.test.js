/**
 * Bible quiz phase 3: sharing a result as a picture (no answers in it), the
 * leaderboard's periods and "people I follow", and challenging a friend.
 */
import React from 'react';
import { Share } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { dropCache } from '../../utils/screenCache';
import { quizKeys, todayIso } from '../../utils/quizCache';

jest.setTimeout(20000);

const mockApi = {
  fetchDailyQuiz: jest.fn(),
  submitDailyQuiz: jest.fn(),
  fetchQuizLeaderboard: jest.fn(),
  startQuizSession: jest.fn(),
  answerQuizSession: jest.fn(),
  finishQuizSession: jest.fn(async () => ({})),
};
jest.mock('../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 7, username: 'mark' } }) }));
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
jest.mock('../../context/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { quizMusic: false, quizSound: false }, setPreference: jest.fn() }),
}));
jest.mock('../../services/quizSound', () => new Proxy({}, { get: () => () => {} }));
jest.mock('../../utils/quizDraft', () => ({
  loadDraft: jest.fn(async () => null), saveDraft: jest.fn(), clearDraft: jest.fn(),
}));
jest.mock('../../utils/adminConfirm', () => ({ confirmAction: jest.fn(async () => true) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn(async () => 'file:///tmp/result.png') }));
const mockSharing = { isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) };
jest.mock('expo-sharing', () => ({
  isAvailableAsync: (...a) => mockSharing.isAvailableAsync(...a),
  shareAsync: (...a) => mockSharing.shareAsync(...a),
}));
jest.mock('expo-media-library', () => ({}));
const mockClipboard = { setStringAsync: jest.fn(async () => true) };
jest.mock('expo-clipboard', () => ({ setStringAsync: (...a) => mockClipboard.setStringAsync(...a) }));

const BibleQuiz = require('../BibleQuiz').default;
const { default: QuizPlay, challengeFrom, challengeLink } = require('../QuizPlay');
const { resultMessage } = require('../../components/QuizResultCard');

const question = (id) => ({ id, order: id, difficulty: 'simple', prompt: `Prompt ${id}`, passage: 'P', choices: ['A', 'B', 'C', 'D'] });
const results = [
  { question_id: 1, chosen_index: 0, answer_index: 0, correct: true, reference: 'John 3:16', explanation: 'x — John 3:16', points_earned: 12 },
  { question_id: 2, chosen_index: 1, answer_index: 2, correct: false, reference: 'Psalms 23:1', explanation: 'y — Psalms 23:1', points_earned: 0 },
];
const played = {
  id: 1, date: todayIso(), questions: [question(1), question(2)],
  my_attempt: { score: 1, total: 2, points: 12, longest_streak: 1, duration_seconds: 30, results },
};
const row = (id, username, extra) => ({ id, user: { id, username }, points: 100, score: 10, total: 20, ...extra });
const nav = () => ({ goBack: jest.fn(), navigate: jest.fn(), push: jest.fn() });

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockReset());
  mockApi.finishQuizSession.mockResolvedValue({});
  mockSharing.shareAsync.mockClear();
  mockClipboard.setStringAsync.mockClear();
  dropCache(quizKeys(7).daily);
});

describe('sharing a result', () => {
  test('the message has the score and one mark a question — and no answers', () => {
    const msg = resultMessage({
      title: 'Daily Bible Quiz', day: 'Tuesday 29 September', score: 1, total: 2,
      coinsLabel: '12 coins', marks: [true, false], beatMe: 'Can you beat me?',
    });
    expect(msg).toBe('Daily Bible Quiz — Tuesday 29 September\n1/2 · 12 coins\n🟨⬛\nCan you beat me?');
    expect(msg).not.toMatch(/John|Psalms/);
  });

  test('ten marks to a row', () => {
    const msg = resultMessage({ title: 'T', day: 'D', score: 12, total: 12, coinsLabel: 'c', marks: Array(12).fill(true) });
    expect(msg.split('\n').slice(2)).toEqual(['🟨'.repeat(10), '🟨🟨']);
  });

  test('Share result opens the picture, and shares the image', async () => {
    mockApi.fetchDailyQuiz.mockResolvedValue(played);
    mockApi.fetchQuizLeaderboard.mockResolvedValue({ results: [], me: null });
    const screen = render(<BibleQuiz navigation={nav()} />);
    await waitFor(() => expect(screen.getByText('quiz.share.button')).toBeTruthy(), { timeout: 8000 });
    fireEvent.press(screen.getByText('quiz.share.button'));
    await waitFor(() => expect(screen.getByTestId('share-sheet')).toBeTruthy());
    expect(screen.getByTestId('quiz-card-marks').children).toHaveLength(2);
    fireEvent.press(screen.getByTestId('share-image'));
    await waitFor(() => expect(mockSharing.shareAsync).toHaveBeenCalledWith(
      'file:///tmp/result.png', expect.objectContaining({ mimeType: 'image/png' }),
    ));
  });
});

describe('the leaderboard', () => {
  test('tabs ask for the week and all time; the following switch narrows it', async () => {
    mockApi.fetchDailyQuiz.mockResolvedValue(played);
    mockApi.fetchQuizLeaderboard.mockResolvedValue({ results: [row(1, 'ivy')], me: null });
    const screen = render(<BibleQuiz navigation={nav()} />);
    await waitFor(() => expect(screen.getByText('ivy')).toBeTruthy());
    expect(mockApi.fetchQuizLeaderboard).toHaveBeenLastCalledWith(undefined, { period: 'today', scope: 'everyone' });

    mockApi.fetchQuizLeaderboard.mockResolvedValue({ results: [row(1, 'ivy', { days: 5, total: undefined })], me: null });
    fireEvent.press(screen.getByText('quiz.board.week'));
    await waitFor(() => expect(screen.getByText('quiz.board.days:5')).toBeTruthy());
    expect(mockApi.fetchQuizLeaderboard).toHaveBeenLastCalledWith(undefined, { period: 'week', scope: 'everyone' });

    mockApi.fetchQuizLeaderboard.mockResolvedValue({ results: [], me: null });
    fireEvent.press(screen.getByText('quiz.board.following'));
    await waitFor(() => expect(screen.getByText('quiz.board.emptyFollowing')).toBeTruthy());
    expect(mockApi.fetchQuizLeaderboard).toHaveBeenLastCalledWith(undefined, { period: 'week', scope: 'following' });
  });

  test('below the rows shown, my own place is pinned', async () => {
    mockApi.fetchDailyQuiz.mockResolvedValue(played);
    mockApi.fetchQuizLeaderboard.mockResolvedValue({ results: [row(1, 'ivy'), row(2, 'zed')], me: { rank: 40, of: 90 } });
    const screen = render(<BibleQuiz navigation={nav()} />);
    // Twice: the rank in the stats above, and the pinned row on the board.
    await waitFor(() => expect(screen.getAllByText('40')).toHaveLength(2));
    expect(screen.getAllByText('quiz.rankOf:90').length).toBeGreaterThan(0);
    expect(screen.getByText('mark')).toBeTruthy();
  });
});

describe('challenging a friend', () => {
  test('a link carries a short name and a whole number, or nothing', () => {
    expect(challengeFrom({ from: 'mark', score: '180' })).toEqual({ from: 'mark', score: 180 });
    expect(challengeFrom({ from: 'x'.repeat(60), score: '3' }).from).toHaveLength(30);
    expect(challengeFrom({ from: 'mark', score: 'lots' })).toBeNull();
    expect(challengeFrom({ from: '', score: '5' })).toBeNull();
    expect(challengeFrom({ from: 'mark', score: '-1' })).toBeNull();
    expect(challengeLink('speed', 'ann marie', 90)).toBe('streams://quiz/speed?from=ann%20marie&score=90');
  });

  const finished = (extra) => ({
    id: 3, mode: 'speed', is_finished: true, score: 7, points: 150, longest_streak: 4,
    total_questions: 10, questions: [], mode_config: { label: 'Speed Quiz' }, ...extra,
  });

  test('beating the challenge says so', async () => {
    mockApi.startQuizSession.mockResolvedValue(finished({ points: 200 }));
    const screen = render(<QuizPlay navigation={nav()} route={{ params: { mode: 'speed', from: 'ivy', score: '180' } }} />);
    await waitFor(() => expect(screen.getByText('quiz.challenge.won:ivy')).toBeTruthy(), { timeout: 8000 });
  });

  test('falling short says by how much', async () => {
    mockApi.startQuizSession.mockResolvedValue(finished({ points: 150 }));
    const screen = render(<QuizPlay navigation={nav()} route={{ params: { mode: 'speed', from: 'ivy', score: '180' } }} />);
    await waitFor(() => expect(screen.getByText('quiz.challenge.lost:ivy,31')).toBeTruthy());
  });

  test('a finished run can challenge someone else, with a link back to it', async () => {
    const spy = jest.spyOn(Share, 'share').mockResolvedValue({});
    mockApi.startQuizSession.mockResolvedValue(finished({ mode: 'streak', longest_streak: 12 }));
    const screen = render(<QuizPlay navigation={nav()} route={{ params: { mode: 'streak' } }} />);
    await waitFor(() => expect(screen.getByText('quiz.challenge.send')).toBeTruthy());
    fireEvent.press(screen.getByText('quiz.challenge.send'));
    expect(spy).toHaveBeenCalledWith({
      message: 'quiz.challenge.message:12,quiz.challenge.inARow,Speed Quiz\nstreams://quiz/streak?from=mark&score=12',
    });
    spy.mockRestore();
  });
});

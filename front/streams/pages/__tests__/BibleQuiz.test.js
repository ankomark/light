/**
 * The quiz hub and the daily quiz, Phase 1: both open on the kept copy, the
 * review stays after the day's attempt, your rank is always shown, a gap in
 * your answers is a choice, and the hub leads to the word puzzle.
 */
import React from 'react';
import { ActivityIndicator } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { writeCache, peekCache, dropCache } from '../../utils/screenCache';
import { quizKeys, todayIso } from '../../utils/quizCache';

jest.setTimeout(20000);

const mockApi = {
  fetchDailyQuiz: jest.fn(),
  submitDailyQuiz: jest.fn(),
  fetchQuizLeaderboard: jest.fn(async () => ({ results: [], me: null })),
  fetchQuizBests: jest.fn(async () => ({})),
  fetchQuizStats: jest.fn(async () => null),
};
jest.mock('../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 7, username: 'mark' } }) }));
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
jest.mock('../../context/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { quizMusic: false, quizSound: false }, setPreference: jest.fn() }),
}));
jest.mock('../../services/quizSound', () => ({
  setSoundEnabled: jest.fn(), setMusicEnabled: jest.fn(), tapFeedback: jest.fn(), finishFeedback: jest.fn(),
  playLoop: jest.fn(), stopLoop: jest.fn(), unload: jest.fn(),
}));
jest.mock('../../utils/quizDraft', () => ({
  loadDraft: jest.fn(async () => null), saveDraft: jest.fn(), clearDraft: jest.fn(),
}));
const mockConfirm = jest.fn(async () => true);
jest.mock('../../utils/adminConfirm', () => ({ confirmAction: (...a) => mockConfirm(...a) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (fn) => require('react').useEffect(fn, []) }));

const BibleQuiz = require('../BibleQuiz').default;
const QuizHome = require('../QuizHome').default;

const KEY = quizKeys(7).daily;
const question = (id, extra = {}) => ({
  id, order: id, difficulty: 'simple', prompt: `Prompt ${id}`, passage: `Passage ${id} ____`,
  choices: ['Alpha', 'Beta', 'Gamma', 'Delta'], ...extra,
});
const quiz = (extra = {}) => ({
  id: 1, date: todayIso(), questions: [question(1), question(2)], my_attempt: null, ...extra,
});
const results = [
  { question_id: 1, chosen_index: 0, answer_index: 0, correct: true, reference: 'John 3:16',
    explanation: 'For God so loved the world — John 3:16', points_earned: 12 },
  { question_id: 2, chosen_index: 1, answer_index: 2, correct: false, reference: 'Psalms 23:1',
    explanation: 'The LORD is my shepherd — Psalms 23:1', points_earned: 0 },
];
const played = () => quiz({ my_attempt: { score: 1, total: 2, points: 12, longest_streak: 1, duration_seconds: 40, results } });
const nav = () => ({ goBack: jest.fn(), navigate: jest.fn() });

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockClear());
  mockApi.fetchQuizLeaderboard.mockImplementation(async () => ({ results: [], me: null }));
  mockConfirm.mockReset();
  mockConfirm.mockImplementation(async () => true);
  dropCache(KEY);
});

describe('the daily quiz', () => {
  test('opens on the copy the hub kept, without a spinner', async () => {
    writeCache(KEY, quiz());
    mockApi.fetchDailyQuiz.mockImplementation(() => new Promise(() => {}));   // never answers
    const screen = render(<BibleQuiz navigation={nav()} />);
    // The first test in the file also pays for loading every module: give it room.
    await waitFor(() => expect(screen.getByText('Prompt 1')).toBeTruthy(), { timeout: 8000 });
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
  });

  test("yesterday's kept quiz is not opened as today's", async () => {
    writeCache(KEY, quiz({ date: '2020-01-01', questions: [question(9)] }));
    mockApi.fetchDailyQuiz.mockResolvedValue(quiz());
    const screen = render(<BibleQuiz navigation={nav()} />);
    await waitFor(() => expect(screen.getByText('Prompt 1')).toBeTruthy());
    expect(screen.queryByText('Prompt 9')).toBeNull();
  });

  test('coming back later shows the review, with the whole verse restored', async () => {
    mockApi.fetchDailyQuiz.mockResolvedValue(played());
    mockApi.fetchQuizLeaderboard.mockResolvedValue({ results: [], me: { rank: 63, of: 120 } });
    const screen = render(<BibleQuiz navigation={nav()} />);
    await waitFor(() => expect(screen.getByText('quiz.review')).toBeTruthy());
    expect(screen.getByText('For God so loved the world')).toBeTruthy();       // not "Passage 1 ____"
    expect(screen.queryByText('Passage 1 ____')).toBeNull();
    await waitFor(() => expect(screen.getByText('63')).toBeTruthy());          // below the top fifty
    expect(screen.getByText('quiz.rankOf:120')).toBeTruthy();
  });

  test('submitting with gaps asks first; "keep answering" goes to the first gap', async () => {
    mockApi.fetchDailyQuiz.mockResolvedValue(quiz());
    mockConfirm.mockResolvedValue(false);
    const screen = render(<BibleQuiz navigation={nav()} />);
    await waitFor(() => expect(screen.getByText('Prompt 1')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('B. Beta'));
    fireEvent.press(screen.getByText('quiz.next'));
    await waitFor(() => expect(screen.getByText('Prompt 2')).toBeTruthy());
    fireEvent.press(screen.getByText('quiz.submit:1,2'));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'quiz.unansweredTitle', message: 'quiz.unansweredBody:1',
    })));
    expect(mockApi.submitDailyQuiz).not.toHaveBeenCalled();
    expect(screen.getByText('Prompt 2')).toBeTruthy();                          // the unanswered one
  });

  test('a finished attempt is kept, so reopening shows the result', async () => {
    mockApi.fetchDailyQuiz.mockResolvedValue(quiz({ questions: [question(1)] }));
    mockApi.submitDailyQuiz.mockResolvedValue({ attempt: { id: 5 }, score: 1, total: 1, points: 12, longest_streak: 1, results: [results[0]] });
    const screen = render(<BibleQuiz navigation={nav()} />);
    await waitFor(() => expect(screen.getByText('Prompt 1')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('A. Alpha'));
    fireEvent.press(screen.getByText('quiz.submit:1,1'));
    await waitFor(() => expect(screen.getByText('quiz.review')).toBeTruthy());
    expect(mockConfirm).not.toHaveBeenCalled();                                 // nothing left unanswered
    expect(peekCache(KEY).my_attempt).toEqual(expect.objectContaining({ score: 1, results: [results[0]] }));
  });

  test('already played on another phone: the result, not an error', async () => {
    mockApi.fetchDailyQuiz.mockResolvedValueOnce(quiz({ questions: [question(1)] }));
    mockApi.submitDailyQuiz.mockRejectedValue({ response: { data: { code: 'already_played', error: 'raw English' } } });
    const screen = render(<BibleQuiz navigation={nav()} />);
    await waitFor(() => expect(screen.getByText('Prompt 1')).toBeTruthy());
    mockApi.fetchDailyQuiz.mockResolvedValue(played());
    fireEvent.press(screen.getByLabelText('A. Alpha'));
    fireEvent.press(screen.getByText('quiz.submit:1,1'));
    await waitFor(() => expect(screen.getByText('quiz.review')).toBeTruthy());
    expect(screen.queryByText('raw English')).toBeNull();
  });

  test('a failed load says so in the reader’s language, not the server’s', async () => {
    mockApi.fetchDailyQuiz.mockRejectedValue({ response: { data: { detail: 'The Bible text has not been imported yet.' } } });
    const screen = render(<BibleQuiz navigation={nav()} />);
    await waitFor(() => expect(screen.getByText('quiz.loadFailed')).toBeTruthy());
    expect(screen.queryByText(/imported/)).toBeNull();
  });
});

describe('the quiz hub', () => {
  test('paints the kept copy at once, with a friendly date', async () => {
    writeCache(KEY, quiz({ date: todayIso() }));
    mockApi.fetchDailyQuiz.mockImplementation(() => new Promise(() => {}));
    mockApi.fetchQuizBests.mockImplementation(() => new Promise(() => {}));
    mockApi.fetchQuizStats.mockImplementation(() => new Promise(() => {}));
    const screen = render(<QuizHome navigation={nav()} />);
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
    expect(screen.queryByText(todayIso())).toBeNull();
    expect(screen.getByText(require('date-fns').format(new Date(), 'EEEE d MMMM'))).toBeTruthy();
  });

  test('leads to the word puzzle', async () => {
    mockApi.fetchDailyQuiz.mockResolvedValue(quiz());
    const n = nav();
    const screen = render(<QuizHome navigation={n} />);
    await waitFor(() => expect(screen.getByText('quiz.home.puzzleTitle')).toBeTruthy());
    fireEvent.press(screen.getByText('quiz.home.puzzleTitle'));
    expect(n.navigate).toHaveBeenCalledWith('PuzzlePlay');
  });
});

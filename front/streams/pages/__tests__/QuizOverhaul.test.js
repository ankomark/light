/**
 * The quiz overhaul on the phone: the players' day, held-back answers, the
 * offline pack, the story journey, reporting a question, and a resumed duel
 * ending where its questions do.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { dropCache, userKey } from '../../utils/screenCache';

jest.setTimeout(20000);

const mockStore = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k) => (k in mockStore ? mockStore[k] : null)),
  setItem: jest.fn(async (k, v) => { mockStore[k] = v; }),
  removeItem: jest.fn(async (k) => { delete mockStore[k]; }),
}));

const mockApi = {
  fetchQuizStories: jest.fn(),
  startQuizSession: jest.fn(),
  answerQuizSession: jest.fn(),
  finishQuizSession: jest.fn(async () => ({})),
  reportQuizQuestion: jest.fn(async () => ({ status: 'reported' })),
  fetchQuizDuel: jest.fn(async () => null),
  buyQuizHint: jest.fn(),
};
jest.mock('../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 7, username: 'mark' } }) }));
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT, resolvedLanguage: 'en' }) }));
jest.mock('../../context/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { quizMusic: false, quizSound: false }, setPreference: jest.fn() }),
}));
jest.mock('../../services/quizSound', () => new Proxy({}, { get: () => () => {} }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), initialWindowMetrics: null };
});
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (fn) => require('react').useEffect(fn, []) }));
jest.mock('../../hooks/useKeyboardHeight', () => () => 0);

const { gameNow, todayIso } = require('../../utils/quizCache');
const { enqueueAnswer, flushAnswers, pendingAnswers } = require('../../utils/answerQueue');
const { offlineRun, refreshOfflinePack, loadOfflinePack } = require('../../utils/offlinePack');
const { default: QuizStories } = require('../QuizStories');
const { default: QuizPlay, storyStars } = require('../QuizPlay');
const ReportQuestionSheet = require('../../components/ReportQuestionSheet').default;

const nav = () => ({ navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn(), addListener: jest.fn(() => () => {}) });
beforeEach(() => {
  Object.keys(mockStore).forEach((k) => delete mockStore[k]);
  Object.values(mockApi).forEach((f) => f.mockReset?.());
  mockApi.finishQuizSession.mockResolvedValue({});
  mockApi.reportQuizQuestion.mockResolvedValue({ status: 'reported' });
  mockApi.fetchQuizDuel.mockResolvedValue(null);
});

describe('the players’ day', () => {
  test('is East Africa’s, whatever zone the phone is in', () => {
    const lateUtc = Date.UTC(2026, 9, 7, 22, 30);          // 22:30 UTC = 01:30 in Nairobi
    const there = gameNow(lateUtc);
    expect(there.getDate()).toBe(8);
    expect(there.getHours()).toBe(1);
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('answers held back by a weak connection', () => {
  test('wait on the phone and go when the line is back; a refusal settles them', async () => {
    await enqueueAnswer(7, { runId: 1, questionId: 10, choice: 2, seconds: 3 });
    await enqueueAnswer(7, { runId: 1, questionId: 10, choice: 2, seconds: 3 });      // the same one twice
    await enqueueAnswer(7, { runId: 1, questionId: 11, choice: 0, seconds: 4 });
    expect(await pendingAnswers(7)).toBe(2);
    expect(await pendingAnswers(8)).toBe(0);                                          // another account's are its own

    const offline = jest.fn(async () => { throw new Error('Network Error'); });
    expect(await flushAnswers(7, offline)).toBe(2);

    const send = jest.fn()
      .mockResolvedValueOnce({ correct: true })
      .mockRejectedValueOnce({ response: { status: 400 } });                          // already there
    expect(await flushAnswers(7, send)).toBe(0);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('the offline pack', () => {
  const pack = {
    date: todayIso(), language: 'en',
    questions: Array.from({ length: 40 }, (_, i) => ({
      id: `off-${i}`, kind: 'book', difficulty: ['hard', 'simple', 'moderate'][i % 3], prompt: `Q${i}`,
      passage: '', choices: ['a', 'b', 'c', 'd'], answer_index: 1, reference: 'John 1:1', explanation: 'x',
    })),
  };

  test('is fetched once a day and kept', async () => {
    const fetchPack = jest.fn(async () => pack);
    await refreshOfflinePack('en', fetchPack);
    await refreshOfflinePack('en', fetchPack);
    expect(fetchPack).toHaveBeenCalledTimes(1);
    expect((await loadOfflinePack('en')).questions).toHaveLength(40);
  });

  test('a failed fetch keeps the pack there was', async () => {
    mockStore['quiz:offlinePack:en'] = JSON.stringify({ ...pack, date: '2020-01-01' });
    const kept = await refreshOfflinePack('en', async () => { throw new Error('offline'); });
    expect(kept.date).toBe('2020-01-01');
  });

  test('a run is ten questions, the easy ones first, with no server behind it', () => {
    const run = offlineRun(pack, 'Offline', 10, () => 0.5);
    expect(run.questions).toHaveLength(10);
    expect(run.total_questions).toBe(10);
    const order = run.questions.map((q) => q.difficulty);
    expect(order).toEqual([...order].sort((a, b) => ['simple', 'moderate', 'hard'].indexOf(a)
      - ['simple', 'moderate', 'hard'].indexOf(b)));
  });

  test('plays to the end on the phone, sending nothing', async () => {
    mockStore['quiz:offlinePack:en'] = JSON.stringify(pack);
    const screen = render(<QuizPlay navigation={nav()} route={{ params: { mode: 'offline' } }} />);
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(screen.getAllByText('b').length).toBeGreaterThan(0));
      fireEvent.press(screen.getAllByText('b')[0]);
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(screen.getByText(i === 9 ? 'quiz.seeResults' : 'quiz.next')).toBeTruthy());
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { fireEvent.press(screen.getByText(i === 9 ? 'quiz.seeResults' : 'quiz.next')); });
    }
    await waitFor(() => expect(screen.getByTestId('coins-note')).toBeTruthy());
    expect(mockApi.answerQuizSession).not.toHaveBeenCalled();
    expect(mockApi.startQuizSession).not.toHaveBeenCalled();
  });
});

describe('the story journey', () => {
  test('stars from a run of ten', () => {
    expect([10, 9, 8, 7, 6, 5].map(storyStars)).toEqual([3, 2, 2, 1, 1, 0]);
  });

  test('open stories play; locked ones wait', async () => {
    dropCache(userKey(7, 'quiz:stories:en'));
    mockApi.fetchQuizStories.mockResolvedValue({
      featured: [{ slug: 'week', title: 'Ruth', passage: 'Ruth 1–4', stars: 0, unlocked: true }],
      journey: [
        { slug: 'creation', title: 'Creation', passage: 'Genesis 1–3', stars: 2, unlocked: true },
        { slug: 'noah', title: 'Noah', passage: 'Genesis 6–9', stars: 0, unlocked: false },
      ],
    });
    const n = nav();
    const screen = render(<QuizStories navigation={n} />);
    await waitFor(() => expect(screen.getByTestId('story-creation')).toBeTruthy());
    fireEvent.press(screen.getByTestId('story-noah'));
    expect(n.navigate).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('story-creation'));
    expect(n.navigate).toHaveBeenCalledWith('QuizPlay', { mode: 'story', story: 'creation', title: 'Creation' });
    fireEvent.press(screen.getByTestId('story-week'));
    expect(n.navigate).toHaveBeenLastCalledWith('QuizPlay', { mode: 'story', story: 'week', title: 'Ruth' });
  });
});

describe('a resumed duel', () => {
  test('ends at its own last question, not after the ones left', async () => {
    const q = (id) => ({ id, kind: 'book', difficulty: 'simple', prompt: `Q${id}`, passage: '',
      choices: ['a', 'b', 'c', 'd'], answer_index: 0, reference: 'John 1:1', explanation: 'x' });
    // Four of ten answered before; six left.
    mockApi.startQuizSession.mockResolvedValue({
      id: 9, mode: 'duel', language: 'en', score: 4, answered: 4, points: 40, streak: 0, longest_streak: 4,
      is_finished: false, total_questions: 10,
      mode_config: { label: 'Duel', time_limit: null, ends_on_wrong: false, questions: 10 },
      questions: [5, 6, 7, 8, 9, 10].map(q),
    });
    mockApi.answerQuizSession.mockResolvedValue({ correct: true, points_earned: 10, session: { points: 50, score: 5 } });
    const screen = render(<QuizPlay navigation={nav()} route={{ params: { mode: 'duel', of: 3 } }} />);
    for (let i = 0; i < 2; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(screen.getAllByText('a').length).toBeGreaterThan(0));
      fireEvent.press(screen.getAllByText('a')[0]);
      // Before the fix, two answers here (4 + 2 = 6 of the 6 left) ended the run.
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(screen.getByText('quiz.next')).toBeTruthy());
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { fireEvent.press(screen.getByText('quiz.next')); });
    }
    expect(screen.queryByText('quiz.seeResults')).toBeNull();
  });
});

describe('reporting a question', () => {
  test('a reason is chosen, then it goes with the note', async () => {
    const onDone = jest.fn();
    const screen = render(<ReportQuestionSheet visible questionId={42} onClose={() => {}} onDone={onDone} />);
    await waitFor(() => expect(screen.getByTestId('report-send')).toBeTruthy());
    fireEvent.press(screen.getByTestId('report-send'));
    expect(mockApi.reportQuizQuestion).not.toHaveBeenCalled();             // no reason yet
    fireEvent.press(screen.getByTestId('report-wrong_answer'));
    fireEvent.changeText(screen.getByTestId('report-note'), '  It was Aaron  ');
    await act(async () => { fireEvent.press(screen.getByTestId('report-send')); });
    expect(mockApi.reportQuizQuestion).toHaveBeenCalledWith(42, 'wrong_answer', 'It was Aaron');
    await waitFor(() => expect(screen.getByTestId('report-done')).toBeTruthy());
    expect(onDone).toHaveBeenCalled();
  });
});

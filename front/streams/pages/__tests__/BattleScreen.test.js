/**
 * Live Bible Battle, on the phone: join by code or host a room, answer when
 * the question opens, see the answer and the ranking, finish on the podium.
 * The socket is a stand-in the test speaks through.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.setTimeout(20000);

const mockApi = {
  createBattle: jest.fn(), joinBattle: jest.fn(), fetchBattle: jest.fn(), startBattle: jest.fn(),
  answerBattle: jest.fn(), revealBattle: jest.fn(), nextBattle: jest.fn(),
};
jest.mock('../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
let mockRoom = null;
jest.mock('../../services/battleSocket', () => ({
  subscribeBattle: (code, fn) => { mockRoom = fn; return () => { mockRoom = null; }; },
}));
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT, resolvedLanguage: 'en' }) }));
jest.mock('../../services/quizSound', () => new Proxy({}, { get: () => () => {} }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});

const { default: BattleScreen, battleLink } = require('../BattleScreen');

const lobby = (extra) => ({
  code: 'ABC234', title: 'Youth night', status: 'lobby', host: 'pastor', is_host: false,
  players: 2, total: 10, current: -1, lobby: ['ann', 'ben'], me: { points: 0, correct: 0, place: 1, answered: false, last: null },
  ...extra,
});
const question = { index: 0, total: 10, prompt: 'Who built the ark?', passage: '', choices: ['Noah', 'Moses', 'Abram', 'Lot'],
  kind: 'fact', difficulty: 'simple', seconds: 20, remaining_ms: 20000 };
const nav = () => ({ goBack: jest.fn() });

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockReset());
  mockRoom = null;
});

test('join by code, then wait in the lobby', async () => {
  mockApi.joinBattle.mockResolvedValue(lobby());
  const screen = render(<BattleScreen navigation={nav()} route={{ params: { mode: 'join' } }} />);
  fireEvent.changeText(screen.getByTestId('battle-code-input'), 'abc-234');
  fireEvent.press(screen.getByText('battle.join'));
  await waitFor(() => expect(screen.getByText('ABC234')).toBeTruthy(), { timeout: 8000 });
  expect(mockApi.joinBattle).toHaveBeenCalledWith('ABC234');
  expect(screen.getByText('battle.waitingForHost:pastor')).toBeTruthy();
  expect(screen.getByText('ann')).toBeTruthy();
});

test('a battle link joins straight away', async () => {
  mockApi.joinBattle.mockResolvedValue(lobby());
  const screen = render(<BattleScreen navigation={nav()} route={{ params: { code: 'abc234' } }} />);
  await waitFor(() => expect(screen.getByText('ABC234')).toBeTruthy());
  expect(battleLink('ABC234')).toBe('streams://battle/ABC234');
});

test('the host creates a room and starts it', async () => {
  mockApi.createBattle.mockResolvedValue(lobby({ is_host: true, me: undefined }));
  mockApi.startBattle.mockResolvedValue(lobby({ is_host: true, status: 'question', current: 0, question, answered: 0 }));
  const screen = render(<BattleScreen navigation={nav()} route={{ params: { mode: 'host' } }} />);
  fireEvent.press(screen.getByText('battle.seconds:15'));
  fireEvent.press(screen.getByText('battle.create'));
  await waitFor(() => expect(screen.getByText('battle.start')).toBeTruthy());
  expect(mockApi.createBattle).toHaveBeenCalledWith({ title: '', seconds: 15, language: 'en' });
  await act(async () => { fireEvent.press(screen.getByText('battle.start')); });
  expect(mockApi.startBattle).toHaveBeenCalledWith('ABC234');
  await waitFor(() => expect(screen.getByText('battle.answered:0,2')).toBeTruthy());
});

test('the question opens for everyone, and a tap answers it once', async () => {
  mockApi.joinBattle.mockResolvedValue(lobby());
  mockApi.answerBattle.mockResolvedValue({ accepted: true, all_in: false });
  const screen = render(<BattleScreen navigation={nav()} route={{ params: { code: 'ABC234' } }} />);
  await waitFor(() => expect(mockRoom).toBeTruthy());
  act(() => mockRoom({ type: 'question', question }));
  await waitFor(() => expect(screen.getByText('Who built the ark?')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByLabelText('A. Noah')); });
  expect(mockApi.answerBattle).toHaveBeenCalledWith('ABC234', 0, 0);
  fireEvent.press(screen.getByLabelText('B. Moses'));
  expect(mockApi.answerBattle).toHaveBeenCalledTimes(1);
  expect(screen.getByText('battle.answerIn')).toBeTruthy();
});

test('when the clock runs out, the answer is asked for', async () => {
  mockApi.joinBattle.mockResolvedValue(lobby());
  mockApi.revealBattle.mockResolvedValue(lobby({ status: 'reveal' }));
  render(<BattleScreen navigation={nav()} route={{ params: { code: 'ABC234' } }} />);
  await waitFor(() => expect(mockRoom).toBeTruthy());
  act(() => mockRoom({ type: 'question', question: { ...question, remaining_ms: 0 } }));
  await waitFor(() => expect(mockApi.revealBattle).toHaveBeenCalledWith('ABC234', 0));
});

test('the answer shown: my result, my place, the ranking', async () => {
  mockApi.joinBattle.mockResolvedValue(lobby());
  const reveal = { index: 0, answer_index: 0, reference: 'Genesis 6:14', explanation: '', counts: [1, 1, 0, 0],
    ranking: [{ id: 1, username: 'ann', points: 870, correct: 1 }, { id: 2, username: 'ben', points: 0, correct: 0 }] };
  mockApi.fetchBattle.mockResolvedValue(lobby({ status: 'reveal', current: 0, question, reveal,
    me: { points: 870, correct: 1, place: 1, answered: true, last: { choice: 0, correct: true, points: 870 } } }));
  const screen = render(<BattleScreen navigation={nav()} route={{ params: { code: 'ABC234' } }} />);
  await waitFor(() => expect(mockRoom).toBeTruthy());
  act(() => mockRoom({ type: 'question', question }));
  act(() => mockRoom({ type: 'reveal', reveal }));
  await waitFor(() => expect(screen.getByText('battle.right:870')).toBeTruthy());
  expect(screen.getByText('battle.place:1')).toBeTruthy();
  expect(screen.getByTestId('battle-board')).toBeTruthy();
  expect(screen.getByText('Genesis 6:14')).toBeTruthy();
});

test('the end: the final ranking', async () => {
  mockApi.joinBattle.mockResolvedValue(lobby());
  mockApi.fetchBattle.mockResolvedValue(lobby({ status: 'finished',
    ranking: [{ id: 1, username: 'ann', points: 5400, correct: 8 }], me: { points: 5400, correct: 8, place: 1 } }));
  const screen = render(<BattleScreen navigation={nav()} route={{ params: { code: 'ABC234' } }} />);
  await waitFor(() => expect(mockRoom).toBeTruthy());
  act(() => mockRoom({ type: 'finished' }));
  await waitFor(() => expect(screen.getByText('battle.finalTitle')).toBeTruthy());
  expect(screen.getByText('battle.finalPlace:1,5400')).toBeTruthy();
});

test('a wrong code is said plainly', async () => {
  mockApi.joinBattle.mockRejectedValue({ response: { status: 404, data: {} } });
  const screen = render(<BattleScreen navigation={nav()} route={{ params: { mode: 'join' } }} />);
  fireEvent.changeText(screen.getByTestId('battle-code-input'), 'ZZZZZZ');
  await act(async () => { fireEvent.press(screen.getByText('battle.join')); });
  await waitFor(() => expect(screen.getByText('battle.error.not_found')).toBeTruthy());
});

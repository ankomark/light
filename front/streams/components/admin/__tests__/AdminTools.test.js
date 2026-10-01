/**
 * Admin phase 3: the quiz bank, the puzzle themes and the verified tick,
 * run from the app.
 */
import React from 'react';
import { render, fireEvent, waitFor, act, configure } from '@testing-library/react-native';

jest.setTimeout(20000);
configure({ asyncUtilTimeout: 8000 });

const mockApi = new Proxy({}, { get: (target, k) => (target[k] ||= jest.fn()) });
jest.mock('../../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
jest.mock('../../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 1 } }) }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (fn) => require('react').useEffect(fn, []) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
const mockConfirm = jest.fn(async () => true);
jest.mock('../../../utils/adminConfirm', () => ({ confirmAction: (...a) => mockConfirm(...a), notify: jest.fn() }));

const AdminQuizBank = require('../AdminQuizBank').default;
const AdminPuzzleThemes = require('../AdminPuzzleThemes').default;
const AdminVerify = require('../AdminVerify').default;

beforeEach(() => {
  Object.keys(mockApi).forEach((k) => mockApi[k].mockReset());
  mockConfirm.mockClear();
});

describe('quiz bank', () => {
  const question = (extra) => ({
    id: 4, kind: 'fact', language: 'en', difficulty: 'simple', prompt: 'How many disciples?',
    choices: ['Ten', 'Twelve'], answer_index: 1, is_active: true, retired_reason: '', times_asked: 10, accuracy: 0.8,
    reference: 'Matthew 10', explanation: '', ...extra,
  });

  test('a question written and saved; the server refusal shown', async () => {
    mockApi.fetchQuizBank.mockResolvedValue({ results: [] });
    mockApi.saveQuizQuestion
      .mockRejectedValueOnce({ data: { answer_index: ['Must point at one of the answers (0 is the first).'] } })
      .mockResolvedValueOnce(question({ id: 9, prompt: 'Who built the ark?' }));
    const screen = render(<AdminQuizBank />);
    await waitFor(() => expect(screen.getByText('adminQuiz.none')).toBeTruthy());
    fireEvent.press(screen.getByTestId('quiz-new'));
    fireEvent.changeText(screen.getByTestId('quiz-prompt'), 'Who built the ark?');
    fireEvent.changeText(screen.getByTestId('quiz-choice-0'), 'Noah');
    fireEvent.changeText(screen.getByTestId('quiz-choice-1'), 'Moses');
    await act(async () => { fireEvent.press(screen.getByTestId('quiz-save')); });
    expect(screen.getByTestId('quiz-error')).toHaveTextContent('Must point at one of the answers (0 is the first).');
    await act(async () => { fireEvent.press(screen.getByTestId('quiz-save')); });
    const sent = mockApi.saveQuizQuestion.mock.calls[1][0];
    expect(sent.choices).toEqual(['Noah', 'Moses']);     // the empty third is dropped
    expect(screen.getByText('Who built the ark?')).toBeTruthy();
  });

  test('a question the quiz retired says why, and comes back', async () => {
    mockApi.fetchQuizBank.mockResolvedValue({ results: [question({ is_active: false, retired_reason: 'too_hard' })] });
    mockApi.activateQuizQuestion.mockResolvedValue(question({ is_active: true, times_asked: 0 }));
    const screen = render(<AdminQuizBank />);
    await waitFor(() => expect(screen.getByTestId('quiz-retired-4')).toHaveTextContent('adminQuiz.retiredFor.too_hard'));
    await act(async () => { fireEvent.press(screen.getByTestId('quiz-toggle-4')); });
    expect(mockApi.activateQuizQuestion).toHaveBeenCalledWith(4);
    expect(screen.queryByTestId('quiz-retired-4')).toBeNull();
  });
});

describe('puzzle themes', () => {
  const themes = [
    { id: 1, name: 'Law', source: { kind: 'books', first: 1, last: 5 }, is_active: true, puzzle_count: 3 },
    { id: 2, name: 'Faith', source: { kind: 'topic', term: 'faith' }, is_active: true, puzzle_count: 0 },
  ];

  test('reordered, and turned off', async () => {
    mockApi.fetchPuzzleThemesAdmin.mockResolvedValue(themes);
    mockApi.reorderPuzzleThemes.mockResolvedValue({});
    mockApi.savePuzzleTheme.mockResolvedValue({});
    const screen = render(<AdminPuzzleThemes />);
    await waitFor(() => expect(screen.getByTestId('theme-up-2')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByTestId('theme-up-2')); });
    expect(mockApi.reorderPuzzleThemes).toHaveBeenCalledWith([2, 1]);
    await act(async () => { fireEvent(screen.getByTestId('theme-on-1'), 'valueChange', false); });
    expect(mockApi.savePuzzleTheme).toHaveBeenCalledWith({ id: 1, is_active: false });
  });

  test('a new theme says where its words come from', async () => {
    mockApi.fetchPuzzleThemesAdmin.mockResolvedValue([]);
    mockApi.savePuzzleTheme.mockResolvedValue({ id: 3, name: 'Grace', source: { kind: 'topic', term: 'grace' }, is_active: true });
    const screen = render(<AdminPuzzleThemes />);
    await waitFor(() => expect(screen.getByTestId('theme-new')).toBeTruthy());
    fireEvent.press(screen.getByTestId('theme-new'));
    fireEvent.changeText(screen.getByTestId('theme-name'), 'Grace');
    fireEvent.changeText(screen.getByTestId('theme-term'), 'grace');
    await act(async () => { fireEvent.press(screen.getByTestId('theme-save')); });
    expect(mockApi.savePuzzleTheme).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Grace', source: { kind: 'topic', term: 'grace', term_sw: '' },
    }));
  });
});

describe('verified ticks', () => {
  test('given after a confirmation; taken with a reason', async () => {
    mockApi.fetchVerifyList.mockResolvedValue({ results: [
      { id: 5, kind: 'artist', name: 'Choir', verified: false, owner: 'choir' },
      { id: 6, kind: 'artist', name: 'Singer', verified: true, owner: 'singer' },
    ] });
    mockApi.setVerified.mockResolvedValue({});
    const screen = render(<AdminVerify />);
    await waitFor(() => expect(screen.getByTestId('verify-toggle-5')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByTestId('verify-toggle-5')); });
    expect(mockApi.setVerified).toHaveBeenCalledWith('artist', 5, true, '');
    fireEvent.press(screen.getByTestId('verify-toggle-6'));
    await waitFor(() => expect(screen.getByTestId('reason-sheet')).toBeTruthy());
    fireEvent.press(screen.getByTestId('reason-impersonation'));
    await act(async () => { fireEvent.press(screen.getByTestId('reason-confirm')); });
    expect(mockApi.setVerified).toHaveBeenLastCalledWith('artist', 6, false, 'adminKit.reason.impersonation');
  });

  test('by kind', async () => {
    mockApi.fetchVerifyList.mockResolvedValue({ results: [] });
    const screen = render(<AdminVerify />);
    await waitFor(() => expect(mockApi.fetchVerifyList).toHaveBeenCalledWith('artist', { state: '', q: '' }));
    await act(async () => { fireEvent.press(screen.getByTestId('verify-kind-organization')); });
    expect(mockApi.fetchVerifyList).toHaveBeenLastCalledWith('organization', { state: '', q: '' });
  });
});

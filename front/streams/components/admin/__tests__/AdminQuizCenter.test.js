/**
 * The quiz centre and Claude's drafts, run from the admin app.
 */
import React from 'react';
import { render, fireEvent, waitFor, act, configure } from '@testing-library/react-native';

jest.setTimeout(20000);
configure({ asyncUtilTimeout: 8000 });

const mockApi = new Proxy({}, { get: (target, k) => (target[k] ||= jest.fn()) });
jest.mock('../../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (fn) => require('react').useEffect(fn, []) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
const mockConfirm = jest.fn(async () => true);
const mockNotify = jest.fn();
jest.mock('../../../utils/adminConfirm', () => ({
  confirmAction: (...a) => mockConfirm(...a), notify: (...a) => mockNotify(...a),
}));

const AdminQuizCenter = require('../AdminQuizCenter').default;
const AdminQuizBank = require('../AdminQuizBank').default;

const day = (extra) => ({
  id: 1, date: '2026-10-07', language: 'en', theme: 'prophets', attempts: 0,
  questions: [{ id: 5, order: 0, kind: 'book', difficulty: 'simple', prompt: 'Which book?', passage: 'In the beginning',
    choices: ['Genesis', 'John'], answer_index: 0, reference: 'Genesis 1:1', explanation: '', bank_question: null }],
  ...extra,
});

beforeEach(() => {
  Object.keys(mockApi).forEach((k) => mockApi[k].mockReset());
  mockConfirm.mockClear();
  mockNotify.mockClear();
});

describe('the quiz centre', () => {
  test("today's quiz shows its answers and rebuilds while unplayed", async () => {
    mockApi.fetchAdminDailyQuiz.mockResolvedValue(day());
    mockApi.rebuildAdminDailyQuiz.mockResolvedValue(day({ id: 2 }));
    const screen = render(<AdminQuizCenter />);
    await waitFor(() => expect(screen.getByText('✓ Genesis')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByTestId('center-rebuild')); });
    expect(mockApi.rebuildAdminDailyQuiz).toHaveBeenCalledWith({ language: 'en' });
  });

  test('a report is settled and leaves the queue', async () => {
    mockApi.fetchAdminDailyQuiz.mockResolvedValue(day());
    mockApi.fetchQuizReports.mockResolvedValue({ results: [{
      id: 3, reason: 'wrong_answer', prompt: 'Who built the ark?', passage: '', choices: ['Moses', 'Noah'], answer_index: 0,
      note: 'Noah!', reference: 'Genesis 6:14', reporter: 'ruth', language: 'en', status: 'open', bank_question: 8,
      reports_on_question: 2,
    }] });
    mockApi.resolveQuizReport.mockResolvedValue({});
    const screen = render(<AdminQuizCenter />);
    await waitFor(() => expect(screen.getByTestId('center-tab-reports')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByTestId('center-tab-reports')); });
    await waitFor(() => expect(screen.getByTestId('center-report-3')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByTestId('center-retire-3')); });
    expect(mockApi.resolveQuizReport).toHaveBeenCalledWith(3, 'fixed', true);
    await waitFor(() => expect(screen.queryByTestId('center-report-3')).toBeNull());
  });

  test('a story must fit its book before it is saved', async () => {
    mockApi.fetchAdminDailyQuiz.mockResolvedValue(day());
    mockApi.fetchStoryPacksAdmin.mockResolvedValue([]);
    const screen = render(<AdminQuizCenter />);
    await act(async () => { fireEvent.press(screen.getByTestId('center-tab-stories')); });
    await waitFor(() => expect(screen.getByTestId('center-new-pack')).toBeTruthy());
    fireEvent.press(screen.getByTestId('center-new-pack'));
    fireEvent.press(screen.getByTestId('pack-book-8'));                     // Ruth: four chapters
    fireEvent.changeText(screen.getByTestId('pack-title'), 'Ruth');
    fireEvent.changeText(screen.getByTestId('pack-chapters-last'), '9');
    await act(async () => { fireEvent.press(screen.getByTestId('pack-save')); });
    expect(screen.getByTestId('pack-error')).toBeTruthy();
    expect(mockApi.saveStoryPack).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByTestId('pack-chapters-last'), '4');
    mockApi.saveStoryPack.mockResolvedValue({ id: 1 });
    await act(async () => { fireEvent.press(screen.getByTestId('pack-save')); });
    expect(mockApi.saveStoryPack).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Ruth', book_number: 8, chapter_start: 1, chapter_end: 4,
    }));
  });
});

describe("Claude's drafts in the question bank", () => {
  test('asked for on a passage, then shown for review', async () => {
    mockApi.fetchQuizBank.mockResolvedValue({ results: [] });
    mockApi.draftQuizQuestions.mockResolvedValue({ created: [{
      id: 9, kind: 'fact', language: 'en', difficulty: 'simple', prompt: 'Who made the earth?', choices: ['God', 'Adam'],
      answer_index: 0, is_active: false, needs_review: true, origin: 'ai', retired_reason: '', times_asked: 0,
      accuracy: null, reference: 'Genesis 1:1', explanation: 'In the beginning God created.', calibrated_from: '',
    }] });
    const screen = render(<AdminQuizBank />);
    await waitFor(() => expect(screen.getByTestId('quiz-ask-claude')).toBeTruthy());
    fireEvent.press(screen.getByTestId('quiz-ask-claude'));
    fireEvent.press(screen.getByTestId('ask-book-1'));
    await act(async () => { fireEvent.press(screen.getByTestId('ask-send')); });
    expect(mockApi.draftQuizQuestions).toHaveBeenCalledWith(expect.objectContaining({
      book_number: 1, chapter_start: 1, chapter_end: 3, count: 5,
    }));
    expect(mockApi.fetchQuizBank).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'review' }));
  });

  test('a passage too long is refused before asking', async () => {
    mockApi.fetchQuizBank.mockResolvedValue({ results: [] });
    const screen = render(<AdminQuizBank />);
    await waitFor(() => expect(screen.getByTestId('quiz-ask-claude')).toBeTruthy());
    fireEvent.press(screen.getByTestId('quiz-ask-claude'));
    fireEvent.changeText(screen.getByTestId('ask-chapters-last'), '20');
    await act(async () => { fireEvent.press(screen.getByTestId('ask-send')); });
    expect(screen.getByTestId('ask-error')).toBeTruthy();
    expect(mockApi.draftQuizQuestions).not.toHaveBeenCalled();
  });
});

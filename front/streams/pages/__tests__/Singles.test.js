/**
 * Single & Searching in the app: the door shows the right thing for where a
 * person is (switched off, not yet eligible, the welcome, a profile in
 * review, Discover), joining needs the rules agreed, creating sends the birth
 * date once, an answer can become a match with a way to begin, and the
 * reviewers approve with a refused photo.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
const mockNav = { navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn() };
let mockParams = {};
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return {
    useNavigation: () => mockNav,
    useRoute: () => ({ params: mockParams }),
    useFocusEffect: (fn) => R.useEffect(fn, [fn]),
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-picker', () => ({ MediaTypeOptions: { Images: 'Images' } }));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('../../utils/adminConfirm', () => ({
  notify: jest.fn(), confirmAction: jest.fn(async () => true),
}));
jest.mock('../../services/api', () => ({
  fetchSinglesMe: jest.fn(), fetchSinglesDiscover: jest.fn(), answerSingles: jest.fn(), fetchSinglesMatches: jest.fn(),
  createSinglesProfile: jest.fn(), updateSinglesProfile: jest.fn(), submitSinglesProfile: jest.fn(),
  pauseSinglesProfile: jest.fn(), leaveSingles: jest.fn(), addSinglesPhoto: jest.fn(), removeSinglesPhoto: jest.fn(),
  reportSingles: jest.fn(), blockSingles: jest.fn(), unmatchSingles: jest.fn(),
  fetchSinglesQueue: jest.fn(), fetchAdminByUrl: jest.fn(), reviewSinglesProfile: jest.fn(),
  banFromSingles: jest.fn(), unbanFromSingles: jest.fn(),
}));
jest.mock('../../components/admin/AdminKit', () => ({
  ADMIN: { card: '#000', border: '#111', text: '#fff', muted: '#999', gold: '#fc6', onGold: '#000', danger: '#f00' },
  ErrorState: () => null,
  useReasonSheet: () => [null, jest.fn(async () => 'reason')],
}));

const api = require('../../services/api');
const SinglesHome = require('../singles/SinglesHome').default;
const SinglesEdit = require('../singles/SinglesEdit').default;
const AdminSingles = require('../../components/admin/AdminSingles').default;

const grace = {
  id: 7, first_name: 'Grace', age: 27, country: 'Kenya', town: 'Nairobi', church: 'Central', baptised: 'yes',
  looking_for: 'marriage', languages: ['English'], about: 'Nurse', prompts: [{ key: 'verse', answer: 'Isaiah 41:10' }],
  occupation: '', education: '', interests: [], photos: [{ id: 1, url: 'https://x/1.jpg' }],
};
const mine = (status, extra = {}) => ({
  id: 1, first_name: 'Mark', age: 29, country: 'Kenya', town: '', church: '', baptised: 'yes', looking_for: 'marriage',
  languages: [], about: 'Hi', prompts: [], occupation: '', education: '', interests: [], photos: [], status,
  review_note: '', is_paused: false, missing: [], ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
});

test('switched off, and not yet eligible, each say so', async () => {
  api.fetchSinglesMe.mockRejectedValueOnce({ data: { code: 'feature_off' } });
  let screen = render(<SinglesHome />);
  await waitFor(() => expect(screen.getByTestId('singles-off')).toBeTruthy());
  screen.unmount();
  api.fetchSinglesMe.mockResolvedValueOnce({ eligible: false, blockers: ['account_too_new'], ready_on: '2026-10-09', profile: null });
  screen = render(<SinglesHome />);
  await waitFor(() => expect(screen.getByText('singles.blocker.account_too_new:2026-10-09')).toBeTruthy());
});

test('the welcome lets you create only once the rules are agreed', async () => {
  api.fetchSinglesMe.mockResolvedValue({ eligible: true, blockers: [], profile: null });
  const screen = render(<SinglesHome />);
  await waitFor(() => expect(screen.getByTestId('singles-welcome')).toBeTruthy());
  fireEvent.press(screen.getByTestId('singles-create'));
  expect(mockNav.navigate).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('singles-agree'));
  fireEvent.press(screen.getByTestId('singles-create'));
  expect(mockNav.navigate).toHaveBeenCalledWith('SinglesEdit', { create: true });
});

test('a profile in review shows where it stands, and missing parts when sent too soon', async () => {
  api.fetchSinglesMe.mockResolvedValue({ eligible: true, blockers: [], profile: mine('draft') });
  api.submitSinglesProfile.mockRejectedValueOnce({ data: { code: 'incomplete', missing: ['photo'] } });
  const { notify } = require('../../utils/adminConfirm');
  const screen = render(<SinglesHome />);
  await waitFor(() => expect(screen.getByTestId('singles-status-draft')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByTestId('singles-submit')); });
  expect(notify).toHaveBeenCalledWith('singles.mine.missingTitle', '•  singles.missing.photo');
});

test('discover: interested can become a match with a way to begin, then the chat', async () => {
  api.fetchSinglesMe.mockResolvedValue({ eligible: true, blockers: [], profile: mine('approved') });
  api.fetchSinglesDiscover.mockResolvedValue({ results: [grace], left_today: 20 });
  api.answerSingles.mockResolvedValue({
    matched: true, left_today: 19,
    match: { id: 3, conversation_id: 44, profile: grace, user: { id: 9, username: 'grace' },
      opener: { kind: 'prompt', key: 'verse', answer: 'Isaiah 41:10' } },
  });
  const screen = render(<SinglesHome />);
  await waitFor(() => expect(screen.getByTestId('singles-card-7')).toBeTruthy());
  expect(screen.getByText('singles.discover.left:20')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('singles-interested')); });
  expect(api.answerSingles).toHaveBeenCalledWith(7, 'interested');
  expect(screen.getByTestId('singles-match')).toBeTruthy();
  expect(screen.getByText('singles.opener.prompt:Grace,singles.prompt.verse,Isaiah 41:10')).toBeTruthy();
  fireEvent.press(screen.getByTestId('singles-hello'));
  expect(mockNav.navigate).toHaveBeenCalledWith('Chat', { conversationId: 44, otherUser: { id: 9, username: 'grace' }, singles: true });
});

test('discover: "not now" moves on, and the day ends kindly', async () => {
  api.fetchSinglesMe.mockResolvedValue({ eligible: true, blockers: [], profile: mine('approved') });
  api.fetchSinglesDiscover.mockResolvedValueOnce({ results: [grace], left_today: 1 });
  api.answerSingles.mockResolvedValue({ matched: false, match: null, left_today: 0 });
  const screen = render(<SinglesHome />);
  await waitFor(() => expect(screen.getByTestId('singles-card-7')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByTestId('singles-pass')); });
  expect(screen.getByText('singles.discover.doneTitle')).toBeTruthy();
});

test('creating sends the birth date once, as a date, with the rules agreed', async () => {
  mockParams = { create: true };
  api.createSinglesProfile.mockResolvedValue({});
  const screen = render(<SinglesEdit />);
  fireEvent.changeText(screen.getByTestId('singles-field-first_name'), 'Mark');
  fireEvent.changeText(screen.getByTestId('singles-birth-day'), '7');
  fireEvent.changeText(screen.getByTestId('singles-birth-month'), '3');
  fireEvent.changeText(screen.getByTestId('singles-birth-year'), '1997');
  fireEvent.press(screen.getByTestId('singles-gender-man'));
  fireEvent.changeText(screen.getByTestId('singles-field-country'), 'Kenya');
  fireEvent.press(screen.getByTestId('singles-baptised-yes'));
  fireEvent.press(screen.getByTestId('singles-prompt-verse'));
  fireEvent.changeText(screen.getByTestId('singles-answer-verse'), 'John 3:16');
  await act(async () => { fireEvent.press(screen.getByTestId('singles-save')); });
  expect(api.createSinglesProfile).toHaveBeenCalledWith(expect.objectContaining({
    agree_rules: true, gender: 'man', birth_date: '1997-03-07', first_name: 'Mark',
    prompts: [{ key: 'verse', answer: 'John 3:16' }],
  }));
  expect(mockNav.goBack).toHaveBeenCalled();
});

test('editing never sends birth date or gender', async () => {
  mockParams = { profile: mine('approved') };
  api.updateSinglesProfile.mockResolvedValue({});
  const screen = render(<SinglesEdit />);
  expect(screen.queryByTestId('singles-birth-day')).toBeNull();
  await act(async () => { fireEvent.press(screen.getByTestId('singles-save')); });
  const sent = api.updateSinglesProfile.mock.calls[0][0];
  expect(sent.birth_date).toBeUndefined();
  expect(sent.gender).toBeUndefined();
});

test('reviewers approve with a refused photo', async () => {
  api.fetchSinglesQueue.mockResolvedValue({ results: [{
    id: 5, first_name: 'Ann', age: 30, gender: 'woman', town: '', country: 'Kenya', church: '', about: 'Hi', prompts: [],
    review_note: '', status: 'pending', user: { username: 'ann', joined: '2026-09-01', strikes: 0 },
    photos: [{ id: 11, url: 'https://x/a.jpg', status: 'pending' }, { id: 12, url: 'https://x/b.jpg', status: 'pending' }],
  }], next: null });
  api.reviewSinglesProfile.mockResolvedValue({ status: 'approved' });
  const screen = render(<AdminSingles />);
  await waitFor(() => expect(screen.getByTestId('singles-review-5')).toBeTruthy());
  fireEvent.press(screen.getAllByLabelText('adminSingles.togglePhoto')[1]);
  await act(async () => { fireEvent.press(screen.getByTestId('singles-approve-5')); });
  expect(api.reviewSinglesProfile).toHaveBeenCalledWith(5, 'approve', '', { 11: 'approve', 12: 'reject' });
  expect(screen.queryByTestId('singles-review-5')).toBeNull();
});

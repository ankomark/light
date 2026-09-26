/**
 * The notice board: opens on the last board seen (placeholders, not a
 * spinner, the first time), pages 20 at a time, deletes with a web-safe
 * confirm, and lets anyone send the admins a note.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { writeCache, dropCache, userKey } from '../../utils/screenCache';

jest.setTimeout(20000);

const mockApi = {
  fetchNotices: jest.fn(),
  createNotice: jest.fn(async () => ({})),
  updateNotice: jest.fn(async () => ({})),
  deleteNotice: jest.fn(async () => ({})),
  markNoticesSeen: jest.fn(async () => ({})),
  createAdminNote: jest.fn(async () => ({})),
  fetchAdminNotes: jest.fn(async () => []),
  fetchMyAdminNotes: jest.fn(async () => ({ results: [] })),
  markAdminNoteRead: jest.fn(async () => ({})),
  replyToAdminNote: jest.fn(async () => ({})),
  deleteAdminNote: jest.fn(async () => ({})),
};
jest.mock('../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));

let mockUser = { id: 1, username: 'me', is_staff: false };
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true, currentUser: mockUser }) }));
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
const mockConfirm = jest.fn(async () => true);
const mockNotify = jest.fn();
jest.mock('../../utils/adminConfirm', () => ({
  confirmAction: (...a) => mockConfirm(...a),
  notify: (...a) => mockNotify(...a),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }) }));

const NoticeBoard = require('../NoticeBoard').default;
const { ActivityIndicator } = require('react-native');

const notice = (id, extra = {}) => ({
  id, title: `Notice ${id}`, body: `Body ${id}`, is_pinned: false, created_by_username: 'pastor',
  created_at: '2026-09-20T10:00:00Z', can_manage: false, ...extra,
});

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockClear());
  mockConfirm.mockClear();
  mockNotify.mockClear();
  mockUser = { id: 1, username: 'me', is_staff: false };
  dropCache(userKey(1, 'notices'));
});

test('opens on the cached board before the network answers, then refreshes it', async () => {
  writeCache(userKey(1, 'notices'), { results: [notice(1)] });
  let answer;
  mockApi.fetchNotices.mockImplementationOnce(() => new Promise((res) => { answer = res; }));
  const r = render(<NoticeBoard />);
  expect(r.getByText('Notice 1')).toBeTruthy();
  await act(async () => { answer({ results: [notice(2)], next: null }); });
  expect(r.getByText('Notice 2')).toBeTruthy();
  expect(r.queryByText('Notice 1')).toBeNull();
});

test('a first-ever open shows placeholders, not a spinner; a failure offers retry', async () => {
  mockApi.fetchNotices.mockImplementationOnce(() => new Promise(() => {}));
  const r = render(<NoticeBoard />);
  expect(r.getByTestId('notice-skeleton')).toBeTruthy();
  expect(r.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);

  mockApi.fetchNotices.mockRejectedValueOnce(new Error('offline'));
  const r2 = render(<NoticeBoard />);
  await waitFor(() => expect(r2.getByTestId('notices-retry')).toBeTruthy());
  mockApi.fetchNotices.mockResolvedValueOnce({ results: [notice(3)], next: null });
  await act(async () => { fireEvent.press(r2.getByTestId('notices-retry')); });
  await waitFor(() => expect(r2.getByText('Notice 3')).toBeTruthy());
});

test('pages as you scroll', async () => {
  mockApi.fetchNotices.mockImplementation(async (page) => (page === 1
    ? { results: [notice(1), notice(2)], next: 'p2' }
    : { results: [notice(3)], next: null }));
  const r = render(<NoticeBoard />);
  await waitFor(() => expect(r.getByText('Notice 2')).toBeTruthy());
  await act(async () => { fireEvent(r.UNSAFE_getByType(require('react-native').FlatList), 'endReached'); });
  await waitFor(() => expect(r.getByText('Notice 3')).toBeTruthy());
  expect(mockApi.fetchNotices).toHaveBeenLastCalledWith(2);
});

test('an admin deletes with a web-safe confirm', async () => {
  mockUser = { id: 1, username: 'me', is_staff: true };
  mockApi.fetchNotices.mockResolvedValue({ results: [notice(5, { can_manage: true })], next: null });
  const r = render(<NoticeBoard />);
  await waitFor(() => expect(r.getByTestId('notice-delete-5')).toBeTruthy());
  await act(async () => { fireEvent.press(r.getByTestId('notice-delete-5')); });
  expect(mockConfirm).toHaveBeenCalled();
  expect(mockApi.deleteNotice).toHaveBeenCalledWith(5);
  expect(r.queryByText('Notice 5')).toBeNull();
});

test('anyone can send the admins a note', async () => {
  mockApi.fetchNotices.mockResolvedValue({ results: [], next: null });
  const r = render(<NoticeBoard />);
  await act(async () => { fireEvent.press(r.getByText('notice.noteToAdmins')); });
  fireEvent.changeText(r.getByTestId('note-body'), 'The hall roof leaks');
  await act(async () => { fireEvent.press(r.getByTestId('note-send')); });
  expect(mockApi.createAdminNote).toHaveBeenCalledWith('The hall roof leaks');
  expect(mockNotify).toHaveBeenCalledWith('notice.sentTitle', 'notice.sentBody');
});

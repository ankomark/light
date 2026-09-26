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
  fetchNotice: jest.fn(),
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
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }) }));
jest.mock('expo-image', () => { const { View } = require('react-native'); return { Image: (p) => <View testID={p.testID} /> }; });
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file://pic.jpg' }] })),
  MediaTypeOptions: { Images: 'Images' },
}));
jest.mock('../../services/imageProcessing', () => ({ compressImage: jest.fn(async (uri) => ({ uri })) }));
const mockUpload = jest.fn(async () => ({ url: 'https://cdn.example/cover/n.jpg' }));
jest.mock('../../services/cloudinary', () => ({ uploadMedia: (...a) => mockUpload(...a) }));

const mockAnnounced = [];
jest.mock('../../services/dmSocket', () => ({ announceDM: (e) => mockAnnounced.push(e) }));

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
  expect(mockApi.fetchNotices).toHaveBeenLastCalledWith(2, { category: '', q: '' });
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

test('new notices are marked, then seen (the badge clears; the cache forgets "new")', async () => {
  const { peekCache } = require('../../utils/screenCache');
  mockApi.fetchNotices.mockResolvedValue({ results: [notice(7, { is_new: true }), notice(6)], next: null });
  const r = render(<NoticeBoard />);
  await waitFor(() => expect(r.getByTestId('notice-new-7')).toBeTruthy());
  expect(r.queryByTestId('notice-new-6')).toBeNull();
  await waitFor(() => expect(mockApi.markNoticesSeen).toHaveBeenCalled());
  await waitFor(() => expect(mockAnnounced).toContainEqual({ type: 'notices_seen' }));
  expect(peekCache(userKey(1, 'notices')).results[0].is_new).toBe(false);
});
test('the compose chips: now / in an hour / tomorrow 8:00, and expiry from then', () => {
  const { publishTime, expiryTime } = require('../NoticeBoard');
  const now = new Date(2026, 8, 26, 15, 30);
  expect(publishTime('now', now)).toBeNull();
  expect(publishTime('1h', now).getTime()).toBe(now.getTime() + 3600000);
  const tomorrow = publishTime('tomorrow', now);
  expect([tomorrow.getDate(), tomorrow.getHours(), tomorrow.getMinutes()]).toEqual([27, 8, 0]);
  expect(expiryTime('never', now)).toBeNull();
  expect(expiryTime('7d', tomorrow).getTime()).toBe(tomorrow.getTime() + 7 * 86400000);
});

test('a manager schedules, edits (keeping the times), and sees what is scheduled', async () => {
  mockUser = { id: 1, username: 'me', is_staff: false, capabilities: ['manage_notices'] };
  mockApi.fetchNotices.mockResolvedValue({ results: [
    notice(8, { can_manage: true, status: 'scheduled', publish_at: '2026-10-01T08:00:00Z' }),
  ], next: null });
  const r = render(<NoticeBoard route={{}} />);
  await waitFor(() => expect(r.getByTestId('notice-scheduled-8')).toBeTruthy());

  await act(async () => { fireEvent.press(r.getByTestId('notice-compose')); });
  fireEvent.changeText(r.getByTestId('notice-title'), 'Choir practice');
  fireEvent.changeText(r.getByTestId('notice-body'), 'Sunday 3pm');
  await act(async () => { fireEvent.press(r.getByTestId('when-1h')); });
  await act(async () => { fireEvent.press(r.getByTestId('expiry-7d')); });
  await act(async () => { fireEvent.press(r.getByTestId('notice-post')); });
  const made = mockApi.createNotice.mock.calls[0][0];
  expect(made.title).toBe('Choir practice');
  expect(new Date(made.expires_at) - new Date(made.publish_at)).toBe(7 * 86400000);

  await act(async () => { fireEvent.press(r.getByTestId('notice-edit-8')); });
  fireEvent.changeText(r.getByTestId('notice-body'), 'New body');
  await act(async () => { fireEvent.press(r.getByTestId('notice-post')); });
  expect(mockApi.updateNotice).toHaveBeenCalledWith(8, { title: 'Notice 8', body: 'New body', is_pinned: false, category: 'general', cover_image: '' });
});

test('my notes: read or not, and the answer; admins answer from the inbox', async () => {
  mockApi.fetchNotices.mockResolvedValue({ results: [], next: null });
  mockApi.fetchMyAdminNotes.mockResolvedValue({ results: [
    { id: 4, body: 'The roof leaks', is_read: true, reply: 'Fixed on Monday', replied_by_username: 'elder', created_at: '2026-09-20T10:00:00Z' },
  ] });
  const r = render(<NoticeBoard route={{ params: { openMyNotes: true } }} />);
  await waitFor(() => expect(r.getByText('Fixed on Monday')).toBeTruthy());
  expect(r.getByText(/notice\.readByAdmins/)).toBeTruthy();

  mockUser = { id: 1, username: 'me', is_staff: true };
  mockApi.fetchAdminNotes.mockResolvedValue([{ id: 9, body: 'Please add Swahili', is_read: false, created_at: '2026-09-20T10:00:00Z' }]);
  mockApi.replyToAdminNote.mockResolvedValue({ id: 9, reply: 'Done', is_read: true, replied_by_username: 'me' });
  const a = render(<NoticeBoard route={{}} />);
  await act(async () => { fireEvent.press(a.getByText('notice.adminInbox')); });
  await waitFor(() => expect(a.getByTestId('reply-9')).toBeTruthy());
  await act(async () => { fireEvent.press(a.getByTestId('reply-9')); });
  fireEvent.changeText(a.getByTestId('reply-input-9'), 'Done');
  await act(async () => { fireEvent.press(a.getByTestId('reply-send-9')); });
  expect(mockApi.replyToAdminNote).toHaveBeenCalledWith(9, 'Done');
  expect(a.getByText('Done')).toBeTruthy();
});
test('search and categories ask the server; a card opens its page', async () => {
  mockApi.fetchNotices.mockImplementation(async (_p, f = {}) => ({ results: [notice(f.category === 'event' ? 20 : 21)], next: null }));
  const nav = { navigate: jest.fn() };
  const r = render(<NoticeBoard route={{}} navigation={nav} />);
  await waitFor(() => expect(r.getByText('Notice 21')).toBeTruthy());
  await act(async () => { fireEvent.press(r.getByTestId('cat-event')); });
  await waitFor(() => expect(r.getByText('Notice 20')).toBeTruthy());
  expect(mockApi.fetchNotices).toHaveBeenLastCalledWith(1, { category: 'event', q: '' });
  fireEvent.changeText(r.getByTestId('notice-search'), 'camp');
  await waitFor(() => expect(mockApi.fetchNotices).toHaveBeenLastCalledWith(1, { category: 'event', q: 'camp' }));
  await act(async () => { fireEvent.press(r.getByTestId('notice-20')); });
  expect(nav.navigate).toHaveBeenCalledWith('Notice', expect.objectContaining({ id: 20 }));
});

test('a notice gets a kind and a picture (uploaded as a cover)', async () => {
  mockUser = { id: 1, username: 'me', is_staff: true };
  mockApi.fetchNotices.mockResolvedValue({ results: [], next: null });
  const r = render(<NoticeBoard route={{}} />);
  await act(async () => { fireEvent.press(r.getByTestId('notice-compose')); });
  fireEvent.changeText(r.getByTestId('notice-title'), 'Camp');
  fireEvent.changeText(r.getByTestId('notice-body'), 'Register at https://camp.example');
  await act(async () => { fireEvent.press(r.getByTestId('kind-event')); });
  await act(async () => { fireEvent.press(r.getByTestId('cover-add')); });
  expect(mockUpload).toHaveBeenCalledWith(expect.objectContaining({ uri: 'file://pic.jpg' }), 'cover');
  await act(async () => { fireEvent.press(r.getByTestId('notice-post')); });
  expect(mockApi.createNotice.mock.calls[0][0]).toMatchObject({ category: 'event', cover_image: 'https://cdn.example/cover/n.jpg' });
});

test('links in text are split out to be tapped', () => {
  const { splitLinks } = require('../../components/LinkedText');
  expect(splitLinks('Register at https://camp.example/a, or www.x.org.')).toEqual([
    { text: 'Register at ' }, { text: 'https://camp.example/a', url: 'https://camp.example/a' },
    { text: ', or ' }, { text: 'www.x.org', url: 'https://www.x.org' }, { text: '.' },
  ]);
});

describe('A notice page', () => {
  const NoticeDetail = require('../NoticeDetail').default;
  const nav = { goBack: jest.fn() };

  it('shows the copy it was given at once, and shares a link', async () => {
    mockApi.fetchNotice.mockImplementation(() => new Promise(() => {}));
    const { Share } = require('react-native');
    const share = jest.spyOn(Share, 'share').mockResolvedValue({});
    const r = render(<NoticeDetail navigation={nav} route={{ params: { id: 30, notice: notice(30, { category: 'urgent' }) } }} />);
    expect(r.getByText('Notice 30')).toBeTruthy();
    expect(r.getByText('notice.category.urgent')).toBeTruthy();
    await act(async () => { fireEvent.press(r.getByTestId('notice-share')); });
    expect(share.mock.calls[0][0].message).toContain('streams://notice/30');
  });

  it('a kept copy of a notice that has since gone is not shown', async () => {
    mockApi.fetchNotice.mockRejectedValueOnce(Object.assign(new Error('nf'), { response: { status: 404 } }));
    const r = render(<NoticeDetail navigation={nav} route={{ params: { id: 32, notice: notice(32) } }} />);
    await waitFor(() => expect(r.getByText('notice.notAvailable')).toBeTruthy());
    expect(r.queryByText('Notice 32')).toBeNull();
  });

  it("says so when it's gone (expired, or not yours to see yet)", async () => {
    mockApi.fetchNotice.mockRejectedValueOnce(Object.assign(new Error('nf'), { response: { status: 404 } }));
    const r = render(<NoticeDetail navigation={nav} route={{ params: { id: 31 } }} />);
    await waitFor(() => expect(r.getByText('notice.notAvailable')).toBeTruthy());
  });
});
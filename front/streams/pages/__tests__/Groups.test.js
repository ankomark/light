/**
 * Groups & communities, fast: the list paints from cache and scopes its tabs
 * on the server; a group chat opens on its cached messages, lets the first
 * fresh page replace them, and polls only for what's newer; members page and
 * search on the server; deleting works on web (no Alert buttons).
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { writeCache, dropCache } from '../../utils/screenCache';
import { groupChatKey, groupListKey } from '../../utils/groupChat';

jest.setTimeout(20000);

const mockApi = {
  fetchGroups: jest.fn(),
  fetchGroupsByUrl: jest.fn(),
  fetchCommunities: jest.fn(),
  fetchCommunitiesByUrl: jest.fn(),
  fetchCommunityCategories: jest.fn(async () => []),
  deleteGroup: jest.fn(async () => ({})),
  joinGroupByCode: jest.fn(),
  fetchGroupDetails: jest.fn(),
  fetchGroupPosts: jest.fn(),
  fetchGroupPostsAfter: jest.fn(async () => ({ results: [], has_more: false })),
  fetchGroupPostsBefore: jest.fn(async () => ({ results: [], has_more: false })),
  sendGroupMessage: jest.fn(),
  editGroupMessage: jest.fn(),
  markGroupRead: jest.fn(async () => ({})),
  leaveGroup: jest.fn(),
  requestJoinGroup: jest.fn(),
  reactToGroupPost: jest.fn(),
  deleteGroupPost: jest.fn(async () => ({})),
  setGroupPostingPolicy: jest.fn(),
  pinGroupMessage: jest.fn(),
  unpinGroupMessage: jest.fn(),
  searchGroupMessages: jest.fn(async () => ({ results: [] })),
  fetchMessageReceipts: jest.fn(),
  setGroupJoinQuestion: jest.fn(),
  fetchGroupMessageContext: jest.fn(),
  fetchGroupMembers: jest.fn(),
  removeGroupMember: jest.fn(async () => ({})),
  setGroupAdmin: jest.fn(async () => ({})),
  setGroupModerator: jest.fn(async () => ({})),
};
jest.mock('../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));

let mockSocket = null;
jest.mock('../../services/groupSocket', () => ({
  createGroupSocket: (slug, handlers) => {
    mockSocket = { slug, handlers, sendTyping: jest.fn(), close: jest.fn() };
    return mockSocket;
  },
}));

jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true, currentUser: { id: 1, username: 'me' } }) }));
// Stable, like the app's (a new `t` each render would re-run every effect).
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
const mockConfirm = jest.fn(async () => true);
const mockNotify = jest.fn();
jest.mock('../../utils/adminConfirm', () => ({
  confirmAction: (...a) => mockConfirm(...a),
  notify: (...a) => mockNotify(...a),
}));
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return { useFocusEffect: (cb) => { R.useEffect(() => cb(), [cb]); } };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialIcons: () => null }));
jest.mock('expo-image', () => {
  const { View } = require('react-native');
  return { Image: (p) => <View testID={p.testID} /> };
});
jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: ({ children }) => <View>{children}</View> };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), initialWindowMetrics: null };
});
jest.mock('react-native-blurhash', () => ({ Blurhash: null }), { virtual: true });
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => {}), selectionAsync: jest.fn(async () => {}), ImpactFeedbackStyle: {},
}));
jest.mock('../../components/RotatingBackground', () => () => null);
jest.mock('../../components/ReportModal', () => () => null);
jest.mock('../../components/BookClubBanner', () => () => null);
jest.mock('../../hooks/useKeyboardHeight', () => () => 0);
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-document-picker', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('expo-sharing', () => ({}));
jest.mock('../../services/audioPlayer', () => ({}));
jest.mock('../../services/imageProcessing', () => ({}));
jest.mock('../../services/cloudinary', () => ({}));

const GroupList = require('../GroupList').default;
const GroupDetail = require('../GroupDetail').default;
const GroupMembers = require('../GroupMembers').default;

const nav = { navigate: jest.fn(), goBack: jest.fn() };
const group = (slug, extra = {}) => ({
  id: slug.length, slug, name: `Group ${slug}`, is_member: true, is_private: false, member_count: 3,
  creator: { id: 9 }, unread_count: 0, ...extra,
});
const at = (s) => new Date(Date.UTC(2026, 8, 26, 10, 0, s)).toISOString();
const post = (id, s, extra = {}) => ({
  id, created_at: at(s), content: `post ${id}`, message_type: 'text', user: { id: 2, username: 'them' },
  reactions: { summary: [], mine: null }, ...extra,
});

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockClear());
  mockApi.fetchGroups.mockReset();
  mockConfirm.mockClear();
  mockNotify.mockClear();
  nav.navigate.mockClear();
  ['public:all', 'private:all', 'mine:all'].forEach((v) => dropCache(groupListKey(1, 'group', v)));
});

describe('Group list', () => {
  it('paints the cached list at once, then asks the server for this tab', async () => {
    writeCache(groupListKey(1, 'group', 'public:all'), { results: [group('cached')], next: null });
    let answer;
    mockApi.fetchGroups.mockImplementation(() => new Promise((res) => { answer = res; }));
    const r = render(<GroupList navigation={nav} route={{}} mode="group" />);
    expect(r.getByText('Group cached')).toBeTruthy();                  // before the network answers
    expect(mockApi.fetchGroups).toHaveBeenCalledWith({ scope: 'public' });
    await act(async () => { answer({ results: [group('fresh')], next: null }); });
    expect(r.getByText('Group fresh')).toBeTruthy();
    expect(r.queryByText('Group cached')).toBeNull();
  });

  it('each tab is scoped by the server (one request per view)', async () => {
    mockApi.fetchGroups.mockImplementation(async ({ scope }) => ({ results: [group(`${scope}-1`)], next: null }));
    const r = render(<GroupList navigation={nav} route={{}} mode="group" />);
    await waitFor(() => expect(r.getByText('Group public-1')).toBeTruthy());
    const before = mockApi.fetchGroups.mock.calls.length;
    await act(async () => { fireEvent.press(r.getByText('group.list.tabMine')); });
    await waitFor(() => expect(r.getByText('Group mine-1')).toBeTruthy());
    expect(mockApi.fetchGroups.mock.calls.length).toBe(before + 1);
    expect(mockApi.fetchGroups).toHaveBeenLastCalledWith({ scope: 'mine' });
  });

  it('an empty list that failed offers a retry (no alert)', async () => {
    mockApi.fetchGroups.mockRejectedValueOnce(new Error('offline'));
    const r = render(<GroupList navigation={nav} route={{}} mode="group" />);
    await waitFor(() => expect(r.getByTestId('groups-retry')).toBeTruthy());
    expect(mockApi.fetchGroups).toHaveBeenCalledTimes(1);               // one request on open
    expect(mockNotify).not.toHaveBeenCalled();
    mockApi.fetchGroups.mockResolvedValueOnce({ results: [group('back')], next: null });
    await act(async () => { fireEvent.press(r.getByTestId('groups-retry')); });
    await waitFor(() => expect(r.getByText('Group back')).toBeTruthy());
  });

  it('opening a group passes it along', async () => {
    mockApi.fetchGroups.mockResolvedValue({ results: [group('g1')], next: null });
    const r = render(<GroupList navigation={nav} route={{}} mode="group" />);
    await waitFor(() => expect(r.getByTestId('group-row-g1')).toBeTruthy());
    fireEvent.press(r.getByTestId('group-row-g1'));
    expect(nav.navigate).toHaveBeenCalledWith('GroupDetail', expect.objectContaining({ groupSlug: 'g1' }));
  });
});

describe('Group chat', () => {
  const open = (slug, params = {}) => render(
    <GroupDetail navigation={nav} route={{ params: { groupSlug: slug, ...params } }} />,
  );

  it('opens on the cached chat before the network answers; the first page replaces it', async () => {
    writeCache(groupChatKey(1, 'c1'), { group: group('c1'), messages: [post(1, 1), post(2, 2), post(3, 3)] });
    let answer;
    mockApi.fetchGroupDetails.mockResolvedValue(group('c1'));
    mockApi.fetchGroupPosts.mockImplementation(() => new Promise((res) => { answer = res; }));
    const r = open('c1');
    expect(r.getByText('post 1')).toBeTruthy();
    expect(r.getByText('post 3')).toBeTruthy();
    // Newest first from the server; 2 was deleted while away.
    await act(async () => { answer({ results: [post(4, 4), post(3, 3), post(1, 1)], next: null }); });
    await waitFor(() => expect(r.getByText('post 4')).toBeTruthy());
    expect(r.queryByText('post 2')).toBeNull();
  });

  it('after the first page, catching up asks only for what is newer', async () => {
    mockApi.fetchGroupDetails.mockResolvedValue(group('c2'));
    mockApi.fetchGroupPosts.mockResolvedValue({ results: [post(11, 11), post(10, 10)], next: null });
    const r = open('c2', { group: group('c2') });
    await waitFor(() => expect(r.getByText('post 11')).toBeTruthy());
    mockApi.fetchGroupPostsAfter.mockResolvedValueOnce({ results: [post(12, 12)], has_more: false });
    const pages = mockApi.fetchGroupPosts.mock.calls.length;
    await act(async () => { mockSocket.handlers.onStatus('open'); });  // back online → catch up
    await waitFor(() => expect(r.getByText('post 12')).toBeTruthy());
    expect(mockApi.fetchGroupPostsAfter).toHaveBeenCalledWith('c2', 11);
    expect(mockApi.fetchGroupPosts.mock.calls.length).toBe(pages);     // no full page again
  });

  it('live messages land; removed-from-group clears the cached chat', async () => {
    mockApi.fetchGroupDetails.mockResolvedValueOnce(group('c3'));
    mockApi.fetchGroupPosts.mockResolvedValue({ results: [post(20, 20)], next: null });
    const r = open('c3', { group: group('c3') });
    await waitFor(() => expect(r.getByText('post 20')).toBeTruthy());
    await act(async () => { mockSocket.handlers.onMessage(post(21, 21)); });
    expect(r.getByText('post 21')).toBeTruthy();
  });

  it('a member no longer sees the old messages once the server says they left', async () => {
    writeCache(groupChatKey(1, 'c4'), { group: group('c4'), messages: [post(30, 30)] });
    mockApi.fetchGroupDetails.mockResolvedValue(group('c4', { is_member: false }));
    mockApi.fetchGroupPosts.mockResolvedValue({ results: [post(30, 30)], next: null });
    const r = open('c4');
    await waitFor(() => expect(r.queryByText('post 30')).toBeNull(), { timeout: 5000 });
  });

  it('delete asks with a web-safe confirm', async () => {
    mockApi.fetchGroupDetails.mockResolvedValue(group('c5'));
    mockApi.fetchGroupPosts.mockResolvedValue({ results: [post(40, 40, { user: { id: 1, username: 'me' } })], next: null });
    const r = open('c5', { group: group('c5') });
    await waitFor(() => expect(r.getByText('post 40')).toBeTruthy());
    await act(async () => { fireEvent(r.getByText('post 40'), 'longPress'); });
    await act(async () => { fireEvent.press(r.getByText('common.delete')); });
    expect(mockConfirm).toHaveBeenCalled();
    expect(mockApi.deleteGroupPost).toHaveBeenCalledWith('c5', 40);
    await waitFor(() => expect(r.queryByText('post 40')).toBeNull());
  });
});

describe('Members', () => {
  const member = (id, extra = {}) => ({ id, user: { id: 100 + id, username: `member${id}` }, is_admin: false, is_moderator: false, ...extra });

  it('pages, searches on the server, and removes in place', async () => {
    mockApi.fetchGroupMembers.mockImplementation(async (_s, { page, q }) => {
      if (q) return { results: [member(7)], next: null, count: 1 };
      return page === 1
        ? { results: [member(1, { is_admin: true }), member(2)], next: 'p2', count: 3 }
        : { results: [member(3)], next: null, count: 3 };
    });
    const r = render(<GroupMembers groupSlug="m1" group={group('m1')} isAdmin onClose={() => {}} />);
    await waitFor(() => expect(r.getByText('member2')).toBeTruthy());
    expect(r.getByText(/^3 /)).toBeTruthy();
    await act(async () => { fireEvent(r.UNSAFE_getByType(require('react-native').FlatList), 'endReached'); });
    await waitFor(() => expect(r.getByText('member3')).toBeTruthy());

    fireEvent.changeText(r.getByTestId('members-search'), 'mem7');
    await waitFor(() => expect(r.getByText('member7')).toBeTruthy());
    expect(mockApi.fetchGroupMembers).toHaveBeenLastCalledWith('m1', { page: 1, q: 'mem7' });
  });
});

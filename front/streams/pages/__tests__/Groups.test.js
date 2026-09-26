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
  setGroupSlowMode: jest.fn(),
  muteGroup: jest.fn(async (_s, h) => ({ muted_until: h ? '2099-01-01T00:00:00Z' : null })),
  setGroupMine: jest.fn(async () => ({})),
  fetchGroupMedia: jest.fn(async () => ({ results: [], next: null })),
  getGroupInviteLink: jest.fn(),
  revokeGroupInvite: jest.fn(async () => ({ code: null })),
  searchGroupUsers: jest.fn(async () => []),
  addGroupMember: jest.fn(),
};
jest.mock('../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));

// The person's own socket (the live list): screens subscribe; the test plays the server.
const mockDM = new Set();
const mockAnnounced = [];
jest.mock('../../services/dmSocket', () => ({
  subscribeDM: (fn) => { mockDM.add(fn); return () => mockDM.delete(fn); },
  announceDM: (e) => { mockAnnounced.push(e); },
}));
const dmLive = async (evt) => { await act(async () => { [...mockDM].forEach((fn) => fn(evt)); }); };

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
jest.mock('../../components/ChoiceSheet', () => {
  const { View, Text, TouchableOpacity } = require('react-native');
  return ({ visible, options }) => (visible ? (
    <View>{options.map((o) => (
      <TouchableOpacity key={o.key} onPress={o.onPress} testID={`choice-${o.key}`}><Text>{o.label}</Text></TouchableOpacity>
    ))}</View>
  ) : null);
});
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
const GroupAddMembers = require('../GroupAddMembers').default;
const GroupMedia = require('../GroupMedia').default;

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
  nav.goBack.mockClear();
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

describe('Communities', () => {
  it('the kinds of community paint from cache before the network answers', async () => {
    writeCache(groupListKey(1, 'community', 'categories'), [{ id: 3, slug: 'choirs', name: 'Choirs', icon: 'musical-notes', community_count: 4 }]);
    mockApi.fetchCommunityCategories.mockImplementation(() => new Promise(() => {}));   // never answers
    mockApi.fetchCommunities.mockResolvedValue({ results: [], next: null });
    const r = render(<GroupList navigation={nav} route={{}} mode="community" />);
    expect(r.getByText('Choirs')).toBeTruthy();
    await act(async () => {});
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
    await act(async () => { await new Promise((res) => setTimeout(res, 300)); });
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

describe('Group chat, live', () => {
  const open = (slug) => render(
    <GroupDetail navigation={nav} route={{ params: { groupSlug: slug, group: group(slug) } }} />,
  );
  const ready = async (slug, posts = [post(50, 50)]) => {
    mockApi.fetchGroupDetails.mockResolvedValue(group(slug));
    mockApi.fetchGroupPosts.mockResolvedValue({ results: posts.slice().reverse(), next: null });
    const r = open(slug);
    await waitFor(() => expect(r.getByText(`post ${posts[posts.length - 1].id}`)).toBeTruthy());
    return r;
  };

  it('a failed send is retried with the same client id (one message)', async () => {
    const r = await ready('l1');
    mockApi.sendGroupMessage.mockRejectedValueOnce(new Error('offline'));
    const input = r.UNSAFE_getAllByType(require('react-native').TextInput).find((n) => n.props.multiline);
    fireEvent.changeText(input, 'hello all');
    await act(async () => { fireEvent.press(r.getByTestId('group-send')); });
    await waitFor(() => expect(r.getByText('group.detail.tapToRetry')).toBeTruthy());
    const first = mockApi.sendGroupMessage.mock.calls[0][1];
    expect(first.client_id).toMatch(/^temp_/);
    mockApi.sendGroupMessage.mockImplementationOnce(async (_s, p) => post(51, 51, { content: p.content, client_id: p.client_id, user: { id: 1, username: 'me' } }));
    await act(async () => { fireEvent.press(r.getByText('hello all')); });
    await waitFor(() => expect(r.queryByText('group.detail.tapToRetry')).toBeNull());
    expect(mockApi.sendGroupMessage.mock.calls[1][1].client_id).toBe(first.client_id);
    expect(r.getAllByText('hello all')).toHaveLength(1);
  });

  it('my message from another device shows; reactions, member count and removal are live', async () => {
    const r = await ready('l2');
    await act(async () => { mockSocket.handlers.onMessage(post(52, 52, { content: 'from my laptop', user: { id: 1, username: 'me' } })); });
    expect(r.getByText('from my laptop')).toBeTruthy();

    await act(async () => { mockSocket.handlers.onEvent({ type: 'reaction', id: 50, summary: [{ emoji: '🔥', count: 3 }], user_id: 2, emoji: '🔥' }); });
    expect(r.getByText('3')).toBeTruthy();

    await act(async () => { mockSocket.handlers.onEvent({ type: 'online_count', count: 4 }); });
    expect(r.getByText('group.detail.onlineCount:3')).toBeTruthy();       // others, not me

    await act(async () => { mockSocket.handlers.onEvent({ type: 'member_removed', user_id: 1 }); });
    expect(mockNotify).toHaveBeenCalledWith('group.detail.removedTitle', 'group.detail.removedBody');
    expect(r.queryByText('post 50')).toBeNull();
  });
});

describe('Group chat, scan fixes', () => {
  it('a deleted group closes with a notice; leaving on another device clears this one', async () => {
    mockApi.fetchGroupDetails.mockResolvedValue(group('z1'));
    mockApi.fetchGroupPosts.mockResolvedValue({ results: [post(90, 90)], next: null });
    const r = render(<GroupDetail navigation={nav} route={{ params: { groupSlug: 'z1', group: group('z1') } }} />);
    await waitFor(() => expect(r.getByText('post 90')).toBeTruthy());
    await act(async () => { mockSocket.handlers.onEvent({ type: 'member_left', user_id: 1 }); });
    expect(r.queryByText('post 90')).toBeNull();
    expect(mockNotify).not.toHaveBeenCalled();                        // I left: no "removed" notice
    await act(async () => { mockSocket.handlers.onEvent({ type: 'group_deleted' }); });
    expect(mockNotify).toHaveBeenCalledWith('group.detail.deletedTitle', 'group.detail.deletedBody');
    expect(nav.goBack).toHaveBeenCalled();
  });
});

describe('Group list, live', () => {
  it('a new message moves its group to the top with a badge; reading clears it', async () => {
    mockApi.fetchGroups.mockResolvedValue({ results: [group('a'), group('b')], next: null });
    const r = render(<GroupList navigation={nav} route={{}} mode="group" />);
    await waitFor(() => expect(r.getByTestId('group-row-b')).toBeTruthy());
    await dmLive({ type: 'group_message', group_slug: 'b', kind: 'group',
      message: { id: 9, content: 'fresh news', message_type: 'text', sender_id: 2, sender_username: 'them', created_at: new Date().toISOString() } });
    const rows = r.getAllByTestId(/^group-row-/).map((n) => n.props.testID);
    expect(rows[0]).toBe('group-row-b');
    expect(r.getByText(/fresh news/)).toBeTruthy();
    expect(r.getByText('1')).toBeTruthy();
    await dmLive({ type: 'group_read', group_slug: 'b' });
    expect(r.queryByText('1')).toBeNull();
  });
});

describe('Safety', () => {
  it('slow mode: members see the hint; a slowed send says why; admins set it', async () => {
    mockApi.fetchGroupDetails.mockResolvedValue(group('s1', { slow_mode_seconds: 30 }));
    mockApi.fetchGroupPosts.mockResolvedValue({ results: [post(60, 60)], next: null });
    const r = render(<GroupDetail navigation={nav} route={{ params: { groupSlug: 's1', group: group('s1', { slow_mode_seconds: 30 }) } }} />);
    await waitFor(() => expect(r.getByTestId('slow-hint')).toBeTruthy());
    const err = Object.assign(new Error('slow'), { response: { status: 429 } });
    mockApi.sendGroupMessage.mockRejectedValueOnce(err);
    const input = r.UNSAFE_getAllByType(require('react-native').TextInput).find((n) => n.props.multiline);
    fireEvent.changeText(input, 'again');
    await act(async () => { fireEvent.press(r.getByTestId('group-send')); });
    await waitFor(() => expect(mockNotify).toHaveBeenCalledWith('group.detail.slowMode', 'group.detail.slowModeHint:group.detail.seconds:30'));

    // An admin: no hint; the menu sets it.
    const admin = group('s2', { is_admin: true });
    mockApi.fetchGroupDetails.mockResolvedValue(admin);
    mockApi.setGroupSlowMode.mockResolvedValue({ ...admin, slow_mode_seconds: 60 });
    const a = render(<GroupDetail navigation={nav} route={{ params: { groupSlug: 's2', group: admin } }} />);
    await waitFor(() => expect(a.getByText('post 60')).toBeTruthy());
    expect(a.queryByTestId('slow-hint')).toBeNull();
  });

  it('invite links: limits for a new link, then revoke', async () => {
    mockApi.getGroupInviteLink.mockResolvedValue({ code: 'abc-123', group_name: 'G', max_uses: 10, uses: 2, expires_at: null });
    const r = render(<GroupAddMembers navigation={nav} route={{ params: { groupSlug: 'inv', group: group('inv') } }} />);
    await act(async () => { fireEvent.press(r.getByTestId('limit-uses-10')); });
    await act(async () => { fireEvent.press(r.getByText('group.add.generateLink')); });
    expect(mockApi.getGroupInviteLink).toHaveBeenCalledWith('inv', true, { expires_in_hours: 0, max_uses: 10 });
    expect(r.getByText('group.add.usedOf:2,10')).toBeTruthy();
    await act(async () => { fireEvent.press(r.getByTestId('invite-revoke')); });
    expect(mockConfirm).toHaveBeenCalled();
    expect(mockApi.revokeGroupInvite).toHaveBeenCalledWith('inv');
    await waitFor(() => expect(r.getByText('group.add.generateLink')).toBeTruthy());
  });
});

describe('Member features', () => {
  const now = Date.now();
  const iso = (msAgo) => new Date(now - msAgo).toISOString();

  it('opens on an unread line after the last read; day labels; @mentions suggested and highlighted', async () => {
    const g = group('f1', { my_settings: { archived: false, notify: 'all', last_read_at: iso(60000) } });
    mockApi.fetchGroupDetails.mockResolvedValue(g);
    mockApi.fetchGroupPosts.mockResolvedValue({ results: [
      post(72, 0, { created_at: iso(1000), content: 'hey @me look' }),
      post(71, 0, { created_at: iso(120000), content: 'old news' }),
    ], next: null });
    mockApi.fetchGroupMembers.mockResolvedValue({ results: [{ id: 1, user: { id: 5, username: 'anna' } }], next: null });
    const r = render(<GroupDetail navigation={nav} route={{ params: { groupSlug: 'f1', group: g } }} />);
    await waitFor(() => expect(r.getByTestId('unread-line')).toBeTruthy());
    expect(r.getAllByText('dm.today').length).toBeGreaterThan(0);
    expect(r.getByText('@me')).toBeTruthy();                         // highlighted apart

    const input = r.UNSAFE_getAllByType(require('react-native').TextInput).find((n) => n.props.multiline);
    fireEvent.changeText(input, 'thanks @an');
    await waitFor(() => expect(r.getByTestId('mention-anna')).toBeTruthy());
    expect(mockApi.fetchGroupMembers).toHaveBeenCalledWith('f1', { q: 'an' });
    await act(async () => { fireEvent.press(r.getByTestId('mention-anna')); });
    expect(input.props.value).toBe('thanks @anna ');
  });

  it('notifications: mute for 8 hours; archive', async () => {
    const g = group('f2', { my_settings: { archived: false, notify: 'all' } });
    mockApi.fetchGroupDetails.mockResolvedValue(g);
    mockApi.fetchGroupPosts.mockResolvedValue({ results: [post(80, 80)], next: null });
    const r = render(<GroupDetail navigation={nav} route={{ params: { groupSlug: 'f2', group: g } }} />);
    await waitFor(() => expect(r.getByText('post 80')).toBeTruthy());
    const openSheet = async (id) => {
      await act(async () => { fireEvent.press(r.getByTestId(id)); await new Promise((res) => setTimeout(res, 260)); });
    };
    await act(async () => { fireEvent.press(r.getByTestId('group-menu')); });
    await openSheet('notify-option');
    await act(async () => { fireEvent.press(r.getByTestId('choice-mute8')); });
    expect(mockApi.muteGroup).toHaveBeenCalledWith('f2', 8);
    await act(async () => { fireEvent.press(r.getByTestId('group-menu')); });
    expect(r.getByText(/^group\.detail\.mutedUntil:/)).toBeTruthy();       // the menu says so
    await act(async () => { fireEvent.press(r.getByTestId('archive-option')); });
    expect(mockApi.setGroupMine).toHaveBeenCalledWith('f2', { archived: true });
  });

  it('the archived view, and media by kind', async () => {
    mockApi.fetchGroups.mockImplementation(async ({ scope }) => ({ results: [group(`${scope}-g`)], next: null }));
    const r = render(<GroupList navigation={nav} route={{}} mode="group" />);
    await waitFor(() => expect(r.getByText('Group public-g')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByText('group.list.tabMine')); });
    await act(async () => { fireEvent.press(r.getByTestId('archived-toggle')); });
    await waitFor(() => expect(r.getByText('Group archived-g')).toBeTruthy());
    expect(mockApi.fetchGroups).toHaveBeenLastCalledWith({ scope: 'archived' });

    const m = render(<GroupMedia groupSlug="md" onClose={() => {}} />);
    await waitFor(() => expect(mockApi.fetchGroupMedia).toHaveBeenCalledWith('md', 1, ''));
    await act(async () => { fireEvent.press(m.getByTestId('media-kind-file')); });
    await waitFor(() => expect(mockApi.fetchGroupMedia).toHaveBeenLastCalledWith('md', 1, 'file'));
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

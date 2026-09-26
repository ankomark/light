/**
 * Messages, live: the inbox (folders, search, a new message bubbling up, the
 * online dot, typing in the row, long-press to mute) and a chat (live
 * messages and typing, a failed send kept for "Tap to retry" with the same
 * client id, reply / react / edit / delete, the request banner, presence).
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.setTimeout(20000);

const mockApi = {
  fetchConversations: jest.fn(),
  fetchConversationsByUrl: jest.fn(),
  fetchUnreadMessageCount: jest.fn(async () => ({ unread_count: 0, requests: 2 })),
  setConversationState: jest.fn(async () => ({})),
  fetchMessages: jest.fn(),
  fetchOlderMessages: jest.fn(async () => []),
  sendMessage: jest.fn(),
  markConversationRead: jest.fn(async () => ({})),
  editMessage: jest.fn(),
  deleteMessage: jest.fn(async () => ({})),
  reactToMessage: jest.fn(),
  fetchPresence: jest.fn(async () => ({ online: false, last_seen: null })),
  searchMessages: jest.fn(async () => []),
  blockUser: jest.fn(async () => ({})),
};
jest.mock('../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));

// The DM socket: screens subscribe; the test plays the server.
const mockListeners = new Set();
const mockTyping = [];
const mockAnnounced = [];
jest.mock('../../services/dmSocket', () => ({
  subscribeDM: (fn) => { mockListeners.add(fn); return () => mockListeners.delete(fn); },
  isDMOpen: () => false,
  sendDMTyping: (...a) => { mockTyping.push(a); return true; },
  announceDM: (e) => { mockAnnounced.push(e); },
}));
const live = async (evt) => { await act(async () => { [...mockListeners].forEach((fn) => fn(evt)); }); };

jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true, currentUser: { id: 1, username: 'me' } }) }));
jest.mock('../../context/I18nContext', () => ({
  useI18n: () => ({ t: (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k) }),
}));
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
jest.mock('../ChoiceSheet', () => {
  const { View, Text, TouchableOpacity } = require('react-native');
  return ({ visible, options }) => (visible ? (
    <View>{options.map((o) => (
      <TouchableOpacity key={o.key} onPress={o.onPress} testID={`choice-${o.key}`}><Text>{o.label}</Text></TouchableOpacity>
    ))}</View>
  ) : null);
});
jest.mock('../ReportModal', () => {
  const { Text } = require('react-native');
  return ({ visible, objectId, contentType }) => (visible ? <Text>{`report:${contentType}:${objectId}`}</Text> : null);
});
jest.mock('../RotatingBackground', () => () => null);
jest.mock('../SkeletonLoader', () => ({ PersonListSkeleton: () => null }));
jest.mock('../../hooks/useKeyboardHeight', () => () => 0);
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-document-picker', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('expo-sharing', () => ({}));
jest.mock('../../services/audioPlayer', () => ({}));
jest.mock('../../services/imageProcessing', () => ({}));
jest.mock('../../services/cloudinary', () => ({}));

const InboxScreen = require('../InboxScreen').default;
const ChatScreen = require('../ChatScreen').default;

const nav = { navigate: jest.fn(), goBack: jest.fn() };
const now = () => new Date().toISOString();
const conv = (id, extra = {}) => ({
  id, other_participant: { id: 100 + id, username: `user${id}` }, unread_count: 0, updated_at: now(),
  last_message: { id: id * 10, content: `hello ${id}`, message_type: 'text', sender_id: 100 + id, created_at: now() },
  online: false, muted: false, is_request: false, ...extra,
});
const msg = (id, extra = {}) => ({
  id, sender: { id: 2, username: 'them' }, content: `m${id}`, message_type: 'text', read: false,
  created_at: now(), reactions: [], ...extra,
});

let convSeq = 500;
beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockClear());
  mockListeners.clear();
  mockTyping.length = 0;
  mockAnnounced.length = 0;
  mockConfirm.mockClear();
  mockNotify.mockClear();
  nav.navigate.mockClear();
  nav.goBack.mockClear();
});

describe('Inbox', () => {
  const setup = async () => {
    mockApi.fetchConversations.mockImplementation(async ({ folder, q } = {}) => {
      if (q) return { results: [conv(3)], next: null };
      if (folder === 'requests') return { results: [conv(9, { is_request: true })], next: null };
      return { results: [conv(1), conv(2)], next: null };
    });
    const r = render(<InboxScreen navigation={nav} />);
    await waitFor(() => expect(r.getByText('hello 1')).toBeTruthy());
    return r;
  };

  it('shows the requests count, and each folder its own chats', async () => {
    const r = await setup();
    await waitFor(() => expect(r.getByText('2')).toBeTruthy());   // requests waiting
    await act(async () => { fireEvent.press(r.getByTestId('folder-requests')); });
    await waitFor(() => expect(r.getByText('hello 9')).toBeTruthy());
    expect(mockApi.fetchConversations).toHaveBeenLastCalledWith({ folder: 'requests', q: '' });
    expect(r.getByText('dm.requestsNote')).toBeTruthy();
  });

  it('searches after a pause', async () => {
    const r = await setup();
    fireEvent.changeText(r.getByTestId('inbox-search'), 'user3');
    await waitFor(() => expect(r.getByText('hello 3')).toBeTruthy());
    expect(mockApi.fetchConversations).toHaveBeenLastCalledWith({ folder: 'primary', q: 'user3' });
  });

  it('a live message moves its chat to the top with a badge; typing and the online dot follow', async () => {
    const r = await setup();
    await live({ type: 'message', conversation_id: 2, message: msg(99, { sender: { id: 102 }, content: 'new one' }) });
    expect(r.getByText('new one')).toBeTruthy();
    const rows = r.getAllByTestId(/^chat-row-/).map((n) => n.props.testID);
    expect(rows[0]).toBe('chat-row-2');
    expect(r.getByText('1')).toBeTruthy();

    await live({ type: 'typing', conversation_id: 1, user_id: 101, is_typing: true });
    expect(r.getByText('dm.typing')).toBeTruthy();
    await live({ type: 'presence', user_id: 101, online: true });
    expect(r.getByTestId('online-1')).toBeTruthy();
    expect(r.queryByTestId('online-2')).toBeNull();
  });

  it('long-press: mute (optimistic) and archive (leaves the list)', async () => {
    const r = await setup();
    await act(async () => { fireEvent(r.getByTestId('chat-row-1'), 'longPress'); });
    await act(async () => { fireEvent.press(r.getByTestId('choice-mute')); });
    expect(mockApi.setConversationState).toHaveBeenCalledWith(1, { muted: true });
    await act(async () => { fireEvent(r.getByTestId('chat-row-1'), 'longPress'); });
    await act(async () => { fireEvent.press(r.getByTestId('choice-archive')); });
    expect(mockApi.setConversationState).toHaveBeenCalledWith(1, { archived: true });
    expect(r.queryByTestId('chat-row-1')).toBeNull();
  });

  it('opening a chat passes its request state along', async () => {
    const r = await setup();
    await act(async () => { fireEvent.press(r.getByTestId('chat-row-1')); });
    expect(nav.navigate).toHaveBeenCalledWith('Chat', expect.objectContaining({ conversationId: 1, isRequest: false }));
  });
});

describe('Chat', () => {
  const open = async (params = {}, messages = [msg(1), msg(2, { sender: { id: 1 } })]) => {
    const id = ++convSeq;
    mockApi.fetchMessages.mockImplementation(async (_c, after) => (after ? { messages: [], read_ids: [] } : messages));
    const r = render(<ChatScreen navigation={nav}
      route={{ params: { conversationId: id, otherUser: { id: 2, username: 'them' }, ...params } }} />);
    await waitFor(() => expect(r.getByText('m1')).toBeTruthy());
    return { r, id };
  };

  it('live: a message arrives and is read; typing shows; presence in the header', async () => {
    const { r, id } = await open();
    expect(mockApi.markConversationRead).toHaveBeenCalledWith(id);
    await live({ type: 'typing', conversation_id: id, user_id: 2, is_typing: true });
    expect(r.getByTestId('typing-bubble')).toBeTruthy();
    expect(r.getByTestId('chat-presence').props.children).toBe('dm.typing');

    await live({ type: 'message', conversation_id: id, message: msg(3, { content: 'live!' }) });
    expect(r.getByText('live!')).toBeTruthy();
    expect(r.queryByTestId('typing-bubble')).toBeNull();

    await live({ type: 'presence', user_id: 2, online: true });
    expect(r.getByTestId('chat-presence').props.children).toBe('dm.online');

    // Another chat's events are not this one's.
    await live({ type: 'message', conversation_id: id + 1000, message: msg(4, { content: 'elsewhere' }) });
    expect(r.queryByText('elsewhere')).toBeNull();
  });

  it('typing goes out while writing', async () => {
    const { r, id } = await open();
    fireEvent.changeText(r.getByTestId('chat-input'), 'hel');
    expect(mockTyping).toEqual([[id, true]]);
  });

  it('a failed send stays with Tap to retry, and the retry keeps its client id', async () => {
    const { r, id } = await open();
    mockApi.sendMessage.mockRejectedValueOnce(new Error('offline'));
    fireEvent.changeText(r.getByTestId('chat-input'), 'hello there');
    await act(async () => { fireEvent.press(r.getByTestId('chat-send')); });
    await waitFor(() => expect(r.getByText('dm.tapToRetry')).toBeTruthy());
    const first = mockApi.sendMessage.mock.calls[0][1];
    expect(first).toMatchObject({ content: 'hello there', client_id: expect.stringMatching(/^temp_/) });

    mockApi.sendMessage.mockImplementationOnce(async (_c, p) => msg(50, { sender: { id: 1 }, content: p.content, client_id: p.client_id }));
    await act(async () => { fireEvent.press(r.getByText('hello there')); });
    await waitFor(() => expect(r.queryByText('dm.tapToRetry')).toBeNull());
    expect(mockApi.sendMessage.mock.calls[1]).toEqual([id, first]);
    expect(r.getAllByText('hello there')).toHaveLength(1);

    // The socket's echo of the same message doesn't double it.
    await live({ type: 'message', conversation_id: id, message: msg(50, { sender: { id: 1 }, content: 'hello there' }) });
    expect(r.getAllByText('hello there')).toHaveLength(1);
  });

  it('long-press: react, reply', async () => {
    const { r, id } = await open();
    mockApi.reactToMessage.mockResolvedValueOnce({ message_id: 1, reactions: [{ emoji: '❤️', count: 1, mine: true }] });
    await act(async () => { fireEvent(r.getByTestId('msg-1'), 'longPress'); });
    await act(async () => { fireEvent.press(r.getByTestId('react-❤️')); });
    expect(mockApi.reactToMessage).toHaveBeenCalledWith(id, 1, '❤️');
    expect(r.getByTestId('reaction-1-❤️')).toBeTruthy();

    await act(async () => { fireEvent(r.getByTestId('msg-1'), 'longPress'); });
    await act(async () => { fireEvent.press(r.getByTestId('action-reply')); await new Promise((res) => setTimeout(res, 250)); });
    expect(r.getByTestId('composer-context')).toBeTruthy();
    mockApi.sendMessage.mockImplementationOnce(async (_c, p) => msg(60, { sender: { id: 1 }, content: p.content, reply_to: { id: 1, content: 'm1', sender_id: 2 } }));
    fireEvent.changeText(r.getByTestId('chat-input'), 'answer');
    await act(async () => { fireEvent.press(r.getByTestId('chat-send')); });
    expect(mockApi.sendMessage.mock.calls.at(-1)[1]).toMatchObject({ content: 'answer', reply_to: 1 });
    expect(r.queryByTestId('composer-context')).toBeNull();
  });

  it('edit my message; delete it for everyone', async () => {
    const { r, id } = await open();
    mockApi.editMessage.mockImplementationOnce(async (_c, mid, content) => msg(mid, { sender: { id: 1 }, content, edited_at: now() }));
    await act(async () => { fireEvent(r.getByTestId('msg-2'), 'longPress'); });
    await act(async () => { fireEvent.press(r.getByTestId('action-edit')); await new Promise((res) => setTimeout(res, 250)); });
    fireEvent.changeText(r.getByTestId('chat-input'), 'm2 fixed');
    await act(async () => { fireEvent.press(r.getByTestId('chat-send')); });
    expect(mockApi.editMessage).toHaveBeenCalledWith(id, 2, 'm2 fixed');
    expect(r.getByText('m2 fixed')).toBeTruthy();

    await act(async () => { fireEvent(r.getByTestId('msg-2'), 'longPress'); });
    await act(async () => { fireEvent.press(r.getByTestId('action-delall')); await new Promise((res) => setTimeout(res, 250)); });
    expect(mockApi.deleteMessage).toHaveBeenCalledWith(id, 2, 'everyone');
    expect(r.getByText('dm.youDeleted')).toBeTruthy();
  });

  it("someone else's message: no edit, but report", async () => {
    const { r } = await open();
    await act(async () => { fireEvent(r.getByTestId('msg-1'), 'longPress'); });
    expect(r.queryByTestId('action-edit')).toBeNull();
    await act(async () => { fireEvent.press(r.getByTestId('action-report')); await new Promise((res) => setTimeout(res, 250)); });
    expect(r.getByText('report:message:1')).toBeTruthy();
  });

  it('live edits, deletions and read receipts', async () => {
    const { r, id } = await open();
    await live({ type: 'edited', conversation_id: id, message: { id: 1, content: 'm1 edited', edited_at: now() } });
    expect(r.getByText('m1 edited')).toBeTruthy();
    await live({ type: 'deleted', conversation_id: id, id: 1 });
    expect(r.getByText('dm.deleted')).toBeTruthy();
    await live({ type: 'read', conversation_id: id, reader_id: 2 });
    expect(r.getByText(/✓✓/)).toBeTruthy();
  });

  it('a request: not marked read until accepted', async () => {
    const { r, id } = await open({ isRequest: true });
    expect(r.getByTestId('request-banner')).toBeTruthy();
    expect(mockApi.markConversationRead).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(r.getByTestId('request-accept')); });
    expect(mockApi.setConversationState).toHaveBeenCalledWith(id, { accepted: true });
    expect(r.queryByTestId('request-banner')).toBeNull();
    expect(mockApi.markConversationRead).toHaveBeenCalledWith(id);
  });

  it('the menu: mute, and block leaves the chat', async () => {
    const { r, id } = await open();
    await act(async () => { fireEvent.press(r.getByTestId('chat-menu')); });
    await act(async () => { fireEvent.press(r.getByTestId('choice-mute')); });
    expect(mockApi.setConversationState).toHaveBeenCalledWith(id, { muted: true });
    await act(async () => { fireEvent.press(r.getByTestId('chat-menu')); });
    await act(async () => { fireEvent.press(r.getByTestId('choice-block')); });
    expect(mockApi.blockUser).toHaveBeenCalledWith(2);
    expect(nav.goBack).toHaveBeenCalled();
  });

  it('search in the chat', async () => {
    const { r, id } = await open();
    mockApi.searchMessages.mockResolvedValueOnce([msg(1, { content: 'm1 found' })]);
    await act(async () => { fireEvent.press(r.getByTestId('chat-menu')); });
    await act(async () => { fireEvent.press(r.getByTestId('choice-search')); });
    fireEvent.changeText(r.getByTestId('chat-search'), 'found');
    await waitFor(() => expect(r.getByTestId('search-hit-1')).toBeTruthy());
    expect(mockApi.searchMessages).toHaveBeenCalledWith(id, 'found');
  });
});

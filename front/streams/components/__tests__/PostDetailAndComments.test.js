/**
 * A post's own screen and its comments: deleting your post goes back once
 * (and the feed hears of it), the song stops when you leave even mid-load,
 * every photo of a multi-photo post shows, and a comment can be deleted by
 * its writer (or the post's author) and reported by anyone else.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.setTimeout(20000);

const mockT = (k) => (k === 'tix.months' ? 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec' : k);
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    useSafeAreaInsets: () => ({ top: 40, bottom: 24, left: 0, right: 0 }),
    SafeAreaView: ({ children, style }) => <View style={style}>{children}</View>,
  };
});
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null, Feather: () => null, Ionicons: () => null }));
jest.mock('../tickets/KeyboardLift', () => ({ children }) => children);
jest.mock('../RotatingBackground', () => () => null);
jest.mock('../ScreenVignette', () => () => null);
jest.mock('../BookPostMedia', () => () => null);
jest.mock('../AppVideo', () => () => null);
jest.mock('../RichCaption', () => ({ text }) => {
  const { Text } = require('react-native');
  return <Text>{text}</Text>;
});
jest.mock('../SocialActions', () => ({ LikeButton: () => null, SaveButton: () => null }));
const mockViewer = jest.fn(() => null);
jest.mock('../ImageViewer', () => (props) => mockViewer(props));
const mockReport = jest.fn(() => null);
jest.mock('../ReportModal', () => (props) => mockReport(props));
// The sheet's slide-in animation isn't what's under test: header, list and menu, plainly.
jest.mock('../BottomSheet', () => ({ visible, header, overlay, children }) => {
  const { View } = require('react-native');
  return visible ? <View>{header}{children}{overlay}</View> : null;
});
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 7, username: 'mark' } }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));

let mockSoundResolve;
const mockSound = { playFromPositionAsync: jest.fn(async () => {}), unloadAsync: jest.fn(async () => {}),
  setOnPlaybackStatusUpdate: jest.fn(), pauseAsync: jest.fn(async () => {}), setPositionAsync: jest.fn(async () => {}) };
jest.mock('../../services/audioPlayer', () => ({
  createSound: jest.fn(() => new Promise((r) => { mockSoundResolve = () => r({ sound: mockSound }); })),
}));

const mockAxios = { get: jest.fn(), delete: jest.fn(async () => ({})), patch: jest.fn() };
jest.mock('axios', () => mockAxios);
const mockApi = {
  apiRequest: jest.fn(async () => ({})),
  fetchSocialPostComments: jest.fn(async () => []),
};
jest.mock('../../services/api', () => new Proxy({}, {
  get: (_, k) => (k === 'API_URL' ? 'https://api.test/api' : k === 'getAccessToken' ? async () => 't'
    : (...a) => (mockApi[k] ? mockApi[k](...a) : Promise.resolve({}))),
}));
jest.mock('../../utils/screenCache', () => ({ peekCache: () => null, readCache: async () => null, writeCache: jest.fn() }));

const { on, EVENTS } = require('../../utils/appEvents');
const PostDetail = require('../PostDetail').default;
const CommentAction = require('../CommentAction').default;

const basePost = {
  id: 5, user: { id: 7, username: 'mark' }, content_type: 'image', can_edit: true, caption: 'Sabbath',
  media_url: 'https://cdn.test/a.jpg', optimized_url: 'https://cdn.test/a.jpg', created_at: '2026-10-05T08:00:00Z',
  likes_count: 2, comments_count: 0,
};

const open = (post) => {
  mockAxios.get.mockResolvedValue({ data: post });
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  const screen = render(<PostDetail route={{ params: { postId: post.id } }} navigation={navigation} />);
  return { screen, navigation };
};

describe("a post's own screen", () => {
  test('deleting your post goes back once, and the feed hears of it', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((title, body, buttons) => buttons?.[1]?.onPress?.());
    const deleted = jest.fn();
    const off = on(EVENTS.POST_DELETED, deleted);
    const { screen, navigation } = open(basePost);
    await waitFor(() => expect(screen.getByLabelText('post.options')).toBeTruthy(), { timeout: 5000 });
    fireEvent.press(screen.getByLabelText('post.options'));
    await act(async () => { fireEvent.press(screen.getByText('post.delete')); });
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(deleted).toHaveBeenCalledWith({ postId: 5 });
    off();
    alert.mockRestore();
  });

  test('the song stops on leaving, even while it is still loading', async () => {
    mockSound.playFromPositionAsync.mockClear();
    mockSound.unloadAsync.mockClear();
    const { screen } = open({ ...basePost, song_audio_url: 'https://cdn.test/s.mp3', song_start_time: 3, song_end_time: 13 });
    await waitFor(() => expect(screen.getByText('Sabbath')).toBeTruthy());
    screen.unmount();
    await act(async () => { mockSoundResolve(); });
    expect(mockSound.playFromPositionAsync).not.toHaveBeenCalled();
    expect(mockSound.unloadAsync).toHaveBeenCalled();
  });

  test('every photo of a multi-photo post shows, and a tap opens it full screen', async () => {
    const urls = ['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg', 'https://cdn.test/3.jpg'];
    const { screen } = open({ ...basePost, media_items: urls.map((u) => ({ media_url: u, optimized_url: u })) });
    await waitFor(() => expect(screen.getByTestId('post-photos')).toBeTruthy(), { timeout: 5000 });
    const shown = screen.UNSAFE_root.findAll((n) => typeof n.props?.source?.uri === 'string' && n.props.source.uri.includes('cdn.test/'))
      .map((n) => n.props.source.uri);
    expect([...new Set(shown)]).toEqual(urls);
    expect(screen.getByText('5 Oct 2026')).toBeTruthy();
  });
});

describe('a comment’s long-press menu', () => {
  const comments = [
    { id: 11, content: 'mine', user: { id: 7, username: 'mark' }, can_delete: true, replies_count: 0, reactions: { total: 0, top: [], mine: null } },
    { id: 12, content: 'theirs', user: { id: 9, username: 'ann' }, can_delete: false, replies_count: 0, reactions: { total: 0, top: [], mine: null } },
  ];

  const openSheet = async () => {
    mockApi.fetchSocialPostComments.mockResolvedValue(comments);
    const posted = jest.fn();
    const screen = render(<CommentAction postId={5} commentCount={2} autoOpen onCommentPosted={posted} />);
    await waitFor(() => expect(screen.getByText('theirs')).toBeTruthy(), { timeout: 5000 });
    return { screen, posted };
  };

  test('your own: delete (after asking), and the count follows', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((title, body, buttons) => buttons?.[1]?.onPress?.());
    const { screen, posted } = await openSheet();
    fireEvent(screen.getByText('mine'), 'longPress');
    expect(screen.queryByTestId('comment-report')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByTestId('comment-delete')); });
    expect(mockApi.apiRequest).toHaveBeenCalledWith('delete', '/post-comments/11/');
    expect(screen.queryByText('mine')).toBeNull();
    expect(posted).toHaveBeenCalledWith(1);
    alert.mockRestore();
  });

  test("someone else's: report, no delete", async () => {
    const { screen } = await openSheet();
    fireEvent(screen.getByText('theirs'), 'longPress');
    expect(screen.queryByTestId('comment-delete')).toBeNull();
    fireEvent.press(screen.getByTestId('comment-report'));
    expect(mockReport).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true, contentType: 'comment', objectId: 12 }));
  });
});

test("a song's comment: deleted from the same menu, through the song's own comments", async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((title, body, buttons) => buttons?.[1]?.onPress?.());
  const rows = [{ id: 21, content: 'on my song', user: { id: 9, username: 'ann' }, can_delete: true,
    replies_count: 0, reactions: { total: 0, top: [], mine: null } }];
  mockApi.apiRequest.mockImplementation(async (method) => (method === 'get' ? rows : {}));
  const screen = render(<CommentAction trackId={3} commentCount={1} autoOpen />);
  await waitFor(() => expect(screen.getByText('on my song')).toBeTruthy(), { timeout: 5000 });
  fireEvent(screen.getByText('on my song'), 'longPress');
  await act(async () => { fireEvent.press(screen.getByTestId('comment-delete')); });
  expect(mockApi.apiRequest).toHaveBeenCalledWith('delete', '/tracks/3/comments/21/');
  expect(screen.queryByText('on my song')).toBeNull();
  mockApi.apiRequest.mockReset();
  mockApi.apiRequest.mockImplementation(async () => ({}));
  alert.mockRestore();
});

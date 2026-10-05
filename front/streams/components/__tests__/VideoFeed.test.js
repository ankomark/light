/**
 * The Videos page: For You is the ranked feed (videos only), it opens on the
 * copy kept from last time, a failed refresh keeps what is on screen, an old
 * answer for a tab left meanwhile is dropped, watch time is reported, and the
 * right-hand column is the bold rail.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { writeCache, dropCache, userKey } from '../../utils/screenCache';

jest.setTimeout(20000);

const mockApi = {
  fetchSocialPosts: jest.fn(),
  fetchFeedByUrl: jest.fn(),
  followUser: jest.fn(),
  likePost: jest.fn(async () => ({})),
  markPostsViewed: jest.fn(async () => ({})),
  logWatchEvents: jest.fn(async () => ({})),
  savePost: jest.fn(async () => ({})),
  markNotInterested: jest.fn(async () => ({})),
};
jest.mock('../../services/api', () => new Proxy({}, {
  get: (_, k) => (k in mockApi ? (...a) => mockApi[k](...a) : (k === 'PUBLIC_BASE' ? 'https://x' : jest.fn())),
}));
jest.mock('../../services/audioPlayer', () => ({ setAudioModeAsync: jest.fn(async () => {}) }));
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 7, username: 'mark' } }) }));
const mockPlayer = { pause: jest.fn() };
jest.mock('../../context/PlayerContext', () => ({ usePlayer: () => mockPlayer }));
jest.mock('../../context/PreferencesContext', () => ({ usePreferences: () => ({ preferences: { autoplayVideo: true } }) }));
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
const mockNav = { navigate: jest.fn(), goBack: jest.fn(), addListener: () => () => {} };
// Each focus effect's cleanup, as leaving the screen would run them.
const mockBlurs = new Map();
const mockBlur = () => mockBlurs.forEach((fn) => fn?.());
jest.mock('@react-navigation/native', () => {
  const ReactLib = require('react');
  return {
    useNavigation: () => mockNav,
    useFocusEffect: (cb) => ReactLib.useEffect(() => {
      const cleanup = cb();
      mockBlurs.set(cb, cleanup);
      return () => { mockBlurs.delete(cb); cleanup?.(); };
    }, [cb]),
  };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../AppVideo', () => {
  const { View } = require('react-native');
  return require('react').forwardRef((props, ref) => <View testID="app-video" {...props} ref={ref} />);
});
jest.mock('../VideoModeToggle', () => () => null);
jest.mock('../CommentAction', () => {
  const { Text } = require('react-native');
  return ({ triggerVariant, commentCount }) => <Text testID={`comment-${triggerVariant}`}>{commentCount}</Text>;
});

const VideoFeed = require('../VideoFeed').default;

const video = (id, extra = {}) => ({
  id, content_type: 'video', media_url: `https://cdn/${id}.mp4`, caption: `clip ${id}`,
  likes_count: 1200, comments_count: 3, view_count: 50, user: { id: 2, username: 'maker' }, ...extra,
});

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockClear());
  dropCache(userKey(7, 'videos:foryou'));
  dropCache(userKey(7, 'videos:following'));
});

test('For You asks for the ranked videos; the rail is bold and labelled', async () => {
  mockApi.fetchSocialPosts.mockResolvedValue({ results: [video(1), video(2)], next: 'https://api/social-posts/?page=2&rank=1&content_type=video' });
  const screen = render(<VideoFeed />);
  await waitFor(() => expect(screen.getByTestId('video-1')).toBeTruthy());
  expect(mockApi.fetchSocialPosts).toHaveBeenCalledWith(null, null, '', { contentType: 'video', fresh: true, rank: true });
  // Counts compact, under big filled icons.
  expect(screen.getAllByTestId('rail-like')[0]).toHaveTextContent(/1\.2K/);
  expect(screen.getAllByTestId('comment-rail')[0]).toBeTruthy();
  expect(screen.getAllByTestId('rail-share')[0]).toHaveTextContent(/video.share/);
  expect(screen.getAllByText('video.more').length).toBeGreaterThan(0);
  // More comes from the server's own next link (ranked pages are numbered).
  mockApi.fetchFeedByUrl.mockResolvedValue({ results: [video(3)], next: null });
  await act(async () => { fireEvent(screen.getByTestId('video-list'), 'endReached'); });
  expect(mockApi.fetchFeedByUrl).toHaveBeenCalledWith('https://api/social-posts/?page=2&rank=1&content_type=video');
});

test('opens on the kept copy, and a failed refresh keeps it on screen', async () => {
  writeCache(userKey(7, 'videos:foryou'), { results: [video(9)], next: null });
  mockApi.fetchSocialPosts.mockRejectedValue(new Error('Network Error'));
  const screen = render(<VideoFeed />);
  expect(screen.getByTestId('video-9')).toBeTruthy();
  await waitFor(() => expect(screen.getByTestId('video-offline')).toBeTruthy());
  expect(screen.getByTestId('video-9')).toBeTruthy();
  expect(screen.queryByTestId('video-error')).toBeNull();
});

test('an answer for a tab left meanwhile is dropped', async () => {
  let answerForYou;
  mockApi.fetchSocialPosts
    .mockImplementationOnce(() => new Promise((r) => { answerForYou = r; }))
    .mockResolvedValueOnce({ results: [video(20)], next: null });
  const screen = render(<VideoFeed />);
  await act(async () => { fireEvent.press(screen.getByTestId('video-tab-following')); });
  await waitFor(() => expect(screen.getByTestId('video-20')).toBeTruthy());
  await act(async () => { answerForYou({ results: [video(1)], next: null }); });
  expect(screen.queryByTestId('video-1')).toBeNull();
  expect(screen.getByTestId('video-20')).toBeTruthy();
  expect(mockApi.fetchSocialPosts).toHaveBeenLastCalledWith(null, 'following', '', { contentType: 'video', fresh: true, rank: false });
});

test('leaving the page reports how long the clip was watched', async () => {
  mockApi.fetchSocialPosts.mockResolvedValue({ results: [video(1)], next: null });
  const screen = render(<VideoFeed />);
  await waitFor(() => expect(screen.getByTestId('video-1')).toBeTruthy());
  await act(async () => { mockBlur(); });
  expect(mockApi.logWatchEvents).toHaveBeenCalledWith([expect.objectContaining({ post_id: 1 })]);
});

test('a clip that will not play says so and can be tried again', async () => {
  mockApi.fetchSocialPosts.mockResolvedValue({ results: [video(1)], next: null });
  const screen = render(<VideoFeed />);
  await waitFor(() => expect(screen.getByTestId('app-video')).toBeTruthy());
  await act(async () => { screen.getByTestId('app-video').props.onError(new Error('404')); });
  expect(screen.getByTestId('video-failed-1')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByText('feed.retry')); });
  expect(screen.getByTestId('app-video')).toBeTruthy();
});

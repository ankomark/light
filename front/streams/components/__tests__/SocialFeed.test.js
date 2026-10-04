/**
 * The Home feed under a bad network and fast fingers: a failed load is a
 * banner (never a popup) over what's on screen, an older response never
 * replaces a newer one, a post sent twice shows once, and page 2 is fetched
 * before anyone scrolls to it.
 */
import React from 'react';
import { Alert, FlatList } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';

jest.setTimeout(20000);

const mockApi = {
  fetchSocialPosts: jest.fn(), fetchFeedByUrl: jest.fn(async () => ({ results: [], next: null })),
  logWatchEvents: jest.fn(async () => {}), markPostsViewed: jest.fn(async () => {}),
  fetchLatestPostId: jest.fn(async () => ({})), likePost: jest.fn(),
};
jest.mock('../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => (mockApi[k] ? mockApi[k](...a) : Promise.resolve({})) }));
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 7 }, isAuthenticated: true }) }));
jest.mock('../../context/PlayerContext', () => ({ usePlayer: () => ({ pause: jest.fn(), currentTrack: null }) }));
jest.mock('../../context/PreferencesContext', () => ({ usePreferences: () => ({ preferences: {} }) }));
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k) }) }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), push: jest.fn() }),
  useFocusEffect: (fn) => require('react').useEffect(fn, [fn]),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }) }));
jest.mock('../../utils/screenCache', () => ({
  peekCache: () => null, readCache: async () => null, writeCache: jest.fn(), userKey: (u, n) => `u${u}:${n}`,
}));
const mockOnline = { value: true };
jest.mock('../../hooks/useOnline', () => ({ __esModule: true, default: () => mockOnline.value }));
// The card's many parts are not what's under test here.
const Null = () => null;
['../../services/audioPlayer', '../AppVideo', '../BookPostMedia', '../GlassView', '../../components/SearchBaar',
  '../../components/FollowButton', '../PostActions', '../CommentAction', '../RichCaption', '../PendingPosts',
  '../StoriesBar', '../AudioVisualizer', '../RotatingBackground', '../ScreenVignette']
  .forEach((m) => jest.doMock(m, () => ({ __esModule: true, default: Null, createSound: jest.fn() })));
jest.mock('../SocialActions', () => ({ DownloadButton: () => null, SaveButton: () => null, LikeButton: () => null, ShareButton: () => null }));
jest.mock('../SkeletonLoader', () => ({ PostSkeleton: () => null }));

const { default: SocialFeed, dedupeAppend } = require('../SocialFeed');

const post = (id) => ({ id, user: { id: 1, username: 'mark' }, caption: `post ${id}`, content_type: 'text', created_at: new Date().toISOString() });
const page = (ids, next = null) => ({ results: ids.map(post), next });

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockClear());
  mockOnline.value = true;
});

test('dedupeAppend keeps order and drops what is already there', () => {
  const a = [post(1), post(2)];
  expect(dedupeAppend(a, [post(2), post(3), post(3)]).map((p) => p.id)).toEqual([1, 2, 3]);
  expect(dedupeAppend(a, [post(1)])).toBe(a);
});

test('page 2 is fetched straight after page 1, and a repeat shows once', async () => {
  mockApi.fetchSocialPosts.mockResolvedValue(page([1, 2], 'https://api.test/social-posts/?rank=1&page=2'));
  mockApi.fetchFeedByUrl.mockResolvedValueOnce(page([2, 3]));
  const screen = render(<SocialFeed showBackground={false} />);
  await waitFor(() => expect(mockApi.fetchFeedByUrl).toHaveBeenCalledWith('https://api.test/social-posts/?rank=1&page=2'));
  const ids = () => screen.UNSAFE_getByType(FlatList).props.data.map((p) => p.id);
  await waitFor(() => expect(ids()).toEqual([1, 2, 3]));
});

test('an older answer never replaces a newer one', async () => {
  let finishOld;
  mockApi.fetchSocialPosts
    .mockImplementationOnce(() => new Promise((r) => { finishOld = r; }))     // first load: slow
    .mockResolvedValueOnce(page([9]));                                       // pull-to-refresh: fast
  const screen = render(<SocialFeed showBackground={false} />);
  const list = () => screen.UNSAFE_getByType(FlatList);
  await waitFor(() => expect(mockApi.fetchSocialPosts).toHaveBeenCalledTimes(1));
  await act(async () => { list().props.onRefresh(); });
  await waitFor(() => expect(list().props.data.map((p) => p.id)).toEqual([9]));
  await act(async () => { finishOld(page([1, 2])); });
  expect(list().props.data.map((p) => p.id)).toEqual([9]);
});

test('a failed load is a banner over the saved posts, never a popup', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockApi.fetchSocialPosts.mockResolvedValueOnce(page([1]));
  const screen = render(<SocialFeed showBackground={false} />);
  await waitFor(() => expect(mockApi.fetchSocialPosts).toHaveBeenCalledTimes(1));
  mockOnline.value = false;
  mockApi.fetchSocialPosts.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { response: undefined }));
  screen.rerender(<SocialFeed showBackground={false} />);
  await waitFor(() => expect(screen.getByTestId('offline-banner')).toBeTruthy());
  expect(alert).not.toHaveBeenCalled();
  alert.mockRestore();
});

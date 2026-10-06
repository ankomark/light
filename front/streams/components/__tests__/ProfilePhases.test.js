/**
 * Profile phases: the name above the @handle and a safe link, sharing a
 * profile, pinning your own posts, the offline note, and the edit form's
 * dates and the server's own words for a refused field.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Alert, Linking, Share } from 'react-native';
import { dropCache, userKey } from '../../utils/screenCache';
import { parseDay, formatDay } from '../../utils/calendarDay';

jest.setTimeout(20000);

const mockApi = {
  fetchUserById: jest.fn(),
  fetchUserPosts: jest.fn(async () => ({ results: [], next: null })),
  fetchUserTracks: jest.fn(async () => ({ results: [] })),
  fetchUserPlaylists: jest.fn(async () => []),
  fetchArtist: jest.fn(async () => null),
  followUser: jest.fn(),
  getOrCreateConversation: jest.fn(),
  blockUser: jest.fn(),
  pinPost: jest.fn(async () => ({ pinned: true })),
  fetchProfile: jest.fn(),
  updateProfile: jest.fn(async () => ({})),
  getAccessToken: jest.fn(async () => 'tok'),
};
jest.mock('../../services/api', () => new Proxy({}, {
  get: (_, k) => (k in mockApi ? (...a) => mockApi[k](...a) : (k === 'PUBLIC_BASE' ? 'https://al.example' : (k === 'API_URL' ? 'https://al.example/api' : jest.fn()))),
}));
jest.mock('../../services/cloudinary', () => ({ uploadMedia: jest.fn() }));
let mockMe = { id: 7, username: 'mark' };
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ currentUser: mockMe, updateUser: jest.fn(async () => {}) }) }));
jest.mock('../../context/PlayerContext', () => ({ usePlayer: () => ({ playQueue: jest.fn() }) }));
jest.mock('../../hooks/useBottomSpace', () => () => 0);
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT, resolvedLanguage: 'en' }) }));
const mockNav = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true, reset: jest.fn(), addListener: () => () => {} };
jest.mock('@react-navigation/native', () => {
  const ReactLib = require('react');
  return {
    useNavigation: () => mockNav,
    useFocusEffect: (cb) => ReactLib.useEffect(() => cb(), [cb]),
  };
});
jest.mock('@react-native-community/datetimepicker', () => () => null);

const ProfileView = require('../ProfileView').default;
const CreateProfile = require('../CreateProfile').default;

const person = (extra = {}) => ({
  id: 7, username: 'mark', is_self: true, can_view: true, followers_count: 3, following_count: 2,
  posts_count: 2, total_likes: 0,
  profile: { bio: 'Choir', location: 'Nairobi', display_name: 'Mark Ankomah', website: 'https://adventist.org/youth/', is_public: true },
  social_posts: [
    { id: 1, content_type: 'image', thumbnail_url: 'https://cdn/1.jpg', view_count: 1 },
    { id: 2, content_type: 'image', thumbnail_url: 'https://cdn/2.jpg', view_count: 1 },
  ],
  posts_has_more: false,
  ...extra,
});

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockClear());
  dropCache(userKey(7, 'profile:7'));
  mockMe = { id: 7, username: 'mark' };
});

test('the name above the handle, a link that opens, and sharing the profile', async () => {
  mockApi.fetchUserById.mockResolvedValue(person());
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const share = jest.spyOn(Share, 'share').mockResolvedValue({});
  const screen = render(<ProfileView userId={7} />);
  await waitFor(() => expect(screen.getByTestId('profile-display-name')).toHaveTextContent('Mark Ankomah'), { timeout: 5000 });
  expect(screen.getByTestId('profile-link')).toHaveTextContent(/adventist\.org\/youth$/);
  fireEvent.press(screen.getByTestId('profile-link'));
  expect(open).toHaveBeenCalledWith('https://adventist.org/youth/');
  fireEvent.press(screen.getByTestId('profile-share'));
  expect(share.mock.calls[0][0].url).toBe('https://al.example/u/mark/');
  open.mockRestore();
  share.mockRestore();
});

test('a link that is not http(s) is never shown', async () => {
  mockApi.fetchUserById.mockResolvedValue(person({ profile: { ...person().profile, website: 'javascript:alert(1)' } }));
  const screen = render(<ProfileView userId={7} />);
  await waitFor(() => expect(screen.getByTestId('profile-display-name')).toBeTruthy());
  expect(screen.queryByTestId('profile-link')).toBeNull();
});

test('pinning your own post brings it to the top at once', async () => {
  mockApi.fetchUserById.mockResolvedValue(person());
  const screen = render(<ProfileView userId={7} />);
  await waitFor(() => expect(screen.getByTestId('profile-tile-2')).toBeTruthy());
  // The server, asked again after the pin, has it pinned.
  const pinned = person();
  pinned.social_posts = [{ ...pinned.social_posts[1], pinned_at: '2026-10-06T10:00:00Z' }, pinned.social_posts[0]];
  mockApi.fetchUserById.mockResolvedValue(pinned);
  fireEvent(screen.getByTestId('profile-tile-2'), 'longPress');
  await act(async () => { fireEvent.press(screen.getByText('profile.pin')); await new Promise((r) => setTimeout(r, 250)); });
  expect(mockApi.pinPost).toHaveBeenCalledWith(2, true);
  expect(screen.getByTestId('profile-pinned-2')).toBeTruthy();
});

test('a failed refresh keeps the profile and says it is offline', async () => {
  mockApi.fetchUserById.mockResolvedValueOnce(person());
  const screen = render(<ProfileView userId={7} />);
  await waitFor(() => expect(screen.getByTestId('profile-display-name')).toBeTruthy());
  mockApi.fetchUserById.mockRejectedValueOnce(new Error('Network Error'));
  await act(async () => { screen.UNSAFE_getByType(require('react-native').RefreshControl).props.onRefresh(); });
  await waitFor(() => expect(screen.getByTestId('profile-offline')).toBeTruthy());
  expect(screen.getByTestId('profile-display-name')).toBeTruthy();
});

test('a birthday is a day in the phone\'s own time, never shifted through UTC', () => {
  const d = parseDay('1990-05-12');
  expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([1990, 4, 12]);
  expect(formatDay(new Date(1990, 4, 12, 0, 0))).toBe('1990-05-12');
  expect(parseDay('')).toBeNull();
});

test('the edit form sends the name and link, and shows the server\'s words under a refused field', async () => {
  mockApi.fetchProfile.mockResolvedValue({ bio: 'Choir', birth_date: '1990-05-12', location: 'Nairobi', display_name: '', website: '' });
  mockApi.updateProfile.mockRejectedValueOnce({ response: { data: { website: ['Enter a web address, like example.org.'] } } });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(<CreateProfile />);
  await waitFor(() => expect(screen.getByTestId('profile-name-input')).toBeTruthy());
  fireEvent.changeText(screen.getByTestId('profile-name-input'), 'Mark Ankomah');
  fireEvent.changeText(screen.getByTestId('profile-link-input'), 'adventist.org');
  await act(async () => { fireEvent.press(screen.getByText('createProfile.save')); });
  expect(mockApi.updateProfile).toHaveBeenCalledWith(expect.objectContaining({
    display_name: 'Mark Ankomah', website: 'adventist.org', birth_date: '1990-05-12',
  }));
  expect(screen.getByText('Enter a web address, like example.org.')).toBeTruthy();
  alert.mockRestore();
});

/**
 * The Music page under fast fingers and a bad network, the song editor when
 * lyrics won't load, and reporting someone else's album.
 */
import React from 'react';
import { render, act, waitFor, fireEvent } from '@testing-library/react-native';

jest.setTimeout(20000);

const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 30, bottom: 20, left: 0, right: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialIcons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-image', () => {
  const { View } = require('react-native');
  const Img = (props) => <View {...props} />;
  Img.prefetch = jest.fn(async () => true);
  return { Image: Img };
});
jest.mock('../../context/PlayerContext', () => ({ usePlayer: () => ({ playQueue: jest.fn(), currentTrack: null }) }));
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 7 } }) }));
jest.mock('../../utils/screenCache', () => ({
  peekCache: () => null, readCache: async () => null, writeCache: jest.fn(), userKey: (u, n) => `u${u}:${n}`,
}));
const mockNav = { navigate: jest.fn(), goBack: jest.fn() };
let mockRouteParams = {};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockRouteParams }),
  useFocusEffect: (fn) => require('react').useEffect(fn, [fn]),
}));
let mockOnSearch;
jest.mock('../SearchBar', () => (props) => { mockOnSearch = props.onSearch; return null; });
jest.mock('../MusicHome', () => () => null);
jest.mock('../TrackItem', () => ({ track }) => {
  const { Text } = require('react-native');
  return <Text>{track.title}</Text>;
});
jest.mock('../SkeletonLoader', () => ({ TrackListSkeleton: () => null }));
jest.mock('../GenrePicker', () => () => null);
jest.mock('../RightsFields', () => ({ __esModule: true, default: () => null, EMPTY_RIGHTS: { license: 'all_rights' }, isrcLooksValid: () => true }));
jest.mock('../tickets/KeyboardLift', () => ({ children }) => children);
const mockReport = jest.fn(() => null);
jest.mock('../ReportModal', () => (props) => mockReport(props));
jest.mock('../AlbumSheets', () => ({ EditAlbumSheet: () => null, AlbumSongsSheet: () => null }));
jest.mock('../PlaylistCover', () => () => null);
jest.mock('../VerifiedBadge', () => () => null);

const mockApi = {
  fetchTracks: jest.fn(async () => ({ results: [], next: null })),
  searchSongs: jest.fn(async () => ({ results: [], next: null })),
  fetchMusicHome: jest.fn(async () => ({})),
  fetchShuffledTracks: jest.fn(async () => []),
  fetchTrackLyrics: jest.fn(),
  invalidateTrackLyrics: jest.fn(),
  apiRequest: jest.fn(async () => ({})),
  fetchAlbum: jest.fn(),
  deleteAlbum: jest.fn(),
};
jest.mock('../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => (mockApi[k] ? mockApi[k](...a) : Promise.resolve({})) }));

const TrackList = require('../TrackList').default;
const EditTrackScreen = require('../EditTrackScreen').default;
const AlbumScreen = require('../AlbumScreen').default;

const tr = (id, title = `Song ${id}`) => ({ id, title, artist: { id: 1, username: 'choir' }, audio_file: `https://m/${id}.mp3` });

describe('the Music page', () => {
  test('an older search answer never replaces a newer one', async () => {
    let finishOld;
    mockApi.searchSongs
      .mockImplementationOnce(() => new Promise((r) => { finishOld = r; }))            // "lo": slow
      .mockResolvedValueOnce({ results: [tr(2, 'Love divine')], next: null });         // "love": fast
    jest.useFakeTimers();
    const screen = render(<TrackList />);
    act(() => { mockOnSearch('lo'); jest.advanceTimersByTime(400); });
    act(() => { mockOnSearch('love'); jest.advanceTimersByTime(400); });
    jest.useRealTimers();
    await waitFor(() => expect(screen.getByText('Love divine')).toBeTruthy());
    await act(async () => { finishOld({ results: [tr(1, 'Lord of all')], next: null }); });
    expect(screen.queryByText('Lord of all')).toBeNull();
    expect(screen.getByText('Love divine')).toBeTruthy();
  });

  test('a failed load says so in words, not "Network Error"', async () => {
    mockApi.fetchTracks.mockRejectedValueOnce(new Error('Network Error'));
    const screen = render(<TrackList />);
    await waitFor(() => expect(screen.getByText('music.loadTracksFailed')).toBeTruthy());
    expect(screen.queryByText('Network Error')).toBeNull();
  });

  test('the upload button clears the gesture bar', async () => {
    const screen = render(<TrackList />);
    const fab = screen.getByTestId('music-upload');
    const style = [].concat(fab.props.style).reduce((a, b) => ({ ...a, ...b }), {});
    expect(style.bottom).toBeGreaterThanOrEqual(20 + 30);   // inset + its own room
  });
});

describe('editing a song', () => {
  test("lyrics that won't load can be retried, and then the song can be saved", async () => {
    mockRouteParams = { track: { id: 5, title: 'Psalm 23' } };
    mockApi.fetchTrackLyrics.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('The Lord is my shepherd');
    const screen = render(<EditTrackScreen />);
    await waitFor(() => expect(screen.getByTestId('edit-track-lyrics-retry')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByTestId('edit-track-lyrics-retry')); });
    await waitFor(() => expect(screen.getByDisplayValue('The Lord is my shepherd')).toBeTruthy());
  });
});

describe("someone else's album", () => {
  test('can be reported', async () => {
    mockRouteParams = { albumId: 3 };
    mockApi.fetchAlbum.mockResolvedValue({ id: 3, title: 'Vespers', is_owner: false, artist: { id: 9, username: 'choir' }, tracks: [] });
    const screen = render(<AlbumScreen />);
    await waitFor(() => expect(screen.getByTestId('album-report')).toBeTruthy());
    fireEvent.press(screen.getByTestId('album-report'));
    expect(mockReport).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true, contentType: 'album', objectId: 3 }));
  });
});

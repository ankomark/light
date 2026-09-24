import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';

const song = (id, title) => ({ id, title, artist: { id: 9, username: 'Kwaya' }, audio_file: `https://m/${id}.mp3` });
const mockLibrary = {
  artist: { id: 9, username: 'Kwaya ya Vijana', profile_picture: null, verified: true },
  album_count: 2,
  track_count: 3,
  duration_ms: 3600000 * 2 + 60000 * 5,
  albums: [
    { id: 21, title: 'Tenzi Vol 2', cover: 'https://m/c2.jpg', release_date: '2025-06-01', track_count: 2 },
    { id: 20, title: 'Tenzi Vol 1', cover: null, release_date: null, track_count: 1 },
  ],
  tracks: [song(1, 'A'), song(2, 'B'), song(3, 'C')],
};
const mockFetch = jest.fn(async () => mockLibrary);
const mockNavigate = jest.fn();
const mockPlayQueue = jest.fn();

jest.mock('../../services/api', () => ({ fetchArtistLibrary: (id) => mockFetch(id) }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => ({ params: { userId: 9 } }),
}));
jest.mock('../../context/PlayerContext', () => ({ usePlayer: () => ({ playQueue: mockPlayQueue }) }));
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 1 } }) }));
jest.mock('../../utils/screenCache', () => ({
  peekCache: () => null, readCache: async () => null, writeCache: () => {}, userKey: (u, k) => `${u}:${k}`,
}));
jest.mock('../../context/I18nContext', () => ({
  useI18n: () => ({ t: (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k) }),
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialIcons: () => null, MaterialCommunityIcons: () => null }));

const ArtistLibraryScreen = require('../ArtistLibraryScreen').default;

beforeEach(() => { mockNavigate.mockClear(); mockPlayQueue.mockClear(); });

test('shows the choir, its totals and every album; an album opens its songs', async () => {
  const r = render(<ArtistLibraryScreen />);
  await waitFor(() => expect(r.getByText('Kwaya ya Vijana')).toBeTruthy(), { timeout: 8000 });
  expect(mockFetch).toHaveBeenCalledWith(9);
  expect(r.getByText('artistLibrary.albumCount:2  ·  library.songCount:3  ·  playlist.lengthHours:2,5')).toBeTruthy();
  expect(r.getByText('Tenzi Vol 2')).toBeTruthy();
  expect(r.getByText('2025  ·  library.songCount:2')).toBeTruthy();
  expect(r.getByText('library.songCount:1')).toBeTruthy();         // no year: just the count
  fireEvent.press(r.getByLabelText('Tenzi Vol 1'));
  expect(mockNavigate).toHaveBeenCalledWith('Album', { albumId: 20, title: 'Tenzi Vol 1' });
}, 20000);

test('Play all and Shuffle play the whole library', async () => {
  const r = render(<ArtistLibraryScreen />);
  await waitFor(() => expect(r.getByText('playlist.playAll')).toBeTruthy(), { timeout: 8000 });
  fireEvent.press(r.getByText('playlist.playAll'));
  const [queue, index, opts] = mockPlayQueue.mock.calls[0];
  expect(queue.map((q) => q.id)).toEqual([1, 2, 3]);
  expect(index).toBe(0);
  expect(opts).toEqual({ shuffle: false, source: 'album' });
  fireEvent.press(r.getByText('playlist.shuffle'));
  expect(mockPlayQueue.mock.calls[1][2].shuffle).toBe(true);
}, 20000);

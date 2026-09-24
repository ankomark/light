import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('../TrackRail', () => {
  const { Text } = require('react-native');
  return ({ title, tracks }) => (tracks?.length ? <Text>{`rail:${title}`}</Text> : null);
});
jest.mock('../PlaylistCover', () => () => null);
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialIcons: () => null }));
jest.mock('../../context/I18nContext', () => ({
  useI18n: () => ({ t: (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k) }),
}));

const MusicHome = require('../MusicHome').default;
const song = (id) => ({ id, title: `S${id}` });

beforeEach(() => mockNavigate.mockClear());

test('empty sections are left out; the rest show in order', () => {
  const r = render(<MusicHome home={{
    recent: [song(1)], for_you: [], trending: [song(2)], new_releases: [], following: [],
    top_country: null, top_world: null, genres: [],
  }} />);
  expect(r.getByText('rail:music.recentlyPlayed')).toBeTruthy();
  expect(r.getByText('rail:music.trending')).toBeTruthy();
  expect(r.queryByText('rail:music.madeForYou')).toBeNull();
  expect(r.queryByText('music.topWorld')).toBeNull();
  expect(r.queryByText('music.genres')).toBeNull();
});

test('chart cards and genres open their screens', () => {
  const r = render(<MusicHome home={{
    recent: [], for_you: [], trending: [], new_releases: [], following: [],
    top_country: { country: 'KE', tracks: [song(1)] },
    top_world: { country: '', tracks: [song(2)] },
    genres: [{ slug: 'hymns', name: 'Hymns', track_count: 3, cover: null }],
  }} />);
  fireEvent.press(r.getByText('music.topCountry:Kenya'));
  expect(mockNavigate).toHaveBeenLastCalledWith('MusicChart', { chart: 'top', country: 'KE' });
  fireEvent.press(r.getByText('music.topWorld'));
  expect(mockNavigate).toHaveBeenLastCalledWith('MusicChart', { chart: 'top', country: '' });
  fireEvent.press(r.getByText('Hymns'));   // no translation: the server's name
  expect(mockNavigate).toHaveBeenLastCalledWith('Genre', { slug: 'hymns', name: 'Hymns' });
});

test('choirs and artists with albums show as libraries and open theirs', () => {
  const home = {
    recent: [], for_you: [], trending: [], new_releases: [], following: [],
    top_country: null, top_world: null, genres: [],
  };
  expect(render(<MusicHome home={home} />).queryByText('music.libraries')).toBeNull();
  const r = render(<MusicHome home={{
    ...home,
    libraries: [{ id: 9, username: 'Kwaya ya Vijana', verified: true, album_count: 10, track_count: 80, cover: null }],
  }} />);
  expect(r.getByText('music.libraries')).toBeTruthy();
  expect(r.getByText('music.albumCount:10')).toBeTruthy();
  fireEvent.press(r.getByText('Kwaya ya Vijana'));
  expect(mockNavigate).toHaveBeenLastCalledWith('ArtistLibrary', { userId: 9, username: 'Kwaya ya Vijana' });
});

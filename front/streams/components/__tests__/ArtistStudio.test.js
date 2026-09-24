import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';

const mockStats = (days) => ({
  days,
  totals: { streams: 1200, listeners: 340, likes: 45, followers: 88, completion: 61.5, skip_rate: 12, avg_listen_ms: 125000 },
  change: { streams: 20, listeners: -5.5, likes: null },
  daily: [{ date: '2026-09-22', streams: 3 }, { date: '2026-09-23', streams: 9 }],
  top_tracks: [{ id: 1, title: 'Amazing Grace', cover: null, streams: 900, listeners: 300, completion: 70 }],
  countries: [{ key: 'KE', streams: 1000, share: 83.3 }],
  sources: [{ key: 'profile', streams: 600, share: 50 }],
  lifetime_streams: 5400,
});
const mockFetchStudio = jest.fn(async (days) => mockStats(days));
jest.mock('../../services/api', () => ({
  fetchStudio: (d) => mockFetchStudio(d),
  fetchAlbums: jest.fn(async () => [{ id: 3, title: 'Vespers', cover: null, track_count: 4 }]),
  createAlbum: jest.fn(),
  fetchRemovedSongs: jest.fn(async () => []),
  disputeTrack: jest.fn(),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: (cb) => { const { useEffect } = require('react'); useEffect(cb, [cb]); },
}));
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 1 } }) }));
jest.mock('../../context/I18nContext', () => ({
  useI18n: () => ({ t: (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k) }),
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialIcons: () => null, MaterialCommunityIcons: () => null }));

const ArtistStudio = require('../ArtistStudio').default;

test('shows the numbers, changes, top songs, countries, sources and albums', async () => {
  const r = render(<ArtistStudio />);
  // The first render is slow under a full parallel test run.
  await waitFor(() => expect(r.getByText('1.2K')).toBeTruthy(), { timeout: 8000 });
  expect(r.getByText('▲ 20%')).toBeTruthy();
  expect(r.getByText('▼ 5.5%')).toBeTruthy();
  expect(r.getByText('61.5%')).toBeTruthy();
  expect(r.getByText('2:05')).toBeTruthy();                 // average listen
  expect(r.getByText('Amazing Grace')).toBeTruthy();
  expect(r.getByText('Kenya')).toBeTruthy();
  expect(r.getByText('profile')).toBeTruthy();              // untranslated here: the raw source
  expect(r.getByText('Vespers')).toBeTruthy();
}, 20000);   // above the render wait: this machine can be slow under a full parallel run

test('switching the period asks for that period', async () => {
  const r = render(<ArtistStudio />);
  await waitFor(() => expect(mockFetchStudio).toHaveBeenCalledWith(28));
  fireEvent.press(r.getByText('studio.lastDays:7'));
  await waitFor(() => expect(mockFetchStudio).toHaveBeenCalledWith(7));
});

// The mini-player steps aside while the full-screen player is open, and comes
// back once it's closed (after its slide-away, not on top of it).
import React from 'react';
import { render, act } from '@testing-library/react-native';

let mockRoute = 'Home';
const mockListeners = new Set();
jest.mock('../../services/navigationRef', () => {
  const { useEffect, useState } = require('react');
  return {
    navigate: jest.fn(),
    useCurrentRouteName: () => {
      const [name, setName] = useState(mockRoute);
      useEffect(() => {
        const fn = () => setName(mockRoute);
        mockListeners.add(fn);
        return () => mockListeners.delete(fn);
      }, []);
      return name;
    },
  };
});
jest.mock('../../context/PlayerContext', () => ({
  usePlayer: () => ({
    currentTrack: { id: 1, title: 'Amazing Grace', artist: { username: 'choir' } },
    isPlaying: false, isLoading: false, isBuffering: false, repeatMode: 'off', shuffle: false,
    hasNext: false, hasPrev: false, togglePlay: jest.fn(), playNext: jest.fn(), playPrevious: jest.fn(),
    toggleShuffle: jest.fn(), cycleRepeat: jest.fn(), beginSeek: jest.fn(), seekTo: jest.fn(), closePlayer: jest.fn(),
  }),
  usePlayerProgress: () => ({ positionMs: 0, durationMs: 1000 }),
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialIcons: () => null }));

const MiniPlayer = require('../MiniPlayer').default;

const goTo = (name) => act(() => { mockRoute = name; mockListeners.forEach((fn) => fn()); });

beforeEach(() => { jest.useFakeTimers(); mockRoute = 'Home'; });
afterEach(() => { jest.useRealTimers(); });

test('hidden while Now Playing is open, back after it closes', () => {
  const screen = render(<MiniPlayer />);
  expect(screen.queryByText('Amazing Grace')).toBeTruthy();

  goTo('NowPlaying');
  expect(screen.queryByText('Amazing Grace')).toBeNull();

  goTo('Home');
  expect(screen.queryByText('Amazing Grace')).toBeNull();      // still sliding away
  act(() => { jest.advanceTimersByTime(400); });
  expect(screen.queryByText('Amazing Grace')).toBeTruthy();
});

test('other screens keep it', () => {
  const screen = render(<MiniPlayer />);
  goTo('Profile');
  act(() => { jest.advanceTimersByTime(400); });
  expect(screen.queryByText('Amazing Grace')).toBeTruthy();
});

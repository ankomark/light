import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { Audio } from 'expo-av';
import { PlayerProvider, usePlayer } from '../PlayerContext';
import { PreferencesProvider } from '../PreferencesContext';

// --- expo-av mock -----------------------------------------------------------
// A single fake Sound whose status callback we capture so tests can simulate
// playback events (status updates, track-finished).
const mockSound = {
  unloadAsync: jest.fn().mockResolvedValue(undefined),
  getStatusAsync: jest.fn().mockResolvedValue({ isLoaded: true, isPlaying: true }),
  pauseAsync: jest.fn().mockResolvedValue(undefined),
  playAsync: jest.fn().mockResolvedValue(undefined),
  setPositionAsync: jest.fn().mockResolvedValue(undefined),
  setStatusAsync: jest.fn().mockResolvedValue(undefined),
};
const mockAudioState = { onStatus: null };

jest.mock('expo-av', () => ({
  Audio: {
    setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
    Sound: {
      createAsync: jest.fn(async (_src, _init, onStatus) => {
        mockAudioState.onStatus = onStatus;
        return { sound: mockSound };
      }),
    },
  },
}));

// PlayerProvider reads audio-quality prefs via usePreferences(), so it must be
// rendered inside a PreferencesProvider.
const wrapper = ({ children }) => (
  <PreferencesProvider>
    <PlayerProvider>{children}</PlayerProvider>
  </PreferencesProvider>
);

// Simulate the player emitting a status update from native.
const emit = (status) =>
  act(() => {
    mockAudioState.onStatus?.({ isLoaded: true, ...status });
  });

const TRACK = (id) => ({ id, title: `Track ${id}`, audio_file: `uri-${id}` });

beforeEach(() => {
  jest.clearAllMocks();
  mockAudioState.onStatus = null;
});

test('playTrack loads the track and exposes it as currentTrack', async () => {
  const { result } = renderHook(() => usePlayer(), { wrapper });

  await act(async () => {
    await result.current.playTrack(TRACK(1));
  });

  expect(Audio.Sound.createAsync).toHaveBeenCalledWith(
    { uri: 'uri-1' },
    expect.anything(),
    expect.any(Function),
  );
  expect(result.current.currentTrack).toMatchObject({ id: 1, title: 'Track 1' });
});

test('status updates drive isPlaying / position / duration', async () => {
  const { result } = renderHook(() => usePlayer(), { wrapper });
  await act(async () => { await result.current.playTrack(TRACK(1)); });

  await emit({ isPlaying: true, positionMillis: 500, durationMillis: 2000 });

  expect(result.current.isPlaying).toBe(true);
  expect(result.current.positionMs).toBe(500);
  expect(result.current.durationMs).toBe(2000);
});

test('togglePlay pauses a playing track', async () => {
  const { result } = renderHook(() => usePlayer(), { wrapper });
  await act(async () => { await result.current.playTrack(TRACK(1)); });

  await act(async () => { await result.current.togglePlay(); });

  expect(mockSound.pauseAsync).toHaveBeenCalled();
});

test('a finished track auto-advances to the next in the queue', async () => {
  const { result } = renderHook(() => usePlayer(), { wrapper });

  await act(async () => { result.current.playQueue([TRACK(1), TRACK(2)], 0); });
  await waitFor(() => expect(result.current.currentTrack?.id).toBe(1));

  // Native reports the track finished -> player should advance to track 2.
  await emit({ didJustFinish: true, positionMillis: 1000, durationMillis: 1000 });

  await waitFor(() => expect(result.current.currentTrack?.id).toBe(2));
  expect(Audio.Sound.createAsync).toHaveBeenLastCalledWith(
    { uri: 'uri-2' },
    expect.anything(),
    expect.any(Function),
  );
});

test('hasNext / hasPrev track the cursor through the queue', async () => {
  const { result } = renderHook(() => usePlayer(), { wrapper });

  await act(async () => { result.current.playQueue([TRACK(1), TRACK(2), TRACK(3)], 0); });
  await waitFor(() => expect(result.current.currentTrack?.id).toBe(1));
  expect(result.current.hasNext).toBe(true);
  expect(result.current.hasPrev).toBe(false);

  await act(async () => { result.current.playNext(); });
  await waitFor(() => expect(result.current.currentTrack?.id).toBe(2));
  expect(result.current.hasPrev).toBe(true);
  expect(result.current.hasNext).toBe(true);
});

test('repeat-one replays the same track on finish instead of advancing', async () => {
  const { result } = renderHook(() => usePlayer(), { wrapper });

  await act(async () => { result.current.playQueue([TRACK(1), TRACK(2)], 0); });
  await waitFor(() => expect(result.current.currentTrack?.id).toBe(1));

  // off -> all -> one
  act(() => { result.current.cycleRepeat(); });
  act(() => { result.current.cycleRepeat(); });
  expect(result.current.repeatMode).toBe('one');

  await emit({ didJustFinish: true, positionMillis: 1000, durationMillis: 1000 });

  // Still on track 1; replay is via setStatusAsync, not a new load.
  expect(result.current.currentTrack?.id).toBe(1);
  expect(mockSound.setStatusAsync).toHaveBeenCalledWith(
    expect.objectContaining({ shouldPlay: true, positionMillis: 0 }),
  );
});

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { createSound } from '../../services/audioPlayer';
import { PlayerProvider, usePlayer, usePlayerProgress } from '../PlayerContext';
import { PreferencesProvider } from '../PreferencesContext';

// --- audio adapter mock -----------------------------------------------------
// PlayerContext now goes through services/audioPlayer (expo-audio under the
// hood). A single fake Sound whose status callback we capture so tests can
// simulate playback events (status updates, track-finished).
const mockSound = {
  unloadAsync: jest.fn().mockResolvedValue(undefined),
  getStatusAsync: jest.fn().mockResolvedValue({ isLoaded: true, isPlaying: true }),
  pauseAsync: jest.fn().mockResolvedValue(undefined),
  playAsync: jest.fn().mockResolvedValue(undefined),
  setPositionAsync: jest.fn().mockResolvedValue(undefined),
  setStatusAsync: jest.fn().mockResolvedValue(undefined),
  // A preloaded sound gets its status callback when it takes over.
  setOnPlaybackStatusUpdate: jest.fn((cb) => { mockAudioState.onStatus = cb; }),
};
const mockAudioState = { onStatus: null };

jest.mock('../../services/audioPlayer', () => ({
  setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
  createSound: jest.fn(async (_src, _init, onStatus) => {
    mockAudioState.onStatus = onStatus;
    return { sound: mockSound };
  }),
}));

// Listens go to the reporter; capture them instead of hitting the network.
jest.mock('../../services/playReporter', () => ({
  reportPlay: jest.fn(),
  flushPlays: jest.fn(),
  setReporterUser: jest.fn(),
  currentNetwork: () => 'wifi',
}));
const { reportPlay } = require('../../services/playReporter');

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

  expect(createSound).toHaveBeenCalledWith(
    { uri: 'uri-1' },
    expect.anything(),
    expect.any(Function),
  );
  expect(result.current.currentTrack).toMatchObject({ id: 1, title: 'Track 1' });
});

test('status updates drive isPlaying / position / duration', async () => {
  // Position and duration live in their own context now, so the 500ms progress
  // tick doesn't re-render every usePlayer() consumer. Read both here.
  const { result } = renderHook(
    () => ({ ...usePlayer(), ...usePlayerProgress() }),
    { wrapper },
  );
  await act(async () => { await result.current.playTrack(TRACK(1)); });

  await emit({ isPlaying: true, positionMillis: 500, durationMillis: 2000 });

  expect(result.current.isPlaying).toBe(true);
  expect(result.current.positionMs).toBe(500);
  expect(result.current.durationMs).toBe(2000);
});

test('the control context keeps its identity across progress ticks', async () => {
  // The guarantee the split exists for: a track playing must not re-render the
  // feed, the track list, or every row in it, twice a second.
  const { result } = renderHook(() => usePlayer(), { wrapper });
  await act(async () => { await result.current.playTrack(TRACK(1)); });

  await emit({ isPlaying: true, positionMillis: 500, durationMillis: 2000 });
  const afterFirstTick = result.current;

  await emit({ isPlaying: true, positionMillis: 1000, durationMillis: 2000 });
  await emit({ isPlaying: true, positionMillis: 1500, durationMillis: 2000 });

  expect(result.current).toBe(afterFirstTick);
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
  expect(createSound).toHaveBeenLastCalledWith(
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

test('play next goes after the current song; add to queue goes last', async () => {
  const { result } = renderHook(() => usePlayer(), { wrapper });
  await act(async () => { result.current.playQueue([TRACK(1), TRACK(2)], 0); });
  await waitFor(() => expect(result.current.currentTrack?.id).toBe(1));

  act(() => { result.current.addToQueue(TRACK(9)); });
  act(() => { result.current.playNextInQueue(TRACK(5)); });
  expect(result.current.getUpNext().map((u) => u.track.id)).toEqual([5, 2, 9]);

  act(() => { result.current.moveInQueue(3, 2); });   // 9 before 2
  expect(result.current.getUpNext().map((u) => u.track.id)).toEqual([5, 9, 2]);
  act(() => { result.current.removeFromQueue(1); });  // drop 5
  expect(result.current.getUpNext().map((u) => u.track.id)).toEqual([9, 2]);

  await emit({ didJustFinish: true, positionMillis: 1000, durationMillis: 1000 });
  await waitFor(() => expect(result.current.currentTrack?.id).toBe(9));
});

test('the next song preloads near the end and takes over without a new load', async () => {
  const { result } = renderHook(() => usePlayer(), { wrapper });
  await act(async () => { result.current.playQueue([TRACK(1), TRACK(2)], 0); });
  await waitFor(() => expect(result.current.currentTrack?.id).toBe(1));
  const onStatusOfTrack1 = mockAudioState.onStatus;

  // 10s from the end: track 2 starts loading, silently.
  await act(async () => { onStatusOfTrack1({ isLoaded: true, isPlaying: true, positionMillis: 170000, durationMillis: 180000 }); });
  expect(createSound).toHaveBeenLastCalledWith({ uri: 'uri-2' }, expect.objectContaining({ shouldPlay: false }));
  const loads = createSound.mock.calls.length;

  await act(async () => { onStatusOfTrack1({ isLoaded: true, didJustFinish: true, positionMillis: 180000, durationMillis: 180000 }); });
  await waitFor(() => expect(result.current.currentTrack?.id).toBe(2));
  await waitFor(() => expect(mockSound.playAsync).toHaveBeenCalled());
  expect(createSound.mock.calls.length).toBe(loads);   // reused, not reloaded
});

test('a listen is reported at 30s and again when it ends', async () => {
  const { result } = renderHook(() => usePlayer(), { wrapper });
  await act(async () => { result.current.playQueue([TRACK(1), TRACK(2)], 0, { source: 'profile' }); });
  await waitFor(() => expect(result.current.currentTrack?.id).toBe(1));

  for (let p = 0; p <= 31000; p += 500) {
    await emit({ isPlaying: true, positionMillis: p, durationMillis: 600000 });
  }
  expect(reportPlay).toHaveBeenCalledTimes(1);
  expect(reportPlay.mock.calls[0][0]).toMatchObject({ track: 1, ms_played: 30000, ended: false, source: 'profile', network: 'wifi' });

  await act(async () => { result.current.playNext(); });
  expect(reportPlay).toHaveBeenCalledTimes(2);
  expect(reportPlay.mock.calls[1][0]).toMatchObject({ track: 1, ended: true, completed: false });
  expect(reportPlay.mock.calls[1][0].play_id).toBe(reportPlay.mock.calls[0][0].play_id);
});

test('sleep timer "end of this song" stops instead of advancing', async () => {
  const { result } = renderHook(() => usePlayer(), { wrapper });
  await act(async () => { result.current.playQueue([TRACK(1), TRACK(2)], 0); });
  await waitFor(() => expect(result.current.currentTrack?.id).toBe(1));

  act(() => { result.current.setSleepTimer('track'); });
  expect(result.current.sleepTimer).toEqual({ mode: 'track' });
  await emit({ didJustFinish: true, positionMillis: 1000, durationMillis: 1000 });

  expect(result.current.currentTrack?.id).toBe(1);
  expect(result.current.sleepTimer).toBeNull();
  expect(mockSound.setStatusAsync).toHaveBeenCalledWith(expect.objectContaining({ shouldPlay: false, positionMillis: 0 }));
});

test('sleep timer by time pauses once it runs out', async () => {
  const { result } = renderHook(() => usePlayer(), { wrapper });
  await act(async () => { await result.current.playTrack(TRACK(1)); });
  const now = Date.now();
  const spy = jest.spyOn(Date, 'now');
  spy.mockReturnValue(now);
  act(() => { result.current.setSleepTimer(15); });
  spy.mockReturnValue(now + 15 * 60 * 1000 + 1);
  await emit({ isPlaying: true, positionMillis: 5000, durationMillis: 600000 });
  spy.mockRestore();
  expect(mockSound.pauseAsync).toHaveBeenCalled();
  expect(result.current.sleepTimer).toBeNull();
});

test('a slow load that finishes after a newer one is thrown away, even for the same song', async () => {
  const fake = () => ({ ...mockSound, unloadAsync: jest.fn().mockResolvedValue(undefined), pauseAsync: jest.fn().mockResolvedValue(undefined) });
  const slow = fake();
  const fast = fake();
  let releaseSlow;
  createSound
    .mockImplementationOnce(() => new Promise((res) => { releaseSlow = () => res({ sound: slow }); }))
    .mockImplementationOnce(async () => ({ sound: fast }));

  const { result } = renderHook(() => usePlayer(), { wrapper });
  await act(async () => { result.current.playQueue([TRACK(1)], 0); });   // still loading…
  await act(async () => { result.current.playQueue([TRACK(1)], 0); });   // tapped again
  await act(async () => { releaseSlow(); });

  expect(slow.unloadAsync).toHaveBeenCalled();   // never left playing
  expect(fast.unloadAsync).not.toHaveBeenCalled();
  await act(async () => { await result.current.togglePlay(); });
  expect(fast.pauseAsync).toHaveBeenCalled();    // the controls drive the kept one
  expect(slow.pauseAsync).not.toHaveBeenCalled();
});

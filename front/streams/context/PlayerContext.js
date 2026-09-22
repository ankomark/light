import React, {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
  useMemo,
  useCallback,
} from 'react';
import { createSound, setAudioModeAsync } from '../services/audioPlayer';
import {
  makeOrder, reshuffleOrder, nextPos, prevPos, canNext, canPrev,
} from '../utils/queueLogic';
import { usePreferences } from './PreferencesContext';
import { applyAudioQuality, resolveAudioQuality } from '../utils/preferences';
import { getLocalUri, getLocalCover } from '../utils/downloads';

// Two contexts, deliberately.
//
// The playback position ticks every 500ms. It used to live in the same context
// value as the controls — and that value was a fresh object literal on every
// render — so while a track played, EVERY usePlayer() consumer re-rendered
// twice a second: the whole social feed, the track list, and every row in it.
// Almost none of them care what the position is; they want `currentTrack` and
// the controls, which change only when the user does something.
//
// So the fast-changing part gets its own context. Anything that draws a
// progress bar reads usePlayerProgress(); everything else reads usePlayer() and
// is left alone during playback.
const PlayerContext = createContext(null);
const PlayerProgressContext = createContext(null);

/** Track, playback flags and controls. Stable during playback. */
export const usePlayer = () => {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within a PlayerProvider');
  return ctx;
};

/** `{ positionMs, durationMs }` — changes ~2x/second while playing, so only
 *  subscribe to it from something that actually draws the position. */
export const usePlayerProgress = () => {
  const ctx = useContext(PlayerProgressContext);
  if (!ctx) throw new Error('usePlayerProgress must be used within a PlayerProvider');
  return ctx;
};

const REPEAT_MODES = ['off', 'all', 'one'];

/**
 * Global single-instance audio player with a play queue.
 *
 * Only one track is ever loaded/playing at a time. The queue lives entirely in
 * JS on top of expo-audio. The playing track is published to the lock screen
 * and the media notification (title, artist, artwork, play/pause and seek) via
 * expo-audio's native media session, so it can be controlled with the phone
 * locked. A downloaded track plays from its local file.
 *
 * Queue model: `queueRef` holds the tracks in their original order; `orderRef`
 * is a list of indices into the queue describing playback order (identity when
 * shuffle is off, randomized otherwise); `posRef` is the cursor within
 * `orderRef`. All queue data is kept in refs so the playback-status callback
 * reads current values without stale closures.
 */
export const PlayerProvider = ({ children }) => {
  const soundRef = useRef(null);
  const currentIdRef = useRef(null);
  const seekingRef = useRef(false);

  // Playback prefs (audio quality / data saver). Mirrored to a ref so the load
  // path reads current values without re-creating the loadAndPlay callback.
  const { preferences } = usePreferences();
  const prefsRef = useRef(preferences);
  useEffect(() => { prefsRef.current = preferences; }, [preferences]);

  // Queue state (refs are the source of truth; mirrored to React state for UI).
  const queueRef = useRef([]);
  const orderRef = useRef([]);
  const posRef = useRef(-1);
  const repeatRef = useRef('off');
  const shuffleRef = useRef(false);
  const advanceRef = useRef(() => {});

  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [repeatMode, setRepeatMode] = useState('off');
  const [shuffle, setShuffle] = useState(false);
  const [hasNext, setHasNext] = useState(false);
  const [hasPrev, setHasPrev] = useState(false);

  // Configure background / silent-mode playback once.
  useEffect(() => {
    setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    }).catch(() => {});

    return () => {
      const s = soundRef.current;
      soundRef.current = null;
      if (s) s.unloadAsync().catch(() => {});
    };
  }, []);

  const syncNavState = useCallback(() => {
    const len = orderRef.current.length;
    const pos = posRef.current;
    const repeat = repeatRef.current;
    setHasNext(canNext(len, pos, repeat));
    setHasPrev(canPrev(len, pos, repeat));
  }, []);

  const onStatus = useCallback((status) => {
    if (!status.isLoaded) return;
    if (status.durationMillis) setDurationMs(status.durationMillis);
    setIsBuffering(Boolean(status.isBuffering) && Boolean(status.shouldPlay));
    setIsPlaying(Boolean(status.isPlaying));
    if (!seekingRef.current) setPositionMs(status.positionMillis || 0);
    if (status.didJustFinish) {
      advanceRef.current();
    }
  }, []);

  /** Tear down any current sound and load + play the given track. */
  const loadAndPlay = useCallback(
    async (track) => {
      if (!track?.audio_file) return;
      setIsLoading(true);
      setCurrentTrack(track);
      currentIdRef.current = track.id;
      setPositionMs(0);
      setDurationMs(0);
      setIsPlaying(false);

      try {
        if (soundRef.current) {
          await soundRef.current.unloadAsync().catch(() => {});
          soundRef.current = null;
        }
        // Downloaded? Play the file on the phone: instant, and it works with
        // no connection. Quality / data-saver only apply to streaming.
        const local = getLocalUri(track.id);
        const uri = local || applyAudioQuality(
          track.audio_file,
          prefsRef.current.audioQuality,
          prefsRef.current.dataSaver
        );
        const { downloadFirst } = local
          ? { downloadFirst: false }
          : resolveAudioQuality(prefsRef.current.audioQuality, prefsRef.current.dataSaver);
        const { sound } = await createSound(
          { uri },
          { shouldPlay: true, progressUpdateIntervalMillis: 500, downloadFirst },
          onStatus
        );
        // A newer load may have superseded us while awaiting.
        if (currentIdRef.current !== track.id) {
          sound.unloadAsync().catch(() => {});
          return;
        }
        soundRef.current = sound;
        sound.setLockScreen?.(
          {
            title: track.title || '',
            artist: track.artist?.username || (typeof track.artist === 'string' ? track.artist : ''),
            albumTitle: track.album || undefined,
            artworkUrl: getLocalCover(track.id) || track.cover_image || undefined,
          },
          { showSeekForward: true, showSeekBackward: true },
        );
      } catch (error) {
        console.error('Player: failed to load track', error);
      } finally {
        setIsLoading(false);
      }
    },
    [onStatus]
  );

  /** Load the track at the given cursor position within the playback order. */
  const loadAt = useCallback(
    (pos) => {
      const order = orderRef.current;
      if (pos < 0 || pos >= order.length) return;
      posRef.current = pos;
      syncNavState();
      loadAndPlay(queueRef.current[order[pos]]);
    },
    [loadAndPlay, syncNavState]
  );

  /**
   * Replace the queue with `tracks` and start playing at `startIndex`.
   * `opts.shuffle` (optional) overrides the current shuffle mode.
   */
  const playQueue = useCallback(
    (tracks, startIndex = 0, opts = {}) => {
      if (!Array.isArray(tracks) || tracks.length === 0) return;
      const useShuffle = opts.shuffle != null ? opts.shuffle : shuffleRef.current;
      if (opts.shuffle != null) {
        shuffleRef.current = useShuffle;
        setShuffle(useShuffle);
      }

      queueRef.current = tracks;
      const { order, pos } = makeOrder(tracks.length, startIndex, useShuffle);
      orderRef.current = order;
      loadAt(pos);
    },
    [loadAt]
  );

  /**
   * Play a single track. If it's already the active track, toggles play/pause;
   * otherwise it becomes a one-item queue. (List screens should call playQueue
   * so next/previous can traverse the surrounding list.)
   */
  const playTrack = useCallback(
    async (track) => {
      if (!track?.audio_file) return;
      if (currentIdRef.current === track.id && soundRef.current) {
        try {
          const status = await soundRef.current.getStatusAsync();
          if (status.isLoaded) {
            if (status.isPlaying) await soundRef.current.pauseAsync();
            else await soundRef.current.playAsync();
          }
        } catch {}
        return;
      }
      playQueue([track], 0);
    },
    [playQueue]
  );

  const playNext = useCallback(() => {
    const p = nextPos(orderRef.current.length, posRef.current, repeatRef.current);
    if (p !== null) loadAt(p);
  }, [loadAt]);

  const playPrevious = useCallback(() => {
    const p = prevPos(orderRef.current.length, posRef.current, repeatRef.current);
    if (p !== null) loadAt(p);
    else soundRef.current?.setPositionAsync(0).catch(() => {}); // restart current
  }, [loadAt]);

  // What happens when a track finishes on its own.
  advanceRef.current = () => {
    if (repeatRef.current === 'one') {
      soundRef.current
        ?.setStatusAsync({ shouldPlay: true, positionMillis: 0 })
        .catch(() => {});
      return;
    }
    const p = nextPos(orderRef.current.length, posRef.current, repeatRef.current);
    if (p !== null) {
      loadAt(p);
    } else {
      // End of queue: stop at the start, paused.
      soundRef.current
        ?.setStatusAsync({ shouldPlay: false, positionMillis: 0 })
        .catch(() => {});
      setPositionMs(0);
      setIsPlaying(false);
    }
  };

  const toggleShuffle = useCallback(() => {
    const next = !shuffleRef.current;
    shuffleRef.current = next;
    setShuffle(next);

    const order = orderRef.current;
    if (order.length > 0) {
      const currentQueueIdx = order[posRef.current]; // index into queueRef
      const result = reshuffleOrder(queueRef.current.length, currentQueueIdx, next);
      orderRef.current = result.order;
      posRef.current = result.pos;
      syncNavState();
    }
  }, [syncNavState]);

  const cycleRepeat = useCallback(() => {
    const idx = REPEAT_MODES.indexOf(repeatRef.current);
    const next = REPEAT_MODES[(idx + 1) % REPEAT_MODES.length];
    repeatRef.current = next;
    setRepeatMode(next);
    syncNavState();
  }, [syncNavState]);

  const togglePlay = useCallback(async () => {
    const s = soundRef.current;
    if (!s) return;
    try {
      const status = await s.getStatusAsync();
      if (!status.isLoaded) return;
      if (status.isPlaying) await s.pauseAsync();
      else await s.playAsync();
    } catch {}
  }, []);

  /** Pause playback if a track is currently playing (no-op otherwise). Used by
   *  other surfaces (e.g. the feed's video player) to avoid overlapping audio. */
  const pause = useCallback(async () => {
    const s = soundRef.current;
    if (!s) return;
    try {
      const status = await s.getStatusAsync();
      if (status.isLoaded && status.isPlaying) await s.pauseAsync();
    } catch {}
  }, []);

  // Read position/duration through refs. As dependencies they would re-create
  // these callbacks on every 500ms tick, which would rebuild the "stable"
  // context value and undo the whole split above.
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  useEffect(() => { positionRef.current = positionMs; }, [positionMs]);
  useEffect(() => { durationRef.current = durationMs; }, [durationMs]);

  const skip = useCallback(async (deltaMs) => {
    const s = soundRef.current;
    const duration = durationRef.current;
    if (!s || !duration) return;
    const target = Math.max(0, Math.min(duration, positionRef.current + deltaMs));
    try {
      await s.setPositionAsync(target);
      setPositionMs(target);
    } catch {}
  }, []);

  const beginSeek = useCallback(() => {
    seekingRef.current = true;
  }, []);

  const seekTo = useCallback(async (ratio) => {
    seekingRef.current = false;
    const s = soundRef.current;
    const duration = durationRef.current;
    if (!s || !duration) return;
    const target = Math.max(0, Math.min(duration, ratio * duration));
    try {
      await s.setPositionAsync(target);
      setPositionMs(target);
    } catch {}
  }, []);

  const closePlayer = useCallback(async () => {
    const s = soundRef.current;
    soundRef.current = null;
    currentIdRef.current = null;
    queueRef.current = [];
    orderRef.current = [];
    posRef.current = -1;
    if (s) await s.unloadAsync().catch(() => {});
    setCurrentTrack(null);
    setIsPlaying(false);
    setIsBuffering(false);
    setPositionMs(0);
    setDurationMs(0);
    setHasNext(false);
    setHasPrev(false);
  }, []);

  // Memoized, and WITHOUT positionMs/durationMs: this object must keep its
  // identity through a whole track, so consumers that only want the controls
  // don't re-render on every progress tick. Every callback below is already
  // stable (refs, not state, in their dependency lists).
  const value = useMemo(() => ({
    currentTrack,
    isPlaying,
    isLoading,
    isBuffering,
    repeatMode,
    shuffle,
    hasNext,
    hasPrev,
    playTrack,
    playQueue,
    playNext,
    playPrevious,
    togglePlay,
    pause,
    toggleShuffle,
    cycleRepeat,
    skip,
    beginSeek,
    seekTo,
    closePlayer,
  }), [
    currentTrack, isPlaying, isLoading, isBuffering, repeatMode, shuffle,
    hasNext, hasPrev, playTrack, playQueue, playNext, playPrevious, togglePlay,
    pause, toggleShuffle, cycleRepeat, skip, beginSeek, seekTo, closePlayer,
  ]);

  // The fast-changing half. Only progress bars subscribe here.
  const progress = useMemo(
    () => ({ positionMs, durationMs }),
    [positionMs, durationMs],
  );

  return (
    <PlayerContext.Provider value={value}>
      <PlayerProgressContext.Provider value={progress}>
        {children}
      </PlayerProgressContext.Provider>
    </PlayerContext.Provider>
  );
};

export default PlayerContext;

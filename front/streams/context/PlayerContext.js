import React, {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
  useMemo,
  useCallback,
} from 'react';
import { AppState } from 'react-native';
import { createSound, setAudioModeAsync } from '../services/audioPlayer';
import {
  makeOrder, reshuffleOrder, nextPos, prevPos, canNext, canPrev,
  insertNext, appendToOrder, removeAt, moveUpcoming,
} from '../utils/queueLogic';
import {
  startListen, advance as advanceListen, finish as finishListen, toEvent,
} from '../utils/listenTracker';
import { reportPlay, flushPlays, setReporterUser, currentNetwork } from '../services/playReporter';
import { readCache, writeCache, dropCache, userKey } from '../utils/screenCache';
import { usePreferences } from './PreferencesContext';
import { useOptionalAuth } from './useAuth';
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

// How close to the end of a song the next one starts loading, so it plays the
// moment this one ends instead of after a buffering pause.
const PRELOAD_LEAD_MS = 20000;
// How often the "where you were" session is saved while a song plays.
const SAVE_EVERY_MS = 10000;
// A saved session older than this isn't offered back.
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// Longer queues are saved as just the current song (a 2,000-song shuffle
// doesn't belong in storage).
const SESSION_MAX_QUEUE = 300;

/**
 * Global single-instance audio player with a play queue.
 *
 * Only one track is ever playing at a time. The queue lives entirely in JS on
 * top of expo-audio. The playing track is published to the lock screen and
 * the media notification (title, artist, artwork, play/pause and seek) via
 * expo-audio's native media session, so it can be controlled with the phone
 * locked. A downloaded track plays from its local file.
 *
 * Queue model: `queueRef` holds the tracks in their original order; `orderRef`
 * is a list of indices into the queue describing playback order (identity when
 * shuffle is off, randomized otherwise); `posRef` is the cursor within
 * `orderRef`. All queue data is kept in refs so the playback-status callback
 * reads current values without stale closures. "Play next" / "Add to queue"
 * append the track to the queue and splice its index into the order.
 *
 * Also, all driven from the status ticks:
 *   - listens: how much of each song was really heard, reported to the
 *     server at 30s and when it ends (services/playReporter);
 *   - preloading: ~20s before the end, the next song starts loading in a
 *     second, silent player that takes over when this one ends;
 *   - the session: queue, song and position are saved per account, so the
 *     app reopens paused where you left off;
 *   - the sleep timer (after N minutes, or at the end of this song).
 */
export const PlayerProvider = ({ children }) => {
  const soundRef = useRef(null);
  const currentIdRef = useRef(null);
  const currentTrackRef = useRef(null);
  const seekingRef = useRef(false);
  // Bumped on every load: a load that finishes after a newer one started
  // throws its sound away. (Comparing song ids wasn't enough — two loads of
  // the same song, a double tap, both passed and both played.)
  const loadSeqRef = useRef(0);

  // Playback prefs (audio quality / data saver). Mirrored to a ref so the load
  // path reads current values without re-creating the loadAndPlay callback.
  const { preferences } = usePreferences();
  const prefsRef = useRef(preferences);
  useEffect(() => { prefsRef.current = preferences; }, [preferences]);

  // Signed-in account: listens and the saved session are per account.
  const auth = useOptionalAuth();
  const userId = auth?.currentUser?.id ?? null;
  const sessionKeyRef = useRef(null);

  // Queue state (refs are the source of truth; mirrored to React state for UI).
  const queueRef = useRef([]);
  const orderRef = useRef([]);
  const posRef = useRef(-1);
  const repeatRef = useRef('off');
  const shuffleRef = useRef(false);
  const advanceRef = useRef(() => {});
  const sourceRef = useRef('');

  const listenRef = useRef(null);       // the listen in progress (utils/listenTracker)
  const preloadRef = useRef(null);      // { id, uri, sound } — the next song, loading
  const resumeAtRef = useRef(null);     // ms to start at when a restored session plays
  const pendingStartRef = useRef(null); // { ms, play } — seek once the new sound loads
  const lastSaveRef = useRef(0);
  const sleepRef = useRef(null);        // { mode: 'time', endsAt } | { mode: 'track' }

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
  // Bumped when the queue changes, so the queue screen re-reads getUpNext().
  const [queueVersion, setQueueVersion] = useState(0);
  const [sleepTimer, setSleepTimerState] = useState(null);

  // Read position/duration through refs. As dependencies they would re-create
  // the callbacks below on every 500ms tick, which would rebuild the "stable"
  // context value and undo the whole split above.
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  useEffect(() => { positionRef.current = positionMs; }, [positionMs]);
  useEffect(() => { durationRef.current = durationMs; }, [durationMs]);

  const bumpQueue = useCallback(() => setQueueVersion((v) => v + 1), []);

  const syncNavState = useCallback(() => {
    const len = orderRef.current.length;
    const pos = posRef.current;
    const repeat = repeatRef.current;
    setHasNext(canNext(len, pos, repeat));
    setHasPrev(canPrev(len, pos, repeat));
  }, []);

  // ── the saved session ──
  const saveSession = useCallback((atMs) => {
    const key = sessionKeyRef.current;
    const track = currentTrackRef.current;
    if (!key || !track) return;
    lastSaveRef.current = Date.now();
    const small = queueRef.current.length <= SESSION_MAX_QUEUE;
    writeCache(key, {
      queue: small ? queueRef.current : [track],
      order: small ? orderRef.current : [0],
      pos: small ? posRef.current : 0,
      positionMs: Math.max(0, Math.round(atMs ?? positionRef.current ?? 0)),
      repeat: repeatRef.current,
      shuffle: shuffleRef.current,
    });
  }, []);

  // ── listens ──
  const startListenFor = useCallback((track, atMs = 0) => {
    listenRef.current = startListen({
      trackId: track.id,
      source: sourceRef.current,
      positionMs: atMs,
      durationMs: track.duration_ms || 0,
    });
  }, []);

  const endListen = useCallback(({ completed = false } = {}) => {
    const listen = listenRef.current;
    listenRef.current = null;
    if (!listen) return;
    if (completed) finishListen(listen);
    // Under a second is a mis-tap, not a listen (or a skip worth learning from).
    if (listen.msPlayed < 1000 && !listen.reported) return;
    reportPlay(toEvent(listen, { completed, ended: true, network: currentNetwork() }));
  }, []);

  // ── preloading the next song ──
  const dropPreload = useCallback(() => {
    const pre = preloadRef.current;
    preloadRef.current = null;
    pre?.sound?.unloadAsync().catch(() => {});
  }, []);

  const streamSourceFor = useCallback((track) => {
    const local = getLocalUri(track.id);
    if (local) return { uri: local, downloadFirst: false, local: true };
    const prefs = prefsRef.current;
    return {
      uri: applyAudioQuality(track.audio_file, prefs.audioQuality, prefs.dataSaver),
      downloadFirst: resolveAudioQuality(prefs.audioQuality, prefs.dataSaver).downloadFirst,
      local: false,
    };
  }, []);

  const maybePreload = useCallback((status) => {
    if (preloadRef.current || !status.isPlaying || !status.durationMillis) return;
    if (status.durationMillis - (status.positionMillis || 0) > PRELOAD_LEAD_MS) return;
    if (repeatRef.current === 'one' || sleepRef.current?.mode === 'track') return;
    const prefs = prefsRef.current;
    // Data saver: never spend data on a song that may not get played.
    if (prefs.dataSaver || prefs.audioQuality === 'data_saver') return;
    const p = nextPos(orderRef.current.length, posRef.current, repeatRef.current);
    if (p === null) return;
    const next = queueRef.current[orderRef.current[p]];
    if (!next?.audio_file || next.id === currentIdRef.current) return;
    const src = streamSourceFor(next);
    if (src.local) return; // a file on the phone starts instantly anyway
    const entry = { id: next.id, uri: src.uri, sound: null };
    preloadRef.current = entry;
    createSound({ uri: src.uri }, { shouldPlay: false, progressUpdateIntervalMillis: 500, downloadFirst: src.downloadFirst })
      .then(({ sound }) => {
        if (preloadRef.current === entry) entry.sound = sound;
        else sound.unloadAsync().catch(() => {});
      })
      .catch(() => { if (preloadRef.current === entry) preloadRef.current = null; });
  }, [streamSourceFor]);

  const clearSleep = useCallback(() => {
    sleepRef.current = null;
    setSleepTimerState(null);
  }, []);

  const onStatus = useCallback((status) => {
    if (!status.isLoaded) return;
    // A restored session (or a resumed song) starts where it left off: seek
    // on the first loaded tick, then play.
    const pending = pendingStartRef.current;
    if (pending && soundRef.current) {
      pendingStartRef.current = null;
      const s = soundRef.current;
      s.setPositionAsync(pending.ms)
        .then(() => (pending.play ? s.playAsync() : null))
        .catch(() => {});
      return;
    }
    if (status.durationMillis) setDurationMs(status.durationMillis);
    setIsBuffering(Boolean(status.isBuffering) && Boolean(status.shouldPlay));
    setIsPlaying(Boolean(status.isPlaying));
    if (!seekingRef.current) setPositionMs(status.positionMillis || 0);

    if (!seekingRef.current && advanceListen(listenRef.current, {
      positionMs: status.positionMillis || 0,
      durationMs: status.durationMillis || 0,
      isPlaying: Boolean(status.isPlaying),
    })) {
      reportPlay(toEvent(listenRef.current, { network: currentNetwork() }));
    }

    const sleep = sleepRef.current;
    if (sleep?.mode === 'time' && Date.now() >= sleep.endsAt) {
      clearSleep();
      if (status.isPlaying) soundRef.current?.pauseAsync().catch(() => {});
    }

    if (status.isPlaying) {
      maybePreload(status);
      if (Date.now() - lastSaveRef.current > SAVE_EVERY_MS) saveSession(status.positionMillis);
    }

    if (status.didJustFinish) {
      endListen({ completed: true });
      advanceRef.current();
    }
  }, [maybePreload, saveSession, endListen, clearSleep]);

  /** Tear down any current sound and load + play the given track.
   *  `startAtMs` resumes partway (a restored session). */
  const loadAndPlay = useCallback(
    async (track, { startAtMs = 0 } = {}) => {
      if (!track?.audio_file) return;
      const seq = ++loadSeqRef.current;
      endListen();
      setIsLoading(true);
      setCurrentTrack(track);
      currentTrackRef.current = track;
      currentIdRef.current = track.id;
      resumeAtRef.current = null;
      pendingStartRef.current = null;
      setPositionMs(startAtMs);
      setDurationMs(track.duration_ms || 0);
      setIsPlaying(false);

      // Stop the old song now, not after an await: nothing may be left
      // playing while the new one loads.
      const old = soundRef.current;
      soundRef.current = null;
      try {
        if (old) await old.unloadAsync().catch(() => {});
        if (seq !== loadSeqRef.current) return;
        // Downloaded? Play the file on the phone: instant, and it works with
        // no connection. Quality / data-saver only apply to streaming.
        const src = streamSourceFor(track);
        let sound = null;
        const pre = preloadRef.current;
        preloadRef.current = null;
        if (pre?.sound && pre.id === track.id && pre.uri === src.uri && !startAtMs) {
          // Already loaded while the last song finished: take it over.
          sound = pre.sound;
          sound.setOnPlaybackStatusUpdate(onStatus);
          await sound.playAsync();
        } else {
          pre?.sound?.unloadAsync().catch(() => {});
          if (startAtMs) pendingStartRef.current = { ms: startAtMs, play: true };
          ({ sound } = await createSound(
            { uri: src.uri },
            { shouldPlay: !startAtMs, progressUpdateIntervalMillis: 500, downloadFirst: src.downloadFirst },
            onStatus
          ));
        }
        // A newer load may have superseded us while awaiting.
        if (seq !== loadSeqRef.current) {
          sound.unloadAsync().catch(() => {});
          return;
        }
        soundRef.current = sound;
        startListenFor(track, startAtMs);
        saveSession(startAtMs);
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
        if (seq === loadSeqRef.current) setIsLoading(false);
      }
    },
    [onStatus, endListen, streamSourceFor, startListenFor, saveSession]
  );

  /** Load the track at the given cursor position within the playback order. */
  const loadAt = useCallback(
    (pos) => {
      const order = orderRef.current;
      if (pos < 0 || pos >= order.length) return;
      posRef.current = pos;
      syncNavState();
      bumpQueue();
      loadAndPlay(queueRef.current[order[pos]]);
    },
    [loadAndPlay, syncNavState, bumpQueue]
  );

  /**
   * Replace the queue with `tracks` and start playing at `startIndex`.
   * `opts.shuffle` (optional) overrides the current shuffle mode; `opts.source`
   * says where the listen started (profile, library, ...) for stats.
   */
  const playQueue = useCallback(
    (tracks, startIndex = 0, opts = {}) => {
      if (!Array.isArray(tracks) || tracks.length === 0) return;
      const useShuffle = opts.shuffle != null ? opts.shuffle : shuffleRef.current;
      if (opts.shuffle != null) {
        shuffleRef.current = useShuffle;
        setShuffle(useShuffle);
      }
      sourceRef.current = opts.source || '';
      dropPreload();

      queueRef.current = [...tracks];
      const { order, pos } = makeOrder(tracks.length, startIndex, useShuffle);
      orderRef.current = order;
      loadAt(pos);
    },
    [loadAt, dropPreload]
  );

  /** Resume the current song when nothing is loaded yet (a restored session,
   *  or after the sound was torn down). Returns false when there's nothing. */
  const resumeCurrent = useCallback(() => {
    const track = currentTrackRef.current;
    if (soundRef.current || !track) return false;
    loadAndPlay(track, { startAtMs: resumeAtRef.current || 0 });
    return true;
  }, [loadAndPlay]);

  /**
   * Play a single track. If it's already the active track, toggles play/pause;
   * otherwise it becomes a one-item queue. (List screens should call playQueue
   * so next/previous can traverse the surrounding list.)
   */
  const playTrack = useCallback(
    async (track) => {
      if (!track?.audio_file) return;
      if (currentIdRef.current === track.id) {
        if (!soundRef.current) { resumeCurrent(); return; }
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
    [playQueue, resumeCurrent]
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
    const stopAtStart = () => {
      soundRef.current
        ?.setStatusAsync({ shouldPlay: false, positionMillis: 0 })
        .catch(() => {});
      setPositionMs(0);
      setIsPlaying(false);
      saveSession(0);
    };
    // Sleep timer set to "end of this song".
    if (sleepRef.current?.mode === 'track') {
      clearSleep();
      stopAtStart();
      return;
    }
    if (repeatRef.current === 'one') {
      soundRef.current
        ?.setStatusAsync({ shouldPlay: true, positionMillis: 0 })
        .catch(() => {});
      if (currentTrackRef.current) startListenFor(currentTrackRef.current, 0);
      return;
    }
    const p = nextPos(orderRef.current.length, posRef.current, repeatRef.current);
    if (p !== null) {
      loadAt(p);
    } else {
      // End of queue: stop at the start, paused.
      stopAtStart();
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
      dropPreload();
      syncNavState();
      bumpQueue();
    }
  }, [syncNavState, dropPreload, bumpQueue]);

  const cycleRepeat = useCallback(() => {
    const idx = REPEAT_MODES.indexOf(repeatRef.current);
    const next = REPEAT_MODES[(idx + 1) % REPEAT_MODES.length];
    repeatRef.current = next;
    setRepeatMode(next);
    syncNavState();
  }, [syncNavState]);

  const togglePlay = useCallback(async () => {
    const s = soundRef.current;
    if (!s) { resumeCurrent(); return; }
    try {
      const status = await s.getStatusAsync();
      if (!status.isLoaded) return;
      if (status.isPlaying) {
        await s.pauseAsync();
        saveSession(status.positionMillis);
      } else {
        // A timer that ran out while paused shouldn't stop the song again.
        const sleep = sleepRef.current;
        if (sleep?.mode === 'time' && Date.now() >= sleep.endsAt) clearSleep();
        await s.playAsync();
      }
    } catch {}
  }, [resumeCurrent, saveSession, clearSleep]);

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

  // Seeking before a restored session has loaded moves where it will start.
  const seekIdle = useCallback((target) => {
    resumeAtRef.current = target;
    setPositionMs(target);
    saveSession(target);
  }, [saveSession]);

  const skip = useCallback(async (deltaMs) => {
    const s = soundRef.current;
    const duration = durationRef.current;
    if (!duration) return;
    const target = Math.max(0, Math.min(duration, positionRef.current + deltaMs));
    if (!s) { seekIdle(target); return; }
    try {
      await s.setPositionAsync(target);
      setPositionMs(target);
    } catch {}
  }, [seekIdle]);

  const beginSeek = useCallback(() => {
    seekingRef.current = true;
  }, []);

  const seekTo = useCallback(async (ratio) => {
    seekingRef.current = false;
    const s = soundRef.current;
    const duration = durationRef.current;
    if (!duration) return;
    const target = Math.max(0, Math.min(duration, ratio * duration));
    if (!s) { seekIdle(target); return; }
    try {
      await s.setPositionAsync(target);
      setPositionMs(target);
    } catch {}
  }, [seekIdle]);

  // ── editing the queue ──
  const enqueue = useCallback((track, where) => {
    if (!track?.audio_file) return;
    if (!currentTrackRef.current) { playQueue([track], 0); return; }
    queueRef.current = [...queueRef.current, track];
    const idx = queueRef.current.length - 1;
    orderRef.current = where === 'next'
      ? insertNext(orderRef.current, posRef.current, idx)
      : appendToOrder(orderRef.current, idx);
    if (where === 'next') dropPreload();
    syncNavState();
    bumpQueue();
    saveSession();
  }, [playQueue, dropPreload, syncNavState, bumpQueue, saveSession]);

  /** "Play next": straight after the current song. */
  const playNextInQueue = useCallback((track) => enqueue(track, 'next'), [enqueue]);
  /** "Add to queue": at the end. */
  const addToQueue = useCallback((track) => enqueue(track, 'end'), [enqueue]);

  /** Upcoming songs, in play order: [{ track, at }] (`at` = order position). */
  const getUpNext = useCallback(() => {
    const pos = posRef.current;
    return orderRef.current.slice(pos + 1).map((qi, k) => ({ track: queueRef.current[qi], at: pos + 1 + k }));
  }, []);

  const editOrder = useCallback((next) => {
    if (next === orderRef.current) return;
    orderRef.current = next;
    dropPreload();
    syncNavState();
    bumpQueue();
    saveSession();
  }, [dropPreload, syncNavState, bumpQueue, saveSession]);

  const removeFromQueue = useCallback((at) => {
    editOrder(removeAt(orderRef.current, posRef.current, at));
  }, [editOrder]);

  const moveInQueue = useCallback((from, to) => {
    editOrder(moveUpcoming(orderRef.current, posRef.current, from, to));
  }, [editOrder]);

  /** Jump to an upcoming song in the queue. */
  const playFromQueue = useCallback((at) => loadAt(at), [loadAt]);

  // ── sleep timer ──
  /** `minutes` (a number), 'track' (end of this song), or null to cancel. */
  const setSleepTimer = useCallback((value) => {
    if (value == null) { clearSleep(); return; }
    const next = value === 'track'
      ? { mode: 'track' }
      : { mode: 'time', endsAt: Date.now() + Number(value) * 60 * 1000 };
    sleepRef.current = next;
    setSleepTimerState(next);
  }, [clearSleep]);

  const resetState = useCallback(() => {
    loadSeqRef.current += 1; // a load still in flight must not come back to life
    currentIdRef.current = null;
    currentTrackRef.current = null;
    queueRef.current = [];
    orderRef.current = [];
    posRef.current = -1;
    resumeAtRef.current = null;
    pendingStartRef.current = null;
    sleepRef.current = null;
    setCurrentTrack(null);
    setIsPlaying(false);
    setIsBuffering(false);
    setPositionMs(0);
    setDurationMs(0);
    setHasNext(false);
    setHasPrev(false);
    setSleepTimerState(null);
    bumpQueue();
  }, [bumpQueue]);

  const closePlayer = useCallback(async () => {
    endListen();
    dropPreload();
    const s = soundRef.current;
    soundRef.current = null;
    if (sessionKeyRef.current) dropCache(sessionKeyRef.current);
    resetState();
    if (s) await s.unloadAsync().catch(() => {});
  }, [endListen, dropPreload, resetState]);

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
      preloadRef.current?.sound?.unloadAsync().catch(() => {});
    };
  }, []);

  // Going to the background: save where we are and send waiting listens (the
  // app may not come back).
  useEffect(() => {
    const sub = AppState.addEventListener?.('change', (state) => {
      if (state !== 'background') return;
      saveSession();
      flushPlays();
    });
    return () => sub?.remove?.();
  }, [saveSession]);

  // The signed-in account changed. Signing out (or switching accounts) stops
  // the music — it was the other account's — and a sign-in brings back that
  // account's last session, paused, ready to resume.
  useEffect(() => {
    setReporterUser(userId);
    const prevKey = sessionKeyRef.current;
    const key = userId != null ? userKey(userId, 'player:session') : null;
    if (key === prevKey) return undefined;
    if (prevKey && currentTrackRef.current) {
      endListen();
      dropPreload();
      const s = soundRef.current;
      soundRef.current = null;
      s?.unloadAsync().catch(() => {});
      resetState();
    }
    sessionKeyRef.current = key;
    if (!key) return undefined;
    let cancelled = false;
    readCache(key, SESSION_MAX_AGE_MS).then((saved) => {
      // Too late if the listener already started something.
      if (cancelled || currentTrackRef.current || !saved) return;
      const { queue, order, pos } = saved;
      if (!Array.isArray(queue) || !Array.isArray(order) || !(pos >= 0 && pos < order.length)) return;
      const track = queue[order[pos]];
      if (!track?.audio_file) return;
      queueRef.current = queue;
      orderRef.current = order;
      posRef.current = pos;
      repeatRef.current = REPEAT_MODES.includes(saved.repeat) ? saved.repeat : 'off';
      shuffleRef.current = !!saved.shuffle;
      setRepeatMode(repeatRef.current);
      setShuffle(shuffleRef.current);
      currentTrackRef.current = track;
      currentIdRef.current = track.id;
      resumeAtRef.current = saved.positionMs || 0;
      setCurrentTrack(track);
      setPositionMs(saved.positionMs || 0);
      setDurationMs(track.duration_ms || 0);
      setIsPlaying(false);
      syncNavState();
      bumpQueue();
    });
    return () => { cancelled = true; };
  }, [userId, endListen, dropPreload, resetState, syncNavState, bumpQueue]);

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
    queueVersion,
    sleepTimer,
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
    playNextInQueue,
    addToQueue,
    getUpNext,
    removeFromQueue,
    moveInQueue,
    playFromQueue,
    setSleepTimer,
  }), [
    currentTrack, isPlaying, isLoading, isBuffering, repeatMode, shuffle,
    hasNext, hasPrev, queueVersion, sleepTimer, playTrack, playQueue, playNext,
    playPrevious, togglePlay, pause, toggleShuffle, cycleRepeat, skip, beginSeek,
    seekTo, closePlayer, playNextInQueue, addToQueue, getUpNext, removeFromQueue,
    moveInQueue, playFromQueue, setSleepTimer,
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

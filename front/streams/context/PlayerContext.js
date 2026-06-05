import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { NativeModules } from 'react-native';
import { Audio } from 'expo-av';
import TrackPlayer, {
  Capability,
  State,
  AppKilledPlaybackBehavior,
  IOSCategory,
  usePlaybackState,
  useProgress,
} from 'react-native-track-player';

// react-native-track-player is a native module — it does NOT exist in Expo Go
// (or on web). When it's missing we transparently fall back to expo-av so the
// app still plays audio; lock-screen / notification controls only work in a
// dev-client or production build where the native module is linked.
const RNTP_AVAILABLE = !!NativeModules.TrackPlayerModule;

const PlayerContext = createContext(null);

export const usePlayer = () => {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within a PlayerProvider');
  return ctx;
};

/* ------------------------------------------------------------------ *
 * react-native-track-player backed provider (full lock-screen support)
 * ------------------------------------------------------------------ */

let setupPromise = null;
const ensurePlayer = () => {
  if (!setupPromise) {
    setupPromise = (async () => {
      try {
        await TrackPlayer.setupPlayer({ iosCategory: IOSCategory.Playback });
      } catch {
        // Already initialized — fine.
      }
      await TrackPlayer.updateOptions({
        android: {
          appKilledPlaybackBehavior:
            AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
        },
        capabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.Stop,
          Capability.SeekTo,
          Capability.JumpForward,
          Capability.JumpBackward,
        ],
        compactCapabilities: [Capability.Play, Capability.Pause, Capability.SeekTo],
        forwardJumpInterval: 10,
        backwardJumpInterval: 10,
        progressUpdateEventInterval: 1,
      });
    })().catch((e) => {
      setupPromise = null; // allow a retry on next play
      throw e;
    });
  }
  return setupPromise;
};

function RNTPProvider({ children }) {
  const [currentTrack, setCurrentTrack] = useState(null);
  const playbackState = usePlaybackState();
  const progress = useProgress(250);

  useEffect(() => {
    ensurePlayer().catch((e) => console.error('Player setup failed', e));
  }, []);

  const state = playbackState?.state;
  const isPlaying = state === State.Playing;
  const isLoading =
    state === State.Loading ||
    state === State.Buffering ||
    state === State.Connecting;
  const isBuffering = state === State.Buffering;
  const positionMs = (progress?.position || 0) * 1000;
  const durationMs = (progress?.duration || 0) * 1000;

  const playTrack = useCallback(
    async (track) => {
      if (!track?.audio_file) return;
      try {
        await ensurePlayer();
        if (currentTrack?.id === track.id) {
          const { state: s } = await TrackPlayer.getPlaybackState();
          if (s === State.Playing) await TrackPlayer.pause();
          else await TrackPlayer.play();
          return;
        }
        setCurrentTrack(track);
        await TrackPlayer.reset();
        await TrackPlayer.add({
          id: String(track.id),
          url: track.audio_file,
          title: track.title || 'Unknown title',
          artist: track.artist?.username || 'Unknown artist',
          album: track.album || undefined,
          artwork: track.cover_image || undefined,
        });
        await TrackPlayer.play();
      } catch (error) {
        console.error('Player: failed to play track', error);
      }
    },
    [currentTrack?.id]
  );

  const togglePlay = useCallback(async () => {
    try {
      const { state: s } = await TrackPlayer.getPlaybackState();
      if (s === State.Playing) await TrackPlayer.pause();
      else await TrackPlayer.play();
    } catch {}
  }, []);

  const skip = useCallback(async (deltaMs) => {
    try {
      await TrackPlayer.seekBy(deltaMs / 1000);
    } catch {}
  }, []);

  const beginSeek = useCallback(() => {}, []);

  const seekTo = useCallback(
    async (ratio) => {
      try {
        if (durationMs > 0) await TrackPlayer.seekTo((ratio * durationMs) / 1000);
      } catch {}
    },
    [durationMs]
  );

  const closePlayer = useCallback(async () => {
    try {
      await TrackPlayer.reset();
    } catch {}
    setCurrentTrack(null);
  }, []);

  const value = {
    currentTrack,
    isPlaying,
    isLoading,
    isBuffering,
    positionMs,
    durationMs,
    playTrack,
    togglePlay,
    skip,
    beginSeek,
    seekTo,
    closePlayer,
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

/* ------------------------------------------------------------------ *
 * expo-av fallback provider (Expo Go / web — no lock-screen controls)
 * ------------------------------------------------------------------ */

function ExpoAvProvider({ children }) {
  const soundRef = useRef(null);
  const currentIdRef = useRef(null);
  const seekingRef = useRef(false);

  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);

  useEffect(() => {
    Audio.setAudioModeAsync({
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

  const onStatus = useCallback((status) => {
    if (!status.isLoaded) return;
    if (status.durationMillis) setDurationMs(status.durationMillis);
    setIsBuffering(Boolean(status.isBuffering) && Boolean(status.shouldPlay));
    setIsPlaying(Boolean(status.isPlaying));
    if (!seekingRef.current) setPositionMs(status.positionMillis || 0);
    if (status.didJustFinish) {
      soundRef.current
        ?.setStatusAsync({ shouldPlay: false, positionMillis: 0 })
        .catch(() => {});
      setPositionMs(0);
      setIsPlaying(false);
    }
  }, []);

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
        const { sound } = await Audio.Sound.createAsync(
          { uri: track.audio_file },
          { shouldPlay: true, progressUpdateIntervalMillis: 500 },
          onStatus
        );
        if (currentIdRef.current !== track.id) {
          sound.unloadAsync().catch(() => {});
          return;
        }
        soundRef.current = sound;
      } catch (error) {
        console.error('Player: failed to load track', error);
      } finally {
        setIsLoading(false);
      }
    },
    [onStatus]
  );

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

  const skip = useCallback(
    async (deltaMs) => {
      const s = soundRef.current;
      if (!s || !durationMs) return;
      const target = Math.max(0, Math.min(durationMs, positionMs + deltaMs));
      try {
        await s.setPositionAsync(target);
        setPositionMs(target);
      } catch {}
    },
    [durationMs, positionMs]
  );

  const beginSeek = useCallback(() => {
    seekingRef.current = true;
  }, []);

  const seekTo = useCallback(
    async (ratio) => {
      seekingRef.current = false;
      const s = soundRef.current;
      if (!s || !durationMs) return;
      const target = Math.max(0, Math.min(durationMs, ratio * durationMs));
      try {
        await s.setPositionAsync(target);
        setPositionMs(target);
      } catch {}
    },
    [durationMs]
  );

  const closePlayer = useCallback(async () => {
    const s = soundRef.current;
    soundRef.current = null;
    currentIdRef.current = null;
    if (s) await s.unloadAsync().catch(() => {});
    setCurrentTrack(null);
    setIsPlaying(false);
    setIsBuffering(false);
    setPositionMs(0);
    setDurationMs(0);
  }, []);

  const value = {
    currentTrack,
    isPlaying,
    isLoading,
    isBuffering,
    positionMs,
    durationMs,
    playTrack,
    togglePlay,
    skip,
    beginSeek,
    seekTo,
    closePlayer,
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

/**
 * Global single-instance audio player. One track plays at a time, shared across
 * every screen. Uses react-native-track-player (lock-screen controls) when the
 * native module is available, otherwise falls back to expo-av.
 */
export const PlayerProvider = RNTP_AVAILABLE ? RNTPProvider : ExpoAvProvider;

export default PlayerContext;

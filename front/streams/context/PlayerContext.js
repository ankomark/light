import React, {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { Audio } from 'expo-av';

const PlayerContext = createContext(null);

export const usePlayer = () => {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within a PlayerProvider');
  return ctx;
};

/**
 * Global single-instance audio player.
 *
 * Only one track is ever loaded/playing at a time. Tracks across any screen
 * (TrackList, Favorites, …) share this provider, so starting a new track
 * automatically stops the previous one. Playback continues in the background;
 * full lock-screen media controls are a TODO (would need a native module such
 * as react-native-track-player).
 */
export const PlayerProvider = ({ children }) => {
  const soundRef = useRef(null);
  const currentIdRef = useRef(null);
  const seekingRef = useRef(false);

  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);

  // Configure background / silent-mode playback once.
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

  /**
   * Play a track. If it's already the active track, this toggles play/pause.
   * `track` must include an `audio_file` URI; `cover_image`, `title`, `artist`
   * are used by the mini-player UI.
   */
  const playTrack = useCallback(
    async (track) => {
      if (!track?.audio_file) return;

      // Same track -> toggle play/pause instead of reloading.
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

      // New track -> tear down the old sound and load the new one.
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
        // A newer playTrack call may have superseded us while awaiting.
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
};

export default PlayerContext;

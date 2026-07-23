// Thin wrapper that presents the small slice of the old expo-av `<Video>` API the
// app actually used (source / resizeMode / shouldPlay / isMuted / isLooping +
// onLoad / onReadyForDisplay / onError), implemented on expo-video. This lets the
// screens migrate off the removed-in-SDK-55 expo-av with a near drop-in swap
// instead of each one learning expo-video's player-object model.
//
// expo-video is player-centric: `useVideoPlayer` creates a player, `<VideoView>`
// renders it. We keep the player's mute/loop/play state in sync with props via
// effects, and forward the events the callers rely on. A ref exposes imperative
// play/pause/seek for the trimmer/feed which drove the old <Video> through a ref.
import React, { forwardRef, useEffect, useImperativeHandle } from 'react';
import { useVideoPlayer, VideoView } from 'expo-video';

// Normalize the caller's `source` (either a `{ uri }` object as expo-av wanted, or
// a bare string / require() id) into an expo-video VideoSource.
const toSource = (source) => {
  if (source == null) return null;
  if (typeof source === 'string' || typeof source === 'number') return source;
  return source.uri ? { uri: source.uri } : null;
};

const AppVideo = forwardRef(function AppVideo(
  {
    source,
    style,
    resizeMode = 'cover',      // expo-av name; mapped to contentFit below
    contentFit,
    isLooping = false,
    shouldPlay = false,
    isMuted = false,
    nativeControls = false,
    useNativeControls = false,   // expo-av name; either turns controls on
    bufferOptions,               // how far ahead to buffer (data-saver lever)
    onReadyForDisplay,
    onLoad,
    onError,
    onPlaybackStatusUpdate,
    ...viewProps
  },
  ref,
) {
  const player = useVideoPlayer(toSource(source), (p) => {
    p.loop = isLooping;
    p.muted = isMuted;
    // Play/pause is driven by the effect below so it also reacts to prop changes.
  });

  // Keep player state in sync with props (setup only runs on player creation).
  useEffect(() => { player.muted = isMuted; }, [player, isMuted]);
  useEffect(() => { player.loop = isLooping; }, [player, isLooping]);
  // expo-video requires the whole BufferOptions object — individual properties
  // can't be set. Serialized as the dep so a caller passing an inline object
  // literal doesn't re-assign on every render.
  const bufferKey = bufferOptions ? JSON.stringify(bufferOptions) : null;
  useEffect(() => {
    if (!bufferKey) return;
    try {
      player.bufferOptions = JSON.parse(bufferKey);
    } catch {
      // Older expo-video builds don't expose bufferOptions — playback still works.
    }
  }, [player, bufferKey]);
  useEffect(() => {
    if (shouldPlay) player.play();
    else player.pause();
  }, [player, shouldPlay]);

  // Forward the load/error events callers depend on. `sourceLoad` is the
  // metadata-ready signal (expo-av's onLoad); `statusChange -> error` is onError.
  useEffect(() => {
    if (!onLoad && !onError) return undefined;
    const loadSub = onLoad
      ? player.addListener('sourceLoad', (payload) => onLoad({
          // Shape like expo-av's onLoad status: callers read durationMillis.
          // expo-video reports duration in seconds on the sourceLoad payload.
          isLoaded: true,
          durationMillis: Math.round((payload?.duration || player.duration || 0) * 1000),
          ...payload,
        }))
      : null;
    const statusSub = onError
      ? player.addListener('statusChange', ({ status, error }) => {
          if (status === 'error') onError(error);
        })
      : null;
    return () => { loadSub?.remove?.(); statusSub?.remove?.(); };
  }, [player, onLoad, onError]);

  // Synthesize expo-av's onPlaybackStatusUpdate from expo-video events for the
  // callers that drive UI off playback progress (e.g. StoryViewer's progress bar
  // + auto-advance). We emit the subset those callers read: isLoaded,
  // positionMillis, durationMillis, didJustFinish, isPlaying.
  useEffect(() => {
    if (!onPlaybackStatusUpdate) return undefined;
    player.timeUpdateEventInterval = 0.25; // seconds; 0 disables timeUpdate
    const emit = (didJustFinish) => onPlaybackStatusUpdate({
      isLoaded: player.status === 'readyToPlay',
      positionMillis: Math.round((player.currentTime || 0) * 1000),
      durationMillis: Math.round((player.duration || 0) * 1000),
      didJustFinish: !!didJustFinish,
      isPlaying: player.playing,
    });
    const timeSub = player.addListener('timeUpdate', () => emit(false));
    const endSub = player.addListener('playToEnd', () => emit(true));
    return () => { timeSub?.remove?.(); endSub?.remove?.(); };
  }, [player, onPlaybackStatusUpdate]);

  // Imperative handle mirroring the old expo-av <Video> ref methods the trimmer
  // and full-screen feed call (playAsync/pauseAsync/setPositionAsync). Kept
  // promise-returning so existing `await v.playAsync()` / `.catch()` call sites
  // work unchanged. Old code seeked in ms; expo-video's currentTime is seconds.
  useImperativeHandle(ref, () => ({
    playAsync: async () => player.play(),
    pauseAsync: async () => player.pause(),
    setPositionAsync: async (positionMillis) => { player.currentTime = (positionMillis || 0) / 1000; },
    play: () => player.play(),
    pause: () => player.pause(),
    seekBy: (seconds) => player.seekBy(seconds),
    getPlayer: () => player,
  }), [player]);

  return (
    <VideoView
      player={player}
      style={style}
      contentFit={contentFit || resizeMode}
      nativeControls={nativeControls || useNativeControls}
      // Fires when the first real frame is painted — the seam we fade a poster
      // over (direct successor to expo-av's onReadyForDisplay).
      onFirstFrameRender={onReadyForDisplay}
      {...viewProps}
    />
  );
});

export default AppVideo;

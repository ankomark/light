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
    onReadyForDisplay,
    onLoad,
    onError,
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
  useEffect(() => {
    if (shouldPlay) player.play();
    else player.pause();
  }, [player, shouldPlay]);

  // Forward the load/error events callers depend on. `sourceLoad` is the
  // metadata-ready signal (expo-av's onLoad); `statusChange -> error` is onError.
  useEffect(() => {
    if (!onLoad && !onError) return undefined;
    const loadSub = onLoad
      ? player.addListener('sourceLoad', (payload) => onLoad(payload))
      : null;
    const statusSub = onError
      ? player.addListener('statusChange', ({ status, error }) => {
          if (status === 'error') onError(error);
        })
      : null;
    return () => { loadSub?.remove?.(); statusSub?.remove?.(); };
  }, [player, onLoad, onError]);

  // Imperative handle mirroring the old <Video> ref methods used by the trimmer/feed.
  useImperativeHandle(ref, () => ({
    play: () => player.play(),
    pause: () => player.pause(),
    // Old code seeked in ms (setPositionAsync); expo-video seeks in seconds.
    setPositionAsync: (positionMillis) => { player.currentTime = (positionMillis || 0) / 1000; },
    seekBy: (seconds) => player.seekBy(seconds),
    getPlayer: () => player,
  }), [player]);

  return (
    <VideoView
      player={player}
      style={style}
      contentFit={contentFit || resizeMode}
      nativeControls={nativeControls}
      // Fires when the first real frame is painted — the seam we fade a poster
      // over (direct successor to expo-av's onReadyForDisplay).
      onFirstFrameRender={onReadyForDisplay}
      {...viewProps}
    />
  );
});

export default AppVideo;

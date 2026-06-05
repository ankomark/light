import TrackPlayer, { Event } from 'react-native-track-player';

/**
 * Playback service for react-native-track-player.
 *
 * Runs in its own JS context (kept alive by the native foreground service /
 * iOS audio session) and handles the remote control events that come from the
 * lock screen, notification, headphones, car (CarPlay/Android Auto), etc.
 */
module.exports = async function () {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.reset());

  TrackPlayer.addEventListener(Event.RemoteJumpForward, async (e) => {
    await TrackPlayer.seekBy(e?.interval ?? 10);
  });
  TrackPlayer.addEventListener(Event.RemoteJumpBackward, async (e) => {
    await TrackPlayer.seekBy(-(e?.interval ?? 10));
  });

  TrackPlayer.addEventListener(Event.RemoteSeek, (e) => {
    if (typeof e?.position === 'number') TrackPlayer.seekTo(e.position);
  });

  // Pause when headphones are unplugged / Bluetooth disconnects.
  TrackPlayer.addEventListener(Event.RemoteDuck, async (e) => {
    if (e?.permanent) {
      await TrackPlayer.pause();
    } else if (e?.paused) {
      await TrackPlayer.pause();
    }
  });
};

// Adapter that presents the slice of the old expo-av `Audio.Sound` API the app
// used, implemented on expo-audio. expo-av is removed in SDK 55; this lets the
// player context and the various clip/voice-note players migrate with a near
// drop-in swap of `Audio.Sound.createAsync` -> `createSound` instead of each
// site learning expo-audio's player-object + status-event model.
//
// expo-audio differs in shape: createAudioPlayer is synchronous (loads in the
// background), times are in seconds, status fields are renamed, and teardown is
// `remove()`. SoundAdapter hides those differences behind the promise-returning
// method names the callers already use.
import {
  createAudioPlayer,
  setAudioModeAsync as expoSetAudioModeAsync,
} from 'expo-audio';

// expo-audio AudioStatus (seconds, renamed fields) -> the expo-av status shape
// callers read (positionMillis/durationMillis/isPlaying/didJustFinish/...).
const toAvStatus = (s, player) => {
  const currentTime = s?.currentTime ?? player?.currentTime ?? 0;
  const duration = s?.duration ?? player?.duration ?? 0;
  const playing = s?.playing ?? player?.playing ?? false;
  return {
    isLoaded: s?.isLoaded ?? player?.isLoaded ?? false,
    isPlaying: playing,
    isBuffering: s?.isBuffering ?? player?.isBuffering ?? false,
    // expo-av's shouldPlay is the play *intent*; expo-audio has no separate
    // intent flag, so approximate with actual playing state (only used to gate
    // a buffering spinner).
    shouldPlay: playing,
    positionMillis: Math.round((currentTime || 0) * 1000),
    durationMillis: Math.round((duration || 0) * 1000),
    didJustFinish: s?.didJustFinish ?? false,
  };
};

class SoundAdapter {
  constructor(source, initialStatus = {}) {
    this._player = createAudioPlayer(
      source,
      initialStatus.progressUpdateIntervalMillis
        ? { updateInterval: initialStatus.progressUpdateIntervalMillis }
        : undefined,
    );
    if (initialStatus.isLooping) this._player.loop = true;
    if (typeof initialStatus.volume === 'number') this._player.volume = initialStatus.volume;
    this._sub = null;
    if (initialStatus.shouldPlay) this._player.play();
  }

  async playAsync() { this._player.play(); }
  async pauseAsync() { this._player.pause(); }
  async stopAsync() { this._player.pause(); await this._player.seekTo(0); }
  async setPositionAsync(positionMillis) { await this._player.seekTo((positionMillis || 0) / 1000); }
  async playFromPositionAsync(positionMillis) {
    await this._player.seekTo((positionMillis || 0) / 1000);
    this._player.play();
  }
  async getStatusAsync() { return toAvStatus(this._player.currentStatus, this._player); }

  // Mirror the subset of Audio.Sound.setStatusAsync the app uses.
  async setStatusAsync(status = {}) {
    if (typeof status.volume === 'number') this._player.volume = status.volume;
    if (typeof status.isLooping === 'boolean') this._player.loop = status.isLooping;
    if (typeof status.positionMillis === 'number') await this._player.seekTo(status.positionMillis / 1000);
    if (status.shouldPlay === true) this._player.play();
    else if (status.shouldPlay === false) this._player.pause();
  }

  setOnPlaybackStatusUpdate(callback) {
    this._sub?.remove?.();
    this._sub = callback
      ? this._player.addListener('playbackStatusUpdate', (s) => callback(toAvStatus(s, this._player)))
      : null;
  }

  async unloadAsync() {
    this._sub?.remove?.();
    this._sub = null;
    this._player.remove();
  }
}

/**
 * Drop-in for `Audio.Sound.createAsync`. Returns `{ sound }` where `sound`
 * exposes the expo-av method surface backed by expo-audio.
 */
export const createSound = async (source, initialStatus = {}, onPlaybackStatusUpdate) => {
  const sound = new SoundAdapter(source, initialStatus);
  if (onPlaybackStatusUpdate) sound.setOnPlaybackStatusUpdate(onPlaybackStatusUpdate);
  return { sound };
};

// Map the old expo-av audio-mode keys to expo-audio's AudioMode and apply it.
// Only the keys the app actually set are translated.
export const setAudioModeAsync = (mode = {}) => {
  const next = {};
  if ('playsInSilentModeIOS' in mode) next.playsInSilentMode = mode.playsInSilentModeIOS;
  if ('staysActiveInBackground' in mode) next.shouldPlayInBackground = mode.staysActiveInBackground;
  if ('allowsRecordingIOS' in mode) next.allowsRecording = mode.allowsRecordingIOS;
  if ('playThroughEarpieceAndroid' in mode) next.shouldRouteThroughEarpiece = mode.playThroughEarpieceAndroid;
  if ('shouldDuckAndroid' in mode) {
    next.interruptionMode = mode.shouldDuckAndroid ? 'duckOthers' : 'mixWithOthers';
  }
  return expoSetAudioModeAsync(next);
};

/**
 * Sound and touch feedback for the quiz.
 *
 * Two kinds of feedback, one switch:
 *   · short effect sounds (correct, wrong, tick, finish) — bundled
 *   · haptics — no asset needed, and the only feedback a silent phone gives
 *
 * Everything here fails soft. Audio is the first thing to misbehave on a real
 * device (a call arrives, the route changes, the file is slow), and none of it
 * is worth interrupting a quiz for — so every call is wrapped and a failure
 * simply means no sound.
 *
 * Background music loops under the games at low volume, on the same switch as
 * everything else. It ducks out the moment sound is muted or a game is left,
 * so it can never outlive the screen that started it.
 */
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as Haptics from 'expo-haptics';

const SOURCES = {
  correct: require('../assets/sounds/correct.wav'),
  wrong: require('../assets/sounds/wrong.wav'),
  tick: require('../assets/sounds/tick.wav'),
  finish: require('../assets/sounds/finish.wav'),
  loop: require('../assets/sounds/loop.mp3'),
};

// Players are created once and reused: building one per tap is the classic way
// to make a quiz stutter on the fifth question.
const players = {};
let loopPlayer = null;
let enabled = true;
let configured = false;

/** Mirror the user's preference in here so callers need not pass it every time. */
export const setSoundEnabled = (value) => {
  enabled = !!value;
  if (!enabled) stopLoop();
};

export const isSoundEnabled = () => enabled;

const ensureAudioMode = async () => {
  if (configured) return;
  configured = true;
  try {
    // Play through the silent switch: someone who has left sound on has asked
    // for it. Never take over the audio session in the background — this app
    // also plays music, and a quiz must not fight it.
    await setAudioModeAsync({ playsInSilentModeIOS: true, shouldPlayInBackground: false });
  } catch {
    // Not fatal — effects will still play under the default mode.
  }
};

const playerFor = (name) => {
  if (!SOURCES[name]) return null;
  if (!players[name]) {
    try {
      players[name] = createAudioPlayer(SOURCES[name]);
    } catch {
      players[name] = null;
    }
  }
  return players[name];
};

/** Play one effect. Silent when the user has muted, or on any failure. */
export const play = (name) => {
  if (!enabled) return;
  ensureAudioMode();
  try {
    const player = playerFor(name);
    if (!player) return;
    // Rewind first: tapping quickly should retrigger, not be ignored because
    // the previous play is still running.
    player.seekTo(0);
    player.play();
  } catch {
    // A sound that will not play is not worth surfacing.
  }
};

export const playLoop = () => {
  if (!enabled || !SOURCES.loop) return;
  ensureAudioMode();
  try {
    if (!loopPlayer) {
      loopPlayer = createAudioPlayer(SOURCES.loop);
      loopPlayer.loop = true;
      loopPlayer.volume = 0.22;   // under the effects, not competing with them
    }
    loopPlayer.play();
  } catch {
    loopPlayer = null;
  }
};

export const stopLoop = () => {
  try {
    if (loopPlayer) loopPlayer.pause();
  } catch {
    // ignore
  }
};

/** Release everything — call when leaving the quiz. */
export const unload = () => {
  try {
    Object.values(players).forEach((p) => p && p.remove());
  } catch { /* ignore */ }
  Object.keys(players).forEach((k) => delete players[k]);
  try {
    if (loopPlayer) loopPlayer.remove();
  } catch { /* ignore */ }
  loopPlayer = null;
};

// ── touch feedback ───────────────────────────────────────────────────────────
// Haptics follow the same switch as sound: one "quiet mode", not two.

export const tapFeedback = () => {
  if (!enabled) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
};

export const correctFeedback = () => {
  play('correct');
  if (!enabled) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
};

export const wrongFeedback = () => {
  play('wrong');
  if (!enabled) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
};

export const tickFeedback = () => play('tick');

export const finishFeedback = () => {
  play('finish');
  if (!enabled) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
};

/** A run of correct answers deserves something extra — fired on milestones. */
export const streakFeedback = () => {
  if (!enabled) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
};

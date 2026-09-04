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
 * Music and effects are on SEPARATE switches, and that separation matters:
 * muting the background music is something people do constantly — it is the
 * thing that gets tiring — while the little click that says a word was right
 * is information, not decoration. Tying them together meant that turning the
 * music off also turned the game's answers silent.
 *
 * The music still ducks out the moment a game is left, so it can never outlive
 * the screen that started it.
 */
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as Haptics from 'expo-haptics';

const SOURCES = {
  correct: require('../assets/sounds/correct.wav'),
  wrong: require('../assets/sounds/wrong.wav'),
  tick: require('../assets/sounds/tick.wav'),
  finish: require('../assets/sounds/finish.wav'),
  bonus: require('../assets/sounds/bonus.wav'),
  loop: require('../assets/sounds/loop.mp3'),
};

// Players are created once and reused: building one per tap is the classic way
// to make a quiz stutter on the fifth question.
const players = {};
let loopPlayer = null;
let enabled = true;        // effect sounds and haptics
let musicOn = true;        // the background loop, muted on its own
let configured = false;

/** Effect sounds and haptics. Nothing to do with the music. */
export const setSoundEnabled = (value) => {
  enabled = !!value;
};

export const isSoundEnabled = () => enabled;

/** The background music, and only that. */
export const setMusicEnabled = (value) => {
  musicOn = !!value;
  if (!musicOn) stopLoop();
};

export const isMusicEnabled = () => musicOn;

const ensureAudioMode = async () => {
  if (configured) return;
  configured = true;
  try {
    // Respect the hardware silent switch. It used to play through it, on the
    // reasoning that someone who left sound on had asked for it — but that was
    // when one button governed everything and muting was one tap away inside
    // the game. Now that effects are on by default and separate from the
    // music, the switch on the side of the phone is the escape hatch, and a
    // game that ignores it is a game that embarrasses someone in a quiet room.
    //
    // Never take over the audio session in the background either — this app
    // also plays music, and a game must not fight it.
    await setAudioModeAsync({ playsInSilentModeIOS: false, shouldPlayInBackground: false });
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
  if (!musicOn || !SOURCES.loop) return;
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
  // Pausing the only thing that was playing can leave the audio session
  // inactive, and the next short effect is then swallowed silently. Clearing
  // this makes the next effect re-assert the mode before it plays, which
  // reactivates the session. Cheap: it happens once per mute, not per sound.
  configured = false;
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

/** A word the wheel spells that was never on the board.
 *
 * Its own sound, not the one a board word gets: hearing the difference is how
 * you learn that a guess which found nothing on the board was still worth
 * making.
 */
export const bonusFeedback = () => {
  play('bonus');
  if (!enabled) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
};

/** A run of correct answers deserves something extra — fired on milestones. */
export const streakFeedback = () => {
  if (!enabled) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
};

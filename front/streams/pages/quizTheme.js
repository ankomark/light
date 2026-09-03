/**
 * The quiz's visual system, shared by every mode.
 *
 * Lifted out of BibleQuiz so Speed and Streak cannot drift from it: one gold,
 * one parchment, one backdrop, one set of typefaces. Cinzel and Lora are
 * already loaded app-wide in App.js, so none of this adds a dependency.
 */
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import RotatingBackground from '../components/RotatingBackground';

export const DISPLAY = 'Cinzel_700Bold';
export const DISPLAY_MID = 'Cinzel_600SemiBold';
export const SERIF = 'Lora_400Regular';
export const SERIF_BOLD = 'Lora_700Bold';

export const GOLD = '#F4A261';
export const GOLD_DEEP = '#C9963F';
export const PARCHMENT = '#E8E3DA';
export const MUTED = '#5F708A';
export const INK = '#0A1628';

export const RIGHT = '#43A047';
export const WRONG = '#E53935';

export const DIFFICULTY_TINT = {
  simple: { fg: '#7FD1A0', bg: 'rgba(67,160,71,0.16)' },
  moderate: { fg: '#F0B972', bg: 'rgba(251,140,0,0.16)' },
  hard: { fg: '#FF8A86', bg: 'rgba(229,57,53,0.16)' },
};

export const mmss = (seconds) => {
  const whole = Math.max(0, Math.round(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

/** The dark navy wash.
 *
 *  A warm amber layer used to sit over the top of this — without a real radial
 *  gradient it spilled across the whole upper screen as a yellow cast rather
 *  than reading as a soft glow, so it is gone. The gold now appears only where
 *  it is deliberate: the accent, the hairlines and the numerals. */
/**
 * The same wallpaper the rest of the app uses, behind the games.
 *
 * The hub screens don't render this — they sit under the app header, which
 * needs the wallpaper to span behind it, so their wrapper in App.js supplies
 * it instead. Only the full-screen play screens draw their own.
 *
 * The scrim is heavier here than on browsing screens: a quiz choice or a
 * letter tile has to stay legible over whatever photo is showing, and a
 * wallpaper that competes with the board is worse than no wallpaper.
 *
 * A long interval on purpose. A picture changing under a puzzle you are
 * concentrating on reads as a glitch, not as atmosphere.
 */
export const Backdrop = () => (
  <RotatingBackground intervalMs={120000} scrimColor="rgba(10,22,40,0.74)" />
);

/** Styles every quiz screen shares — cards, choices, buttons, eyebrows. */
export const quizStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: INK },
  // For screens whose wallpaper is painted by a parent wrapper.
  rootClear: { flex: 1 },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },

  eyebrow: {
    fontFamily: DISPLAY_MID, fontSize: 10, letterSpacing: 1.4,
    textTransform: 'uppercase', color: MUTED,
  },
  gold: { color: GOLD },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingTop: 8 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    flex: 1, textAlign: 'center', fontFamily: DISPLAY, fontSize: 15,
    letterSpacing: 0.6, color: PARCHMENT,
  },
  // Under the app header there is no title bar of our own, so the page names
  // itself at the top of its content the way the other sections do.
  pageTitle: {
    fontFamily: DISPLAY, fontSize: 22, letterSpacing: 0.6, color: PARCHMENT,
    marginBottom: 2,
  },

  verseCard: {
    padding: 22, paddingTop: 24, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.26)',
  },
  quoteMark: {
    position: 'absolute', top: 4, left: 16,
    fontFamily: SERIF_BOLD, fontSize: 46, color: 'rgba(244,162,97,0.20)',
  },
  verseText: { fontFamily: SERIF, fontSize: 19, lineHeight: 31, color: PARCHMENT, paddingLeft: 14 },

  prompt: { marginTop: 20, fontSize: 15, fontWeight: '700', color: '#E0E1DD', lineHeight: 21 },

  choice: {
    flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 58,
    paddingHorizontal: 16, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.09)',
  },
  choiceActive: { backgroundColor: 'rgba(244,162,97,0.15)', borderColor: GOLD_DEEP },
  choiceRight: { backgroundColor: 'rgba(67,160,71,0.18)', borderColor: RIGHT },
  choiceWrong: { backgroundColor: 'rgba(229,57,53,0.16)', borderColor: WRONG },
  choiceLetter: {
    fontFamily: DISPLAY_MID, fontSize: 14, color: '#7E8DA3', width: 16, textAlign: 'center',
  },
  choiceRule: { width: 1, height: 24, backgroundColor: 'rgba(255,255,255,0.10)' },
  choiceText: { flex: 1, fontSize: 15, color: '#C6CBD2' },
  choiceTextStrong: { color: '#F6E9D8', fontWeight: '700' },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 56, paddingHorizontal: 24, borderRadius: 28, backgroundColor: GOLD,
  },
  primaryBtnText: {
    fontFamily: DISPLAY, fontSize: 13, letterSpacing: 1, color: INK, textTransform: 'uppercase',
  },
  ghostBtn: {
    alignItems: 'center', justifyContent: 'center', minHeight: 52, paddingHorizontal: 24,
    borderRadius: 26, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.15)',
  },
  ghostBtnText: {
    fontFamily: DISPLAY_MID, fontSize: 12, letterSpacing: 1, color: '#A9BCD0',
    textTransform: 'uppercase',
  },
  disabled: { opacity: 0.6 },

  emptyTitle: { fontFamily: SERIF_BOLD, fontSize: 19, color: PARCHMENT, textAlign: 'center' },
  emptyBody: { fontSize: 14, color: '#A9BCD0', textAlign: 'center', maxWidth: 320, lineHeight: 20 },
});

// The stack is taller than it is wide; keeping the ratio stops it squashing.
const COIN_ASPECT = 172 / 160;

/**
 * A coin: points, shown the way a game shows them.
 *
 * `size` is the width — the height follows the artwork's ratio rather than
 * being forced square, which would letterbox or squash it.
 *
 * There is a floor on the rendered size: this is a stack of three coins, and
 * below about 14pt the three read as one gold smudge. Anywhere the layout asks
 * for less, it is drawn at the floor instead.
 */
const COIN_MIN = 14;

export const Coin = ({ size = 15, style }) => {
  const width = Math.max(COIN_MIN, size);
  return (
    <Image
      source={require('../assets/coins.png')}
      style={[{ width, height: width * COIN_ASPECT }, style]}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
    />
  );
};

/** Coin count with its glyph — the pairing used everywhere points appear. */
export const Coins = ({ value, size = 15, textSize, style, textStyle }) => (
  <View style={[coinStyles.row, style]}>
    <Coin size={size} />
    <Text style={[coinStyles.value, { fontSize: textSize ?? size + 3 }, textStyle]}>
      {value ?? 0}
    </Text>
  </View>
);

const coinStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  value: { fontFamily: DISPLAY, color: GOLD },
});

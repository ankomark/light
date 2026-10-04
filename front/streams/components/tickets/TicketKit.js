/**
 * The look of Events & Tickets: midnight and champagne.
 *
 * Near-black grounds so the posters carry the colour, a champagne gold for
 * what matters (prices, the one action on a screen), ivory type. Cormorant
 * Garamond for display — an engraved-invitation serif — and Manrope for
 * everything read at a glance: numbers, prices, buttons.
 *
 * Fonts are the app's own (loaded in App.js); nothing here is new to the build.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

export const T = {
  ink: '#0A0A0D',
  surface: '#131317',
  raised: '#1B1B21',
  line: 'rgba(232,212,170,0.14)',
  lineStrong: 'rgba(232,212,170,0.32)',
  champagne: '#E8D4AA',
  gold: '#C9A45C',
  goldDeep: '#8E6D33',
  ivory: '#F6F1E7',
  muted: 'rgba(246,241,231,0.64)',
  faint: 'rgba(246,241,231,0.38)',
  success: '#86D3AE',
  danger: '#F0907F',
  paper: '#FBF7EE',          // the ticket stub
  paperInk: '#16130E',
};

export const F = {
  display: 'CormorantGaramond_700Bold',
  displaySemi: 'CormorantGaramond_600SemiBold',
  ui: 'Manrope_500Medium',
  uiSemi: 'Manrope_600SemiBold',
  uiBold: 'Manrope_700Bold',
  uiHeavy: 'Manrope_800ExtraBold',
};

export const tap = () => { Haptics.selectionAsync().catch(() => {}); };
export const thud = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); };

/** The one gold action on a screen. */
export const GoldButton = ({ label, onPress, disabled, busy, style, accessibilityLabel, testID }) => (
  <TouchableOpacity
    onPress={() => { if (!disabled && !busy) { thud(); onPress?.(); } }}
    activeOpacity={0.85}
    disabled={disabled || busy}
    style={[styles.goldWrap, (disabled && !busy) && styles.off, style]}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel || label}
    accessibilityState={{ disabled: !!disabled, busy: !!busy }}
    testID={testID}
  >
    <LinearGradient
      colors={['#F1DFB4', T.gold, '#A9833F']}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
    {busy ? <ActivityIndicator color={T.paperInk} /> : <Text style={styles.goldText}>{label}</Text>}
  </TouchableOpacity>
);

/** A quiet outlined action beside the gold one. */
export const GhostButton = ({ label, onPress, style, testID }) => (
  <TouchableOpacity
    onPress={() => { tap(); onPress?.(); }}
    style={[styles.ghost, style]}
    accessibilityRole="button"
    testID={testID}
  >
    <Text style={styles.ghostText}>{label}</Text>
  </TouchableOpacity>
);

/** A small all-caps label over a section. */
export const Kicker = ({ children, style }) => <Text style={[styles.kicker, style]}>{children}</Text>;

/** Day over month, as on an invitation's corner. */
export const DateTile = ({ day, month, style }) => (
  <View style={[styles.tile, style]}>
    <Text style={styles.tileDay}>{day}</Text>
    <Text style={styles.tileMonth}>{month}</Text>
  </View>
);

const PILL = {
  paid: { bg: 'rgba(134,211,174,0.14)', fg: T.success },
  pending: { bg: 'rgba(232,212,170,0.14)', fg: T.champagne },
  failed: { bg: 'rgba(240,144,127,0.14)', fg: T.danger },
  expired: { bg: 'rgba(240,144,127,0.14)', fg: T.danger },
  closed: { bg: 'rgba(246,241,231,0.10)', fg: T.muted },
};

/** A status in a word: paid, pending, failed, sold out… */
export const Pill = ({ kind = 'closed', label, style }) => {
  const c = PILL[kind] || PILL.closed;
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }, style]}>
      <Text style={[styles.pillText, { color: c.fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
};

/** A centred message with an optional action: empty lists, errors. */
export const Notice = ({ title, body, action, onAction, style }) => (
  <View style={[styles.notice, style]}>
    <Text style={styles.noticeTitle}>{title}</Text>
    {!!body && <Text style={styles.noticeBody}>{body}</Text>}
    {!!action && <GhostButton label={action} onPress={onAction} style={styles.noticeAction} />}
  </View>
);

const styles = StyleSheet.create({
  goldWrap: {
    height: 54, borderRadius: 27, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 26,
    shadowColor: T.gold, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  goldText: { fontFamily: F.uiHeavy, fontSize: 15.5, letterSpacing: 0.4, color: T.paperInk },
  off: { opacity: 0.4 },

  ghost: {
    height: 46, borderRadius: 23, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: T.lineStrong,
  },
  ghostText: { fontFamily: F.uiBold, fontSize: 14, color: T.champagne, letterSpacing: 0.3 },

  kicker: {
    fontFamily: F.uiBold, fontSize: 11, letterSpacing: 2.2, textTransform: 'uppercase', color: T.gold,
  },

  tile: {
    width: 54, paddingVertical: 7, borderRadius: 14, alignItems: 'center',
    backgroundColor: 'rgba(10,10,13,0.72)', borderWidth: StyleSheet.hairlineWidth, borderColor: T.lineStrong,
  },
  tileDay: { fontFamily: F.display, fontSize: 24, lineHeight: 26, color: T.ivory },
  tileMonth: { fontFamily: F.uiBold, fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: T.champagne },

  pill: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10, alignSelf: 'flex-start' },
  pillText: { fontFamily: F.uiBold, fontSize: 11, letterSpacing: 0.6 },

  notice: { alignItems: 'center', paddingHorizontal: 28, paddingVertical: 40 },
  noticeTitle: { fontFamily: F.display, fontSize: 26, lineHeight: 30, color: T.ivory, textAlign: 'center' },
  noticeBody: { fontFamily: F.ui, fontSize: 14.5, lineHeight: 22, color: T.muted, textAlign: 'center', marginTop: 10 },
  noticeAction: { marginTop: 20 },
});

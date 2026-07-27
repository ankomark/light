/**
 * Shared premium building blocks for the Live surface (champagne-gold system).
 * Used by LiveHub and LiveRoom so the look stays consistent.
 */
import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Image, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { radius } from '../../constants/theme';
import { live, goldGlow, fmtCount } from '../../constants/liveTheme';
import useReducedMotion from '../../utils/useReducedMotion';

const DEFAULT_AVATAR = require('../../assets/avatar-placeholder.jpg');

// A breathing red LIVE dot (a ring pulses outward and fades). Honors the OS
// "reduce motion" setting — falls back to a static dot.
export const PulseDot = ({ size = 7 }) => {
  const reduced = useReducedMotion();
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(
      Animated.timing(a, { toValue: 1, duration: 1700, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [a, reduced]);
  const scale = a.interpolate({ inputRange: [0, 1], outputRange: [1, 2.8] });
  const opacity = a.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {!reduced && (
        <Animated.View style={[
          styles.dotRing,
          { width: size, height: size, borderRadius: size / 2, transform: [{ scale }], opacity },
        ]} />
      )}
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: live.live }} />
    </View>
  );
};

export const LiveBadge = ({ small }) => (
  <View style={[styles.liveBadge, small && styles.liveBadgeSm]}>
    <PulseDot size={small ? 6 : 7} />
    <Text style={[styles.liveText, small && { fontSize: 8, letterSpacing: 1 }]}>LIVE</Text>
  </View>
);

// Champagne ring around a host avatar.
export const GoldRing = ({ uri, size }) => (
  <LinearGradient
    colors={[live.goldBright, live.goldDeep]}
    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
    style={{ width: size + 4, height: size + 4, borderRadius: (size + 4) / 2, padding: 2, ...goldGlow, shadowRadius: 10, elevation: 6 }}
  >
    <Image
      source={uri ? { uri } : DEFAULT_AVATAR}
      defaultSource={DEFAULT_AVATAR}
      style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: live.bg, backgroundColor: live.navy }}
    />
  </LinearGradient>
);

// Glass pill showing a viewer count (eye + tabular number).
export const ViewPill = ({ count }) => (
  <View style={styles.viewPill}>
    <Ionicons name="eye" size={12} color={live.ink} />
    <Text style={styles.viewPillText}>{fmtCount(count)}</Text>
  </View>
);

const styles = StyleSheet.create({
  dotRing: { position: 'absolute', backgroundColor: live.live },
  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 4,
    borderRadius: radius.full, backgroundColor: 'rgba(6,13,26,0.5)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(229,72,74,0.5)',
  },
  liveBadgeSm: { paddingHorizontal: 6, paddingVertical: 2, gap: 4 },
  liveText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  viewPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4,
    borderRadius: radius.full, backgroundColor: 'rgba(6,13,26,0.5)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: live.hair,
  },
  viewPillText: { color: live.ink, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
});

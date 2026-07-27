/**
 * On-screen broadcast graphics (lower third / banner / name tag / ticker),
 * TikTok-style. Purely presentational: the host authors one via GraphicComposer,
 * it rides the LiveKit data channel, and every client renders the current one
 * here as an overlay above the video. pointerEvents:none so it never blocks the
 * controls. Honors reduce-motion.
 *
 * graphic shape: { style: 'lower3'|'banner'|'nametag'|'ticker', title, sub }
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { live } from '../../constants/liveTheme';
import useReducedMotion from '../../utils/useReducedMotion';

function Ticker({ text }) {
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const x = useRef(new Animated.Value(width)).current;
  const [textW, setTextW] = useState(0);
  useEffect(() => {
    if (reduced || !textW) return undefined;
    x.setValue(width);
    const loop = Animated.loop(
      Animated.timing(x, {
        toValue: -textW,
        duration: Math.max(6000, (textW + width) * 14),
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [text, textW, width, reduced, x]);
  return (
    <View style={styles.tickerWrap} pointerEvents="none">
      <View style={styles.tickerTag}><Text style={styles.tickerTagText}>LIVE</Text></View>
      <View style={{ flex: 1, overflow: 'hidden' }}>
        <Animated.Text
          onLayout={(e) => setTextW(e.nativeEvent.layout.width)}
          numberOfLines={1}
          style={[styles.tickerText, reduced ? null : { transform: [{ translateX: x }] }]}
        >
          {text}
        </Animated.Text>
      </View>
    </View>
  );
}

export default function LiveGraphic({ graphic, insets, bottomOffset = 160 }) {
  const reduced = useReducedMotion();
  const anim = useRef(new Animated.Value(0)).current;
  const key = graphic ? `${graphic.style}|${graphic.title}|${graphic.sub || ''}` : '';

  useEffect(() => {
    if (!graphic) return;
    if (reduced) { anim.setValue(1); return; }
    anim.setValue(0);
    Animated.spring(anim, { toValue: 1, friction: 8, tension: 60, useNativeDriver: true }).start();
  }, [key, graphic, reduced, anim]);

  if (!graphic || !graphic.title) return null;
  const { style: s, title, sub } = graphic;

  const slideIn = {
    opacity: anim,
    transform: [{ translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) }],
  };
  const dropIn = {
    opacity: anim,
    transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }],
  };

  if (s === 'banner') {
    return (
      <Animated.View style={[styles.bannerWrap, { top: (insets?.top || 0) + 78 }, dropIn]} pointerEvents="none">
        <LinearGradient colors={live.gradCta} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.banner}>
          <Text style={styles.bannerText} numberOfLines={1}>{title}</Text>
          {sub ? <Text style={styles.bannerSub} numberOfLines={1}>{sub}</Text> : null}
        </LinearGradient>
      </Animated.View>
    );
  }

  if (s === 'nametag') {
    return (
      <Animated.View style={[styles.nametag, { bottom: bottomOffset }, slideIn]} pointerEvents="none">
        <View style={styles.nametagBar} />
        <Text style={styles.nametagText} numberOfLines={1}>{title}</Text>
        {sub ? <Text style={styles.nametagSub} numberOfLines={1}> · {sub}</Text> : null}
      </Animated.View>
    );
  }

  if (s === 'ticker') {
    return (
      <Animated.View style={[styles.tickerOuter, { bottom: bottomOffset }, dropIn]} pointerEvents="none">
        <Ticker text={title} />
      </Animated.View>
    );
  }

  // default: lower third
  return (
    <Animated.View style={[styles.lower3, { bottom: bottomOffset }, slideIn]} pointerEvents="none">
      <View style={styles.lower3Bar} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.lower3Title} numberOfLines={2}>{title}</Text>
        {sub ? <Text style={styles.lower3Sub} numberOfLines={1}>{sub}</Text> : null}
      </View>
    </Animated.View>
  );
}

const CARD = 'rgba(6,13,26,0.72)';

const styles = StyleSheet.create({
  // Lower third — bottom-left band with a gold accent bar
  lower3: {
    position: 'absolute', left: 16, right: 40,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: CARD, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: live.hair,
  },
  lower3Bar: { width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: live.gold },
  lower3Title: { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: 0.2 },
  lower3Sub: { color: live.gold, fontSize: 12.5, fontWeight: '600', marginTop: 2 },

  // Banner — full-width gold strip near the top
  bannerWrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  banner: {
    width: '100%', borderRadius: 999, paddingVertical: 9, paddingHorizontal: 18, alignItems: 'center',
  },
  bannerText: { color: live.onGold, fontSize: 14.5, fontWeight: '800', letterSpacing: 0.3 },
  bannerSub: { color: 'rgba(42,28,5,0.8)', fontSize: 11.5, fontWeight: '600', marginTop: 1 },

  // Name tag — compact pill bottom-left
  nametag: {
    position: 'absolute', left: 16, maxWidth: '75%',
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: CARD, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: live.hair,
  },
  nametagBar: { width: 3, height: 16, borderRadius: 2, backgroundColor: live.gold, marginRight: 8 },
  nametagText: { color: '#fff', fontSize: 13.5, fontWeight: '800' },
  nametagSub: { color: live.gold, fontSize: 12, fontWeight: '600' },

  // Ticker — scrolling strip near the bottom
  tickerOuter: { position: 'absolute', left: 0, right: 0 },
  tickerWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(6,13,26,0.82)',
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: live.hair,
    paddingVertical: 7,
  },
  tickerTag: { backgroundColor: live.gold, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, marginHorizontal: 10 },
  tickerTagText: { color: live.onGold, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  tickerText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});

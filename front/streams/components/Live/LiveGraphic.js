/**
 * On-screen broadcast graphics (lower third / banner / name tag / ticker),
 * TikTok-style. The current graphic rides the LiveKit data channel and every
 * client renders it here. Publishers (host/co-host) can DRAG it to reposition;
 * the position is stored normalised (0..1 of screen) so it maps across devices,
 * synced to everyone and persisted. Viewers see it non-interactive.
 *
 * graphic shape: { style, title, sub, x, y }  (x/y normalised top-left, or null)
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Animated, Easing, PanResponder, useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { live } from '../../constants/liveTheme';
import useReducedMotion from '../../utils/useReducedMotion';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

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
        toValue: -textW, duration: Math.max(6000, (textW + width) * 14),
        easing: Easing.linear, useNativeDriver: true,
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

export default function LiveGraphic({ graphic, insets, bottomOffset = 160, kbHeight = 0, editable = false, onReposition }) {
  const { width: W, height: H } = useWindowDimensions();
  const reduced = useReducedMotion();
  const anim = useRef(new Animated.Value(0)).current;

  const layoutRef = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const [drag, setDrag] = useState(null);          // {left, top} px while/after dragging
  const dragRef = useRef(null); dragRef.current = drag;
  const startRef = useRef({ left: 0, top: 0 });
  const editableRef = useRef(editable); editableRef.current = editable;
  const cbRef = useRef({}); cbRef.current = { W, H, onReposition };

  const key = graphic ? `${graphic.style}|${graphic.title}|${graphic.sub || ''}` : '';
  useEffect(() => {
    setDrag(null); // a fresh graphic (or an externally-synced move) resets the local drag override
    if (!graphic) return;
    if (reduced) { anim.setValue(1); return; }
    anim.setValue(0);
    Animated.spring(anim, { toValue: 1, friction: 8, tension: 60, useNativeDriver: true }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => editableRef.current,
    onMoveShouldSetPanResponder: (_e, g) => editableRef.current && (Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2),
    onPanResponderGrant: () => {
      const d = dragRef.current;
      startRef.current = { left: d ? d.left : layoutRef.current.x, top: d ? d.top : layoutRef.current.y };
    },
    onPanResponderMove: (_e, g) => setDrag({ left: startRef.current.left + g.dx, top: startRef.current.top + g.dy }),
    onPanResponderRelease: (_e, g) => {
      const { W: w0, H: h0, onReposition: cb } = cbRef.current;
      const { w, h } = layoutRef.current;
      const left = clamp(startRef.current.left + g.dx, 0, Math.max(0, w0 - w));
      const top = clamp(startRef.current.top + g.dy, 0, Math.max(0, h0 - h));
      setDrag({ left, top });
      // A pure tap (no real movement) shouldn't re-broadcast.
      if (Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3) {
        cb?.({ x: +(left / w0).toFixed(4), y: +(top / h0).toFixed(4) });
      }
    },
  })).current;

  if (!graphic || !graphic.title) return null;
  const { style: s, title, sub } = graphic;
  const cardW = Math.min(W - 32, 520);

  // Resolve position: live drag > explicit x/y > per-preset default.
  let posStyle;
  if (drag) {
    posStyle = { left: drag.left, top: drag.top };
  } else if (graphic.x != null && graphic.y != null) {
    posStyle = {
      left: clamp(graphic.x * W, 0, Math.max(0, W - (layoutRef.current.w || 0))),
      top: clamp(graphic.y * H, 0, Math.max(0, H - (layoutRef.current.h || 0))),
    };
  } else if (s === 'banner') {
    posStyle = { top: (insets?.top || 0) + 78, left: (W - cardW) / 2 };
  } else if (s === 'nametag') {
    posStyle = { left: 16, bottom: bottomOffset };
  } else if (s === 'ticker') {
    posStyle = { left: 0, bottom: bottomOffset };
  } else {
    posStyle = { left: 16, bottom: bottomOffset };
  }

  const onLayout = (e) => {
    const { x, y, width, height } = e.nativeEvent.layout;
    layoutRef.current = { x, y, w: width, h: height };
  };

  // Enter animation + a uniform lift by the keyboard height (project-wide
  // pattern) so the graphic rides above the keyboard like the chat dock does.
  const tf = [];
  if (!reduced) {
    tf.push({ translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [s === 'banner' ? 0 : -40, 0] }) });
    tf.push({ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [s === 'banner' ? -20 : 0, 0] }) });
  }
  if (kbHeight) tf.push({ translateY: -kbHeight });
  const enter = { opacity: reduced ? 1 : anim, transform: tf };

  let inner;
  if (s === 'banner') {
    inner = (
      <LinearGradient colors={live.gradCta} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.banner}>
        <Text style={styles.bannerText} numberOfLines={1}>{title}</Text>
        {sub ? <Text style={styles.bannerSub} numberOfLines={1}>{sub}</Text> : null}
      </LinearGradient>
    );
  } else if (s === 'nametag') {
    inner = (
      <View style={styles.nametag}>
        <View style={styles.nametagBar} />
        <Text style={styles.nametagText} numberOfLines={1}>{title}</Text>
        {sub ? <Text style={styles.nametagSub} numberOfLines={1}> · {sub}</Text> : null}
      </View>
    );
  } else if (s === 'ticker') {
    inner = <Ticker text={title} />;
  } else {
    inner = (
      <View style={styles.lower3}>
        <View style={styles.lower3Bar} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.lower3Title} numberOfLines={2}>{title}</Text>
          {sub ? <Text style={styles.lower3Sub} numberOfLines={1}>{sub}</Text> : null}
        </View>
      </View>
    );
  }

  const width = s === 'ticker' ? W : (s === 'nametag' ? undefined : cardW);

  return (
    <Animated.View
      onLayout={onLayout}
      pointerEvents={editable ? 'box-none' : 'none'}
      style={[styles.wrap, posStyle, width != null && { width }, enter]}
    >
      <View {...(editable ? pan.panHandlers : {})} pointerEvents={editable ? 'auto' : 'none'}>
        {editable && <View style={styles.dragHint}><Text style={styles.dragHintText}>drag to move</Text></View>}
        {inner}
      </View>
    </Animated.View>
  );
}

const CARD = 'rgba(6,13,26,0.72)';

const styles = StyleSheet.create({
  wrap: { position: 'absolute' },
  dragHint: {
    position: 'absolute', top: -18, left: 8, backgroundColor: 'rgba(6,13,26,0.7)',
    paddingHorizontal: 7, paddingVertical: 1, borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth, borderColor: live.hair, zIndex: 5,
  },
  dragHintText: { color: live.gold, fontSize: 9, fontWeight: '700', letterSpacing: 0.4 },

  lower3: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: CARD, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: live.hair,
  },
  lower3Bar: { width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: live.gold },
  lower3Title: { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: 0.2 },
  lower3Sub: { color: live.gold, fontSize: 12.5, fontWeight: '600', marginTop: 2 },

  banner: { width: '100%', borderRadius: 999, paddingVertical: 9, paddingHorizontal: 18, alignItems: 'center' },
  bannerText: { color: live.onGold, fontSize: 14.5, fontWeight: '800', letterSpacing: 0.3 },
  bannerSub: { color: 'rgba(42,28,5,0.8)', fontSize: 11.5, fontWeight: '600', marginTop: 1 },

  nametag: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center',
    backgroundColor: CARD, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: live.hair,
  },
  nametagBar: { width: 3, height: 16, borderRadius: 2, backgroundColor: live.gold, marginRight: 8 },
  nametagText: { color: '#fff', fontSize: 13.5, fontWeight: '800' },
  nametagSub: { color: live.gold, fontSize: 12, fontWeight: '600' },

  tickerWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(6,13,26,0.82)',
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: live.hair,
    paddingVertical: 7,
  },
  tickerTag: { backgroundColor: live.gold, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, marginHorizontal: 10 },
  tickerTagText: { color: live.onGold, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  tickerText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});

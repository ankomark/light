// "Popular": what people want now (the server's sort=popular — looks, saves
// and recent sales), as a row that glides by on its own, right to left, and
// round again without a seam.
//
// - A finger on it holds it still; it can be dragged either way, and picks
//   up again a moment after it is let go. A tap opens the product.
// - It stands still while the screen is out of sight or the app is in the
//   background, and runs on the native driver, so it costs the JS thread
//   nothing while the page scrolls.
// - With Reduce Motion or a screen reader on, it is an ordinary row that
//   scrolls by hand: nothing moves by itself.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, Easing, PanResponder, ScrollView,
  AppState, AccessibilityInfo, Platform, useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import useReducedMotion from '../../utils/useReducedMotion';
import { formatPrice } from '../../utils/market';

const PLACEHOLDER_IMAGE = require('../../assets/default-image.png');
const CARD_W = 150;
const CARD_H = 200;
const GAP = 12;
const STEP = CARD_W + GAP;
const SPEED = 32;                 // points a second: easy to read, never a blur
const RESUME_MS = 1800;           // after a finger lets go
const NATIVE = Platform.OS !== 'web';

const photoOf = (p) => (p?.images?.[0]?.image_url ? { uri: p.images[0].image_url } : PLACEHOLDER_IMAGE);
const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

/** One card: the photo edge to edge, its place in the ranking, and the
 *  title and price over a shade at the foot. */
const Card = React.memo(({ item, rank, onOpen, testID }) => (
  <TouchableOpacity style={styles.card} onPress={() => onOpen(item)} activeOpacity={0.9}
                    accessibilityRole="button"
                    accessibilityLabel={`${rank}. ${item.title}, ${formatPrice(item.price, item.currency)}`}
                    testID={testID}>
    <Image source={photoOf(item)} placeholder={PLACEHOLDER_IMAGE} contentFit="cover" transition={150}
           recyclingKey={String(item.id)} style={StyleSheet.absoluteFill} />
    <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(5,12,24,0.55)', 'rgba(5,12,24,0.92)']}
                    locations={[0.35, 0.65, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />
    <View style={[styles.rank, rank <= 3 && styles.rankTop]}>
      {rank <= 3 && <MaterialCommunityIcons name="fire" size={11} color="#0A1628" />}
      <Text style={styles.rankText}>{`#${rank}`}</Text>
    </View>
    {item.views > 0 && (
      <View style={styles.views}>
        <MaterialCommunityIcons name="eye-outline" size={11} color="#fff" />
        <Text style={styles.viewsText}>{compact(item.views)}</Text>
      </View>
    )}
    <View style={styles.body}>
      <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
      <Text style={styles.price} numberOfLines={1}>{formatPrice(item.price, item.currency)}</Text>
    </View>
  </TouchableOpacity>
));

const useScreenReader = () => {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isScreenReaderEnabled?.().then((v) => { if (live) setOn(!!v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('screenReaderChanged', (v) => setOn(!!v));
    return () => { live = false; sub?.remove?.(); };
  }, []);
  return on;
};

const PopularMarquee = ({ products, onOpen }) => {
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const screenReader = useScreenReader();
  const moving = !reduced && !screenReader && products.length >= 2;

  // One lap is every card once. Enough laps are drawn to fill the screen and
  // one more, so as the first slides out its twin is already in place.
  const lap = products.length * STEP;
  const laps = moving ? Math.max(2, Math.ceil(width / Math.max(lap, 1)) + 1) : 1;
  const track = useMemo(() => Array.from({ length: laps }, (_, l) => products.map((p, i) => ({
    p, rank: i + 1, key: `${l}-${p.id}`, first: l === 0,
  }))).flat(), [products, laps]);

  const x = useRef(new Animated.Value(0)).current;
  const at = useRef(0);                 // where it is, in (-lap, 0]
  const anim = useRef(null);
  const wrap = useCallback((v) => (lap ? (((v % lap) - lap) % lap) : 0), [lap]);

  const [focused, setFocused] = useState(true);
  const [active, setActive] = useState(AppState.currentState !== 'background');
  const [held, setHeld] = useState(false);
  const resumeTimer = useRef(null);

  useEffect(() => {
    const offs = [
      navigation.addListener?.('focus', () => setFocused(true)),
      navigation.addListener?.('blur', () => setFocused(false)),
    ];
    const sub = AppState.addEventListener?.('change', (s) => setActive(s === 'active'));
    return () => { offs.forEach((off) => typeof off === 'function' && off()); sub?.remove?.(); };
  }, [navigation]);

  const stop = useCallback(() => {
    anim.current?.stop();
    anim.current = null;
    x.stopAnimation((v) => { at.current = wrap(v); });
  }, [x, wrap]);

  const run = useCallback(() => {
    // From where it is to the end of the lap, then from the start again.
    const leg = Animated.timing(x, {
      toValue: -lap,
      duration: Math.max(16, ((lap + at.current) / SPEED) * 1000),
      easing: Easing.linear,
      useNativeDriver: NATIVE,
      isInteraction: false,             // never holds up InteractionManager work
    });
    anim.current = leg;
    leg.start(({ finished }) => {
      if (!finished || anim.current !== leg) return;
      x.setValue(0);
      at.current = 0;
      run();
    });
  }, [x, lap]);

  // Different cards: from the start. (Before the effect below, which then
  // starts it: setValue would stop an animation already under way.)
  useEffect(() => {
    at.current = 0;
    x.setValue(0);
  }, [lap, x]);

  const running = moving && focused && active && !held;
  useEffect(() => {
    if (!running) return undefined;
    run();
    return stop;
  }, [running, run, stop]);

  useEffect(() => () => clearTimeout(resumeTimer.current), []);

  const hold = useCallback(() => {
    clearTimeout(resumeTimer.current);
    setHeld(true);
  }, []);
  const letGo = useCallback(() => {
    clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => setHeld(false), RESUME_MS);
  }, []);

  const dragFrom = useRef(0);
  const pan = useMemo(() => PanResponder.create({
    // Sideways only: an up-and-down drag is the page scrolling.
    onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
    onPanResponderGrant: () => {
      stop();
      dragFrom.current = at.current;
    },
    onPanResponderMove: (_, g) => {
      const v = wrap(dragFrom.current + g.dx);
      at.current = v;
      x.setValue(v);
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: letGo,
    onPanResponderTerminate: letGo,
  }), [stop, wrap, x, letGo]);

  if (!moving) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.still}
                  style={styles.bleed} testID="popular-row">
        {track.map(({ p, rank, key }) => (
          <Card key={key} item={p} rank={rank} onOpen={onOpen} testID={`spot-${p.id}`} />
        ))}
      </ScrollView>
    );
  }

  return (
    <View style={[styles.bleed, styles.window]} {...pan.panHandlers}
          onTouchStart={hold} onTouchEnd={letGo} onTouchCancel={letGo} testID="popular-marquee">
      <Animated.View style={[styles.belt, { transform: [{ translateX: x }] }]}>
        {track.map(({ p, rank, key, first }) => (
          <Card key={key} item={p} rank={rank} onOpen={onOpen}
                testID={first ? `spot-${p.id}` : undefined} />
        ))}
      </Animated.View>
      {/* The cards come in out of the page and go back into it. */}
      <LinearGradient colors={['rgba(10,22,40,0.85)', 'rgba(10,22,40,0)']} start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }} style={[styles.fade, styles.fadeLeft]} pointerEvents="none" />
      <LinearGradient colors={['rgba(10,22,40,0)', 'rgba(10,22,40,0.85)']} start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }} style={[styles.fade, styles.fadeRight]} pointerEvents="none" />
    </View>
  );
};

const PAD = 16;
const styles = StyleSheet.create({
  // Edge to edge, out of the page's side padding, so cards glide in from
  // beyond the screen rather than appearing at a margin.
  bleed: { marginHorizontal: -PAD },
  window: { height: CARD_H + 8, overflow: 'hidden', justifyContent: 'center' },
  belt: { flexDirection: 'row', paddingLeft: PAD },
  still: { paddingHorizontal: PAD, gap: GAP, paddingVertical: 4 },
  fade: { position: 'absolute', top: 0, bottom: 0, width: 28 },
  fadeLeft: { left: 0 },
  fadeRight: { right: 0 },

  card: {
    width: CARD_W, height: CARD_H, marginRight: GAP, borderRadius: 16, overflow: 'hidden',
    backgroundColor: '#1D2B40',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,196,107,0.45)',
  },
  rank: {
    position: 'absolute', top: 8, left: 8, flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.88)',
  },
  rankTop: { backgroundColor: '#FFC46B' },
  rankText: { color: '#0A1628', fontSize: 11, fontWeight: '800' },
  views: {
    position: 'absolute', top: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.45)',
  },
  viewsText: { color: '#fff', fontSize: 10.5, fontWeight: '700' },
  body: { position: 'absolute', left: 10, right: 10, bottom: 10 },
  title: { color: '#fff', fontSize: 13.5, fontWeight: '700', lineHeight: 17 },
  price: { color: '#FFC46B', fontSize: 14.5, fontWeight: '800', marginTop: 3 },
});

export default PopularMarquee;

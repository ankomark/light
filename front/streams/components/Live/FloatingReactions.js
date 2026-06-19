/**
 * Floating reaction bursts (IG/TikTok-live style). Imperative API:
 *   const ref = useRef();
 *   ref.current.add('❤️');
 * Each emoji drifts up, wobbles, scales and fades, then removes itself.
 */
import React, {
  forwardRef, useImperativeHandle, useRef, useState, useEffect, useCallback,
} from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

let _seq = 0;

const Heart = ({ emoji, onDone }) => {
  const t = useRef(new Animated.Value(0)).current;
  // Randomised drift so a burst doesn't look like a single column.
  const drift = useRef((Math.random() - 0.5) * 80).current;
  const rise = useRef(220 + Math.random() * 120).current;
  const startScale = useRef(0.7 + Math.random() * 0.5).current;

  useEffect(() => {
    Animated.timing(t, {
      toValue: 1,
      duration: 2200 + Math.random() * 600,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => onDone());
  }, []);

  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, -rise] });
  const translateX = t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, drift, drift * 0.4] });
  const opacity = t.interpolate({ inputRange: [0, 0.1, 0.8, 1], outputRange: [0, 1, 1, 0] });
  const scale = t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [startScale, startScale * 1.25, startScale] });

  return (
    <Animated.View style={[styles.heart, { opacity, transform: [{ translateY }, { translateX }, { scale }] }]}>
      <Text style={styles.emoji}>{emoji}</Text>
    </Animated.View>
  );
};

const FloatingReactions = forwardRef((_props, ref) => {
  const [items, setItems] = useState([]);

  const add = useCallback((emoji = '❤️') => {
    const id = ++_seq;
    setItems((prev) => [...prev.slice(-24), { id, emoji }]); // cap so a spam burst can't grow unbounded
  }, []);

  useImperativeHandle(ref, () => ({ add }), [add]);

  const remove = useCallback((id) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  return (
    <View pointerEvents="none" style={styles.layer}>
      {items.map((it) => (
        <Heart key={it.id} emoji={it.emoji} onDone={() => remove(it.id)} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  layer: { position: 'absolute', right: 8, bottom: 0, width: 120, height: 360, alignItems: 'center', justifyContent: 'flex-end' },
  heart: { position: 'absolute', bottom: 0 },
  emoji: { fontSize: 28 },
});

export default FloatingReactions;

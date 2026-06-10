import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { colors } from '../constants/theme';

/**
 * Lightweight animated audio-bar visualizer.
 *
 * expo-av doesn't expose real-time frequency/metering data for playback, so the
 * bars pulse with randomized heights while `playing` is true and settle to a low
 * flat line when paused. Bars scale with the native driver (anchored at their
 * base via transformOrigin) so it stays smooth even while the feed scrolls.
 */
const AudioVisualizer = ({
  playing = true,
  barCount = 4,
  height = 22,
  color = colors.white,
}) => {
  const bars = useRef(
    Array.from({ length: barCount }, () => new Animated.Value(0.35))
  ).current;

  useEffect(() => {
    let cancelled = false;

    const pulse = (bar, delay) => {
      const next = () => {
        if (cancelled) return;
        Animated.timing(bar, {
          toValue: 0.25 + Math.random() * 0.75,
          duration: 220 + Math.random() * 240,
          useNativeDriver: true,
        }).start(({ finished }) => finished && next());
      };
      setTimeout(next, delay);
    };

    if (playing) {
      bars.forEach((bar, i) => pulse(bar, i * 70));
    } else {
      bars.forEach((bar) =>
        Animated.timing(bar, {
          toValue: 0.3,
          duration: 200,
          useNativeDriver: true,
        }).start()
      );
    }

    return () => {
      cancelled = true;
    };
  }, [playing, bars]);

  return (
    <View style={[styles.row, { height }]}>
      {bars.map((bar, i) => (
        <Animated.View
          key={i}
          style={[
            styles.bar,
            {
              height,
              backgroundColor: color,
              transform: [{ scaleY: bar }],
              transformOrigin: 'bottom',
            },
          ]}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  bar: {
    width: 3.5,
    marginHorizontal: 2,
    borderRadius: 2,
  },
});

export default React.memo(AudioVisualizer);

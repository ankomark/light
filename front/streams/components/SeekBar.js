import React, { useRef, useState } from 'react';
import { View, PanResponder, StyleSheet } from 'react-native';
import { colors as defaultColors } from '../constants/theme';

const clamp01 = (n) => Math.max(0, Math.min(1, n));

/**
 * View-based seek bar with the same callback shape as
 * `@react-native-community/slider` (onSlidingStart / onValueChange /
 * onSlidingComplete + `value` 0..1).
 *
 * Why this exists: on the New Architecture (Fabric), the community Slider
 * ignores programmatic updates to its `value` prop after mount, so the playback
 * progress never advances on screen. This component renders the progress with
 * plain Views (which always re-render) and handles seeking with a PanResponder,
 * so it works regardless of architecture and ships as an OTA update.
 */
const SeekBar = ({
  value = 0,
  onSlidingStart,
  onValueChange,
  onSlidingComplete,
  disabled = false,
  minimumTrackTintColor = defaultColors.primary,
  maximumTrackTintColor = defaultColors.border,
  thumbTintColor = defaultColors.white,
  trackHeight = 4,
  thumbSize = 14,
  style,
}) => {
  const widthRef = useRef(0);
  const startRatioRef = useRef(0);
  const [dragRatio, setDragRatio] = useState(null);

  // Latest props live in a ref so the PanResponder (created once) never reads a
  // stale `disabled` / callback closure.
  const propsRef = useRef();
  propsRef.current = { onSlidingStart, onValueChange, onSlidingComplete, disabled };

  const ratioFromX = (x) =>
    widthRef.current > 0 ? clamp01(x / widthRef.current) : 0;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !propsRef.current.disabled,
      onMoveShouldSetPanResponder: () => !propsRef.current.disabled,
      onPanResponderGrant: (evt) => {
        const r = ratioFromX(evt.nativeEvent.locationX);
        startRatioRef.current = r;
        setDragRatio(r);
        propsRef.current.onSlidingStart?.();
        propsRef.current.onValueChange?.(r);
      },
      onPanResponderMove: (_evt, g) => {
        const r = clamp01(startRatioRef.current + g.dx / (widthRef.current || 1));
        setDragRatio(r);
        propsRef.current.onValueChange?.(r);
      },
      onPanResponderRelease: (_evt, g) => {
        const r = clamp01(startRatioRef.current + g.dx / (widthRef.current || 1));
        setDragRatio(null);
        propsRef.current.onSlidingComplete?.(r);
      },
      onPanResponderTerminate: (_evt, g) => {
        const r = clamp01(startRatioRef.current + g.dx / (widthRef.current || 1));
        setDragRatio(null);
        propsRef.current.onSlidingComplete?.(r);
      },
    })
  ).current;

  const ratio = clamp01(dragRatio != null ? dragRatio : value);

  return (
    <View
      style={[styles.container, style]}
      onLayout={(e) => {
        widthRef.current = e.nativeEvent.layout.width;
      }}
      {...pan.panHandlers}
    >
      <View style={[styles.track, { height: trackHeight, backgroundColor: maximumTrackTintColor }]}>
        <View
          style={[
            styles.fill,
            { width: `${ratio * 100}%`, backgroundColor: minimumTrackTintColor },
          ]}
        />
      </View>
      <View
        style={[
          styles.thumb,
          {
            width: thumbSize,
            height: thumbSize,
            borderRadius: thumbSize / 2,
            backgroundColor: thumbTintColor,
            left: `${ratio * 100}%`,
            marginLeft: -thumbSize / 2,
            opacity: disabled ? 0 : 1,
          },
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: 28,
    justifyContent: 'center',
  },
  track: {
    width: '100%',
    borderRadius: 999,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
  },
  thumb: {
    position: 'absolute',
  },
});

export default SeekBar;

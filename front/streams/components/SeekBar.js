import React, { useMemo, useRef, useState } from 'react';
import { View, PanResponder, StyleSheet } from 'react-native';
import { colors as defaultColors } from '../constants/theme';
import waveformBars from '../utils/waveformBars';

const BAR_WIDTH = 3;
const BAR_GAP = 2;

const clamp01 = (n) => {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
};

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
 *
 * With `peaks` (a song's waveform, 0..1 each) it draws the song's shape as
 * bars instead of a line — played bars in the fill colour — and seeks the
 * same way.
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
  peaks = null,
  waveHeight = 44,
  style,
}) => {
  const widthRef = useRef(0);
  const [width, setWidth] = useState(0);
  const bars = useMemo(
    () => (peaks && width ? waveformBars(peaks, Math.floor((width + BAR_GAP) / (BAR_WIDTH + BAR_GAP))) : []),
    [peaks, width],
  );
  const wave = bars.length > 0;
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
      style={[styles.container, style, wave && { height: waveHeight + 8 }]}
      onLayout={(e) => {
        widthRef.current = e.nativeEvent.layout.width;
        // Always, not only once there are peaks: Now Playing lays the bar out
        // before the song's waveform arrives, and nothing re-lays it out after
        // — so a width kept only "if peaks" stayed 0 and no bars ever drew.
        setWidth(e.nativeEvent.layout.width);
      }}
      accessible
      accessibilityRole="adjustable"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}
      {...pan.panHandlers}
    >
      {wave ? (
        <View style={[styles.wave, { height: waveHeight }]} pointerEvents="none">
          {bars.map((h, i) => (
            <View
              key={i}
              style={[
                styles.bar,
                {
                  height: `${h * 100}%`,
                  backgroundColor: (i + 0.5) / bars.length <= ratio ? minimumTrackTintColor : maximumTrackTintColor,
                },
              ]}
            />
          ))}
        </View>
      ) : (
        <View style={[styles.track, { height: trackHeight, backgroundColor: maximumTrackTintColor }]}>
          <View
            style={[
              styles.fill,
              { width: `${ratio * 100}%`, backgroundColor: minimumTrackTintColor },
            ]}
          />
        </View>
      )}
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
            // The waveform shows progress itself; a dot on top would hide a bar.
            opacity: disabled || wave ? 0 : 1,
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
  wave: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: BAR_GAP,
  },
  bar: {
    flex: 1,
    borderRadius: BAR_WIDTH,
  },
});

export default SeekBar;

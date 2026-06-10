import React, { useMemo, useRef, useState } from 'react';
import { View, StyleSheet, PanResponder } from 'react-native';
import { colors } from '../constants/theme';

const TRACK_HEIGHT = 72;
const HANDLE_W = 18;
const BAR_COUNT = 48;

/**
 * Professional-feeling audio range trimmer.
 *
 * A waveform strip with a draggable selection window: drag either edge handle to
 * resize, or drag the middle to slide the whole window. The selection is clamped
 * to [minClipMs, maxClipMs]. A playhead line tracks preview position. All values
 * are in milliseconds.
 *
 * Controlled: the parent owns startMs/endMs and updates them from onChange. Live
 * refs feed the (created-once) PanResponders so they never use stale closures.
 */
export default function AudioTrimmer({
  durationMs = 0,
  startMs = 0,
  endMs = 0,
  playheadMs = null,
  minClipMs = 1000,
  maxClipMs = 30000,
  onChange,
  color = colors.primary,
}) {
  const [trackW, setTrackW] = useState(0);

  // Stable decorative waveform (real PCM isn't available from expo-av playback).
  const bars = useMemo(
    () => Array.from({ length: BAR_COUNT }, () => 0.28 + Math.random() * 0.72),
    []
  );

  // Live state for the pan responders + the change callback (avoids stale closures).
  const live = useRef({ durationMs, startMs, endMs, trackW, onChange, minClipMs, maxClipMs });
  live.current = { durationMs, startMs, endMs, trackW, onChange, minClipMs, maxClipMs };

  const dragRef = useRef({ start: 0, end: 0 });

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const makeResponder = (mode) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        dragRef.current = { start: live.current.startMs, end: live.current.endMs };
      },
      onPanResponderMove: (_evt, g) => {
        const { durationMs: D, trackW: W, minClipMs: minC, maxClipMs: maxC } = live.current;
        if (W <= 0 || D <= 0) return;
        const deltaMs = (g.dx / W) * D;
        let { start, end } = dragRef.current;

        if (mode === 'start') {
          start = clamp(start + deltaMs, 0, end - minC);
          if (end - start > maxC) start = end - maxC;
        } else if (mode === 'end') {
          end = clamp(end + deltaMs, start + minC, D);
          if (end - start > maxC) end = start + maxC;
        } else {
          const width = end - start;
          start = clamp(start + deltaMs, 0, D - width);
          end = start + width;
        }
        live.current.onChange?.(start, end);
      },
    });

  const leftPan = useRef(makeResponder('start')).current;
  const rightPan = useRef(makeResponder('end')).current;
  const regionPan = useRef(makeResponder('region')).current;

  const msToX = (ms) => (durationMs > 0 ? clamp((ms / durationMs) * trackW, 0, trackW) : 0);
  const startX = msToX(startMs);
  const endX = msToX(endMs);
  const startFrac = durationMs > 0 ? startMs / durationMs : 0;
  const endFrac = durationMs > 0 ? endMs / durationMs : 1;

  return (
    <View
      style={styles.track}
      onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
    >
      {/* Waveform bars (brighten inside the selection). */}
      <View style={styles.waveRow} pointerEvents="none">
        {bars.map((h, i) => {
          const f = (i + 0.5) / bars.length;
          const inSel = f >= startFrac && f <= endFrac;
          return (
            <View
              key={i}
              style={[
                styles.waveBar,
                { height: `${h * 100}%`, backgroundColor: inSel ? color : '#33455a' },
              ]}
            />
          );
        })}
      </View>

      {/* Dim the trimmed-away portions. */}
      <View style={[styles.dim, { left: 0, width: startX }]} pointerEvents="none" />
      <View style={[styles.dim, { left: endX, width: Math.max(0, trackW - endX) }]} pointerEvents="none" />

      {/* Selection outline. */}
      <View
        style={[styles.selection, { left: startX, width: Math.max(0, endX - startX), borderColor: color }]}
        pointerEvents="none"
      />

      {/* Middle: drag to move the whole window. */}
      <View
        style={[
          styles.regionTouch,
          { left: startX + HANDLE_W, width: Math.max(0, endX - startX - HANDLE_W * 2) },
        ]}
        {...regionPan.panHandlers}
      />

      {/* Playhead. */}
      {playheadMs != null && (
        <View style={[styles.playhead, { left: msToX(playheadMs) }]} pointerEvents="none" />
      )}

      {/* Edge handles. */}
      <View style={[styles.handle, { left: startX - HANDLE_W / 2, backgroundColor: color }]} {...leftPan.panHandlers}>
        <View style={styles.grip} />
      </View>
      <View style={[styles.handle, { left: endX - HANDLE_W / 2, backgroundColor: color }]} {...rightPan.panHandlers}>
        <View style={styles.grip} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: TRACK_HEIGHT,
    borderRadius: 10,
    backgroundColor: '#0d2236',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  waveRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  waveBar: {
    flex: 1,
    marginHorizontal: 1,
    borderRadius: 2,
    minHeight: 3,
  },
  dim: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(10,22,40,0.66)',
  },
  selection: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderWidth: 2,
    borderRadius: 8,
  },
  regionTouch: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
  handle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: HANDLE_W,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grip: {
    width: 3,
    height: 26,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  playhead: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#fff',
  },
});

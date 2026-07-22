import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { colors } from '../constants/theme';

const WAVE_HEIGHT = 88;                 // the clipped waveform strip
const HANDLE_W = 14;                    // grab-bar width (visual only; the whole
                                        // track is the touch target)
const HANDLE_H = WAVE_HEIGHT + 28;      // protrudes 14px above & below the wave
const GRAB = 34;                        // px from a handle centre that counts as grabbing it
const BAR_COUNT = 48;                   // bars in the full-song overview strip
const DETAIL_SAMPLES = 240;             // high-res waveform the zoom strip slices
const ZOOM_BARS = 56;                   // fixed bar count in the zoom strip
const ZOOM_HEIGHT = 72;                 // zoomed "selected 30s" waveform strip
const BUBBLE_W = 58;                    // floating timestamp bubble width

const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ms -> m:ss for the floating timestamp bubbles.
const fmtTime = (ms) => {
  const t = Math.max(0, Math.floor((ms || 0) / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/**
 * Professional-feeling audio range trimmer.
 *
 * A waveform strip with a draggable selection window plus a zoomed view of the
 * selected clip. A single pan gesture drives everything: where your finger lands
 * decides the action — grab near the left/right edge to resize, or press anywhere
 * else to slide the whole window across the song. One gesture (no overlapping
 * touch targets) is what makes dragging reliable, including inside a modal.
 *
 * Controlled: the parent owns startMs/endMs and updates them from onChange. A
 * live ref feeds the (created-once) gesture so it never uses stale closures.
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
  // Which part is being dragged ('start' | 'end' | 'region' | null) — drives the
  // floating timestamp bubbles.
  const [dragging, setDragging] = useState(null);

  // Stable high-resolution decorative waveform (real PCM isn't available from
  // expo-av playback). The overview strip downsamples it; the zoom strip slices
  // the selected window out of it — both stay consistent as the window moves.
  const detail = useMemo(
    () => Array.from({ length: DETAIL_SAMPLES }, () => 0.22 + Math.random() * 0.78),
    []
  );
  // Overview bars: peak of each downsampled group of the high-res waveform.
  const bars = useMemo(() => {
    const size = detail.length / BAR_COUNT;
    return Array.from({ length: BAR_COUNT }, (_, g) => {
      const s = Math.floor(g * size);
      const e = Math.max(s + 1, Math.floor((g + 1) * size));
      let peak = 0;
      for (let i = s; i < e; i++) peak = Math.max(peak, detail[i]);
      return peak || 0.3;
    });
  }, [detail]);
  // Zoom strip: the selected window resampled to a fixed number of bars and
  // stretched to full width, so the 30s of waves is big and legible.
  const zoomBars = useMemo(() => {
    const sF = durationMs > 0 ? clampN(startMs / durationMs, 0, 1) : 0;
    const eF = durationMs > 0 ? clampN(endMs / durationMs, 0, 1) : 1;
    const s = sF * detail.length;
    const span = Math.max(1, eF * detail.length - s);
    return Array.from({ length: ZOOM_BARS }, (_, i) => {
      const idx = Math.min(detail.length - 1, Math.floor(s + (i / ZOOM_BARS) * span));
      return detail[idx];
    });
  }, [detail, startMs, endMs, durationMs]);

  // Handle centres travel this inset range, so a bar is never clipped at an edge.
  const usableW = Math.max(1, trackW - HANDLE_W);

  // Live values for the (created-once) gesture callbacks (avoids stale closures).
  const live = useRef({ durationMs, startMs, endMs, usableW, onChange, minClipMs, maxClipMs });
  live.current = { durationMs, startMs, endMs, usableW, onChange, minClipMs, maxClipMs };

  const dragRef = useRef({ start: 0, end: 0 });
  const modeRef = useRef('region');
  const lastTickRef = useRef(null);

  // Map a time to the centre-x of its handle (inset so bars never clip at edges).
  const centerX = (ms, W = usableW, D = durationMs) =>
    D > 0 ? HANDLE_W / 2 + clampN(ms / D, 0, 1) * W : HANDLE_W / 2;
  const startCX = centerX(startMs);
  const endCX = centerX(endMs);

  // ONE pan gesture for the whole track. runOnJS so callbacks can touch state.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .onBegin((e) => {
          const { startMs: sMs, endMs: eMs, usableW: W, durationMs: D } = live.current;
          const sCX = centerX(sMs, W, D);
          const eCX = centerX(eMs, W, D);
          const dS = Math.abs(e.x - sCX);
          const dE = Math.abs(e.x - eCX);
          // Nearest edge within GRAB resizes; anything else moves the window.
          let mode = 'region';
          if (dS <= GRAB && dS <= dE) mode = 'start';
          else if (dE <= GRAB) mode = 'end';
          modeRef.current = mode;
          dragRef.current = { start: sMs, end: eMs };
          lastTickRef.current = null;
          setDragging(mode);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        })
        .onUpdate((e) => {
          const { durationMs: D, usableW: W, minClipMs: minC, maxClipMs: maxC, onChange: cb } =
            live.current;
          if (W <= 0 || D <= 0) return;
          const deltaMs = (e.translationX / W) * D;
          let { start, end } = dragRef.current;
          const mode = modeRef.current;

          if (mode === 'start') {
            start = clampN(start + deltaMs, 0, end - minC);
            if (end - start > maxC) start = end - maxC;
          } else if (mode === 'end') {
            end = clampN(end + deltaMs, start + minC, D);
            if (end - start > maxC) end = start + maxC;
          } else {
            const width = end - start;
            start = clampN(start + deltaMs, 0, D - width);
            end = start + width;
          }

          // Light haptic tick each time the dragged edge crosses a whole second.
          const edgeMs = mode === 'end' ? end : start;
          const sec = Math.round(edgeMs / 1000);
          if (lastTickRef.current !== sec) {
            lastTickRef.current = sec;
            Haptics.selectionAsync().catch(() => {});
          }

          cb?.(start, end);
        })
        .onFinalize(() => setDragging(null)),
    []
  );

  return (
    <View>
      <GestureDetector gesture={pan}>
        <View
          style={styles.track}
          onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
        >
          {/* Clipped waveform layer: bars + dimmed regions + selection outline. */}
          <View style={styles.waveClip} pointerEvents="none">
            <View style={styles.waveRow}>
              {bars.map((h, i) => {
                const barX = ((i + 0.5) / bars.length) * trackW;
                const inSel = barX >= startCX && barX <= endCX;
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
            <View style={[styles.dim, { left: 0, width: startCX }]} />
            <View style={[styles.dim, { left: endCX, width: Math.max(0, trackW - endCX) }]} />

            {/* Selection outline. */}
            <View
              style={[styles.selection, { left: startCX, width: Math.max(0, endCX - startCX), borderColor: color }]}
            />
          </View>

          {/* Playhead. */}
          {playheadMs != null && (
            <View style={[styles.playhead, { left: centerX(playheadMs) }]} pointerEvents="none" />
          )}

          {/* Edge grab-bars — visual only; the single pan gesture handles touch. */}
          <View
            style={[styles.handle, { left: startCX - HANDLE_W / 2, backgroundColor: color }]}
            pointerEvents="none"
          >
            <View style={styles.grip} />
          </View>
          <View
            style={[styles.handle, { left: endCX - HANDLE_W / 2, backgroundColor: color }]}
            pointerEvents="none"
          >
            <View style={styles.grip} />
          </View>

          {/* Floating timestamp bubbles above the active handle(s) while dragging. */}
          {(dragging === 'start' || dragging === 'region') && (
            <View style={[styles.bubble, { left: startCX - BUBBLE_W / 2 }]} pointerEvents="none">
              <Text style={styles.bubbleText}>{fmtTime(startMs)}</Text>
              <View style={styles.caret} />
            </View>
          )}
          {(dragging === 'end' || dragging === 'region') && (
            <View style={[styles.bubble, { left: endCX - BUBBLE_W / 2 }]} pointerEvents="none">
              <Text style={styles.bubbleText}>{fmtTime(endMs)}</Text>
              <View style={styles.caret} />
            </View>
          )}
        </View>
      </GestureDetector>

      {/* Zoomed waveform of the selected window — the up-to-30s selection
          stretched to full width so its wave detail is big and legible, with a
          length badge showing exactly how many seconds are selected. */}
      <View style={styles.zoom}>
        <View style={styles.zoomRow} pointerEvents="none">
          {zoomBars.map((h, i) => (
            <View
              key={i}
              style={[styles.zoomBar, { height: `${h * 100}%`, backgroundColor: color }]}
            />
          ))}
        </View>
        <View style={styles.zoomBadge} pointerEvents="none">
          <Text style={styles.zoomBadgeText}>{((endMs - startMs) / 1000).toFixed(1)}s</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: HANDLE_H,
    justifyContent: 'center',
    marginTop: 16, // room for the floating timestamp bubbles above the handles
  },
  waveClip: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: (HANDLE_H - WAVE_HEIGHT) / 2,
    height: WAVE_HEIGHT,
    borderRadius: 12,
    backgroundColor: '#0d2236',
    overflow: 'hidden',
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
    borderRadius: 10,
  },
  handle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: HANDLE_W,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    // Premium lift so the grab-bars read as raised, tappable controls.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  grip: {
    width: 2,
    height: 20,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  playhead: {
    position: 'absolute',
    top: (HANDLE_H - WAVE_HEIGHT) / 2,
    height: WAVE_HEIGHT,
    width: 2,
    backgroundColor: '#fff',
  },
  bubble: {
    position: 'absolute',
    top: -13,
    width: BUBBLE_W,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(13,22,40,0.96)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 6,
  },
  bubbleText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  caret: {
    position: 'absolute',
    bottom: -5,
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: 'rgba(13,22,40,0.96)',
  },
  // Zoomed "selected window" waveform below the overview timeline.
  zoom: {
    marginTop: 14,
    height: ZOOM_HEIGHT,
    borderRadius: 12,
    backgroundColor: '#0d2236',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  zoomRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  zoomBar: {
    flex: 1,
    marginHorizontal: 1,
    borderRadius: 2,
    minHeight: 3,
  },
  zoomBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(13,22,40,0.9)',
  },
  zoomBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});

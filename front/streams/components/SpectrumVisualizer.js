// The spectrum visualizer: bars that dance with the song playing, bass in the
// middle and treble out to both edges, growing up and down from a centre line.
//
// Nothing is analysed on the phone. The server measured the song's bands ten
// times a second when it processed it (utils/spectrum.js); this only plays
// that back in step with the player — moving on from the last position the
// player reported (it reports twice a second) so the bars stay smooth.
//
// Decoration, so it stays cheap and out of the way: 30 frames a second, only
// while the song plays and the app is in front, still bars (a resting line)
// when paused, nothing at all for "reduce motion" or a song without the data.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, StyleSheet, View } from 'react-native';
import { usePlayer, usePlayerProgress } from '../context/PlayerContext';
import { fetchSpectrum } from '../services/api';
import { levelsAt } from '../utils/spectrum';
import useReducedMotion from '../utils/useReducedMotion';

const FRAME_MS = 33;          // ~30 fps
const REST = 0.06;            // a resting bar: a short dash on the centre line
const RISE = 0.55;            // how fast a bar jumps to a beat
const FALL = 0.16;            // and how gently it drops back

// Left to right, like a stage light bar: red, orange, yellow, lime, green.
const STOPS = [[255, 59, 48], [255, 149, 0], [255, 214, 10], [163, 230, 53], [52, 199, 89]];
const colourAt = (x) => {
  const p = Math.max(0, Math.min(1, x)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(p));
  const f = p - i;
  const [r, g, b] = STOPS[i].map((c, k) => Math.round(c + (STOPS[i + 1][k] - c) * f));
  return `rgb(${r},${g},${b})`;
};

const SpectrumVisualizer = ({ url, height = 72, style }) => {
  const { isPlaying } = usePlayer();
  const { positionMs } = usePlayerProgress();
  const reduced = useReducedMotion();
  const [spec, setSpec] = useState(null);

  useEffect(() => {
    let alive = true;
    setSpec(null);
    if (url) fetchSpectrum(url).then((s) => { if (alive) setSpec(s); });
    return () => { alive = false; };
  }, [url]);

  const bands = spec?.bands || 0;
  // One animated height per band; the mirrored bar on the other side shares it.
  const values = useMemo(() => Array.from({ length: bands }, () => new Animated.Value(REST)), [bands]);

  // Where the song was when the player last said, and when that was.
  const anchor = useRef({ pos: 0, at: 0 });
  useEffect(() => { anchor.current = { pos: positionMs, at: Date.now() }; }, [positionMs]);

  // What each bar shows now — kept across play/pause, so pausing lets the bars
  // fall back instead of snapping them down.
  const shownRef = useRef(null);

  useEffect(() => {
    if (!spec || reduced) return undefined;
    if (shownRef.current?.length !== spec.bands) shownRef.current = new Float32Array(spec.bands).fill(REST);
    const shown = shownRef.current;
    const target = new Float32Array(spec.bands);
    let raf = null;
    let last = 0;
    // Paused only when the app is actually away: right after launch iOS can
    // still report 'unknown', and `=== 'active'` froze the bars until the app
    // had been to the background and back.
    const away = (s) => s === 'background' || s === 'inactive';
    let appActive = !away(AppState.currentState);
    const sub = AppState.addEventListener?.('change', (s) => { appActive = !away(s); });

    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      if (!appActive || now - last < FRAME_MS) return;
      last = now;
      if (isPlaying) {
        levelsAt(spec, anchor.current.pos + (Date.now() - anchor.current.at), target);
      } else {
        target.fill(REST);
      }
      let moving = false;
      for (let i = 0; i < spec.bands; i += 1) {
        const goal = Math.max(REST, target[i]);
        const next = shown[i] + (goal - shown[i]) * (goal > shown[i] ? RISE : FALL);
        if (Math.abs(next - shown[i]) > 0.002) moving = true;
        shown[i] = next;
        values[i].setValue(next);
      }
      // Paused and settled: stop until playback starts again.
      if (!isPlaying && !moving) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
      sub?.remove?.();
    };
  }, [spec, reduced, isPlaying, values]);

  if (!spec || reduced) return null;

  // Treble … bass | bass … treble.
  const order = [...Array.from({ length: bands }, (_, i) => bands - 1 - i), ...Array.from({ length: bands }, (_, i) => i)];
  return (
    <View
      style={[styles.row, { height }, style]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="spectrum-visualizer"
    >
      {order.map((band, i) => (
        <Animated.View
          key={i}
          style={[
            styles.bar,
            { height, backgroundColor: colourAt(i / (order.length - 1)), transform: [{ scaleY: values[band] }] },
          ]}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: '100%' },
  bar: { flex: 1, maxWidth: 10, marginHorizontal: 1.5, borderRadius: 3 },
});

export default SpectrumVisualizer;

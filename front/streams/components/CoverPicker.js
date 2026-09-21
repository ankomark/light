// Choose a video's cover frame, TikTok-style: a large preview over a strip of
// frames sampled across the trimmed clip. Tap a frame to make it the cover.
//
// Frames come from the source file on-device (no upload, no seeking a live
// player). They're extracted two at a time, and each appears as soon as it's
// ready, so the strip fills in rather than blocking on the slowest frame.
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { extractFrame } from '../services/videoProcessing';
import { colors, radius, spacing } from '../constants/theme';

const FRAME_COUNT = 8;
const CONCURRENCY = 2;

export const sampleTimes = (start, end, count = FRAME_COUNT) => {
  const span = Math.max(0, end - start);
  if (span === 0) return [start];
  // Centre of each slice, so the first and last frames aren't black fades.
  return Array.from({ length: count }, (_, i) => +(start + span * ((i + 0.5) / count)).toFixed(2));
};

const CoverPicker = ({ uri, start, end, value, aspect = 9 / 16, onPick, t }) => {
  const { width } = useWindowDimensions();
  const [frames, setFrames] = useState(() => sampleTimes(start, end).map((sec) => ({ sec, uri: null })));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const times = sampleTimes(start, end);
    setFrames(times.map((sec) => ({ sec, uri: null })));
    let next = 0;
    const worker = async () => {
      while (!cancelled && next < times.length) {
        const i = next++;
        try {
          const frameUri = await extractFrame(uri, times[i]);
          if (cancelled) return;
          if (!frameUri) { setFailed(true); return; }
          setFrames((prev) => prev.map((f, k) => (k === i ? { ...f, uri: frameUri } : f)));
        } catch {
          // one bad frame leaves a gap; the rest still load
        }
      }
    };
    Array.from({ length: CONCURRENCY }, worker);
    return () => { cancelled = true; };
  }, [uri, start, end]);

  const chosen = frames.reduce(
    (best, f) => (value != null && Math.abs(f.sec - value) < Math.abs(best.sec - value) ? f : best),
    frames[0],
  );
  const selected = value == null ? frames[0] : chosen;
  const previewW = Math.min(width - spacing.md * 2, 320);
  const thumbW = (width - spacing.md * 2 - spacing.xs * (FRAME_COUNT - 1)) / FRAME_COUNT;

  if (failed) {
    return <Text style={styles.unavailable}>{t('create.post.coverUnavailable')}</Text>;
  }

  return (
    <View style={styles.root}>
      <View style={[styles.preview, { width: previewW, aspectRatio: aspect }]}>
        {selected?.uri ? (
          <Image source={{ uri: selected.uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={100} />
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </View>
      <View style={styles.strip}>
        {frames.map((f) => {
          const active = f.sec === selected?.sec;
          return (
            <TouchableOpacity
              key={f.sec}
              disabled={!f.uri}
              onPress={() => onPick(f.sec, f.uri)}
              style={[styles.thumb, { width: thumbW }, active && styles.thumbActive]}
            >
              {f.uri ? (
                <Image source={{ uri: f.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <View style={styles.thumbLoading} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.hint}>{t('create.post.coverHint')}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { alignItems: 'center', paddingHorizontal: spacing.md },
  preview: {
    borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000',
    alignItems: 'center', justifyContent: 'center', maxHeight: 440,
  },
  strip: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md },
  thumb: {
    aspectRatio: 9 / 16, borderRadius: 6, overflow: 'hidden', backgroundColor: colors.surface,
    borderWidth: 2, borderColor: 'transparent',
  },
  thumbActive: { borderColor: colors.primary },
  thumbLoading: { flex: 1, backgroundColor: 'rgba(255,255,255,0.06)' },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: spacing.sm, textAlign: 'center' },
  unavailable: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', padding: spacing.lg },
});

export default CoverPicker;

import React, { useMemo, useRef, useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, PanResponder, Dimensions, TouchableOpacity,
} from 'react-native';
import { Video } from 'expo-av';
import { Feather } from '@expo/vector-icons';
import { colors, radius } from '../constants/theme';

const TRACK_W = Dimensions.get('window').width - 40;
const HANDLE_W = 18;
const MAX_CLIP = 30; // seconds

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fmt = (s) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/**
 * Video trimmer: a preview player + a draggable range window over the full
 * timeline (capped at 30s). Drag the edge handles to resize or the middle to
 * move; Play loops the selected window. Reports the window (seconds) via onChange.
 */
export default function VideoTrimmer({ uri, durationSec = 0, aspectRatio = 1, onChange }) {
  const videoRef = useRef(null);
  const [duration, setDuration] = useState(durationSec || 0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(Math.min(MAX_CLIP, durationSec || MAX_CLIP));
  const [playing, setPlaying] = useState(false);

  const live = useRef({ duration, start, end });
  live.current = { duration, start, end };

  // Push changes up.
  useEffect(() => { onChange?.(start, end); }, [start, end]);

  const report = (s, e) => { setStart(s); setEnd(e); };

  const dragRef = useRef({ start: 0, end: 0 });
  const secToX = (s) => (duration > 0 ? (s / duration) * TRACK_W : 0);

  const makeResponder = (mode) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        dragRef.current = { start: live.current.start, end: live.current.end };
      },
      onPanResponderMove: (_e, g) => {
        const { duration: D } = live.current;
        if (D <= 0) return;
        const delta = (g.dx / TRACK_W) * D;
        let { start: s, end: e } = dragRef.current;
        if (mode === 'start') {
          s = clamp(s + delta, 0, e - 1);
          if (e - s > MAX_CLIP) s = e - MAX_CLIP;
        } else if (mode === 'end') {
          e = clamp(e + delta, s + 1, D);
          if (e - s > MAX_CLIP) e = s + MAX_CLIP;
        } else {
          const w = e - s;
          s = clamp(s + delta, 0, D - w);
          e = s + w;
        }
        report(s, e);
      },
    });

  const leftPan = useRef(makeResponder('start')).current;
  const rightPan = useRef(makeResponder('end')).current;
  const regionPan = useRef(makeResponder('region')).current;

  const onLoad = (status) => {
    if (status?.durationMillis) {
      const d = status.durationMillis / 1000;
      setDuration(d);
      setEnd((prev) => Math.min(prev || MAX_CLIP, Math.min(MAX_CLIP, d), d));
    }
  };

  const onStatus = (status) => {
    if (!status?.isLoaded || !playing) return;
    if ((status.positionMillis || 0) >= live.current.end * 1000 - 30) {
      videoRef.current?.setPositionAsync(live.current.start * 1000).catch(() => {});
    }
  };

  const togglePreview = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (playing) {
        await v.pauseAsync();
        setPlaying(false);
      } else {
        await v.setPositionAsync(start * 1000);
        await v.playAsync();
        setPlaying(true);
      }
    } catch {}
  };

  const startX = secToX(start);
  const endX = secToX(end);

  return (
    <View>
      <Video
        ref={videoRef}
        source={{ uri }}
        style={[styles.video, { aspectRatio: aspectRatio || 1 }]}
        resizeMode="contain"
        isLooping={false}
        onLoad={onLoad}
        onPlaybackStatusUpdate={onStatus}
      />

      <View style={styles.times}>
        <Text style={styles.timeText}>{fmt(start)}</Text>
        <View style={styles.durPill}>
          <Text style={styles.durPillText}>{(end - start).toFixed(1)}s</Text>
        </View>
        <Text style={styles.timeText}>{fmt(end)}</Text>
      </View>

      <View style={styles.track}>
        <View style={[styles.dim, { left: 0, width: startX }]} pointerEvents="none" />
        <View style={[styles.dim, { left: endX, width: Math.max(0, TRACK_W - endX) }]} pointerEvents="none" />
        <View style={[styles.selection, { left: startX, width: Math.max(0, endX - startX) }]} pointerEvents="none" />
        <View
          style={[styles.regionTouch, { left: startX + HANDLE_W, width: Math.max(0, endX - startX - HANDLE_W * 2) }]}
          {...regionPan.panHandlers}
        />
        <View style={[styles.handle, { left: startX - HANDLE_W / 2 }]} {...leftPan.panHandlers}>
          <View style={styles.grip} />
        </View>
        <View style={[styles.handle, { left: endX - HANDLE_W / 2 }]} {...rightPan.panHandlers}>
          <View style={styles.grip} />
        </View>
      </View>

      <TouchableOpacity style={styles.playBtn} onPress={togglePreview} activeOpacity={0.85}>
        <Feather name={playing ? 'pause' : 'play'} size={20} color="#fff" />
        <Text style={styles.playText}>{playing ? 'Pause' : 'Play selection'}</Text>
      </TouchableOpacity>

      <Text style={styles.hint}>Drag the edges to trim · max {MAX_CLIP}s · the rest is removed</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  video: {
    width: '100%',
    maxHeight: 360,
    borderRadius: 10,
    backgroundColor: '#000',
  },
  times: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 8,
  },
  timeText: { fontSize: 14, fontWeight: '600', color: '#555', fontVariant: ['tabular-nums'] },
  durPill: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.primary },
  durPillText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  track: {
    height: 56,
    width: TRACK_W,
    borderRadius: 10,
    backgroundColor: '#0d2236',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  dim: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(10,22,40,0.66)' },
  selection: { position: 'absolute', top: 0, bottom: 0, borderWidth: 2, borderRadius: 8, borderColor: colors.primary },
  regionTouch: { position: 'absolute', top: 0, bottom: 0 },
  handle: {
    position: 'absolute', top: 0, bottom: 0, width: HANDLE_W, borderRadius: 8,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  grip: { width: 3, height: 22, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.9)' },
  playBtn: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
    backgroundColor: colors.primary, paddingVertical: 14, borderRadius: 10, marginTop: 16,
  },
  playText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  hint: { color: '#888', fontSize: 12, textAlign: 'center', marginTop: 12 },
});

import React, { useMemo, useRef, useState, useCallback } from 'react';
import {
  View, Text, Modal, StyleSheet, TouchableOpacity, Animated, PanResponder,
  Dimensions, ActivityIndicator,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Feather } from '@expo/vector-icons';
import * as ImageManipulator from 'expo-image-manipulator';

const SCREEN_W = Dimensions.get('window').width;
const FRAME_W = SCREEN_W - 32;
const MAX_ZOOM = 3;

// Instagram crop presets (width:height ratio).
const ASPECTS = [
  { key: '4:5', label: '4:5', ratio: 0.8 },
  { key: '1:1', label: '1:1', ratio: 1 },
  { key: '1.91:1', label: '1.91', ratio: 1.91 },
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Instagram-style image cropper (core RN — no reanimated/gesture-handler).
 *
 * The image is shown inside a fixed-aspect frame, sized to "cover" it. Drag to
 * reposition, use the zoom slider to scale, and pick an aspect preset. On Done
 * the visible region is converted to source pixels and cropped with
 * expo-image-manipulator.
 */
export default function ImageCropper({ visible, uri, imageWidth, imageHeight, onCancel, onCropped }) {
  const [aspectKey, setAspectKey] = useState('4:5');
  const [zoom, setZoom] = useState(1);
  const [working, setWorking] = useState(false);

  const aspect = ASPECTS.find((a) => a.key === aspectKey)?.ratio ?? 0.8;
  const frameH = FRAME_W / aspect;

  const iw = imageWidth || 1;
  const ih = imageHeight || 1;

  // Base scale so the image covers the frame; total = base * zoom.
  const baseScale = useMemo(
    () => Math.max(FRAME_W / iw, frameH / ih),
    [iw, ih, frameH]
  );
  const totalScale = baseScale * zoom;
  const dispW = iw * totalScale;
  const dispH = ih * totalScale;
  const maxTx = Math.max(0, (dispW - FRAME_W) / 2);
  const maxTy = Math.max(0, (dispH - frameH) / 2);

  const pan = useRef({ x: 0, y: 0 });
  const translate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  // Live geometry for the (created-once) PanResponder.
  const geo = useRef({ maxTx, maxTy });
  geo.current = { maxTx, maxTy };

  const setPan = useCallback((x, y) => {
    const cx = clamp(x, -geo.current.maxTx, geo.current.maxTx);
    const cy = clamp(y, -geo.current.maxTy, geo.current.maxTy);
    pan.current = { x: cx, y: cy };
    translate.setValue({ x: cx, y: cy });
  }, [translate]);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        responder.start = { ...pan.current };
      },
      onPanResponderMove: (_e, g) => {
        setPan(responder.start.x + g.dx, responder.start.y + g.dy);
      },
    })
  ).current;

  // Re-clamp the pan whenever the frame/zoom changes the bounds.
  const reclamp = useCallback(() => setPan(pan.current.x, pan.current.y), [setPan]);

  const onZoom = (z) => {
    setZoom(z);
    // bounds depend on zoom; clamp on the next tick once geo updates
    requestAnimationFrame(reclamp);
  };

  const onPickAspect = (key) => {
    setAspectKey(key);
    pan.current = { x: 0, y: 0 };
    translate.setValue({ x: 0, y: 0 });
  };

  const handleDone = async () => {
    try {
      setWorking(true);
      const ts = baseScale * zoom;
      let cropX = ((dispW - FRAME_W) / 2 - pan.current.x) / ts;
      let cropY = ((dispH - frameH) / 2 - pan.current.y) / ts;
      let cropW = FRAME_W / ts;
      let cropH = frameH / ts;

      // Integer-safe clamp so origin + size never spills past the source bounds.
      const w = Math.min(Math.round(cropW), iw);
      const h = Math.min(Math.round(cropH), ih);
      const originX = clamp(Math.round(cropX), 0, iw - w);
      const originY = clamp(Math.round(cropY), 0, ih - h);

      const actions = [{ crop: { originX, originY, width: w, height: h } }];
      // Cap the long edge so uploads stay reasonable.
      if (w > 1080) actions.push({ resize: { width: 1080 } });

      const result = await ImageManipulator.manipulateAsync(uri, actions, {
        compress: 0.85,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      onCropped?.({ uri: result.uri, width: result.width, height: result.height });
    } catch (e) {
      console.error('Crop failed:', e);
      onCropped?.({ uri, width: iw, height: ih }); // fall back to the original
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel} disabled={working} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.headerCancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Crop</Text>
          <TouchableOpacity onPress={handleDone} disabled={working} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            {working ? <ActivityIndicator color="#1DA1F2" /> : <Text style={styles.headerDone}>Done</Text>}
          </TouchableOpacity>
        </View>

        <View style={styles.stage}>
          <View style={[styles.frame, { width: FRAME_W, height: frameH }]} {...responder.panHandlers}>
            <Animated.Image
              source={{ uri }}
              style={{
                position: 'absolute',
                left: (FRAME_W - dispW) / 2,
                top: (frameH - dispH) / 2,
                width: dispW,
                height: dispH,
                transform: [{ translateX: translate.x }, { translateY: translate.y }],
              }}
            />
            {/* Rule-of-thirds grid */}
            <View pointerEvents="none" style={styles.grid}>
              <View style={[styles.gridLineV, { left: '33.33%' }]} />
              <View style={[styles.gridLineV, { left: '66.66%' }]} />
              <View style={[styles.gridLineH, { top: '33.33%' }]} />
              <View style={[styles.gridLineH, { top: '66.66%' }]} />
            </View>
          </View>
        </View>

        <View style={styles.controls}>
          <View style={styles.zoomRow}>
            <Feather name="zoom-out" size={18} color="#9bb0c4" />
            <Slider
              style={styles.zoomSlider}
              minimumValue={1}
              maximumValue={MAX_ZOOM}
              value={zoom}
              onValueChange={onZoom}
              minimumTrackTintColor="#1DA1F2"
              maximumTrackTintColor="#33455a"
              thumbTintColor="#1DA1F2"
            />
            <Feather name="zoom-in" size={18} color="#9bb0c4" />
          </View>

          <View style={styles.aspectRow}>
            {ASPECTS.map((a) => (
              <TouchableOpacity
                key={a.key}
                style={[styles.aspectBtn, aspectKey === a.key && styles.aspectBtnActive]}
                onPress={() => onPickAspect(a.key)}
              >
                <Text style={[styles.aspectText, aspectKey === a.key && styles.aspectTextActive]}>
                  {a.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.hint}>Drag to reposition · pick a ratio · zoom</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A1628' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 14,
  },
  headerCancel: { color: '#9bb0c4', fontSize: 16 },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  headerDone: { color: '#1DA1F2', fontSize: 16, fontWeight: '700' },
  stage: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  frame: {
    overflow: 'hidden',
    backgroundColor: '#000',
    borderRadius: 6,
  },
  grid: { ...StyleSheet.absoluteFillObject },
  gridLineV: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.35)' },
  gridLineH: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.35)' },
  controls: { paddingHorizontal: 20, paddingBottom: 34, paddingTop: 6 },
  zoomRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  zoomSlider: { flex: 1, height: 36 },
  aspectRow: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  aspectBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#102E50',
    borderWidth: 1,
    borderColor: '#1b3a5c',
  },
  aspectBtnActive: { backgroundColor: '#1DA1F2', borderColor: '#1DA1F2' },
  aspectText: { color: '#9bb0c4', fontSize: 14, fontWeight: '600' },
  aspectTextActive: { color: '#fff' },
  hint: { color: '#6b8299', fontSize: 12, textAlign: 'center', marginTop: 12 },
});

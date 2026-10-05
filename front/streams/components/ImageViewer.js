/**
 * Full-screen photos, the way Facebook shows them: black backdrop, the photo
 * whole (never cropped), swipe sideways between the post's photos, pinch or
 * double-tap to zoom (and drag around while zoomed), swipe down to close, tap
 * to show or hide the caption and the controls.
 *
 * Gestures are react-native-gesture-handler (already in every build the feed
 * runs on) driving plain Animated values — no Reanimated, whose native side a
 * phone's installed build may not have yet.
 *
 *   <ImageViewer visible urls={[...]} index={1} caption="…" author="mark" onClose={…} />
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, FlatList, Animated, TouchableOpacity, StatusBar, useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../context/I18nContext';

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 900;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** One photo: pinch, double-tap and pan to zoom; drag down (unzoomed) to close. */
const ZoomablePhoto = ({ url, width, height, onZoomChange, onTap, onDragDown, onDismiss, onDragCancel, testID }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  // The committed values gestures start from (Animated values can't be read synchronously).
  const s = useRef({ scale: 1, x: 0, y: 0, pinchBase: 1, panX: 0, panY: 0, dismissing: false });

  // Zoomed in: a drag in any direction moves the photo (the pager is locked
  // then). Not zoomed: only a mostly-vertical drag counts — the dismiss — and
  // a sideways one is left to the pager. One pan, configured by this state,
  // rather than a manually activated second pan (whose activate()/fail()
  // calls Reanimated warns about on every touch move).
  const [isZoomed, setIsZoomed] = useState(false);
  const setZoomed = useCallback((zoomed) => {
    setIsZoomed(zoomed);
    onZoomChange?.(zoomed);
  }, [onZoomChange]);

  // How far a zoomed photo may move before its edge leaves the screen edge.
  const bounds = (k) => ({ x: (width * (k - 1)) / 2, y: (height * (k - 1)) / 2 });

  const animateTo = useCallback((k, x, y) => {
    s.current.scale = k; s.current.x = x; s.current.y = y;
    Animated.parallel([
      Animated.spring(scale, { toValue: k, useNativeDriver: true, friction: 7 }),
      Animated.spring(tx, { toValue: x, useNativeDriver: true, friction: 7 }),
      Animated.spring(ty, { toValue: y, useNativeDriver: true, friction: 7 }),
    ]).start();
    setZoomed(k > 1.01);
  }, [scale, tx, ty, setZoomed]);

  const gesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onStart(() => { s.current.pinchBase = s.current.scale; })
      .onUpdate((e) => {
        const k = clamp(s.current.pinchBase * e.scale, 0.8, MAX_SCALE);
        s.current.scale = k;
        scale.setValue(k);
      })
      .onEnd(() => {
        const k = clamp(s.current.scale, 1, MAX_SCALE);
        const b = bounds(k);
        animateTo(k, clamp(s.current.x, -b.x, b.x), clamp(s.current.y, -b.y, b.y));
      });

    // Zoomed: move the photo. Not zoomed: only a mostly-vertical drag, which
    // closes the viewer (a sideways one is left to the pager).
    const pan = Gesture.Pan()
      .runOnJS(true)
      .averageTouches(true);
    if (!isZoomed) pan.activeOffsetY([-12, 12]).failOffsetX([-24, 24]);
    pan
      .onStart(() => { s.current.panX = s.current.x; s.current.panY = s.current.y; })
      .onUpdate((e) => {
        if (s.current.scale > 1.01) {
          const b = bounds(s.current.scale);
          s.current.x = clamp(s.current.panX + e.translationX, -b.x, b.x);
          s.current.y = clamp(s.current.panY + e.translationY, -b.y, b.y);
          tx.setValue(s.current.x);
          ty.setValue(s.current.y);
        } else {
          ty.setValue(e.translationY);
          onDragDown?.(Math.abs(e.translationY));
        }
      })
      .onEnd((e) => {
        if (s.current.scale > 1.01) return;
        const far = Math.abs(e.translationY) > DISMISS_DISTANCE || Math.abs(e.velocityY) > DISMISS_VELOCITY;
        if (far) {
          s.current.dismissing = true;
          Animated.timing(ty, { toValue: Math.sign(e.translationY || 1) * height, duration: 180, useNativeDriver: true })
            .start(() => onDismiss?.());
        } else {
          Animated.spring(ty, { toValue: 0, useNativeDriver: true }).start();
          onDragCancel?.();
        }
      });

    const doubleTap = Gesture.Tap()
      .runOnJS(true)
      .numberOfTaps(2)
      .maxDuration(260)
      .onEnd((e) => {
        if (s.current.scale > 1.01) { animateTo(1, 0, 0); return; }
        // Zoom in towards where the finger was.
        const k = DOUBLE_TAP_SCALE;
        const b = bounds(k);
        const x = clamp((width / 2 - e.x) * (k - 1), -b.x, b.x);
        const y = clamp((height / 2 - e.y) * (k - 1), -b.y, b.y);
        animateTo(k, x, y);
      });
    const singleTap = Gesture.Tap().runOnJS(true).maxDuration(260).onEnd(() => onTap?.());

    return Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, isZoomed, animateTo, onTap, onDragDown, onDismiss, onDragCancel]);

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width, height }} collapsable={false} testID={testID}>
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: tx }, { translateY: ty }, { scale }] }]}>
          <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="contain"
                 cachePolicy="memory-disk" transition={120} recyclingKey={url} accessibilityIgnoresInvertColors />
        </Animated.View>
      </View>
    </GestureDetector>
  );
};

const ImageViewer = ({ visible, urls = [], index = 0, caption, author, onClose }) => {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [at, setAt] = useState(index);
  const [zoomed, setZoomed] = useState(false);
  const [chrome, setChrome] = useState(true);
  const backdrop = useRef(new Animated.Value(1)).current;
  const listRef = useRef(null);

  useEffect(() => {
    if (!visible) return;
    setAt(index);
    setZoomed(false);
    setChrome(true);
    backdrop.setValue(1);
  }, [visible, index, backdrop]);

  const onDragDown = useCallback((dy) => {
    backdrop.setValue(Math.max(0.25, 1 - dy / (height * 0.6)));
  }, [backdrop, height]);
  const onDragCancel = useCallback(() => {
    Animated.timing(backdrop, { toValue: 1, duration: 150, useNativeDriver: true }).start();
  }, [backdrop]);
  const toggleChrome = useCallback(() => setChrome((c) => !c), []);

  if (!visible || !urls.length) return null;
  const many = urls.length > 1;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}
           supportedOrientations={['portrait', 'landscape']}>
      {/* A Modal is its own window: gestures need their own root there. */}
      <GestureHandlerRootView style={styles.root}>
        <StatusBar hidden={!chrome} barStyle="light-content" />
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdrop }]} />
        <FlatList
          ref={listRef}
          data={urls}
          horizontal
          pagingEnabled
          scrollEnabled={many && !zoomed}
          initialScrollIndex={Math.min(index, urls.length - 1)}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          showsHorizontalScrollIndicator={false}
          keyExtractor={(u, i) => `${i}:${u}`}
          onMomentumScrollEnd={(e) => setAt(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item: url, index: i }) => (
            <ZoomablePhoto
              url={url}
              width={width}
              height={height}
              onZoomChange={setZoomed}
              onTap={toggleChrome}
              onDragDown={onDragDown}
              onDragCancel={onDragCancel}
              onDismiss={onClose}
              testID={`viewer-photo-${i}`}
            />
          )}
          testID="image-viewer-pager"
        />

        {chrome && (
          <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
            <TouchableOpacity onPress={onClose} style={styles.iconBtn} accessibilityRole="button"
                              accessibilityLabel={t('common.close')} hitSlop={10} testID="image-viewer-close">
              <MaterialIcons name="close" size={26} color="#FFFFFF" />
            </TouchableOpacity>
            {many && <Text style={styles.counter} testID="image-viewer-counter">{`${at + 1} / ${urls.length}`}</Text>}
            <View style={styles.iconBtn} />
          </View>
        )}

        {chrome && (!!caption || !!author) && (
          <View style={[styles.bottom, { paddingBottom: insets.bottom + 14 }]} pointerEvents="none">
            {!!author && <Text style={styles.author} numberOfLines={1}>{author}</Text>}
            {!!caption && <Text style={styles.caption} numberOfLines={4}>{caption}</Text>}
          </View>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { backgroundColor: '#000000' },
  top: {
    position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 10,
  },
  iconBtn: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  counter: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  bottom: {
    position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 28,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  author: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', marginBottom: 4 },
  caption: { color: '#FFFFFF', fontSize: 14, lineHeight: 20 },
});

export default ImageViewer;

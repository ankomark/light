// A TikTok-style bottom sheet: slides up over the lower part of the screen
// while what's behind it (the post) stays visible, dimmed, above. Swipe the
// handle/header down, tap the dimmed area, or press back to close.
//
// The parent owns `visible`. Closing animates out first and only then
// unmounts, so the sheet never just blinks away.
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Animated, PanResponder, Pressable, StyleSheet, useWindowDimensions, Easing,
} from 'react-native';
import { initialWindowMetrics } from 'react-native-safe-area-context';

const CLOSE_DRAG = 110;      // px dragged down that closes on release
const CLOSE_VELOCITY = 1.1;  // or a flick this fast

const BottomSheet = ({
  visible,
  onClose,
  heightRatio = 0.72,
  keyboardHeight = 0,
  header = null,        // the draggable top area (under the handle)
  overlay = null,       // drawn above the sheet (e.g. a picker), full screen
  children,
}) => {
  const { height: winH } = useWindowDimensions();
  // A Modal sits outside the navigator's safe-area context: read the device.
  const insets = initialWindowMetrics?.insets || { top: 24, bottom: 0 };
  const maxH = winH - insets.top - 8;
  // A short window (a phone on its side, a split screen): nearly all of it,
  // or the sheet's contents don't fit.
  const ratio = winH < 520 ? Math.max(heightRatio, 0.92) : heightRatio;
  // Taller when the keyboard is up, so the list keeps some room above the box.
  const sheetH = Math.min(maxH, keyboardHeight > 0
    ? Math.max(winH * ratio, keyboardHeight + 360)
    : winH * ratio);

  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current; // 0 hidden → 1 open
  const drag = useRef(new Animated.Value(0)).current;      // finger offset

  useEffect(() => {
    if (visible) {
      setMounted(true);
      drag.setValue(0);
      Animated.spring(progress, { toValue: 1, useNativeDriver: true, damping: 22, stiffness: 220, mass: 0.9 }).start();
    } else if (mounted) {
      Animated.timing(progress, { toValue: 0, duration: 200, easing: Easing.in(Easing.quad), useNativeDriver: true })
        .start(({ finished }) => { if (finished) setMounted(false); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
    onPanResponderRelease: (_, g) => {
      if (g.dy > CLOSE_DRAG || g.vy > CLOSE_VELOCITY) {
        onCloseRef.current?.();
      } else {
        Animated.spring(drag, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 260 }).start();
      }
    },
    onPanResponderTerminate: () => {
      Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
    },
  })).current;

  if (!mounted) return null;

  const translateY = Animated.add(
    progress.interpolate({ inputRange: [0, 1], outputRange: [sheetH, 0] }),
    drag,
  );
  const backdropOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>

        <Animated.View style={[styles.sheet, { height: sheetH, transform: [{ translateY }] }]}>
          <View {...pan.panHandlers} style={styles.dragZone}>
            <View style={styles.handle} />
            {header}
          </View>
          <View style={[styles.body, { paddingBottom: keyboardHeight > 0 ? keyboardHeight : insets.bottom }]}>
            {children}
          </View>
        </Animated.View>

        {overlay}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    width: '100%',
    // A tablet or the web: a sheet, not a full-width slab (phones: all of it).
    maxWidth: 720,
    alignSelf: 'center',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
    backgroundColor: 'rgba(12,24,42,0.98)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  dragZone: { paddingTop: 8 },
  handle: {
    alignSelf: 'center', width: 38, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  body: { flex: 1, backgroundColor: 'transparent' },
});

export default BottomSheet;

/**
 * Full-screen in-app camera for composing a post (photo + video).
 *
 * Premium capture surface built on expo-camera's CameraView: live preview,
 * photo/video modes, flip, flash/torch, a recording timer, and a photo review
 * step. On confirm it hands an ImagePicker-shaped asset back to the composer
 * (via the `onCapture` route param), which runs the existing compress / trim /
 * upload pipeline — no new backend.
 *
 * Requires the `expo-camera` native module (run `npx expo install expo-camera`)
 * and a dev/EAS build — the live preview does not run in Expo Go.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, Image, Alert, PanResponder,
} from 'react-native';
// eslint-disable-next-line import/no-unresolved -- installed via `npx expo install expo-camera` (native module; needs a dev/EAS build)
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as Haptics from 'expo-haptics';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const MAX_VIDEO_SEC = 30;
const FLASH_CYCLE = { off: 'auto', auto: 'on', on: 'off' };
const FLASH_ICON = { off: 'flash-off', auto: 'flash-outline', on: 'flash' };

const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const CameraCapture = ({ navigation, route }) => {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const onCapture = route.params?.onCapture;

  const cameraRef = useRef(null);
  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();

  const [mode, setMode] = useState('picture');   // 'picture' | 'video'
  const [facing, setFacing] = useState('back');  // 'back' | 'front'
  const [flash, setFlash] = useState('off');      // 'off' | 'auto' | 'on'
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [captured, setCaptured] = useState(null); // photo review { uri }
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  // Phase 2: zoom, grid, tap-to-focus, last-photo thumbnail.
  const [zoom, setZoom] = useState(0);           // CameraView zoom 0..1
  const [gridOn, setGridOn] = useState(false);
  const [focusPt, setFocusPt] = useState(null);   // { x, y } for the focus square
  const [lastPhoto, setLastPhoto] = useState(null);
  const zoomRef = useRef(0);        // mirrors `zoom` for the (stable) PanResponder closure
  const zoomBaseRef = useRef(0);    // zoom captured at the start of the current pinch
  const pinchStartRef = useRef(null);
  const lastTapRef = useRef(0);
  const focusAnim = useRef(new Animated.Value(0)).current;

  const timerRef = useRef(null);
  const recDot = useRef(new Animated.Value(1)).current;
  const shutter = useRef(new Animated.Value(1)).current;

  const flipFacing = useCallback(() => setFacing((f) => (f === 'back' ? 'front' : 'back')), []);

  // Load the most recent photo for the gallery-shortcut thumbnail — but only if
  // library access is ALREADY granted. We never prompt just for a thumbnail; the
  // gallery button itself prompts (via the picker) when tapped.
  useEffect(() => {
    (async () => {
      try {
        const perm = await MediaLibrary.getPermissionsAsync();
        if (!perm.granted) return;
        const res = await MediaLibrary.getAssetsAsync({ first: 1, sortBy: 'creationTime', mediaType: 'photo' });
        if (res.assets?.[0]?.uri) setLastPhoto(res.assets[0].uri);
      } catch { /* thumbnail is optional */ }
    })();
  }, []);

  const dist = (touches) => {
    const [a, b] = touches;
    return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
  };

  const showFocus = (x, y) => {
    setFocusPt({ x, y });
    focusAnim.setValue(0);
    Animated.sequence([
      Animated.spring(focusAnim, { toValue: 1, useNativeDriver: true, friction: 5 }),
      Animated.timing(focusAnim, { toValue: 0, duration: 400, delay: 500, useNativeDriver: true }),
    ]).start(() => setFocusPt(null));
  };

  // One overlay handles pinch-to-zoom, tap-to-focus and double-tap-to-flip.
  const gestures = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2,
      onPanResponderGrant: (e) => {
        if (e.nativeEvent.touches.length === 2) {
          pinchStartRef.current = dist(e.nativeEvent.touches);
          zoomBaseRef.current = zoomRef.current; // fixed baseline for this pinch
        }
      },
      onPanResponderMove: (e) => {
        const touches = e.nativeEvent.touches;
        if (touches.length !== 2) return;
        if (!pinchStartRef.current) { // second finger landed after grant
          pinchStartRef.current = dist(touches);
          zoomBaseRef.current = zoomRef.current;
          return;
        }
        const delta = (dist(touches) - pinchStartRef.current) / 400; // sensitivity
        setZoom(Math.max(0, Math.min(1, zoomBaseRef.current + delta)));
      },
      onPanResponderRelease: (e, g) => {
        const wasPinch = !!pinchStartRef.current;
        pinchStartRef.current = null; // the zoom baseline is kept in sync by an effect
        // A near-stationary single-finger release = a tap (ignore pinch releases).
        if (!wasPinch && Math.abs(g.dx) < 8 && Math.abs(g.dy) < 8 && e.nativeEvent.changedTouches.length <= 1) {
          const now = Date.now();
          if (now - lastTapRef.current < 280) { lastTapRef.current = 0; flipFacing(); }
          else { lastTapRef.current = now; showFocus(e.nativeEvent.locationX, e.nativeEvent.locationY); }
        }
      },
      onPanResponderTerminationRequest: () => true,
    })
  ).current;

  // Keep the ref mirror of `zoom` current for the stable PanResponder closure.
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  // Ask for camera access on mount.
  useEffect(() => { if (camPerm && !camPerm.granted) requestCam(); }, [camPerm, requestCam]);

  // Blink the recording dot.
  useEffect(() => {
    if (recording) {
      Animated.loop(Animated.sequence([
        Animated.timing(recDot, { toValue: 0.2, duration: 500, useNativeDriver: true }),
        Animated.timing(recDot, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])).start();
    } else {
      recDot.stopAnimation(); recDot.setValue(1);
    }
  }, [recording, recDot]);

  useEffect(() => () => clearInterval(timerRef.current), []);

  const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

  const takePhoto = useCallback(async () => {
    if (!cameraRef.current || busy) return;
    tap();
    setBusy(true);
    Animated.sequence([
      Animated.timing(shutter, { toValue: 0.85, duration: 80, useNativeDriver: true }),
      Animated.spring(shutter, { toValue: 1, useNativeDriver: true }),
    ]).start();
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9, skipProcessing: false });
      setCaptured({ uri: photo.uri, width: photo.width, height: photo.height });
    } catch {
      Alert.alert(t('camera.errorTitle'), t('camera.photoFailed'));
    } finally { setBusy(false); }
  }, [busy, shutter, t]);

  // Keep the latest elapsed available to the async recordAsync closure.
  const elapsedRef = useRef(0);
  useEffect(() => { elapsedRef.current = elapsed; }, [elapsed]);

  const stopRecording = useCallback(() => {
    if (!cameraRef.current) return;
    tap();
    try { cameraRef.current.stopRecording(); } catch { /* noop */ }
  }, []);

  const startRecording = useCallback(async () => {
    if (!cameraRef.current || recording || busy) return;
    // Video needs the mic.
    if (micPerm && !micPerm.granted) {
      const res = await requestMic();
      if (!res.granted) { Alert.alert(t('camera.micTitle'), t('camera.micBody')); return; }
    }
    tap();
    setRecording(true);
    setElapsed(0);
    // Timer is display-only; recordAsync({maxDuration}) auto-stops at the cap.
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: MAX_VIDEO_SEC });
      // recordAsync resolves when recording stops (manual or at maxDuration).
      if (video?.uri && onCapture) {
        onCapture({ uri: video.uri, type: 'video', duration: (elapsedRef.current || 1) * 1000 });
        navigation.goBack();
      }
    } catch {
      Alert.alert(t('camera.errorTitle'), t('camera.videoFailed'));
    } finally {
      clearInterval(timerRef.current);
      setRecording(false);
    }
  }, [recording, busy, micPerm, requestMic, onCapture, navigation, t]);

  const onShutter = () => {
    if (mode === 'picture') takePhoto();
    else if (recording) stopRecording();
    else startRecording();
  };

  const openGallery = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: mode === 'video' ? ImagePicker.MediaTypeOptions.Videos : ImagePicker.MediaTypeOptions.Images,
      quality: mode === 'video' ? 1 : 0.9,
    });
    if (res.canceled || !res.assets?.length || !onCapture) return;
    const a = res.assets[0];
    onCapture({ uri: a.uri, width: a.width, height: a.height, duration: a.duration, type: mode === 'video' ? 'video' : 'image' });
    navigation.goBack();
  };

  const usePhoto = () => {
    if (captured && onCapture) {
      onCapture({ uri: captured.uri, width: captured.width, height: captured.height, type: 'image' });
      navigation.goBack();
    }
  };

  // ── Permission gate ───────────────────────────────────────────────────────
  if (!camPerm) return <View style={styles.root} />;  // still resolving
  if (!camPerm.granted) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.gate}>
          <MaterialCommunityIcons name="camera-off-outline" size={56} color={colors.textMuted} />
          <Text style={styles.gateTitle}>{t('camera.permTitle')}</Text>
          <Text style={styles.gateText}>{t('camera.permBody')}</Text>
          <TouchableOpacity style={styles.gateBtn} onPress={requestCam} activeOpacity={0.85}>
            <Text style={styles.gateBtnText}>{t('camera.enable')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: spacing.md }}>
            <Text style={styles.gateCancel}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  // ── Photo review ──────────────────────────────────────────────────────────
  if (captured) {
    return (
      <View style={styles.root}>
        <Image source={{ uri: captured.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        <SafeAreaView style={styles.reviewBar} edges={['bottom']}>
          <TouchableOpacity style={styles.reviewBtn} onPress={() => setCaptured(null)} activeOpacity={0.85}>
            <Ionicons name="camera-reverse-outline" size={20} color="#fff" />
            <Text style={styles.reviewBtnText}>{t('camera.retake')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.reviewBtn, styles.reviewUse]} onPress={usePhoto} activeOpacity={0.85}>
            <Text style={styles.reviewUseText}>{t('camera.use')}</Text>
            <Ionicons name="arrow-forward" size={20} color="#0A1628" />
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  // ── Live camera ───────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        flash={flash}
        enableTorch={mode === 'video' && recording && flash === 'on'}
        mode={mode}
        zoom={zoom}
        onCameraReady={() => setReady(true)}
      />

      {/* Gesture layer: pinch-zoom, tap-to-focus, double-tap flip */}
      <View style={styles.gestureLayer} {...gestures.panHandlers} pointerEvents="box-only" />

      {/* Rule-of-thirds grid */}
      {gridOn && (
        <View style={styles.gridLayer} pointerEvents="none">
          <View style={[styles.gridLine, styles.gridV, { left: '33.33%' }]} />
          <View style={[styles.gridLine, styles.gridV, { left: '66.66%' }]} />
          <View style={[styles.gridLine, styles.gridH, { top: '33.33%' }]} />
          <View style={[styles.gridLine, styles.gridH, { top: '66.66%' }]} />
        </View>
      )}

      {/* Tap-to-focus square */}
      {focusPt && (
        <Animated.View
          pointerEvents="none"
          style={[styles.focusBox, {
            left: focusPt.x - 40, top: focusPt.y - 40,
            opacity: focusAnim,
            transform: [{ scale: focusAnim.interpolate({ inputRange: [0, 1], outputRange: [1.4, 1] }) }],
          }]}
        />
      )}

      {/* Zoom readout */}
      {zoom > 0.001 && (
        <View style={styles.zoomPill} pointerEvents="none">
          <Text style={styles.zoomText}>{`${(1 + zoom * 9).toFixed(1)}x`}</Text>
        </View>
      )}

      {/* Top controls */}
      <SafeAreaView edges={['top']} style={[styles.topBar, { paddingTop: insets.top || spacing.sm }]}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()} hitSlop={10} disabled={recording}>
          <Ionicons name="close" size={28} color="#fff" />
        </TouchableOpacity>

        {recording ? (
          <View style={styles.recPill}>
            <Animated.View style={[styles.recDot, { opacity: recDot }]} />
            <Text style={styles.recTime}>{fmt(elapsed)}</Text>
          </View>
        ) : <View />}

        <View style={styles.topRight}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => setGridOn((g) => !g)} hitSlop={10} disabled={recording}>
            <MaterialCommunityIcons name="grid" size={22} color={gridOn ? colors.accent : '#fff'} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => setFlash((f) => FLASH_CYCLE[f])} hitSlop={10}>
            <Ionicons name={FLASH_ICON[flash]} size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Bottom controls */}
      <SafeAreaView edges={['bottom']} style={[styles.bottom, { paddingBottom: insets.bottom || spacing.md }]}>
        {!recording && (
          <View style={styles.modeRow}>
            <TouchableOpacity onPress={() => setMode('picture')} style={styles.modePill}>
              <Text style={[styles.modeText, mode === 'picture' && styles.modeTextActive]}>{t('camera.photo')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setMode('video')} style={styles.modePill}>
              <Text style={[styles.modeText, mode === 'video' && styles.modeTextActive]}>{t('camera.video')}</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.shutterRow}>
          <TouchableOpacity style={styles.sideBtn} onPress={openGallery} disabled={recording} activeOpacity={0.8}>
            {lastPhoto ? (
              <Image source={{ uri: lastPhoto }} style={styles.galleryThumb} />
            ) : (
              <Ionicons name="images-outline" size={26} color={recording ? 'rgba(255,255,255,0.3)' : '#fff'} />
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={onShutter} activeOpacity={0.85} disabled={busy || !ready}>
            <Animated.View style={[styles.shutterOuter, { transform: [{ scale: shutter }] }, recording && styles.shutterOuterRec]}>
              <View style={[
                styles.shutterInner,
                mode === 'video' && !recording && styles.shutterInnerVideo,
                recording && styles.shutterInnerRec,
              ]} />
            </Animated.View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.sideBtn} onPress={flipFacing} disabled={recording} activeOpacity={0.8}>
            <Ionicons name="camera-reverse-outline" size={28} color={recording ? 'rgba(255,255,255,0.3)' : '#fff'} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },

  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md, backgroundColor: '#0A1628' },
  gateTitle: { ...typography.h2, color: '#fff', textAlign: 'center' },
  gateText: { ...typography.body, color: 'rgba(255,255,255,0.7)', textAlign: 'center', lineHeight: 21 },
  gateBtn: { backgroundColor: colors.accent, paddingVertical: 14, paddingHorizontal: 28, borderRadius: radius.full, marginTop: spacing.sm },
  gateBtnText: { ...typography.button, color: '#0A1628', fontWeight: '800' },
  gateCancel: { ...typography.body, color: 'rgba(255,255,255,0.6)' },

  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  topRight: { flexDirection: 'row', gap: spacing.sm },

  gestureLayer: { ...StyleSheet.absoluteFillObject, zIndex: 1 },
  gridLayer: { ...StyleSheet.absoluteFillObject, zIndex: 1 },
  gridLine: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.35)' },
  gridV: { top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  gridH: { left: 0, right: 0, height: StyleSheet.hairlineWidth },
  focusBox: {
    position: 'absolute', width: 80, height: 80, borderRadius: 8,
    borderWidth: 1.5, borderColor: colors.accent, zIndex: 2,
  },
  zoomPill: {
    position: 'absolute', alignSelf: 'center', top: '50%', zIndex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.full,
  },
  zoomText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  galleryThumb: { width: 40, height: 40, borderRadius: 8, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)' },
  recPill: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FF3B30' },
  recTime: { color: '#fff', fontVariant: ['tabular-nums'], fontWeight: '700', fontSize: 14 },

  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 2, paddingHorizontal: spacing.md },
  modeRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg, marginBottom: spacing.md },
  modePill: { paddingVertical: 6, paddingHorizontal: 10 },
  modeText: { color: 'rgba(255,255,255,0.55)', fontWeight: '700', fontSize: 14, letterSpacing: 0.5 },
  modeTextActive: { color: colors.accent },

  shutterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg },
  sideBtn: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  shutterOuter: {
    width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  shutterOuterRec: { borderColor: '#FF3B30' },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
  shutterInnerVideo: { backgroundColor: '#FF3B30' },
  shutterInnerRec: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#FF3B30' },

  reviewBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md, paddingTop: spacing.md,
  },
  reviewBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 18, borderRadius: radius.full, backgroundColor: 'rgba(0,0,0,0.5)' },
  reviewBtnText: { color: '#fff', fontWeight: '700' },
  reviewUse: { backgroundColor: colors.accent },
  reviewUseText: { color: '#0A1628', fontWeight: '800' },
});

export default CameraCapture;

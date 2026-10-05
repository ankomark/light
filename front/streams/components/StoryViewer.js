import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, useWindowDimensions,
  StatusBar, Animated, Easing, PanResponder, ActivityIndicator, AppState,
} from 'react-native';
// expo-image: cached on disk, so a story seen once paints at once next time,
// and the next one can be fetched while this one shows.
import { Image } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';
import AppVideo from './AppVideo';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { viewStory } from '../services/api';
import { spacing } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { allowAllOrientations, lockPortrait } from '../utils/orientation';

const IMAGE_DURATION = 5000;   // ms an image story is shown
const VIDEO_MAX_MS = 30000;    // hard 30s cap for video stories
const LONG_PRESS_MS = 200;     // hold-to-pause threshold
const DISMISS_DY = 120;        // drag-down distance that closes the viewer
const PREV_ZONE = 0.3;         // left 30% of the screen taps backwards

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

const StoryViewer = ({ route, navigation }) => {
  const { group } = route.params;
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const stories = useMemo(() => group.stories ?? [], [group.stories]);
  // Reactive full-screen size — reflows on rotation / web resize (was a
  // module-scope Dimensions.get snapshot). screenWRef feeds the once-created
  // PanResponder its live value without re-creating it.
  const { width: screenW, height: screenH } = useWindowDimensions();
  const screenWRef = useRef(screenW);
  useEffect(() => { screenWRef.current = screenW; }, [screenW]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [mediaFailed, setMediaFailed] = useState(false);

  // Turns with the phone while open (the app is otherwise portrait-only).
  useFocusEffect(useCallback(() => {
    allowAllOrientations();
    return () => { lockPortrait(); };
  }, []));

  const progressAnim = useRef(new Animated.Value(0)).current;
  const progressValRef = useRef(0);
  const translateY = useRef(new Animated.Value(0)).current;
  const animRef = useRef(null);

  // Mirrors kept in refs so the PanResponder (created once) reads live values.
  const pausedRef = useRef(false);
  const indexRef = useRef(0);
  const goNextRef = useRef(() => {});
  const goPrevRef = useRef(() => {});

  const currentStory = stories[currentIndex];
  const isVideo = currentStory?.content_type === 'video';

  useEffect(() => {
    const id = progressAnim.addListener(({ value }) => { progressValRef.current = value; });
    return () => progressAnim.removeListener(id);
  }, [progressAnim]);

  useEffect(() => { indexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const markViewed = useCallback((story) => {
    if (story) viewStory(story.id).catch(() => {});
  }, []);

  // Image stories advance on a timer; `from` lets us resume from where a hold
  // paused, rather than restarting the 5s.
  const startImageProgress = useCallback((from = 0) => {
    animRef.current?.stop();
    progressAnim.setValue(from);
    animRef.current = Animated.timing(progressAnim, {
      toValue: 1,
      duration: Math.max(0, IMAGE_DURATION * (1 - from)),
      easing: Easing.linear,
      useNativeDriver: false,
    });
    animRef.current.start(({ finished }) => { if (finished) goNextRef.current(); });
  }, [progressAnim]);

  const stopImageProgress = useCallback(() => { animRef.current?.stop(); }, []);
  const startImageProgressRef = useRef(startImageProgress);
  startImageProgressRef.current = startImageProgress;

  const goNext = useCallback(() => {
    stopImageProgress();
    progressAnim.setValue(0);
    if (currentIndex < stories.length - 1) {
      setCurrentIndex((i) => i + 1);
      setMediaLoading(true);
      setMediaFailed(false);
    } else {
      navigation.goBack();
    }
  }, [currentIndex, stories.length, navigation, progressAnim, stopImageProgress]);

  const goPrev = useCallback(() => {
    stopImageProgress();
    progressAnim.setValue(0);
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
      setMediaLoading(true);
      setMediaFailed(false);
    } else {
      // Restart the first story (mirrors WhatsApp's behaviour).
      if (isVideo) progressAnim.setValue(0);
      else startImageProgress(0);
    }
  }, [currentIndex, isVideo, progressAnim, startImageProgress, stopImageProgress]);

  useEffect(() => { goNextRef.current = goNext; }, [goNext]);
  useEffect(() => { goPrevRef.current = goPrev; }, [goPrev]);

  // Mark each story viewed as it becomes current, and fetch the next photo
  // now so the tap to it shows it straight away.
  useEffect(() => {
    markViewed(currentStory);
    const next = stories[currentIndex + 1];
    const nextPicture = next && (next.content_type === 'video' ? next.thumbnail_url : next.media_url);
    if (nextPicture) Image.prefetch(nextPicture).catch(() => {});
  }, [currentStory, markViewed, stories, currentIndex]);

  // A story that won't load (offline, deleted) says so and moves on by
  // itself, instead of a spinner that never ends.
  const handleMediaError = useCallback(() => {
    setMediaLoading(false);
    setMediaFailed(true);
    if (!pausedRef.current) startImageProgressRef.current(0);
  }, []);

  const handleMediaReady = useCallback(() => {
    setMediaLoading(false);
    // Video drives its own progress via playback status; images use the timer.
    if (!isVideo && !pausedRef.current) startImageProgress(0);
  }, [isVideo, startImageProgress]);

  const onVideoStatus = useCallback((s) => {
    if (!s.isLoaded) return;
    const dur = Math.min(s.durationMillis || VIDEO_MAX_MS, VIDEO_MAX_MS);
    const pos = s.positionMillis || 0;
    progressAnim.setValue(dur > 0 ? Math.min(1, pos / dur) : 0);
    if (s.didJustFinish || pos >= VIDEO_MAX_MS) goNextRef.current();
  }, [progressAnim]);

  const pause = useCallback(() => {
    setPaused(true);
    pausedRef.current = true;
    if (!isVideo || mediaFailed) stopImageProgress();
  }, [isVideo, mediaFailed, stopImageProgress]);

  const resume = useCallback(() => {
    setPaused(false);
    pausedRef.current = false;
    if (!isVideo || mediaFailed) startImageProgress(progressValRef.current);
  }, [isVideo, mediaFailed, startImageProgress]);

  const dismiss = useCallback(() => {
    Animated.timing(translateY, {
      toValue: screenH, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: true,
    }).start(() => navigation.goBack());
  }, [translateY, navigation, screenH]);

  // The PanResponder is created once, so it must reach pause/resume through refs
  // to avoid capturing a stale `isVideo` from the first story in the group.
  const pauseRef = useRef(pause);
  const resumeRef = useRef(resume);
  const dismissRef = useRef(dismiss);
  useEffect(() => { pauseRef.current = pause; }, [pause]);
  useEffect(() => { resumeRef.current = resume; }, [resume]);
  useEffect(() => { dismissRef.current = dismiss; }, [dismiss]);

  // Leaving the app pauses the story (the clock and the video); coming back
  // carries on — unless the person had paused it themselves by holding.
  const pausedByAppRef = useRef(false);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active' && !pausedRef.current) { pausedByAppRef.current = true; pauseRef.current(); }
      if (st === 'active' && pausedByAppRef.current) { pausedByAppRef.current = false; resumeRef.current(); }
    });
    return () => sub.remove();
  }, []);

  // One gesture surface: tap zones for prev/next, hold to pause, drag down to
  // dismiss — the WhatsApp status interaction model.
  const longPressTimer = useRef(null);
  const longPressedRef = useRef(false);
  const draggingRef = useRef(false);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && g.dy > Math.abs(g.dx),
      onPanResponderGrant: () => {
        longPressedRef.current = false;
        draggingRef.current = false;
        longPressTimer.current = setTimeout(() => {
          longPressedRef.current = true;
          pauseRef.current();
        }, LONG_PRESS_MS);
      },
      onPanResponderMove: (_e, g) => {
        if (g.dy > 6 && g.dy > Math.abs(g.dx)) {
          if (!draggingRef.current) {
            draggingRef.current = true;
            clearTimeout(longPressTimer.current);
            if (!pausedRef.current) pauseRef.current();
          }
          translateY.setValue(g.dy);
        }
      },
      onPanResponderRelease: (e, g) => {
        clearTimeout(longPressTimer.current);
        if (draggingRef.current) {
          draggingRef.current = false;
          if (g.dy > DISMISS_DY) { dismissRef.current(); return; }
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
          resumeRef.current();
          return;
        }
        if (longPressedRef.current) {
          longPressedRef.current = false;
          resumeRef.current();
          return;
        }
        // A plain tap: left edge goes back, the rest advances.
        if (e.nativeEvent.locationX < screenWRef.current * PREV_ZONE) goPrevRef.current();
        else goNextRef.current();
      },
      onPanResponderTerminate: () => {
        clearTimeout(longPressTimer.current);
        if (draggingRef.current) {
          draggingRef.current = false;
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
        }
        if (longPressedRef.current) { longPressedRef.current = false; resumeRef.current(); }
      },
    })
  ).current;

  // Nothing to show (a group with no stories left): leave, once, from an
  // effect — never from inside rendering.
  useEffect(() => {
    if (!currentStory && navigation.canGoBack()) navigation.goBack();
  }, [currentStory, navigation]);
  if (!currentStory) return null;

  // Every story is shown whole — a landscape photo or video is never cropped
  // to fill a portrait screen (or the other way round). The space around it
  // is the same picture, blurred and dimmed, as Facebook and Instagram do.
  const fit = 'contain';
  const backdrop = isVideo ? currentStory.thumbnail_url : currentStory.media_url;

  const dragOpacity = translateY.interpolate({
    inputRange: [0, screenH], outputRange: [1, 0.3], extrapolate: 'clamp',
  });

  return (
    <Animated.View style={[styles.container, { transform: [{ translateY }], opacity: dragOpacity }]}>
      <StatusBar hidden />

      {!!backdrop && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="story-backdrop">
          <Image source={{ uri: backdrop }} style={StyleSheet.absoluteFill} contentFit="cover"
                 blurRadius={30} cachePolicy="memory-disk" />
          <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
        </View>
      )}

      {/* A video's poster under it while it loads: a picture, not black. */}
      {isVideo && !!currentStory.thumbnail_url && mediaLoading && (
        <Image
          source={{ uri: currentStory.thumbnail_url }}
          style={[styles.media, { width: screenW, height: screenH }]}
          contentFit={fit}
          cachePolicy="memory-disk"
          testID="story-poster"
        />
      )}

      {/* Media */}
      {isVideo ? (
        <AppVideo
          key={currentStory.id}
          source={{ uri: currentStory.media_url }}
          style={[styles.media, { width: screenW, height: screenH }]}
          resizeMode={fit}
          shouldPlay={!paused && !mediaLoading}
          isLooping={false}
          onReadyForDisplay={handleMediaReady}
          onPlaybackStatusUpdate={onVideoStatus}
          onError={handleMediaError}
        />
      ) : (
        <Image
          key={currentStory.id}
          source={{ uri: currentStory.media_url }}
          style={[styles.media, { width: screenW, height: screenH }]}
          contentFit={fit}
          cachePolicy="memory-disk"
          onLoad={handleMediaReady}
          onError={handleMediaError}
        />
      )}

      {mediaLoading && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}
      {mediaFailed && (
        <View style={styles.loadingOverlay} pointerEvents="none" testID="story-failed">
          <Ionicons name="cloud-offline-outline" size={36} color="#fff" />
          <Text style={styles.failedText}>{t('story.loadFailed')}</Text>
        </View>
      )}

      {/* Gesture surface (sits below the header so the close button stays tappable) */}
      <View style={styles.gestureLayer} {...pan.panHandlers} />

      {/* Header */}
      <View
        style={[styles.header, {
          paddingTop: insets.top + spacing.sm,
          // Turned sideways, the notch is on a side.
          paddingLeft: spacing.sm + insets.left,
          paddingRight: spacing.sm + insets.right,
        }]}
        pointerEvents="box-none"
      >
        <LinearGradient
          colors={['rgba(0,0,0,0.6)', 'transparent']}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        {/* Progress bars */}
        <View style={styles.progressRow}>
          {stories.map((_, i) => (
            <View key={i} style={styles.progressTrack}>
              <Animated.View
                style={[
                  styles.progressFill,
                  {
                    width: i < currentIndex
                      ? '100%'
                      : i === currentIndex
                        ? progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })
                        : '0%',
                  },
                ]}
              />
            </View>
          ))}
        </View>

        {/* User info */}
        <View style={styles.userRow}>
          <Image
            source={group.user.profile_picture ? { uri: group.user.profile_picture } : DEFAULT_AVATAR}
            placeholder={DEFAULT_AVATAR}
            cachePolicy="memory-disk"
            style={styles.avatar}
          />
          <Text style={styles.username} numberOfLines={1}>{group.user.username}</Text>
          <Text style={styles.timeAgo}>{timeAgo(currentStory.created_at, t)}</Text>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeBtn}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            accessibilityRole="button" accessibilityLabel={t('common.close')} testID="story-close">
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Caption */}
        {currentStory.caption ? (
          <Text style={styles.caption} numberOfLines={4}>{currentStory.caption}</Text>
        ) : null}
      </View>
    </Animated.View>
  );
};

// "now", "5m", "3h" in the reader's language (a story lives a day at most).
export function timeAgo(dateStr, t) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (!Number.isFinite(diff)) return '';
  if (diff < 60) return t ? t('feed.ago.now') : 'now';
  if (diff < 3600) return t ? t('feed.ago.m', { n: Math.floor(diff / 60) }) : `${Math.floor(diff / 60)}m`;
  return t ? t('feed.ago.h', { n: Math.floor(diff / 3600) }) : `${Math.floor(diff / 3600)}h`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  media: { position: 'absolute' },  // width/height applied inline (reactive)
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  gestureLayer: { ...StyleSheet.absoluteFillObject },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.md,
  },
  progressRow: { flexDirection: 'row', gap: 3, marginBottom: spacing.sm },
  progressTrack: {
    flex: 1,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.4)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: '#fff' },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: '#fff' },
  username: { flex: 1, color: '#fff', fontWeight: '600', fontSize: 14 },
  timeAgo: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  closeBtn: { padding: spacing.xs },
  backdropDim: { backgroundColor: 'rgba(0,0,0,0.45)' },
  failedText: { color: '#fff', fontSize: 14, marginTop: spacing.sm, textAlign: 'center', paddingHorizontal: spacing.lg },
  caption: {
    color: '#fff',
    fontSize: 14,
    marginTop: spacing.sm,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});

export default StoryViewer;

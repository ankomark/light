import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, useWindowDimensions,
  StatusBar, Animated, Easing, PanResponder, ActivityIndicator, AppState, Modal, FlatList, Alert,
} from 'react-native';
// expo-image: cached on disk, so a story seen once paints at once next time,
// and the next one can be fetched while this one shows.
import { Image } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';
import AppVideo from './AppVideo';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { viewStory, reactToStory, fetchStoryViewers, deleteStory } from '../services/api';
import { emit, EVENTS } from '../utils/appEvents';
import { useAuth } from '../context/useAuth';
import { spacing } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { allowAllOrientations, lockPortrait } from '../utils/orientation';

const IMAGE_DURATION = 5000;   // ms an image story is shown
const VIDEO_MAX_MS = 30000;    // hard 30s cap for video stories
const LONG_PRESS_MS = 200;     // hold-to-pause threshold
const DISMISS_DY = 120;        // drag-down distance that closes the viewer
const PREV_ZONE = 0.3;         // left 30% of the screen taps backwards

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

// The quick reactions (the server accepts exactly these: songs/stories.py).
export const STORY_REACTIONS = ['❤️', '😂', '😮', '😢', '🙏', '👏', '🔥', '🙌'];

const StoryViewer = ({ route, navigation }) => {
  const { group } = route.params;
  const { t } = useI18n();
  const { currentUser } = useAuth() || {};
  const isOwn = !!currentUser?.id && currentUser.id === group.user?.id;
  const insets = useSafeAreaInsets();
  // Your own stories you delete here leave the list at once.
  const [removed, setRemoved] = useState(() => new Set());
  const stories = useMemo(
    () => (group.stories ?? []).filter((s) => !removed.has(s.id)),
    [group.stories, removed],
  );
  // Reactive full-screen size — reflows on rotation / web resize (was a
  // module-scope Dimensions.get snapshot). screenWRef feeds the once-created
  // PanResponder its live value without re-creating it.
  const { width: screenW, height: screenH } = useWindowDimensions();
  const screenWRef = useRef(screenW);
  useEffect(() => { screenWRef.current = screenW; }, [screenW]);

  // Someone else's stories open where you left off: at the first one you
  // haven't seen (all seen: from the start). Yours always from the start.
  const [currentIndex, setCurrentIndex] = useState(() => {
    if (isOwn) return 0;
    const unseen = stories.findIndex((s) => !s.is_viewed);
    return unseen > 0 ? unseen : 0;
  });
  const [paused, setPaused] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(true);
  const mediaLoadingRef = useRef(true);
  mediaLoadingRef.current = mediaLoading;
  const [mediaFailed, setMediaFailed] = useState(false);
  // Reactions: what this viewer picked per story (starts from the server's
  // my_reaction), the emoji floating up, and — on your own story — the list
  // of who watched.
  const [reacted, setReacted] = useState(() => Object.fromEntries(
    (group.stories || []).map((s) => [s.id, s.my_reaction || null]),
  ));
  const [burst, setBurst] = useState(null);
  const burstAnim = useRef(new Animated.Value(0)).current;
  const [viewersOpen, setViewersOpen] = useState(false);
  const [viewers, setViewers] = useState(null);

  // Turns with the phone while open (the app is otherwise portrait-only).
  useFocusEffect(useCallback(() => {
    allowAllOrientations();
    return () => { lockPortrait(); };
  }, []));

  // Leaving happens once: a video's end, a swipe down and the close button
  // can all ask at nearly the same moment, and two goBack()s would also
  // close the screen under this one.
  const leftRef = useRef(false);
  const leave = useCallback(() => {
    if (leftRef.current) return;
    leftRef.current = true;
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);
  const videoRef = useRef(null);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const progressValRef = useRef(0);
  const translateY = useRef(new Animated.Value(0)).current;
  const animRef = useRef(null);

  // Mirrors kept in refs so the PanResponder (created once) reads live values.
  const pausedRef = useRef(false);
  const indexRef = useRef(currentIndex);
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

  // Your own stories aren't "viewed" by you (the server ignores it as well).
  // The stories row hears of each one seen, so its ring greys only once
  // they all are, and the next open starts at the first one left.
  const markViewed = useCallback((story) => {
    if (!story || isOwn) return;
    viewStory(story.id).catch(() => {});
    if (!story.is_viewed) emit(EVENTS.STORY_VIEWED, { storyId: story.id, userId: group.user?.id });
  }, [isOwn, group.user?.id]);

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

  // A story moves on once: a video reports its end on several status
  // updates, and each used to skip one more story.
  const advancedFromRef = useRef(-1);
  const goNext = useCallback(() => {
    if (advancedFromRef.current === currentIndex) return;
    advancedFromRef.current = currentIndex;
    stopImageProgress();
    progressAnim.setValue(0);
    if (currentIndex < stories.length - 1) {
      setCurrentIndex((i) => i + 1);
      setMediaLoading(true);
      setMediaFailed(false);
    } else {
      leave();
    }
  }, [currentIndex, stories.length, leave, progressAnim, stopImageProgress]);

  const goPrev = useCallback(() => {
    stopImageProgress();
    progressAnim.setValue(0);
    advancedFromRef.current = -1;
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
      setMediaLoading(true);
      setMediaFailed(false);
    } else if (isVideo && !mediaFailed) {
      // Restart the first story (mirrors WhatsApp's behaviour) — the video
      // itself too, not just its progress bar.
      videoRef.current?.setPositionAsync?.(0).catch?.(() => {});
    } else {
      startImageProgress(0);
    }
  }, [currentIndex, isVideo, mediaFailed, progressAnim, startImageProgress, stopImageProgress]);

  // A new story on screen may move on again.
  useEffect(() => { if (advancedFromRef.current !== currentIndex) advancedFromRef.current = -1; }, [currentIndex]);

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

  // A video is held paused until it shows, and some Android builds never draw
  // the first frame of a paused video — so it would wait forever. Loaded is
  // ready enough: it plays, and the first frame follows.
  const handleVideoLoad = useCallback(() => { setMediaLoading(false); }, []);

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

  // A photo still loading has no clock to resume yet: it starts on load.
  const resume = useCallback(() => {
    setPaused(false);
    pausedRef.current = false;
    if ((!isVideo || mediaFailed) && !mediaLoadingRef.current) startImageProgress(progressValRef.current);
  }, [isVideo, mediaFailed, startImageProgress]);

  const dismiss = useCallback(() => {
    Animated.timing(translateY, {
      toValue: screenH, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: true,
    }).start(() => leave());
  }, [translateY, leave, screenH]);

  // The PanResponder is created once, so it must reach pause/resume through refs
  // to avoid capturing a stale `isVideo` from the first story in the group.
  const pauseRef = useRef(pause);
  const resumeRef = useRef(resume);
  const dismissRef = useRef(dismiss);
  useEffect(() => { pauseRef.current = pause; }, [pause]);
  useEffect(() => { resumeRef.current = resume; }, [resume]);
  useEffect(() => { dismissRef.current = dismiss; }, [dismiss]);

  const react = useCallback((emoji) => {
    const story = stories[indexRef.current];
    if (!story) return;
    const was = reacted[story.id] || null;
    const next = was === emoji ? null : emoji;      // the same one again takes it back
    setReacted((r) => ({ ...r, [story.id]: next }));
    if (next) {
      setBurst(next);
      burstAnim.setValue(0);
      Animated.timing(burstAnim, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true })
        .start(() => setBurst(null));
    }
    reactToStory(story.id, next)
      // The stories row keeps it too, so reopening shows the same reaction.
      .then(() => emit(EVENTS.STORY_REACTED, { storyId: story.id, emoji: next }))
      .catch(() => setReacted((r) => ({ ...r, [story.id]: was })));
  }, [stories, reacted, burstAnim]);

  // Your own story: delete it now (its files go too, on the server).
  const removeStory = useCallback(() => {
    const story = stories[indexRef.current];
    if (!story) return;
    pauseRef.current();
    Alert.alert(t('story.deleteTitle'), t('story.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel', onPress: () => resumeRef.current() },
      {
        text: t('story.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteStory(story.id);
          } catch {
            Alert.alert(t('common.error'), t('story.deleteFailed'));
            resumeRef.current();
            return;
          }
          emit(EVENTS.STORY_DELETED, { storyId: story.id });
          if (stories.length <= 1) { leave(); return; }
          stopImageProgress();
          progressAnim.setValue(0);
          advancedFromRef.current = -1;
          setRemoved((r) => new Set(r).add(story.id));
          setCurrentIndex((i) => Math.min(i, stories.length - 2));
          setMediaLoading(true);
          setMediaFailed(false);
          setPaused(false);
          pausedRef.current = false;
        },
      },
    ]);
  }, [stories, t, leave, progressAnim, stopImageProgress]);

  const openViewers = useCallback(() => {
    const story = stories[indexRef.current];
    if (!story) return;
    pauseRef.current();
    setViewers(null);
    setViewersOpen(true);
    fetchStoryViewers(story.id).then(setViewers).catch(() => setViewers({ results: [], failed: true }));
  }, [stories]);
  const closeViewers = useCallback(() => {
    setViewersOpen(false);
    resumeRef.current();
  }, []);

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
    if (!currentStory) leave();
  }, [currentStory, leave]);
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
          ref={videoRef}
          key={currentStory.id}
          source={{ uri: currentStory.media_url }}
          style={[styles.media, { width: screenW, height: screenH }]}
          resizeMode={fit}
          shouldPlay={!paused && !mediaLoading}
          isLooping={false}
          onReadyForDisplay={handleMediaReady}
          onLoad={handleVideoLoad}
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
          <TouchableOpacity onPress={leave} style={styles.closeBtn}
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

      {/* The emoji just sent, floating up. */}
      {!!burst && (
        <Animated.Text
          pointerEvents="none"
          style={[styles.burst, {
            opacity: burstAnim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
            transform: [
              { translateY: burstAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -screenH * 0.35] }) },
              { scale: burstAnim.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.6, 1.4, 1.1] }) },
            ],
          }]}
        >
          {burst}
        </Animated.Text>
      )}

      {/* Bottom: react (someone else's story) or who watched (your own). */}
      <View
        style={[styles.footer, {
          paddingBottom: insets.bottom + spacing.sm,
          paddingLeft: spacing.sm + insets.left,
          paddingRight: spacing.sm + insets.right,
        }]}
        pointerEvents="box-none"
      >
        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.55)']} style={StyleSheet.absoluteFill} pointerEvents="none" />
        {isOwn ? (
          <View style={styles.ownRow}>
            <TouchableOpacity style={styles.viewsBtn} onPress={openViewers} accessibilityRole="button"
                              accessibilityLabel={t('story.viewers')} testID="story-viewers">
              <Ionicons name="eye-outline" size={18} color="#fff" />
              <Text style={styles.viewsText}>{t('story.viewsCount', { n: currentStory.views_count || 0 })}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.deleteBtn} onPress={removeStory} accessibilityRole="button"
                              accessibilityLabel={t('story.delete')} testID="story-delete">
              <Ionicons name="trash-outline" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.reactions} accessibilityRole="toolbar">
            {STORY_REACTIONS.map((e) => {
              const on = reacted[currentStory.id] === e;
              return (
                <TouchableOpacity key={e} onPress={() => react(e)} style={[styles.reaction, on && styles.reactionOn]}
                                  accessibilityRole="button" accessibilityState={{ selected: on }}
                                  accessibilityLabel={t('story.reactWith', { emoji: e })} testID={`story-react-${e}`}>
                  <Text style={styles.reactionText}>{e}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      {/* Your story's viewers, with how they reacted. */}
      <Modal visible={viewersOpen} transparent animationType="slide" onRequestClose={closeViewers}
             supportedOrientations={['portrait', 'landscape']}>
        <TouchableOpacity style={styles.sheetScrim} activeOpacity={1} onPress={closeViewers}
                          accessibilityLabel={t('common.close')} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md, maxHeight: screenH * 0.6 }]}
              testID="story-viewers-sheet">
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>
            {viewers ? t('story.viewersTitle', { n: viewers.count || 0 }) : t('story.viewers')}
          </Text>
          {!viewers ? <ActivityIndicator color="#fff" style={{ marginVertical: spacing.lg }} /> : (
            <FlatList
              data={viewers.results || []}
              keyExtractor={(r) => String(r.user?.id)}
              ListEmptyComponent={(
                <Text style={styles.sheetEmpty}>{viewers.failed ? t('story.viewersFailed') : t('story.noViewers')}</Text>
              )}
              renderItem={({ item }) => (
                <View style={styles.viewerRow}>
                  <Image
                    source={item.user?.profile_picture ? { uri: item.user.profile_picture } : DEFAULT_AVATAR}
                    placeholder={DEFAULT_AVATAR}
                    cachePolicy="memory-disk"
                    style={styles.viewerAvatar}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.viewerName} numberOfLines={1}>{item.user?.username}</Text>
                    <Text style={styles.viewerTime}>{timeAgo(item.viewed_at, t)}</Text>
                  </View>
                  {!!item.reaction && <Text style={styles.viewerReaction}>{item.reaction}</Text>}
                </View>
              )}
            />
          )}
        </View>
      </Modal>
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
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: spacing.lg },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  reaction: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  reactionOn: { backgroundColor: 'rgba(255,255,255,0.35)', transform: [{ scale: 1.08 }] },
  reactionText: { fontSize: 24 },
  burst: { position: 'absolute', alignSelf: 'center', bottom: '22%', fontSize: 72 },
  ownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  deleteBtn: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  viewsBtn: {
    alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44,
    paddingHorizontal: spacing.md, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)',
  },
  viewsText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  sheetScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#101722', borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingHorizontal: spacing.md, paddingTop: spacing.sm,
  },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)' },
  sheetTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginVertical: spacing.sm },
  sheetEmpty: { color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginVertical: spacing.lg },
  viewerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8 },
  viewerAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1d2a3c' },
  viewerName: { color: '#fff', fontWeight: '600', fontSize: 14 },
  viewerTime: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  viewerReaction: { fontSize: 22 },
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

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Easing,
} from 'react-native';
import SeekBar from './SeekBar';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { colors, spacing, radius, shadows, typography } from '../constants/theme';
// expo-image so the mini player's cover comes from the same cache the track
// row and Now Playing use, rather than being fetched a third time.
import { Image } from 'expo-image';
import { usePlayer, usePlayerProgress } from '../context/PlayerContext';
import { useContentWidth, FONT_SCALE } from '../utils/layout';
import { navigate, useCurrentRouteName } from '../services/navigationRef';

const HIT = { top: 10, bottom: 10, left: 10, right: 10 };
// About how long the full-screen player takes to slide away.
const HIDE_FOR_MS = 320;

const formatTime = (ms) => {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

/**
 * Persistent bottom mini-player. Renders only when a track is active.
 * Mounted once at the app root so playback follows the user across screens.
 */
const MiniPlayer = () => {
  const {
    currentTrack,
    isPlaying,
    isLoading,
    isBuffering,
    repeatMode,
    shuffle,
    hasNext,
    hasPrev,
    togglePlay,
    playNext,
    playPrevious,
    toggleShuffle,
    cycleRepeat,
    beginSeek,
    seekTo,
    closePlayer,
  } = usePlayer();
  // Position lives in its own context so the ~2x/second tick doesn't re-render
  // everything else that uses the player.
  const { positionMs, durationMs } = usePlayerProgress();
  // Centred over the same column as the feed and the library, so the bar doesn't
  // span a whole tablet while the content above it sits in the middle.
  const { sideMargin } = useContentWidth({ gutter: 0 });

  const [seekValue, setSeekValue] = useState(null);

  // Out of the way while Now Playing (the full-screen player) is open: it
  // would sit on top of it, showing the same song twice. Back on screen once
  // Now Playing has slid away — faded in after its closing animation, rather
  // than appearing over it while it's still sliding down.
  const route = useCurrentRouteName();
  const fullPlayerOpen = route === 'NowPlaying';
  const [shown, setShown] = useState(!fullPlayerOpen);
  const fade = useRef(new Animated.Value(fullPlayerOpen ? 0 : 1)).current;
  useEffect(() => {
    if (fullPlayerOpen) {
      fade.stopAnimation();
      fade.setValue(0);
      setShown(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      setShown(true);
      Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    }, HIDE_FOR_MS);
    return () => clearTimeout(timer);
  }, [fullPlayerOpen, fade]);

  // Spinning "vinyl" cover while playing. Freezes on pause and resumes from the
  // same angle (we keep advancing a single value toward the next full turn
  // rather than looping/resetting, so there's no jump).
  const angle = useRef(new Animated.Value(0)).current;
  const targetRef = useRef(0);
  const animRef = useRef(null);

  useEffect(() => {
    const run = () => {
      targetRef.current += 1;
      animRef.current = Animated.timing(angle, {
        toValue: targetRef.current,
        duration: 6000,
        easing: Easing.linear,
        useNativeDriver: true,
      });
      animRef.current.start(({ finished }) => {
        if (finished) run();
      });
    };
    if (isPlaying) run();
    else animRef.current?.stop();
    return () => animRef.current?.stop();
  }, [isPlaying, angle]);

  const rotate = angle.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  if (!currentTrack || !shown) return null;

  // The 200px cover (processed songs) — the full one is a waste at this size.
  const cover = currentTrack.cover_small || currentTrack.cover_image;
  const progress =
    seekValue != null
      ? seekValue
      : durationMs > 0
      ? positionMs / durationMs
      : 0;
  // While dragging, preview the seek target instead of the live position.
  const displayedMs = seekValue != null ? seekValue * durationMs : positionMs;
  const busy = isLoading || isBuffering;

  return (
    <Animated.View style={[styles.wrap, { opacity: fade }, sideMargin > 0 && {
      left: sideMargin + spacing.sm,
      right: sideMargin + spacing.sm,
    }]}>
      <View style={styles.topRow}>
        <TouchableOpacity onPress={toggleShuffle} hitSlop={HIT}>
          <Ionicons name="shuffle" size={18} color={shuffle ? colors.primary : colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity onPress={cycleRepeat} hitSlop={HIT}>
          <MaterialIcons
            name={repeatMode === 'one' ? 'repeat-one' : 'repeat'}
            size={18}
            color={repeatMode !== 'off' ? colors.primary : colors.textMuted}
          />
        </TouchableOpacity>
      </View>

      <SeekBar
        style={styles.slider}
        value={progress}
        onSlidingStart={() => {
          beginSeek();
          setSeekValue(progress);
        }}
        onValueChange={setSeekValue}
        onSlidingComplete={async (v) => {
          await seekTo(v);
          setSeekValue(null);
        }}
        thumbTintColor={colors.white}
        minimumTrackTintColor={colors.primary}
        maximumTrackTintColor={colors.border}
        disabled={durationMs === 0}
      />

      <View style={styles.row}>
        <TouchableOpacity
          style={styles.expandArea}
          activeOpacity={0.8}
          onPress={() => navigate('NowPlaying')}
        >
          <Animated.View style={[styles.coverWrap, { transform: [{ rotate }] }]}>
            {cover ? (
              <Image
                source={{ uri: cover }}
                style={styles.cover}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={150}
              />
            ) : (
              <View style={[styles.cover, styles.coverPlaceholder]}>
                <Ionicons name="musical-notes" size={20} color={colors.textMuted} />
              </View>
            )}
            <View style={styles.coverHole} />
          </Animated.View>

          <View style={styles.meta}>
            <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE.chrome}>
              {currentTrack.title}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {currentTrack.artist?.username || 'Unknown artist'}
              {durationMs > 0 ? `  ·  ${formatTime(displayedMs)} / ${formatTime(durationMs)}` : ''}
            </Text>
          </View>
        </TouchableOpacity>

        <View style={styles.controls}>
          <TouchableOpacity onPress={playPrevious} hitSlop={HIT} disabled={!hasPrev}>
            <MaterialIcons name="skip-previous" size={26} color={hasPrev ? colors.textSecondary : colors.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={togglePlay}
            style={styles.playButton}
            activeOpacity={0.85}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Ionicons
                name={isPlaying ? 'pause' : 'play'}
                size={22}
                color={colors.white}
                style={!isPlaying && { marginLeft: 2 }}
              />
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={playNext} hitSlop={HIT} disabled={!hasNext}>
            <MaterialIcons name="skip-next" size={26} color={hasNext ? colors.textSecondary : colors.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity onPress={closePlayer} hitSlop={HIT} style={styles.closeBtn}>
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    bottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    ...shadows.lg,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
  },
  slider: { width: '100%', height: 28 },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: -4 },
  expandArea: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  coverWrap: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.card,
  },
  coverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  coverHole: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  meta: { flex: 1, marginHorizontal: spacing.sm },
  title: { ...typography.label, color: colors.textPrimary },
  sub: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  closeBtn: { marginLeft: 2 },
});

export default MiniPlayer;

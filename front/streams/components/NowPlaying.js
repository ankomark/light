import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Image, StyleSheet, TouchableOpacity, ScrollView,
  Dimensions, ActivityIndicator, Platform, StatusBar,
} from 'react-native';
import SeekBar from './SeekBar';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { usePlayer } from '../context/PlayerContext';
import { colors, spacing, radius, typography, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const { width } = Dimensions.get('window');
const ART = Math.min(width - spacing.lg * 2, 340);
const TOP_PAD = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 8 : 54;
const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

const formatTime = (ms) => {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

// Bump a Cloudinary cover's transform up for full-screen display. Returns the
// original URL untouched if it isn't a recognizable Cloudinary transform URL.
const upscaleCover = (url) => {
  if (!url || !url.includes('res.cloudinary.com')) return url;
  return url.replace(/\/upload\/[^/]*[wc]_[^/]*\//, '/upload/w_800,h_800,c_fill,q_auto,f_auto/');
};

const NowPlaying = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const {
    currentTrack,
    isPlaying,
    isLoading,
    isBuffering,
    positionMs,
    durationMs,
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
  } = usePlayer();

  const [seekValue, setSeekValue] = useState(null);
  const [showLyrics, setShowLyrics] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);

  const lyricsRef = useRef(null);
  const userScrollingRef = useRef(false);
  const resumeTimer = useRef(null);
  const contentH = useRef(0);
  const viewH = useRef(0);

  // If playback is closed/stopped while this screen is open, dismiss it.
  useEffect(() => {
    if (!currentTrack) navigation.goBack();
  }, [currentTrack, navigation]);

  // Auto-scroll the lyrics in step with playback (unless the user is scrolling).
  useEffect(() => {
    if (!showLyrics || userScrollingRef.current || durationMs <= 0) return;
    const max = Math.max(0, contentH.current - viewH.current);
    const y = max * (positionMs / durationMs);
    lyricsRef.current?.scrollTo({ y, animated: true });
  }, [positionMs, durationMs, showLyrics]);

  useEffect(() => () => clearTimeout(resumeTimer.current), []);

  if (!currentTrack) return null;

  const progress = seekValue != null ? seekValue : durationMs > 0 ? positionMs / durationMs : 0;
  const busy = isLoading || isBuffering;
  const cover = !coverFailed ? upscaleCover(currentTrack.cover_image) : null;
  const lyrics = (currentTrack.lyrics || '').trim();
  const repeatIcon = repeatMode === 'one' ? 'repeat-one' : 'repeat';
  const displayedMs = seekValue != null ? seekValue * durationMs : positionMs;

  const onLyricsScrollBegin = () => {
    userScrollingRef.current = true;
    clearTimeout(resumeTimer.current);
  };
  const onLyricsScrollEnd = () => {
    clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => { userScrollingRef.current = false; }, 2500);
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#143A63', '#0A1628']} style={StyleSheet.absoluteFill} />

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: TOP_PAD }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={HIT}>
          <Ionicons name="chevron-down" size={28} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topLabel}>NOW PLAYING</Text>
        <TouchableOpacity
          onPress={() => setShowLyrics((s) => !s)}
          hitSlop={HIT}
          disabled={!lyrics}
        >
          <MaterialIcons
            name="lyrics"
            size={24}
            color={lyrics ? (showLyrics ? colors.primary : colors.textSecondary) : colors.textMuted}
          />
        </TouchableOpacity>
      </View>

      {/* Stage: artwork or lyrics */}
      <View style={styles.stage}>
        {showLyrics ? (
          <ScrollView
            ref={lyricsRef}
            style={styles.lyricsScroll}
            contentContainerStyle={styles.lyricsContent}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScrollBeginDrag={onLyricsScrollBegin}
            onScrollEndDrag={onLyricsScrollEnd}
            onMomentumScrollEnd={onLyricsScrollEnd}
            onLayout={(e) => { viewH.current = e.nativeEvent.layout.height; }}
            onContentSizeChange={(_, h) => { contentH.current = h; }}
          >
            <Text style={styles.lyricsText}>{lyrics || t('music.noLyrics')}</Text>
          </ScrollView>
        ) : cover ? (
          <Image
            source={{ uri: cover }}
            style={styles.art}
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <View style={[styles.art, styles.artPlaceholder]}>
            <Ionicons name="musical-notes" size={72} color={colors.textMuted} />
          </View>
        )}
      </View>

      {/* Title / artist */}
      <View style={styles.metaBlock}>
        <Text style={styles.title} numberOfLines={1}>{currentTrack.title}</Text>
        <Text style={styles.artist} numberOfLines={1}>
          {currentTrack.artist?.username || 'Unknown artist'}
          {currentTrack.album ? `  ·  ${currentTrack.album}` : ''}
        </Text>
      </View>

      {/* Scrubber */}
      <View style={styles.scrubBlock}>
        <SeekBar
          style={styles.slider}
          value={progress}
          onSlidingStart={() => { beginSeek(); setSeekValue(progress); }}
          onValueChange={setSeekValue}
          onSlidingComplete={async (v) => { await seekTo(v); setSeekValue(null); }}
          thumbTintColor={colors.white}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.border}
          disabled={durationMs === 0}
        />
        <View style={styles.timeRow}>
          <Text style={styles.time}>{formatTime(displayedMs)}</Text>
          <Text style={styles.time}>{formatTime(durationMs)}</Text>
        </View>
      </View>

      {/* Transport controls */}
      <View style={styles.controls}>
        <TouchableOpacity onPress={toggleShuffle} hitSlop={HIT}>
          <Ionicons name="shuffle" size={24} color={shuffle ? colors.primary : colors.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity onPress={playPrevious} hitSlop={HIT} disabled={!hasPrev}>
          <MaterialIcons name="skip-previous" size={42} color={hasPrev ? colors.textPrimary : colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity onPress={togglePlay} style={styles.playBtn} activeOpacity={0.85} disabled={busy}>
          {busy ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={34} color={colors.white} style={!isPlaying && { marginLeft: 3 }} />
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={playNext} hitSlop={HIT} disabled={!hasNext}>
          <MaterialIcons name="skip-next" size={42} color={hasNext ? colors.textPrimary : colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity onPress={cycleRepeat} hitSlop={HIT}>
          <MaterialIcons name={repeatIcon} size={24} color={repeatMode !== 'off' ? colors.primary : colors.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  topLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    letterSpacing: 1.5,
    fontWeight: '700',
  },
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  art: {
    width: ART,
    height: ART,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    ...shadows.lg,
  },
  artPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  lyricsScroll: { alignSelf: 'stretch' },
  lyricsContent: { paddingVertical: spacing.xl },
  lyricsText: {
    ...typography.body,
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 32,
    textAlign: 'center',
  },
  metaBlock: { paddingHorizontal: spacing.lg, marginTop: spacing.md },
  title: { ...typography.h2, color: colors.textPrimary, textAlign: 'center' },
  artist: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  scrubBlock: { paddingHorizontal: spacing.lg, marginTop: spacing.md },
  slider: { width: '100%', height: 36 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
  time: { ...typography.caption, color: colors.textMuted },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
    marginBottom: spacing.xxl,
  },
  playBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
});

export default NowPlaying;

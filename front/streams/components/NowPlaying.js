import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, FlatList,
  useWindowDimensions, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// expo-image: the cover is the same artwork the track row already loaded, so a
// shared memory+disk cache means opening Now Playing shows it instantly.
import { Image } from 'expo-image';
import SeekBar from './SeekBar';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { usePlayer, usePlayerProgress } from '../context/PlayerContext';
import { fetchTrackLyrics, fetchSimilarTracks } from '../services/api';
import LikeButton from './LikeButton';
import CommentAction from './CommentAction';
import DownloadButton from './DownloadButton';
import FullSheet from './FullSheet';
import { colors, spacing, radius, typography, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

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
  // Reactive artwork size — reflows on rotation / web resize (was a module-scope
  // Dimensions.get snapshot captured once at import).
  const { width: winW, height: winH } = useWindowDimensions();
  // Real safe-area insets instead of a guessed status-bar height, top and
  // bottom (the controls used to sit on the home indicator on some phones).
  const insets = useSafeAreaInsets();
  // Leave room for the action row on shorter screens.
  const artSize = Math.min(winW - spacing.lg * 2, 340, winH * 0.36);
  const artDim = { width: artSize, height: artSize };
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
    playQueue,
  } = usePlayer();
  // Position lives in its own context so the ~2x/second tick doesn't re-render
  // everything else that uses the player.
  const { positionMs, durationMs } = usePlayerProgress();

  const [seekValue, setSeekValue] = useState(null);
  const [showLyrics, setShowLyrics] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  // The queue no longer carries lyrics (a 200-track shuffle used to ship 200
  // song texts). They're fetched for the track being played, and only when the
  // lyrics view is actually opened — cached per track for the session, so
  // toggling back and forth costs nothing.
  const [lyricsText, setLyricsText] = useState('');
  // "More like this" for whatever is playing, loaded when the sheet opens.
  const [showSimilar, setShowSimilar] = useState(false);
  const [similar, setSimilar] = useState([]);
  const [similarFor, setSimilarFor] = useState(null);

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

  // Fetch this track's lyrics when the view is open. Re-runs on track change,
  // so lyrics follow the song as the queue advances.
  const trackId = currentTrack?.id;
  const inlineLyrics = currentTrack?.lyrics;
  useEffect(() => {
    if (!showLyrics || trackId == null) return undefined;
    // A full track object (detail/edit paths) still carries them inline.
    if (typeof inlineLyrics === 'string') {
      setLyricsText(inlineLyrics);
      return undefined;
    }
    let cancelled = false;
    setLyricsText('');
    fetchTrackLyrics(trackId)
      .then((text) => { if (!cancelled) setLyricsText(text); })
      .catch(() => { if (!cancelled) setLyricsText(''); });
    return () => { cancelled = true; };
  }, [showLyrics, trackId, inlineLyrics]);

  useEffect(() => {
    if (!showSimilar || trackId == null || similarFor === trackId) return undefined;
    let cancelled = false;
    setSimilar([]);
    fetchSimilarTracks(trackId)
      .then((rows) => { if (!cancelled && Array.isArray(rows)) { setSimilar(rows); setSimilarFor(trackId); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [showSimilar, trackId, similarFor]);

  if (!currentTrack) return null;

  const progress = seekValue != null ? seekValue : durationMs > 0 ? positionMs / durationMs : 0;
  const busy = isLoading || isBuffering;
  const cover = !coverFailed ? upscaleCover(currentTrack.cover_image) : null;
  const lyrics = lyricsText.trim();
  // Whether the button is enabled comes from the flag on the payload, not from
  // the text — the text isn't fetched until the button is pressed.
  const hasLyrics = typeof currentTrack.has_lyrics === 'boolean'
    ? currentTrack.has_lyrics
    : !!(currentTrack.lyrics || '').trim();
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
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={HIT}>
          <Ionicons name="chevron-down" size={28} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topLabel}>NOW PLAYING</Text>
        <TouchableOpacity
          onPress={() => setShowLyrics((s) => !s)}
          hitSlop={HIT}
          disabled={!hasLyrics}
        >
          <MaterialIcons
            name="lyrics"
            size={24}
            color={hasLyrics ? (showLyrics ? colors.primary : colors.textSecondary) : colors.textMuted}
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
            style={[styles.art, artDim]}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={200}
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <View style={[styles.art, styles.artPlaceholder, artDim]}>
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

      {/* Like · comments · download · more like this */}
      <View style={styles.actionRow}>
        <LikeButton trackId={currentTrack.id} initialLikes={currentTrack.likes_count} initialIsLiked={currentTrack.is_liked} />
        <CommentAction trackId={currentTrack.id} commentCount={currentTrack.comments_count} triggerVariant="compact" />
        <DownloadButton track={currentTrack} size={22} />
        <TouchableOpacity style={styles.moreLike} onPress={() => setShowSimilar(true)} hitSlop={HIT}>
          <Ionicons name="sparkles" size={16} color={colors.primary} />
          <Text style={styles.moreLikeText}>{t('music.moreLikeThis')}</Text>
        </TouchableOpacity>
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
      <View style={[styles.controls, { marginBottom: Math.max(insets.bottom, spacing.md) + spacing.lg }]}>
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

      <FullSheet visible={showSimilar} title={t('music.moreLikeThis')} onClose={() => setShowSimilar(false)}>
        {similarFor !== trackId ? (
          <ActivityIndicator style={styles.sheetSpinner} color={colors.primary} />
        ) : (
          <FlatList
            data={similar}
            keyExtractor={(tr) => `sim_${tr.id}`}
            contentContainerStyle={styles.simList}
            ListEmptyComponent={<Text style={styles.simEmpty}>{t('sound.empty')}</Text>}
            renderItem={({ item, index }) => (
              <TouchableOpacity
                style={styles.simRow}
                activeOpacity={0.85}
                onPress={() => { setShowSimilar(false); playQueue(similar, index); }}
              >
                <View style={styles.simCover}>
                  {item.cover_image ? (
                    <Image source={{ uri: item.cover_image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
                  ) : (
                    <Ionicons name="musical-notes" size={20} color={colors.textMuted} />
                  )}
                </View>
                <View style={styles.simBody}>
                  <Text style={styles.simTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.simMeta} numberOfLines={1}>
                    {item.artist?.username}{item.reason ? '  ·  ' + t('music.reason.' + item.reason) : ''}
                  </Text>
                </View>
                <Ionicons name="play-circle" size={28} color={colors.primary} />
              </TouchableOpacity>
            )}
          />
        )}
      </FullSheet>
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
  scrubBlock: { paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  actionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, marginTop: spacing.md,
  },
  moreLike: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: 'rgba(29,161,242,0.14)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(29,161,242,0.5)',
  },
  moreLikeText: { color: colors.textPrimary, fontSize: 12.5, fontWeight: '700' },
  sheetSpinner: { marginTop: spacing.xl },
  simList: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
  simEmpty: { color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl },
  simRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 9 },
  simCover: {
    width: 50, height: 50, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  simBody: { flex: 1 },
  simTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  simMeta: { color: colors.textSecondary, fontSize: 12.5, marginTop: 2 },
  slider: { width: '100%', height: 36 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
  time: { ...typography.caption, color: colors.textMuted },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    marginTop: spacing.md,
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

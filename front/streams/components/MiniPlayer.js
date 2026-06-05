import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { colors, spacing, radius, shadows, typography } from '../constants/theme';
import { usePlayer } from '../context/PlayerContext';

const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

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
    positionMs,
    durationMs,
    togglePlay,
    skip,
    beginSeek,
    seekTo,
    closePlayer,
  } = usePlayer();

  const [seekValue, setSeekValue] = useState(null);

  if (!currentTrack) return null;

  const cover = currentTrack.cover_image;
  const progress =
    seekValue != null
      ? seekValue
      : durationMs > 0
      ? positionMs / durationMs
      : 0;
  const busy = isLoading || isBuffering;

  return (
    <View style={styles.wrap}>
      <Slider
        style={styles.slider}
        minimumValue={0}
        maximumValue={1}
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
        {cover ? (
          <Image source={{ uri: cover }} style={styles.cover} />
        ) : (
          <View style={[styles.cover, styles.coverPlaceholder]}>
            <Ionicons name="musical-notes" size={20} color={colors.textMuted} />
          </View>
        )}

        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={1}>
            {currentTrack.title}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {currentTrack.artist?.username || 'Unknown artist'}
            {durationMs > 0 ? `  ·  ${formatTime(positionMs)} / ${formatTime(durationMs)}` : ''}
          </Text>
        </View>

        <View style={styles.controls}>
          <TouchableOpacity onPress={() => skip(-10000)} hitSlop={HIT} disabled={busy}>
            <MaterialIcons name="replay-10" size={24} color={colors.textSecondary} />
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

          <TouchableOpacity onPress={() => skip(10000)} hitSlop={HIT} disabled={busy}>
            <MaterialIcons name="forward-10" size={24} color={colors.textSecondary} />
          </TouchableOpacity>

          <TouchableOpacity onPress={closePlayer} hitSlop={HIT} style={styles.closeBtn}>
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
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
  slider: { width: '100%', height: 28 },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: -4 },
  cover: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.card,
  },
  coverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
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

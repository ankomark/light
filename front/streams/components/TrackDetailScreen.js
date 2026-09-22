// A song's own page: cover, title and artist, play / like / download, its
// comments, and "More like this". It's where a track notification lands —
// with `commentId`, the comments open on that exact comment.
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import RotatingBackground from './RotatingBackground';
import LikeButton from './LikeButton';
import DownloadButton from './DownloadButton';
import CommentAction from './CommentAction';
import TrackRail from './TrackRail';
import { usePlayer } from '../context/PlayerContext';
import { fetchTrack, fetchSimilarTracks } from '../services/api';
import { useI18n } from '../context/I18nContext';
import { colors, radius, spacing, shadows } from '../constants/theme';

const TrackDetailScreen = ({ route, navigation }) => {
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const { trackId, commentId } = route.params || {};
  const [track, setTrack] = useState(route.params?.track || null);
  const [similar, setSimilar] = useState([]);
  const [failed, setFailed] = useState(false);
  const { currentTrack, isPlaying, playQueue, togglePlay } = usePlayer();

  useEffect(() => {
    let cancelled = false;
    fetchTrack(trackId)
      .then((tr) => { if (!cancelled) setTrack(tr); })
      .catch(() => { if (!cancelled) setFailed(true); });
    fetchSimilarTracks(trackId)
      .then((rows) => { if (!cancelled && Array.isArray(rows)) setSimilar(rows); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [trackId]);

  const art = Math.min(width - spacing.xl * 2, 300);
  const isCurrent = currentTrack?.id === track?.id;
  const reasonLabel = (r) => t(`music.reason.${r}`);

  return (
    <View style={styles.root}>
      <RotatingBackground scope="music" intervalMs={60000} scrimColor="rgba(8,18,34,0.78)" />
      <SafeAreaView edges={['top']} style={styles.flex}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
            <Feather name="arrow-left" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        {!track ? (
          failed
            ? <Text style={styles.gone}>{t('music.trackUnavailable')}</Text>
            : <ActivityIndicator style={styles.spinner} color={colors.primary} />
        ) : (
          <>
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
              <View style={[styles.cover, { width: art, height: art }]}>
                {track.cover_image ? (
                  <Image source={{ uri: track.cover_image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={150} />
                ) : (
                  <Ionicons name="musical-notes" size={64} color={colors.textMuted} />
                )}
              </View>
              <Text style={styles.title} numberOfLines={2}>{track.title}</Text>
              <TouchableOpacity
                onPress={() => track.artist?.id && navigation.navigate('UserProfile', { userId: track.artist.id, username: track.artist.username })}
              >
                <Text style={styles.artist}>{track.artist?.username}{track.album ? `  ·  ${track.album}` : ''}</Text>
              </TouchableOpacity>

              <View style={styles.actions}>
                <LikeButton trackId={track.id} initialLikes={track.likes_count} initialIsLiked={track.is_liked} />
                <TouchableOpacity
                  style={styles.play}
                  activeOpacity={0.85}
                  onPress={() => (isCurrent ? togglePlay() : playQueue([track, ...similar], 0))}
                >
                  <Ionicons name={isCurrent && isPlaying ? 'pause' : 'play'} size={30} color="#fff" style={!(isCurrent && isPlaying) && { marginLeft: 3 }} />
                </TouchableOpacity>
                <DownloadButton track={track} size={24} />
              </View>

              <TrackRail title={t('music.moreLikeThis')} tracks={similar} reasonLabel={reasonLabel} style={styles.rail} />
            </ScrollView>

            <CommentAction
              trackId={track.id}
              commentCount={track.comments_count}
              triggerVariant="bar"
              autoOpen={!!commentId}
              highlightCommentId={commentId}
            />
          </>
        )}
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  content: { alignItems: 'center', paddingBottom: spacing.xl },
  cover: {
    borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', ...shadows.lg,
  },
  title: { color: colors.textPrimary, fontSize: 24, fontWeight: '800', textAlign: 'center', marginTop: spacing.lg, paddingHorizontal: spacing.lg },
  artist: { color: colors.textSecondary, fontSize: 15, marginTop: 4, textAlign: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xl, marginTop: spacing.lg, marginBottom: spacing.lg },
  play: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', ...shadows.md,
  },
  rail: { alignSelf: 'stretch' },
  spinner: { marginTop: spacing.xxl },
  gone: { color: colors.textMuted, textAlign: 'center', marginTop: spacing.xxl },
});

export default TrackDetailScreen;

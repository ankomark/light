import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { fetchPlaylist, deletePlaylist, removeTrackFromPlaylist } from '../services/api';
import { usePlayer } from '../context/PlayerContext';
import TrackItem from './TrackItem';
import { colors, spacing, radius, typography, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { peekCache, readCache, writeCache } from '../utils/screenCache';
import { TrackListSkeleton } from './SkeletonLoader';

const PlaylistDetail = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const route = useRoute();
  const { playQueue } = usePlayer();
  const playlistId = route.params?.playlistId;

  // Keyed by playlist, not by user: a playlist is already scoped to its owner
  // server-side, and this screen is only reachable from that owner's list.
  const cacheKey = `playlist:${playlistId}`;
  const cached = peekCache(cacheKey);

  const [playlist, setPlaylist] = useState(cached ?? null);
  const [tracks, setTracks] = useState(
    () => (Array.isArray(cached?.tracks) ? cached.tracks : [])
  );
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState(null);

  // Cold open: paint the last version from disk, then revalidate behind it.
  useEffect(() => {
    let cancelled = false;
    readCache(cacheKey).then((hit) => {
      if (cancelled || !hit) return;
      setPlaylist((prev) => prev ?? hit);
      setTracks((prev) => (prev.length ? prev : (Array.isArray(hit.tracks) ? hit.tracks : [])));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [cacheKey]);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchPlaylist(playlistId);
      setPlaylist(data);
      setTracks(Array.isArray(data?.tracks) ? data.tracks : []);
      if (data) writeCache(cacheKey, data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [playlistId, cacheKey]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (playlist?.name || route.params?.name) {
      navigation.setOptions?.({ title: playlist?.name || route.params?.name });
    }
  }, [navigation, playlist?.name, route.params?.name]);

  const buildQueue = useCallback(
    () => tracks.map((t) => ({
      id: t.id,
      title: t.title,
      album: t.album,
      artist: t.artist,
      cover_image: t.cover_image,
      audio_file: t.audio_file,
      has_lyrics: t.has_lyrics,
    })),
    [tracks]
  );

  const handleRemove = useCallback((trackId) => {
    // Optimistic removal with rollback.
    const prev = tracks;
    setTracks((cur) => cur.filter((t) => t.id !== trackId));
    removeTrackFromPlaylist(playlistId, trackId).catch(() => {
      setTracks(prev);
      Alert.alert(t('common.error'), t('playlist.removeTrackFailed'));
    });
  }, [tracks, playlistId, t]);

  const handleDeletePlaylist = useCallback(() => {
    Alert.alert(t('playlist.deleteTitle'), t('playlist.deleteConfirm', { name: playlist?.name || t('playlist.thisPlaylist') }), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deletePlaylist(playlistId);
            navigation.goBack();
          } catch {
            Alert.alert(t('common.error'), t('playlist.deleteFailed'));
          }
        },
      },
    ]);
  }, [playlist?.name, playlistId, navigation, t]);

  const renderHeader = useCallback(() => (
    <View style={styles.header}>
      <Text style={styles.title} numberOfLines={2}>{playlist?.name}</Text>
      <Text style={styles.meta}>
        {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
      </Text>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionBtn, tracks.length === 0 && styles.actionDisabled]}
          onPress={() => tracks.length && playQueue(buildQueue(), 0, { shuffle: false })}
          disabled={tracks.length === 0}
          activeOpacity={0.85}
        >
          <Ionicons name="play" size={16} color={colors.white} />
          <Text style={styles.actionText}>{t('playlist.playAll')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.shuffleBtn, tracks.length === 0 && styles.actionDisabled]}
          onPress={() => tracks.length && playQueue(buildQueue(), 0, { shuffle: true })}
          disabled={tracks.length === 0}
          activeOpacity={0.85}
        >
          <Ionicons name="shuffle" size={16} color={colors.primary} />
          <Text style={styles.shuffleText}>{t('playlist.shuffle')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.deleteBtn} onPress={handleDeletePlaylist} activeOpacity={0.85}>
          <MaterialIcons name="delete-outline" size={20} color={colors.error} />
        </TouchableOpacity>
      </View>
    </View>
  ), [playlist?.name, tracks.length, buildQueue, playQueue, handleDeletePlaylist, t]);

  // Skeleton rows rather than a centered spinner, and only when there is
  // genuinely nothing cached to show.
  if (loading && !playlist) {
    return (
      <View style={styles.container}>
        <TrackListSkeleton count={8} />
      </View>
    );
  }

  if ((error && !playlist) || !playlist) {
    return (
      <View style={styles.centered}>
        <MaterialIcons name="error-outline" size={48} color={colors.textMuted} />
        <Text style={styles.errorText}>{"Couldn't load this playlist."}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load}>
          <Text style={styles.retryText}>{t('common.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <FlatList
      // Each row hosts a comment sheet (a Modal). Touches inside a Modal still
      // bubble through this list in the React tree, and with the default
      // ('never') the list swallowed the first tap to close the keyboard, so
      // posting a comment took two taps. 'handled' lets the button take it.
      keyboardShouldPersistTaps="handled"
      style={styles.container}
      data={tracks}
      keyExtractor={(item) => `pltrack_${item.id}`}
      renderItem={({ item, index }) => (
        <TrackItem
          track={item}
          onPlay={() => playQueue(buildQueue(), index)}
          onRemoveFromPlaylist={() => handleRemove(item.id)}
        />
      )}
      ListHeaderComponent={renderHeader}
      ListEmptyComponent={
        <View style={styles.empty}>
          <MaterialIcons name="queue-music" size={48} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('playlist.empty')}</Text>
          <Text style={styles.emptySub}>{t('playlist.addFromMusic')}</Text>
        </View>
      }
      contentContainerStyle={styles.listContent}
    />
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  centered: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  listContent: { paddingBottom: 120 },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  title: { ...typography.h2, color: colors.textPrimary },
  meta: { ...typography.body, color: colors.textSecondary, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  actionText: { ...typography.label, color: colors.white, fontWeight: '700' },
  shuffleBtn: { backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: colors.primary },
  shuffleText: { ...typography.label, color: colors.primary, fontWeight: '700' },
  actionDisabled: { opacity: 0.5 },
  deleteBtn: {
    marginLeft: 'auto',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  empty: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textSecondary },
  emptySub: { ...typography.caption, color: colors.textMuted },
  errorText: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm, marginBottom: spacing.md },
  retryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryText: { ...typography.button, color: colors.white },
});

export default PlaylistDetail;

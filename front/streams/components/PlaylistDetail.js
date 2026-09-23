// A playlist: its cover, name, description, owner and length, then its songs
// in order. Anyone the owner shared it with (public / unlisted) can play it;
// the owner can also edit it, reorder it and remove songs.
//
// Paints the last copy straight away (cache) and refreshes behind it.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, useWindowDimensions,
} from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  fetchPlaylist, deletePlaylist, removeTrackFromPlaylist, reorderPlaylist,
} from '../services/api';
import { usePlayer } from '../context/PlayerContext';
import toQueueTrack from '../utils/queueTrack';
import TrackItem from './TrackItem';
import PlaylistCover from './PlaylistCover';
import EditPlaylistSheet from './EditPlaylistSheet';
import { colors, spacing, radius, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { peekCache, readCache, writeCache } from '../utils/screenCache';
import { TrackListSkeleton } from './SkeletonLoader';

const VIS_ICON = { private: 'lock-closed', unlisted: 'link', public: 'globe-outline' };
const HIT = { top: 8, bottom: 8, left: 8, right: 8 };

// "48 min", "1 hr 5 min" — a playlist's total length.
const totalLength = (t, ms) => {
  const mins = Math.round((ms || 0) / 60000);
  if (!mins) return null;
  const h = Math.floor(mins / 60);
  return h ? t('playlist.lengthHours', { h, m: mins % 60 }) : t('playlist.lengthMinutes', { m: mins });
};

const move = (list, from, to) => {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

const PlaylistDetail = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const route = useRoute();
  const { playQueue } = usePlayer();
  const { width } = useWindowDimensions();
  const playlistId = route.params?.playlistId;

  const cacheKey = `playlist:${playlistId}`;
  const cached = peekCache(cacheKey);

  const [playlist, setPlaylist] = useState(cached ?? null);
  const [tracks, setTracks] = useState(() => (Array.isArray(cached?.tracks) ? cached.tracks : []));
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  // Reordering: a working copy of the order until Done.
  const [order, setOrder] = useState(null);

  const apply = useCallback((data) => {
    setPlaylist(data);
    setTracks(Array.isArray(data?.tracks) ? data.tracks : []);
    if (data) writeCache(cacheKey, data);
  }, [cacheKey]);

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
      apply(await fetchPlaylist(playlistId));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [playlistId, apply]);

  useEffect(() => { load(); }, [load]);

  const isOwner = !!playlist?.is_owner;

  const buildQueue = useCallback(() => tracks.map(toQueueTrack), [tracks]);

  const handleRemove = useCallback((trackId) => {
    const prev = tracks;
    setTracks((cur) => cur.filter((tr) => tr.id !== trackId));
    removeTrackFromPlaylist(playlistId, trackId)
      .then(apply)
      .catch(() => {
        setTracks(prev);
        Alert.alert(t('common.error'), t('playlist.removeTrackFailed'));
      });
  }, [tracks, playlistId, apply, t]);

  const handleDelete = useCallback(() => {
    Alert.alert(t('playlist.deleteTitle'), t('playlist.deleteConfirm', { name: playlist?.name || t('playlist.thisPlaylist') }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deletePlaylist(playlistId);
            setEditing(false);
            navigation.goBack();
          } catch {
            Alert.alert(t('common.error'), t('playlist.deleteFailed'));
          }
        },
      },
    ]);
  }, [playlist?.name, playlistId, navigation, t]);

  const saveOrder = useCallback(() => {
    const next = order;
    setOrder(null);
    if (!next || next.every((tr, i) => tr.id === tracks[i]?.id)) return;
    const prev = tracks;
    setTracks(next);
    reorderPlaylist(playlistId, next.map((tr) => tr.id))
      .then(apply)
      .catch(() => {
        setTracks(prev);
        Alert.alert(t('common.error'), t('playlist.reorderFailed'));
      });
  }, [order, tracks, playlistId, apply, t]);

  const coverSize = Math.min(220, Math.round(width * 0.55));
  const meta = useMemo(() => [
    t('library.songCount', { n: tracks.length }),
    totalLength(t, playlist?.duration_ms),
    playlist?.visibility ? t(`playlist.visibility.${playlist.visibility}`) : null,
  ].filter(Boolean).join('  ·  '), [t, tracks.length, playlist?.duration_ms, playlist?.visibility]);

  const header = playlist ? (
    <View style={styles.header}>
      <PlaylistCover
        cover={playlist.cover_image}
        images={playlist.cover_images || []}
        size={coverSize}
        radius={12}
        style={styles.bigCover}
      />
      <Text style={styles.title} numberOfLines={3}>{playlist.name}</Text>
      {playlist.description ? <Text style={styles.description}>{playlist.description}</Text> : null}
      {!isOwner && playlist.user ? (
        <TouchableOpacity
          onPress={() => navigation.navigate('UserProfile', { userId: playlist.user.id, username: playlist.user.username })}
          hitSlop={HIT}
        >
          <Text style={styles.owner}>{t('playlist.by', { name: playlist.user.username })}</Text>
        </TouchableOpacity>
      ) : null}
      <View style={styles.metaRow}>
        {playlist.visibility ? <Ionicons name={VIS_ICON[playlist.visibility]} size={13} color={colors.textSecondary} /> : null}
        <Text style={styles.meta}>{meta}</Text>
      </View>

      {order ? (
        <View style={styles.actions}>
          <Text style={styles.reorderHint}>{t('playlist.reorderHint')}</Text>
          <TouchableOpacity style={styles.actionBtn} onPress={saveOrder} activeOpacity={0.85}>
            <Text style={styles.actionText}>{t('common.done')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, !tracks.length && styles.actionDisabled]}
            onPress={() => tracks.length && playQueue(buildQueue(), 0, { shuffle: false, source: 'playlist' })}
            disabled={!tracks.length}
            activeOpacity={0.85}
          >
            <Ionicons name="play" size={16} color={colors.white} />
            <Text style={styles.actionText}>{t('playlist.playAll')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.shuffleBtn, !tracks.length && styles.actionDisabled]}
            onPress={() => tracks.length && playQueue(buildQueue(), 0, { shuffle: true, source: 'playlist' })}
            disabled={!tracks.length}
            activeOpacity={0.85}
          >
            <Ionicons name="shuffle" size={16} color={colors.primary} />
            <Text style={styles.shuffleText}>{t('playlist.shuffle')}</Text>
          </TouchableOpacity>
          {isOwner ? (
            <View style={styles.ownerBtns}>
              {tracks.length > 1 ? (
                <TouchableOpacity style={styles.roundBtn} onPress={() => setOrder(tracks)} accessibilityLabel={t('playlist.reorder')}>
                  <MaterialIcons name="swap-vert" size={20} color={colors.textPrimary} />
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={styles.roundBtn} onPress={() => setEditing(true)} accessibilityLabel={t('playlist.edit')}>
                <Ionicons name="pencil" size={18} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      )}
    </View>
  ) : null;

  if (loading && !playlist) {
    return (
      <View style={styles.container}>
        <TrackListSkeleton count={8} />
      </View>
    );
  }

  if (!playlist) {
    return (
      <View style={styles.centered}>
        <MaterialIcons name="error-outline" size={48} color={colors.textMuted} />
        <Text style={styles.errorText}>{t(error?.response?.status === 404 ? 'playlist.unavailable' : 'playlist.loadFailed')}</Text>
        {error?.response?.status !== 404 ? (
          <TouchableOpacity style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  const reorderRow = ({ item, index }) => (
    <View style={styles.reorderRow}>
      <Text style={styles.reorderPos}>{index + 1}</Text>
      <View style={styles.reorderBody}>
        <Text style={styles.reorderTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.reorderArtist} numberOfLines={1}>{item.artist?.username}</Text>
      </View>
      <TouchableOpacity
        style={styles.arrow}
        disabled={index === 0}
        onPress={() => setOrder((o) => move(o, index, index - 1))}
        accessibilityLabel={t('player.moveUp')}
      >
        <MaterialIcons name="keyboard-arrow-up" size={26} color={index === 0 ? colors.textMuted : colors.textPrimary} />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.arrow}
        disabled={index === order.length - 1}
        onPress={() => setOrder((o) => move(o, index, index + 1))}
        accessibilityLabel={t('playlist.moveDown')}
      >
        <MaterialIcons name="keyboard-arrow-down" size={26} color={index === order.length - 1 ? colors.textMuted : colors.textPrimary} />
      </TouchableOpacity>
    </View>
  );

  return (
    <>
      <FlatList
        // Each row hosts a comment sheet (a Modal); 'handled' lets its buttons
        // take the first tap instead of the list closing the keyboard.
        keyboardShouldPersistTaps="handled"
        style={styles.container}
        data={order || tracks}
        keyExtractor={(item) => `pltrack_${item.id}`}
        renderItem={order ? reorderRow : ({ item, index }) => (
          <TrackItem
            track={item}
            onPlay={() => playQueue(buildQueue(), index, { source: 'playlist' })}
            onRemoveFromPlaylist={isOwner ? () => handleRemove(item.id) : undefined}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialIcons name="queue-music" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>{t('playlist.empty')}</Text>
            {isOwner ? <Text style={styles.emptySub}>{t('playlist.addFromMusic')}</Text> : null}
          </View>
        }
        contentContainerStyle={styles.listContent}
      />
      {isOwner ? (
        <EditPlaylistSheet
          visible={editing}
          playlist={playlist}
          onClose={() => setEditing(false)}
          onSaved={apply}
          onDelete={handleDelete}
        />
      ) : null}
    </>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  centered: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  listContent: { paddingBottom: 140, width: '100%', maxWidth: 760, alignSelf: 'center' },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm, alignItems: 'center' },
  bigCover: { marginBottom: spacing.md },
  title: { ...typography.h1, color: colors.textPrimary, textAlign: 'center' },
  description: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: 4 },
  owner: { ...typography.label, color: colors.primary, fontWeight: '700', marginTop: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  meta: { ...typography.caption, color: colors.textSecondary },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, alignSelf: 'stretch' },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    minHeight: 40,
    borderRadius: radius.full,
  },
  actionText: { ...typography.label, color: colors.white, fontWeight: '700' },
  shuffleBtn: { backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: colors.primary },
  shuffleText: { ...typography.label, color: colors.primary, fontWeight: '700' },
  actionDisabled: { opacity: 0.5 },
  ownerBtns: { flexDirection: 'row', gap: spacing.sm, marginLeft: 'auto' },
  roundBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  reorderHint: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  reorderRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.md,
    paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  reorderPos: { width: 24, textAlign: 'right', color: colors.textMuted, fontWeight: '700' },
  reorderBody: { flex: 1 },
  reorderTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  reorderArtist: { ...typography.caption, color: colors.textSecondary },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textSecondary },
  emptySub: { ...typography.caption, color: colors.textMuted },
  errorText: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm, marginBottom: spacing.md, textAlign: 'center' },
  retryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryText: { ...typography.button, color: colors.white },
});

export default PlaylistDetail;

// An album: cover, title, artist (with the tick), year, length, then its
// songs in order. Anyone can play it; the artist edits it and picks its songs.
// Cache-first like the other music screens.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, useWindowDimensions,
} from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { fetchAlbum, deleteAlbum } from '../services/api';
import { usePlayer } from '../context/PlayerContext';
import { useAuth } from '../context/useAuth';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import toQueueTrack from '../utils/queueTrack';
import TrackItem from './TrackItem';
import PlaylistCover from './PlaylistCover';
import VerifiedBadge from './VerifiedBadge';
import { EditAlbumSheet, AlbumSongsSheet } from './AlbumSheets';
import { TrackListSkeleton } from './SkeletonLoader';
import { colors, spacing, radius, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const lengthOf = (t, ms) => {
  const mins = Math.round((ms || 0) / 60000);
  if (!mins) return null;
  const h = Math.floor(mins / 60);
  return h ? t('playlist.lengthHours', { h, m: mins % 60 }) : t('playlist.lengthMinutes', { m: mins });
};

const AlbumScreen = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { params = {} } = useRoute();
  const { albumId } = params;
  const { currentUser } = useAuth();
  const { playQueue } = usePlayer();
  const { width } = useWindowDimensions();
  const cacheKey = userKey(currentUser?.id, `album:${albumId}`);
  const [album, setAlbum] = useState(() => peekCache(cacheKey));
  const [failed, setFailed] = useState(null);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);

  const apply = useCallback((data) => {
    setAlbum(data);
    if (data) writeCache(cacheKey, data);
  }, [cacheKey]);

  const load = useCallback(async () => {
    try {
      apply(await fetchAlbum(albumId));
      setFailed(null);
    } catch (err) {
      setFailed(err?.response?.status || 'error');
    }
  }, [albumId, apply]);

  useEffect(() => {
    if (!album) readCache(cacheKey).then((c) => { if (c) setAlbum((a) => a ?? c); });
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  useEffect(() => { navigation.setOptions?.({ title: album?.title || params.title || '' }); }, [navigation, album?.title, params.title]);

  const tracks = album?.tracks || [];
  const play = (index, shuffle = false) => playQueue(tracks.map(toQueueTrack), index, { shuffle, source: 'album' });

  const handleDelete = () => {
    Alert.alert(t('album.delete'), t('album.deleteConfirm', { name: album?.title || '' }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAlbum(albumId);
            setEditing(false);
            navigation.goBack();
          } catch {
            Alert.alert(t('common.error'), t('album.saveFailed'));
          }
        },
      },
    ]);
  };

  if (!album) {
    if (failed) {
      return (
        <View style={styles.centered}>
          <MaterialIcons name="error-outline" size={48} color={colors.textMuted} />
          <Text style={styles.errorText}>{t(failed === 404 ? 'album.unavailable' : 'album.loadFailed')}</Text>
          {failed !== 404 ? (
            <TouchableOpacity style={styles.retryBtn} onPress={load}>
              <Text style={styles.retryText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      );
    }
    return <View style={styles.container}><TrackListSkeleton count={8} /></View>;
  }

  const size = Math.min(220, Math.round(width * 0.55));
  const meta = [
    album.release_date ? album.release_date.slice(0, 4) : null,
    t('library.songCount', { n: album.track_count ?? tracks.length }),
    lengthOf(t, album.duration_ms),
  ].filter(Boolean).join('  ·  ');

  const header = (
    <View style={styles.header}>
      <PlaylistCover cover={album.cover} images={[]} size={size} radius={12} style={styles.cover} />
      <Text style={styles.kind}>{t('album.kind')}</Text>
      <Text style={styles.title} numberOfLines={3}>{album.title}</Text>
      {album.description ? <Text style={styles.description}>{album.description}</Text> : null}
      {album.artist ? (
        <TouchableOpacity
          style={styles.artistRow}
          onPress={() => navigation.navigate('UserProfile', { userId: album.artist.id, username: album.artist.username })}
        >
          <Text style={styles.artist}>{album.artist.username}</Text>
          {album.artist.verified ? <VerifiedBadge size={15} /> : null}
        </TouchableOpacity>
      ) : null}
      <Text style={styles.meta}>{meta}</Text>
      <View style={styles.actions}>
        <TouchableOpacity style={[styles.btn, !tracks.length && styles.disabled]} disabled={!tracks.length} onPress={() => play(0)}>
          <Ionicons name="play" size={16} color={colors.white} />
          <Text style={styles.btnText}>{t('playlist.playAll')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnOutline, !tracks.length && styles.disabled]} disabled={!tracks.length} onPress={() => play(0, true)}>
          <Ionicons name="shuffle" size={16} color={colors.primary} />
          <Text style={[styles.btnText, styles.btnOutlineText]}>{t('playlist.shuffle')}</Text>
        </TouchableOpacity>
        {album.is_owner ? (
          <View style={styles.ownerBtns}>
            <TouchableOpacity
              style={styles.round}
              onPress={() => navigation.navigate('UploadTrack', { albumId: album.id })}
              accessibilityLabel={t('album.uploadSongs')}
            >
              <Ionicons name="cloud-upload-outline" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.round} onPress={() => setPicking(true)} accessibilityLabel={t('album.songs')}>
              <MaterialIcons name="queue-music" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.round} onPress={() => setEditing(true)} accessibilityLabel={t('album.edit')}>
              <Ionicons name="pencil" size={18} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </View>
  );

  return (
    <>
      <FlatList
        keyboardShouldPersistTaps="handled"
        style={styles.container}
        data={tracks}
        keyExtractor={(item) => `albtrack_${item.id}`}
        renderItem={({ item, index }) => <TrackItem track={item} index={index} onPlay={() => play(index)} />}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <MaterialIcons name="album" size={44} color={colors.textMuted} />
            <Text style={styles.emptyText}>{t('album.noSongsYet')}</Text>
            {album.is_owner ? (
              <TouchableOpacity style={styles.btn} onPress={() => navigation.navigate('UploadTrack', { albumId: album.id })}>
                <Ionicons name="cloud-upload-outline" size={16} color={colors.white} />
                <Text style={styles.btnText}>{t('album.uploadSongs')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      />
      {album.is_owner ? (
        <>
          <EditAlbumSheet visible={editing} album={album} onClose={() => setEditing(false)} onSaved={apply} onDelete={handleDelete} />
          <AlbumSongsSheet visible={picking} album={album} userId={currentUser?.id} onClose={() => setPicking(false)} onSaved={apply} />
        </>
      ) : null}
    </>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  list: { paddingBottom: 140, width: '100%', maxWidth: 760, alignSelf: 'center' },
  header: { alignItems: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  cover: { marginBottom: spacing.md },
  kind: { ...typography.caption, color: colors.textSecondary, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  title: { ...typography.h1, color: colors.textPrimary, textAlign: 'center', marginTop: 2 },
  description: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: 4 },
  artistRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, minHeight: 32 },
  artist: { ...typography.label, color: colors.primary, fontWeight: '800' },
  meta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, alignSelf: 'stretch' },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary,
    borderRadius: radius.full, paddingHorizontal: spacing.md, minHeight: 40,
  },
  btnText: { ...typography.label, color: colors.white, fontWeight: '700' },
  btnOutline: { backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: colors.primary },
  btnOutlineText: { color: colors.primary },
  disabled: { opacity: 0.5 },
  ownerBtns: { flexDirection: 'row', gap: spacing.sm, marginLeft: 'auto' },
  round: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  empty: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  errorText: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm, marginBottom: spacing.md, textAlign: 'center' },
  retryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryText: { ...typography.button, color: colors.white },
});

export default AlbumScreen;

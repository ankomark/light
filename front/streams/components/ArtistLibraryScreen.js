// An artist's (a choir's) library: who they are, Play all / Shuffle across
// everything, then every album as a cover in a grid — tap one for its songs
// (AlbumScreen). One request (GET /users/<id>/library/), cache-first.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { fetchArtistLibrary } from '../services/api';
import { usePlayer } from '../context/PlayerContext';
import { useAuth } from '../context/useAuth';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import toQueueTrack from '../utils/queueTrack';
import PlaylistCover from './PlaylistCover';
import VerifiedBadge from './VerifiedBadge';
import { TrackListSkeleton } from './SkeletonLoader';
import { colors, spacing, radius, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const MAX_WIDTH = 960;
const GAP = spacing.md;

// 2 columns on a phone, more as the screen widens.
const columnsFor = (w) => (w < 480 ? 2 : w < 720 ? 3 : w < 900 ? 4 : 5);

const lengthOf = (t, ms) => {
  const mins = Math.round((ms || 0) / 60000);
  if (!mins) return null;
  const h = Math.floor(mins / 60);
  return h ? t('playlist.lengthHours', { h, m: mins % 60 }) : t('playlist.lengthMinutes', { m: mins });
};

const ArtistLibraryScreen = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { params = {} } = useRoute();
  const { userId } = params;
  const { currentUser } = useAuth();
  const { playQueue } = usePlayer();
  const { width } = useWindowDimensions();
  const cacheKey = userKey(currentUser?.id, `library:${userId}`);
  const [lib, setLib] = useState(() => peekCache(cacheKey));
  const [failed, setFailed] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchArtistLibrary(userId);
      setLib(data);
      writeCache(cacheKey, data);
      setFailed(null);
    } catch (err) {
      setFailed(err?.response?.status || 'error');
    }
  }, [userId, cacheKey]);

  useEffect(() => {
    if (!lib) readCache(cacheKey).then((c) => { if (c) setLib((l) => l ?? c); });
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  if (!lib) {
    if (failed) {
      const gone = failed === 404 || failed === 403;
      return (
        <View style={styles.centered}>
          <MaterialIcons name={failed === 403 ? 'lock-outline' : 'error-outline'} size={48} color={colors.textMuted} />
          <Text style={styles.errorText}>
            {t(failed === 403 ? 'artistLibrary.private' : gone ? 'artistLibrary.unavailable' : 'artistLibrary.loadFailed')}
          </Text>
          {!gone ? (
            <TouchableOpacity style={styles.retryBtn} onPress={load}>
              <Text style={styles.retryText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      );
    }
    return <View style={styles.container}><TrackListSkeleton count={8} /></View>;
  }

  const inner = Math.min(width, MAX_WIDTH) - spacing.md * 2;
  const cols = columnsFor(inner);
  const cardSize = Math.floor((inner - GAP * (cols - 1)) / cols);
  const tracks = lib.tracks || [];
  const artist = lib.artist || {};
  const play = (shuffle) => tracks.length && playQueue(tracks.map(toQueueTrack), 0, { shuffle, source: 'album' });
  const meta = [
    t('artistLibrary.albumCount', { n: lib.album_count }),
    t('library.songCount', { n: lib.track_count }),
    lengthOf(t, lib.duration_ms),
  ].filter(Boolean).join('  ·  ');

  const header = (
    <View style={styles.header}>
      <View style={styles.avatar}>
        {artist.profile_picture ? (
          <Image source={{ uri: artist.profile_picture }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
        ) : <Ionicons name="people" size={40} color={colors.textMuted} />}
      </View>
      <Text style={styles.kind}>{t('artistLibrary.kind')}</Text>
      <TouchableOpacity
        style={styles.nameRow}
        onPress={() => navigation.navigate('UserProfile', { userId: artist.id, username: artist.username })}
        accessibilityRole="link"
      >
        <Text style={styles.name} numberOfLines={2}>{artist.username}</Text>
        {artist.verified ? <VerifiedBadge size={18} /> : null}
      </TouchableOpacity>
      <Text style={styles.meta}>{meta}</Text>
      <View style={styles.actions}>
        <TouchableOpacity style={[styles.btn, !tracks.length && styles.disabled]} disabled={!tracks.length} onPress={() => play(false)}>
          <Ionicons name="play" size={16} color={colors.white} />
          <Text style={styles.btnText}>{t('playlist.playAll')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnOutline, !tracks.length && styles.disabled]} disabled={!tracks.length} onPress={() => play(true)}>
          <Ionicons name="shuffle" size={16} color={colors.primary} />
          <Text style={[styles.btnText, styles.btnOutlineText]}>{t('playlist.shuffle')}</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.heading}>{t('artist.albums')}</Text>
    </View>
  );

  return (
    <FlatList
      key={`cols_${cols}`}
      style={styles.container}
      data={lib.albums || []}
      numColumns={cols}
      keyExtractor={(a) => `libalb_${a.id}`}
      columnWrapperStyle={cols > 1 ? { gap: GAP } : undefined}
      contentContainerStyle={[styles.list, { width: inner + spacing.md * 2 }]}
      ListHeaderComponent={header}
      renderItem={({ item: a }) => (
        <TouchableOpacity
          style={[styles.card, { width: cardSize }]}
          onPress={() => navigation.navigate('Album', { albumId: a.id, title: a.title })}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={a.title}
        >
          <PlaylistCover cover={a.cover} images={[]} size={cardSize} radius={10} />
          <Text style={styles.cardTitle} numberOfLines={2}>{a.title}</Text>
          <Text style={styles.cardMeta} numberOfLines={1}>
            {[a.release_date ? a.release_date.slice(0, 4) : null, t('library.songCount', { n: a.track_count })].filter(Boolean).join('  ·  ')}
          </Text>
        </TouchableOpacity>
      )}
      ListEmptyComponent={(
        <View style={styles.empty}>
          <MaterialIcons name="library-music" size={44} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('artistLibrary.empty')}</Text>
        </View>
      )}
    />
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  list: { paddingHorizontal: spacing.md, paddingBottom: 140, alignSelf: 'center', maxWidth: MAX_WIDTH },
  header: { alignItems: 'center', paddingTop: spacing.md, paddingBottom: spacing.sm },
  avatar: {
    width: 112, height: 112, borderRadius: 56, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  kind: { ...typography.caption, color: colors.textSecondary, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, minHeight: 32 },
  name: { ...typography.h1, color: colors.textPrimary, textAlign: 'center', flexShrink: 1 },
  meta: { ...typography.caption, color: colors.textSecondary, marginTop: 4, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary,
    borderRadius: radius.full, paddingHorizontal: spacing.md, minHeight: 40,
  },
  btnText: { ...typography.label, color: colors.white, fontWeight: '700' },
  btnOutline: { backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: colors.primary },
  btnOutlineText: { color: colors.primary },
  disabled: { opacity: 0.5 },
  heading: { color: colors.textPrimary, fontSize: 17, fontWeight: '800', alignSelf: 'flex-start', marginTop: spacing.lg },
  card: { marginBottom: spacing.lg },
  cardTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700', marginTop: 6 },
  cardMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  empty: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  errorText: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm, marginBottom: spacing.md, textAlign: 'center' },
  retryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryText: { ...typography.button, color: colors.white },
});

export default ArtistLibraryScreen;

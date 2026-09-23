// A genre's songs, newest first, a page at a time (GET /tracks/?genre=).
// Play all / shuffle, or tap a song to play from there. Cache-first.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { fetchTracks } from '../services/api';
import { usePlayer } from '../context/PlayerContext';
import { useAuth } from '../context/useAuth';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import { mergePage } from '../utils/exploreLogic';
import toQueueTrack from '../utils/queueTrack';
import TrackItem from './TrackItem';
import { TrackListSkeleton } from './SkeletonLoader';
import { colors, spacing, radius, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const GenreScreen = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { params = {} } = useRoute();
  const { slug, name } = params;
  const { currentUser } = useAuth();
  const { playQueue } = usePlayer();
  const cacheKey = userKey(currentUser?.id, `music:genre:${slug}`);
  const [tracks, setTracks] = useState(() => peekCache(cacheKey));
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const pageRef = useRef(1);

  useEffect(() => { navigation.setOptions?.({ title: name || '' }); }, [navigation, name]);

  const load = useCallback(async () => {
    try {
      const res = await fetchTracks(1, '', slug);
      const rows = res?.results ?? [];
      pageRef.current = 1;
      setTracks(rows);
      setHasMore(!!res?.next);
      setFailed(false);
      writeCache(cacheKey, rows);
    } catch {
      setFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, [slug, cacheKey]);

  useEffect(() => {
    if (!tracks) readCache(cacheKey).then((c) => { if (Array.isArray(c)) setTracks((p) => p ?? c); });
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = pageRef.current + 1;
      const res = await fetchTracks(next, '', slug);
      pageRef.current = next;
      setHasMore(!!res?.next);
      setTracks((prev) => mergePage(prev || [], res?.results ?? []));
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, slug]);

  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const playFrom = useCallback((index, shuffle = false) => {
    playQueue((tracksRef.current || []).map(toQueueTrack), index, { shuffle, source: 'genre' });
  }, [playQueue]);

  if (!tracks) {
    return <View style={styles.container}><TrackListSkeleton count={8} /></View>;
  }

  const header = (
    <View style={styles.header}>
      <Text style={styles.title}>{name}</Text>
      {tracks.length ? (
        <View style={styles.actions}>
          <TouchableOpacity style={styles.btn} onPress={() => playFrom(0)} activeOpacity={0.85}>
            <Ionicons name="play" size={16} color={colors.white} />
            <Text style={styles.btnText}>{t('playlist.playAll')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={() => playFrom(0, true)} activeOpacity={0.85}>
            <Ionicons name="shuffle" size={16} color={colors.primary} />
            <Text style={[styles.btnText, styles.btnOutlineText]}>{t('playlist.shuffle')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );

  return (
    <FlatList
      keyboardShouldPersistTaps="handled"
      style={styles.container}
      data={tracks}
      keyExtractor={(item) => `genre_${item.id}`}
      renderItem={({ item, index }) => <TrackItem track={item} index={index} onPlay={playFrom} />}
      ListHeaderComponent={header}
      contentContainerStyle={styles.list}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.more} color={colors.primary} /> : null}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} colors={[colors.primary]} />}
      ListEmptyComponent={(
        <View style={styles.empty}>
          <MaterialIcons name={failed ? 'wifi-off' : 'library-music'} size={44} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t(failed ? 'music.loadTracksFailed' : 'music.genreEmpty')}</Text>
        </View>
      )}
    />
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  list: { paddingBottom: 140, width: '100%', maxWidth: 760, alignSelf: 'center' },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  title: { ...typography.h1, color: colors.textPrimary },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary,
    borderRadius: radius.full, paddingHorizontal: spacing.md, minHeight: 40,
  },
  btnText: { ...typography.label, color: colors.white, fontWeight: '700' },
  btnOutline: { backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: colors.primary },
  btnOutlineText: { color: colors.primary },
  more: { marginVertical: spacing.md },
  empty: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
});

export default GenreScreen;

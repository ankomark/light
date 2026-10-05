// src/components/FavoritesPage.js
import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { getFavoriteTracks, fetchSavedPosts } from '../services/api';
import TrackItem from './TrackItem';
import useGridColumns from '../utils/useGridColumns';
import { colors, spacing, typography, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import useOnline from '../hooks/useOnline';
import useBottomSpace from '../hooks/useBottomSpace';
import OfflineBanner from './OfflineBanner';

// Liked songs and saved posts change only when you change them: a day-old
// copy is a fine thing to open on while the fresh one loads.
const FAVORITES_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const GRID_PAD = 2;

// A still thumbnail for the grid. Prefer the server-provided thumbnail_url
// (R2 poster for videos); a raw video URL can't render in <Image>, so if no
// poster exists we fall back to the placeholder cell (the play badge still
// marks it as a video).
const thumbUri = (post) => {
  const url =
    post?.media_items?.[0]?.thumbnail_url ||
    post?.thumbnail_url ||
    post?.media_items?.[0]?.optimized_url ||
    post?.media_items?.[0]?.media_url ||
    post?.optimized_url ||
    post?.media_url ||
    null;
  if (!url || /\.(mp4|mov|webm|m4v)$/i.test(url)) return null;
  return url;
};

const EmptyState = ({ icon, title, text }) => (
  <View style={styles.empty}>
    <Ionicons name={icon} size={48} color={colors.textMuted} />
    <Text style={styles.emptyTitle}>{title}</Text>
    <Text style={styles.emptyText}>{text}</Text>
  </View>
);

const FavoritesPage = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  // Responsive grid: 3 columns on a phone, more on tablets / landscape.
  const { cols, tileSize } = useGridColumns({
    target: 124, min: 3, max: 6, horizontalPadding: GRID_PAD * 2, gap: GRID_PAD,
  });
  const { currentUser } = useAuth();
  const online = useOnline();
  const bottomSpace = useBottomSpace(30);
  const cacheKey = userKey(currentUser?.id, 'favorites');
  const [tab, setTab] = useState('music'); // 'music' | 'posts'
  // Open on the last copy (this session's, then the phone's); `loading` means
  // "nothing to show yet", never "a request is running".
  const first = peekCache(cacheKey);
  const [favoriteTracks, setFavoriteTracks] = useState(() => first?.tracks ?? []);
  const [savedPosts, setSavedPosts] = useState(() => first?.posts ?? []);
  const [loading, setLoading] = useState(() => !first);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    readCache(cacheKey, FAVORITES_MAX_AGE_MS).then((saved) => {
      if (cancelled || !saved) return;
      setFavoriteTracks((prev) => (prev.length ? prev : saved.tracks || []));
      setSavedPosts((prev) => (prev.length ? prev : saved.posts || []));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [cacheKey]);

  // Each half on its own: a failed one keeps what was showing (and says so)
  // instead of becoming an empty "nothing saved yet" - which is what offline
  // used to look like.
  const load = useCallback(async () => {
    setError(null);
    const [tracks, posts] = await Promise.allSettled([getFavoriteTracks(), fetchSavedPosts()]);
    const next = {};
    if (tracks.status === 'fulfilled' && Array.isArray(tracks.value)) {
      setFavoriteTracks(tracks.value);
      next.tracks = tracks.value;
    }
    if (posts.status === 'fulfilled' && Array.isArray(posts.value)) {
      setSavedPosts(posts.value);
      next.posts = posts.value;
    }
    if (tracks.status === 'rejected' || posts.status === 'rejected') setError(t('favorites.loadFailed'));
    if (next.tracks && next.posts) writeCache(cacheKey, next);
    setLoading(false);
    setRefreshing(false);
  }, [t, cacheKey]);

  // Reload on focus so items favorited/saved elsewhere show up immediately.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const handleTrackRemoved = useCallback(
    (id) => setFavoriteTracks((prev) => prev.filter((t) => t.id !== id)),
    []
  );

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={handleRefresh}
      tintColor={colors.primary}
      colors={[colors.primary]}
    />
  );

  const busy = loading && !refreshing;

  return (
    <View style={styles.container}>
      <Text style={styles.header}>{t('profile.myFavorites')}</Text>
      {(!online || error) && (favoriteTracks.length > 0 || savedPosts.length > 0) ? (
        <OfflineBanner kind={!online ? 'offline' : 'failed'} onRetry={handleRefresh} />
      ) : null}

      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'music' && styles.tabActive]}
          onPress={() => setTab('music')}
          activeOpacity={0.85}
        >
          <Ionicons name="musical-notes" size={16} color={tab === 'music' ? colors.white : colors.textSecondary} />
          <Text style={[styles.tabText, tab === 'music' && styles.tabTextActive]}>
            {t('favorites.tabMusic', { n: favoriteTracks.length })}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'posts' && styles.tabActive]}
          onPress={() => setTab('posts')}
          activeOpacity={0.85}
        >
          <Ionicons name="bookmark" size={16} color={tab === 'posts' ? colors.white : colors.textSecondary} />
          <Text style={[styles.tabText, tab === 'posts' && styles.tabTextActive]}>
            {t('favorites.tabPosts', { n: savedPosts.length })}
          </Text>
        </TouchableOpacity>
      </View>

      {busy ? (
        <View style={styles.contentCenter}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : tab === 'music' ? (
        <FlatList
          // Each row hosts a comment sheet (a Modal). Touches inside a Modal still
          // bubble through this list in the React tree, and with the default
          // ('never') the list swallowed the first tap to close the keyboard, so
          // posting a comment took two taps. 'handled' lets the button take it.
          keyboardShouldPersistTaps="handled"
          data={favoriteTracks}
          keyExtractor={(track) => `track_${track.id}`}
          renderItem={({ item }) => (
            <TrackItem track={item} onDelete={handleTrackRemoved} onRefresh={load} />
          )}
          contentContainerStyle={[styles.list, { paddingBottom: bottomSpace }]}
          refreshControl={refreshControl}
          ListEmptyComponent={
            <EmptyState
              icon="musical-notes-outline"
              title={error ? t('common.somethingWrong') : t('favorites.noTracks')}
              text={error || t('favorites.noTracksSub')}
            />
          }
        />
      ) : (
        <FlatList
          key={`posts-grid-${cols}`}
          data={savedPosts}
          numColumns={cols}
          keyExtractor={(post) => `saved_${post.id}`}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.cell, { width: tileSize, height: tileSize }]}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('PostDetail', { postId: item.id })}
            >
              {thumbUri(item) ? (
                <Image source={{ uri: thumbUri(item) }} style={styles.cellImg} contentFit="cover" transition={150} />
              ) : (
                <View style={[styles.cellImg, styles.cellPlaceholder]}>
                  <MaterialIcons name="image" size={24} color={colors.textMuted} />
                </View>
              )}
              {item.content_type === 'video' && (
                <View style={styles.cellBadge}>
                  <MaterialIcons name="play-arrow" size={16} color="#fff" />
                </View>
              )}
              {item.media_items?.length > 1 && (
                <View style={styles.cellBadge}>
                  <MaterialIcons name="collections" size={14} color="#fff" />
                </View>
              )}
            </TouchableOpacity>
          )}
          columnWrapperStyle={{ gap: GRID_PAD }}
          contentContainerStyle={[styles.gridContent, { paddingBottom: bottomSpace }, savedPosts.length === 0 && { flexGrow: 1 }]}
          refreshControl={refreshControl}
          ListEmptyComponent={
            <EmptyState
              icon="bookmark-outline"
              title={error ? t('common.somethingWrong') : t('favorites.noPosts')}
              text={error || t('favorites.noPostsSub')}
            />
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  contentCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    ...typography.h2,
    color: colors.textPrimary,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  tabs: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    paddingBottom: spacing.sm,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabText: {
    ...typography.label,
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: colors.white,
    fontWeight: '700',
  },
  list: {
    flexGrow: 1,
  },
  gridContent: {
    padding: GRID_PAD,
  },
  cell: {
    marginBottom: GRID_PAD,
    backgroundColor: colors.surface,
    borderRadius: 4,
    overflow: 'hidden',
  },
  cellImg: {
    width: '100%',
    height: '100%',
  },
  cellPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  cellBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
});

export default FavoritesPage;

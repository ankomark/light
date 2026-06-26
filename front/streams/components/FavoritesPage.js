// src/components/FavoritesPage.js
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Image,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { getFavoriteTracks, fetchSavedPosts } from '../services/api';
import TrackItem from './TrackItem';
import useGridColumns from '../utils/useGridColumns';
import { colors, spacing, typography, radius } from '../constants/theme';

const GRID_PAD = 2;

// A still thumbnail for the grid. For videos we ask Cloudinary for a poster
// frame (so_0 = first frame) as a JPG — same trick as the Explore grid — so the
// cell shows an image instead of a blank <Image> that can't render an .mp4.
const thumbUri = (post) => {
  const url =
    post?.media_items?.[0]?.optimized_url ||
    post?.media_items?.[0]?.media_url ||
    post?.optimized_url ||
    post?.media_url ||
    null;
  if (!url) return null;
  if (post?.content_type === 'video' || /\.(mp4|mov|webm|m4v)$/i.test(url)) {
    return url
      .replace('/video/upload/', '/video/upload/so_0,w_400,h_400,c_fill/')
      .replace(/\.(mp4|mov|webm|m4v)$/i, '.jpg');
  }
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
  const navigation = useNavigation();
  // Responsive grid: 3 columns on a phone, more on tablets / landscape.
  const { cols, tileSize } = useGridColumns({
    target: 124, min: 3, max: 6, horizontalPadding: GRID_PAD * 2, gap: GRID_PAD,
  });
  const [tab, setTab] = useState('music'); // 'music' | 'posts'
  const [favoriteTracks, setFavoriteTracks] = useState([]);
  const [savedPosts, setSavedPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [tracks, posts] = await Promise.all([
        getFavoriteTracks().catch(() => []),
        fetchSavedPosts().catch(() => []),
      ]);
      setFavoriteTracks(Array.isArray(tracks) ? tracks : []);
      setSavedPosts(Array.isArray(posts) ? posts : []);
    } catch {
      setError('Could not load your favorites. Pull down to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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
      <Text style={styles.header}>My Favorites</Text>

      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'music' && styles.tabActive]}
          onPress={() => setTab('music')}
          activeOpacity={0.85}
        >
          <Ionicons name="musical-notes" size={16} color={tab === 'music' ? colors.white : colors.textSecondary} />
          <Text style={[styles.tabText, tab === 'music' && styles.tabTextActive]}>
            Music ({favoriteTracks.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'posts' && styles.tabActive]}
          onPress={() => setTab('posts')}
          activeOpacity={0.85}
        >
          <Ionicons name="bookmark" size={16} color={tab === 'posts' ? colors.white : colors.textSecondary} />
          <Text style={[styles.tabText, tab === 'posts' && styles.tabTextActive]}>
            Posts ({savedPosts.length})
          </Text>
        </TouchableOpacity>
      </View>

      {busy ? (
        <View style={styles.contentCenter}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : tab === 'music' ? (
        <FlatList
          data={favoriteTracks}
          keyExtractor={(track) => `track_${track.id}`}
          renderItem={({ item }) => (
            <TrackItem track={item} onDelete={handleTrackRemoved} onRefresh={load} />
          )}
          contentContainerStyle={styles.list}
          refreshControl={refreshControl}
          ListEmptyComponent={
            <EmptyState
              icon="musical-notes-outline"
              title={error ? 'Something went wrong' : 'No favorite tracks yet'}
              text={error || 'Tap the heart on any track to save it here.'}
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
                <Image source={{ uri: thumbUri(item) }} style={styles.cellImg} resizeMode="cover" />
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
          contentContainerStyle={[styles.gridContent, savedPosts.length === 0 && { flexGrow: 1 }]}
          refreshControl={refreshControl}
          ListEmptyComponent={
            <EmptyState
              icon="bookmark-outline"
              title={error ? 'Something went wrong' : 'No saved posts yet'}
              text={error || 'Tap the bookmark on any post to save it here.'}
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
    paddingBottom: 110,
    flexGrow: 1,
  },
  gridContent: {
    padding: GRID_PAD,
    paddingBottom: 110,
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

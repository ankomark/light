import React, { memo, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
} from 'react-native';
// expo-image: a follower list is mostly faces you've seen before (the feed,
// comments, the inbox), so a shared memory+disk cache paints them instantly.
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { fetchFollowing, fetchFollowers } from '../services/api';
import { useAuth } from '../context/useAuth';
import FollowButton from './FollowButton';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import { PersonListSkeleton } from './SkeletonLoader';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

// One row, memoised: following someone updates one row's flag, and only that
// row should re-render. The avatar fallback is row-local for the same reason —
// it used to live in the list's state, so one broken picture re-rendered every
// row.
const FollowRow = memo(({ item, isSelf, onOpen, onFollowChange }) => {
  const [failed, setFailed] = useState(false);
  return (
    <View style={styles.row}>
      <TouchableOpacity style={styles.userInfo} activeOpacity={0.7} onPress={() => onOpen(item)}>
        <Image
          source={item.profile_picture && !failed ? { uri: item.profile_picture } : DEFAULT_AVATAR}
          placeholder={DEFAULT_AVATAR}
          cachePolicy="memory-disk"
          contentFit="cover"
          style={styles.avatar}
          onError={() => setFailed(true)}
        />
        <Text style={styles.username} numberOfLines={1}>{item.username}</Text>
      </TouchableOpacity>

      {!isSelf && (
        <FollowButton
          userId={item.id}
          initialFollowing={item.is_following}
          onFollowChange={onFollowChange}
        />
      )}
    </View>
  );
});
FollowRow.displayName = 'FollowRow';

const FollowList = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const route = useRoute();
  const { currentUser } = useAuth();
  const userId = route.params?.userId;
  const type = route.params?.type === 'followers' ? 'followers' : 'following';
  const username = route.params?.username;

  // First page painted from the last visit — this list is typically opened by
  // tapping a count on a profile, and it used to open on a spinner each time.
  const cacheKey = userKey(currentUser?.id, `follows:${userId}:${type}`);
  const [rows, setRows] = useState(() => peekCache(cacheKey) ?? []);
  const [loading, setLoading] = useState(() => !peekCache(cacheKey));
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions?.({
      title: type === 'followers' ? t('profile.followers') : t('profile.following'),
    });
  }, [navigation, type, t]);

  const fetchPage = useCallback(
    (p) => (type === 'followers' ? fetchFollowers(userId, p) : fetchFollowing(userId, p)),
    [type, userId]
  );

  const load = useCallback(async (isRefresh = false) => {
    if (!userId) {
      setLoading(false);
      return;
    }
    try {
      if (isRefresh) setRefreshing(true);
      const res = await fetchPage(1);
      const list = Array.isArray(res) ? res : (res?.results ?? []);
      setRows(list);
      writeCache(cacheKey, list);
      setPage(1);
      setHasMore(!!res?.next);
    } catch (err) {
      // A private account's lists are for its approved followers only.
      if (err?.response?.status === 403) {
        setIsPrivate(true);
        setRows([]);
      } else {
        console.error('Error loading follow list:', err);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, fetchPage, cacheKey]);

  useEffect(() => {
    load();
  }, [load]);

  // Cold start: the disk copy, if the network hasn't answered first.
  useEffect(() => {
    let cancelled = false;
    readCache(cacheKey).then((cached) => {
      if (cancelled || !Array.isArray(cached) || !cached.length) return;
      setRows((prev) => (prev.length ? prev : cached));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [cacheKey]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || loading) return;
    try {
      setLoadingMore(true);
      const next = page + 1;
      const res = await fetchPage(next);
      const list = Array.isArray(res) ? res : (res?.results ?? []);
      setRows((prev) => [...prev, ...list]);
      setPage(next);
      setHasMore(!!res?.next);
    } catch (err) {
      console.error('Error loading more:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, loading, page, fetchPage]);

  // Reflect follow/unfollow changes locally so the button state is accurate.
  const handleFollowChange = useCallback((data) => {
    setRows((prev) => {
      const next = prev.map((u) => (u.id === data.id ? { ...u, is_following: data.is_following } : u));
      // Keep the cached page in step, or the next open repaints the old button.
      writeCache(cacheKey, next.slice(0, 30));
      return next;
    });
  }, [cacheKey]);

  const openProfile = useCallback((item) => {
    navigation.navigate('UserProfile', { userId: item.id, username: item.username });
  }, [navigation]);

  const renderItem = useCallback(({ item }) => (
    <FollowRow
      item={item}
      isSelf={currentUser?.id === item.id}
      onOpen={openProfile}
      onFollowChange={handleFollowChange}
    />
  ), [currentUser?.id, openProfile, handleFollowChange]);

  const renderEmpty = useCallback(() => (loading ? (
    // Nothing cached yet: rows that are about to fill in, not a spinner.
    <View style={styles.skeletonWrap}><PersonListSkeleton count={9} avatar={46} withButton /></View>
  ) : (
    <View style={styles.empty}>
      <MaterialIcons name={isPrivate ? 'lock-outline' : 'people-outline'} size={48} color={colors.textMuted} />
      <Text style={styles.emptyText}>
        {isPrivate
          ? t('profile.private')
          : type === 'followers' ? t('follow.noFollowers') : t('follow.notFollowingAnyone')}
      </Text>
    </View>
  )), [type, t, loading, isPrivate]);

  return (
    <FlatList
      style={styles.container}
      data={rows}
      keyExtractor={(item) => `fl_${item.id}`}
      renderItem={renderItem}
      ListEmptyComponent={renderEmpty}
      contentContainerStyle={rows.length === 0 ? styles.flexGrow : styles.listContent}
      refreshing={refreshing}
      onRefresh={() => load(true)}
      onEndReached={loadMore}
      onEndReachedThreshold={0.4}
      ListFooterComponent={loadingMore ? (
        <ActivityIndicator style={{ marginVertical: spacing.md }} color={colors.primary} />
      ) : null}
      showsVerticalScrollIndicator={false}
    />
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  listContent: { paddingVertical: spacing.sm },
  flexGrow: { flexGrow: 1 },
  skeletonWrap: { paddingVertical: spacing.sm },
  centered: {
    flex: 1, backgroundColor: colors.bg,
    justifyContent: 'center', alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.md,
    marginVertical: spacing.xs,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    ...shadows.sm,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: spacing.sm,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  username: {
    ...typography.label,
    color: colors.textPrimary,
    fontWeight: '600',
    marginLeft: spacing.sm,
    flex: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
  },
});

export default FollowList;

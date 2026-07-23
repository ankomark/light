import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  View, Text, Image, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { fetchFollowing, fetchFollowers } from '../services/api';
import { useAuth } from '../context/useAuth';
import FollowButton from './FollowButton';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

const FollowList = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const route = useRoute();
  const { currentUser } = useAuth();
  const userId = route.params?.userId;
  const type = route.params?.type === 'followers' ? 'followers' : 'following';
  const username = route.params?.username;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [failedAvatars, setFailedAvatars] = useState({});

  useLayoutEffect(() => {
    navigation.setOptions?.({
      title: type === 'followers' ? 'Followers' : 'Following',
    });
  }, [navigation, type]);

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
      setPage(1);
      setHasMore(!!res?.next);
    } catch (err) {
      console.error('Error loading follow list:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, fetchPage]);

  useEffect(() => {
    load();
  }, [load]);

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
    setRows((prev) =>
      prev.map((u) => (u.id === data.id ? { ...u, is_following: data.is_following } : u))
    );
  }, []);

  const renderItem = useCallback(({ item }) => {
    const avatarSource = item.profile_picture && !failedAvatars[item.id]
      ? { uri: item.profile_picture }
      : DEFAULT_AVATAR;
    const isSelf = currentUser?.id === item.id;

    return (
      <View style={styles.row}>
        <TouchableOpacity
          style={styles.userInfo}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('UserProfile', {
            userId: item.id,
            username: item.username,
          })}
        >
          <Image
            source={avatarSource}
            defaultSource={DEFAULT_AVATAR}
            style={styles.avatar}
            onError={() => setFailedAvatars((p) => ({ ...p, [item.id]: true }))}
          />
          <Text style={styles.username} numberOfLines={1}>{item.username}</Text>
        </TouchableOpacity>

        {!isSelf && (
          <FollowButton
            userId={item.id}
            initialFollowing={item.is_following}
            onFollowChange={handleFollowChange}
          />
        )}
      </View>
    );
  }, [navigation, currentUser?.id, failedAvatars, handleFollowChange]);

  const renderEmpty = useCallback(() => (
    <View style={styles.empty}>
      <MaterialIcons name="people-outline" size={48} color={colors.textMuted} />
      <Text style={styles.emptyText}>
        {type === 'followers' ? 'No followers yet' : t('follow.notFollowingAnyone')}
      </Text>
    </View>
  ), [type, t]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

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

// One profile screen for everyone: your own (the Profile tab) and anyone else's
// (UserProfile). Everything the header draws plus the first page of the grid
// comes from a single request, GET /users/<id>/.
//
// Built to feel instant, like Home, Music and Explore:
//   - the last visit paints straight from cache (memory, then disk) while a
//     fresh copy loads behind it — no spinner when you come back;
//   - your own profile refreshes quietly each time you return to it (you may
//     have just posted), others' when the copy is more than 30s old;
//   - the grid is virtualised and pages in 30 at a time as you scroll;
//   - follow / unfollow is optimistic and survives into the cache.
import React, { useCallback, useEffect, useRef, useState, memo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialIcons, Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  fetchUserById, fetchUserPosts, followUser, getOrCreateConversation, blockUser,
} from '../services/api';
import { useAuth } from '../context/useAuth';
import { useI18n } from '../context/I18nContext';
import useGridColumns from '../utils/useGridColumns';
import formatCount from '../utils/formatCount';
import { mergePage } from '../utils/exploreLogic';
import { peekCache, readCache, writeCache, dropCache, userKey } from '../utils/screenCache';
import ChoiceSheet from './ChoiceSheet';
import ReportModal from './ReportModal';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const AVATAR_SIZE = 94;
const GRID_GAP = 3;
const PAGE_SIZE = 30;
const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const STALE_MS = 30 * 1000;

/**
 * Still-image thumbnail for a post. Videos use the poster frame captured on
 * upload (thumbnail_url) — a video's media URL is a raw .mp4 that can't render
 * as an image.
 */
const getPostThumb = (post) => (post.content_type === 'video'
  ? post.thumbnail_url || null
  : post.thumbnail_url || post.optimized_url || post.media_url || null);

const StatBox = ({ value, label, onPress }) => {
  const body = (
    <>
      <Text style={styles.statValue}>{value == null ? '—' : formatCount(value)}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </>
  );
  return onPress ? (
    <TouchableOpacity style={styles.statBox} onPress={onPress} activeOpacity={0.7}>{body}</TouchableOpacity>
  ) : (
    <View style={styles.statBox}>{body}</View>
  );
};

const PostTile = memo(({ post, size, isSelf, onPress }) => {
  const thumb = getPostThumb(post);
  return (
    <TouchableOpacity style={[styles.tile, { width: size, height: size }]} activeOpacity={0.85} onPress={() => onPress(post)}>
      {thumb ? (
        <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={120} recyclingKey={String(post.id)} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.tileFallback]}>
          <Feather name="image" size={22} color={colors.textMuted} />
        </View>
      )}
      {post.content_type === 'video' && (
        <View style={styles.videoBadge}><Ionicons name="play" size={12} color={colors.white} /></View>
      )}
      {/* Only on your own grid: who can see a post that isn't public. */}
      {isSelf && post.visibility && post.visibility !== 'public' && (
        <View style={styles.lockBadge}>
          <Feather name={post.visibility === 'private' ? 'lock' : 'users'} size={11} color={colors.white} />
        </View>
      )}
      {/* Play count, bottom-left over the thumbnail — the TikTok grid badge. */}
      <View style={styles.viewsBadge}>
        <Ionicons name="play" size={11} color={colors.white} />
        <Text style={styles.viewsBadgeText}>{formatCount(post.view_count || 0)}</Text>
      </View>
    </TouchableOpacity>
  );
});
PostTile.displayName = 'PostTile';

const Pulse = ({ style }) => <View style={[styles.skel, style]} />;

const HeaderSkeleton = ({ cols, tileSize }) => (
  <View>
    <View style={styles.cover} />
    <View style={styles.avatarRow}>
      <Pulse style={{ width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2 }} />
    </View>
    <View style={styles.nameBlock}>
      <Pulse style={{ width: 160, height: 20, marginBottom: 8 }} />
      <Pulse style={{ width: 110, height: 13 }} />
    </View>
    <Pulse style={[styles.statsRow, { height: 64 }]} />
    <View style={[styles.gridRow, styles.skelGrid]}>
      {Array.from({ length: cols * 2 }, (_, i) => <Pulse key={i} style={{ width: tileSize, height: tileSize, borderRadius: 4 }} />)}
    </View>
  </View>
);

const ProfileView = ({ userId, initialUsername, onLoaded }) => {
  const { t, resolvedLanguage } = useI18n();
  const navigation = useNavigation();
  const { currentUser } = useAuth();
  const { cols, tileSize } = useGridColumns({
    target: 124, min: 3, max: 6, horizontalPadding: GRID_GAP * 2, gap: GRID_GAP,
  });

  const cacheKey = userKey(currentUser?.id, `profile:${userId}`);
  const initial = userId ? peekCache(cacheKey) : null;
  const [user, setUser] = useState(initial);
  const [posts, setPosts] = useState(initial?.social_posts ?? []);
  const [hasMore, setHasMore] = useState(!!initial?.posts_has_more);
  const [loading, setLoading] = useState(!initial);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [messageBusy, setMessageBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const pageRef = useRef(1);
  // When the copy on screen was fetched (kept in the cache, so a copy from an
  // earlier visit still counts as old and gets refreshed).
  const lastFetchRef = useRef(initial?._fetchedAt || 0);
  const reqRef = useRef(0);
  const answeredRef = useRef(false); // the network has answered at least once

  const isSelf = !!user?.is_self || (currentUser?.id != null && currentUser.id === userId);
  const name = user?.username || initialUsername || '';

  useEffect(() => { if (user) onLoaded?.(user); }, [user, onLoaded]);

  const apply = useCallback((data) => {
    setUser(data);
    setPosts(Array.isArray(data?.social_posts) ? data.social_posts : []);
    setHasMore(!!data?.posts_has_more);
    pageRef.current = 1;
  }, []);

  const load = useCallback(async ({ pull = false } = {}) => {
    if (!userId) return;
    const req = ++reqRef.current;
    if (pull) setRefreshing(true);
    try {
      const data = await fetchUserById(userId);
      if (req !== reqRef.current) return;
      answeredRef.current = true;
      apply(data);
      setError(null);
      lastFetchRef.current = Date.now();
      writeCache(cacheKey, { ...data, _fetchedAt: lastFetchRef.current });
    } catch (err) {
      if (req !== reqRef.current) return;
      const status = err?.response?.status;
      if (status === 404) {
        // Gone, deactivated or blocked: never keep showing a stale copy.
        answeredRef.current = true;
        dropCache(cacheKey);
        setUser(null);
        setPosts([]);
      }
      setError(status === 404 ? 'unavailable' : 'failed');
    } finally {
      if (req === reqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [userId, cacheKey, apply]);

  // Cold start: the disk copy, if the network hasn't answered first.
  useEffect(() => {
    if (initial || !userId) return undefined;
    let cancelled = false;
    readCache(cacheKey).then((c) => {
      // Too late if the network already answered (or the screen closed).
      if (cancelled || !c || answeredRef.current) return;
      apply(c);
      lastFetchRef.current = c._fetchedAt || 0;
      setLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  // Fetch on focus: always for your own profile, when stale for others.
  useFocusEffect(useCallback(() => {
    const age = Date.now() - lastFetchRef.current;
    if (isSelf || age > STALE_MS) load();
  }, [load, isSelf]));

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || loading) return;
    setLoadingMore(true);
    try {
      const next = pageRef.current + 1;
      const res = await fetchUserPosts(userId, next, PAGE_SIZE);
      const list = Array.isArray(res) ? res : (res?.results ?? []);
      pageRef.current = next;
      setHasMore(!!res?.next);
      setPosts((prev) => mergePage(prev, list));
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, loading, userId]);

  // ── actions ──
  const handleFollow = useCallback(async () => {
    if (followBusy || isSelf || !user) return;
    const prev = user;
    const wasOn = prev.is_following || prev.follow_status === 'requested';
    // Optimistic: a private account goes to "Requested", not "Following".
    const optimistic = wasOn
      ? { ...prev, is_following: false, follow_status: 'none', followers_count: prev.is_following ? Math.max(0, prev.followers_count - 1) : prev.followers_count }
      : prev.is_private
        ? { ...prev, follow_status: 'requested' }
        : { ...prev, is_following: true, follow_status: 'following', followers_count: prev.followers_count + 1 };
    setUser(optimistic);
    setFollowBusy(true);
    try {
      const res = await followUser(userId);
      const next = {
        ...optimistic,
        is_following: !!res.is_following,
        follow_status: res.follow_status ?? (res.is_following ? 'following' : 'none'),
        followers_count: res.followers_count ?? optimistic.followers_count,
      };
      // Unfollowing a private account locks it again straight away.
      if (prev.is_private && !next.is_following) next.can_view = false;
      setUser(next);
      writeCache(cacheKey, { ...next, social_posts: posts.slice(0, PAGE_SIZE), _fetchedAt: lastFetchRef.current });
      // Following a private account unlocks its posts: fetch them.
      if (next.is_following && prev.is_private && !prev.can_view) load();
    } catch {
      setUser(prev);
      Alert.alert(t('common.error'), t('profile.followFailed'));
    } finally {
      setFollowBusy(false);
    }
  }, [followBusy, isSelf, user, userId, cacheKey, posts, load, t]);

  const handleMessage = useCallback(async () => {
    if (messageBusy || !userId) return;
    setMessageBusy(true);
    try {
      const conversation = await getOrCreateConversation(userId);
      navigation.navigate('Chat', { conversationId: conversation.id, otherUser: conversation.other_participant ?? user });
    } catch {
      Alert.alert(t('common.error'), t('profile.messageFailed'));
    } finally {
      setMessageBusy(false);
    }
  }, [messageBusy, userId, navigation, user, t]);

  const handleBlock = useCallback(() => {
    const who = name || t('profile.thisUser');
    Alert.alert(t('profile.blockTitle', { name: who }), t('profile.blockBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.block'),
        style: 'destructive',
        onPress: async () => {
          try {
            await blockUser(userId);
            dropCache(cacheKey);
            Alert.alert(t('common.blocked'), t('profile.blockDone', { name: who }));
            navigation.goBack();
          } catch {
            Alert.alert(t('common.error'), t('profile.blockFailed'));
          }
        },
      },
    ]);
  }, [name, userId, cacheKey, navigation, t]);

  const openList = useCallback((type) => {
    navigation.navigate('FollowList', { userId, type, username: name });
  }, [navigation, userId, name]);

  const openPost = useCallback((post) => navigation.navigate('PostDetail', { postId: post.id }), [navigation]);

  // ── header ──
  const profile = user?.profile || {};
  const canView = user ? user.can_view !== false : false;
  const bornText = isSelf && profile.birth_date
    ? t('profile.born', {
      date: new Date(profile.birth_date).toLocaleDateString(resolvedLanguage === 'sw' ? 'sw-KE' : 'en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      }),
    })
    : null;

  const followLabel = user?.is_following
    ? t('profile.following')
    : user?.follow_status === 'requested'
      ? t('profile.requested')
      : user?.follows_you ? t('profile.followBack') : t('profile.follow');

  const header = user ? (
    <View>
      <LinearGradient colors={['rgba(16,46,80,0.55)', 'rgba(10,22,40,0.2)']} style={styles.cover} />

      <View style={styles.avatarRow}>
        <View style={styles.avatarWrapper}>
          <Image
            source={user.profile_picture ? { uri: user.profile_picture } : DEFAULT_AVATAR}
            placeholder={DEFAULT_AVATAR}
            cachePolicy="memory-disk"
            contentFit="cover"
            transition={150}
            style={styles.avatar}
          />
        </View>

        <View style={styles.actionRow}>
          {isSelf ? (
            <>
              <TouchableOpacity style={styles.editBtn} onPress={() => navigation.navigate('CreateProfile')} activeOpacity={0.85}>
                <Ionicons name="pencil-outline" size={15} color={colors.white} />
                <Text style={styles.editBtnText}>{t('profile.editProfile')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={[
                  styles.followBtn,
                  user.is_following && styles.followingBtn,
                  user.follow_status === 'requested' && styles.requestedBtn,
                ]}
                onPress={handleFollow}
                disabled={followBusy}
                activeOpacity={0.85}
              >
                <Text style={styles.followBtnText}>{followLabel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.roundBtn} onPress={handleMessage} disabled={messageBusy} activeOpacity={0.85}>
                {messageBusy
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <Ionicons name="chatbubble-outline" size={18} color={colors.primary} />}
              </TouchableOpacity>
              <TouchableOpacity style={styles.roundBtn} onPress={() => setMenuOpen(true)} activeOpacity={0.85} hitSlop={8}>
                <Ionicons name="ellipsis-horizontal" size={18} color={colors.primary} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      <View style={styles.nameBlock}>
        <View style={styles.nameRow}>
          <Text style={styles.displayName} numberOfLines={1}>{user.username}</Text>
          {user.is_private && <Feather name="lock" size={15} color={colors.textSecondary} style={styles.nameLock} />}
        </View>
        <View style={styles.nameRow}>
          <Text style={styles.handle}>@{user.username}</Text>
          {user.follows_you && !isSelf && (
            <View style={styles.followsYou}><Text style={styles.followsYouText}>{t('profile.followsYou')}</Text></View>
          )}
        </View>
      </View>

      <View style={styles.statsRow}>
        <StatBox value={user.posts_count} label={t('profile.posts')} />
        <View style={styles.statDivider} />
        <StatBox value={user.followers_count} label={t('profile.followers')} onPress={canView ? () => openList('followers') : undefined} />
        <View style={styles.statDivider} />
        <StatBox value={user.following_count} label={t('profile.following')} onPress={canView ? () => openList('following') : undefined} />
        <View style={styles.statDivider} />
        {/* Lifetime likes across this user's posts, tracks and publications. */}
        <StatBox value={user.total_likes ?? 0} label={t('profile.likes')} />
      </View>

      {/* Quick link to saved music & posts (your own profile only). */}
      {isSelf && (
        <TouchableOpacity style={styles.favoritesLink} onPress={() => navigation.navigate('Favorites')} activeOpacity={0.85}>
          <Ionicons name="heart" size={18} color={colors.accent} />
          <Text style={styles.favoritesLinkText}>{t('profile.myFavorites')}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} style={styles.chevron} />
        </TouchableOpacity>
      )}

      {(profile.bio || profile.location || bornText) ? (
        <View style={styles.infoSection}>
          {profile.bio ? (
            <View style={styles.infoCard}>
              <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
              <Text style={styles.infoText}>{profile.bio}</Text>
            </View>
          ) : null}
          {profile.location ? (
            <View style={styles.infoCard}>
              <Ionicons name="location-outline" size={18} color={colors.primary} />
              <Text style={styles.infoText}>{profile.location}</Text>
            </View>
          ) : null}
          {bornText ? (
            <View style={styles.infoCard}>
              <Ionicons name="calendar-outline" size={18} color={colors.primary} />
              <Text style={styles.infoText}>{bornText}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>{t('profile.posts')}</Text>
    </View>
  ) : null;

  const empty = !user ? null : !canView ? (
    // A private account the viewer isn't approved for: a locked state, not
    // "No posts yet", which would misrepresent it.
    <View style={styles.postsEmpty}>
      <MaterialIcons name="lock-outline" size={40} color={colors.textMuted} />
      <Text style={styles.postsEmptyText}>{t('profile.private')}</Text>
      <Text style={styles.postsLockedSub}>
        {user.follow_status === 'requested' ? t('profile.privateRequestPending') : t('profile.privateFollowPrompt')}
      </Text>
    </View>
  ) : (
    <View style={styles.postsEmpty}>
      <MaterialIcons name="photo-library" size={40} color={colors.textMuted} />
      <Text style={styles.postsEmptyText}>{t('profile.noPosts')}</Text>
    </View>
  );

  const renderPost = useCallback(
    ({ item }) => <PostTile post={item} size={tileSize} isSelf={isSelf} onPress={openPost} />,
    [tileSize, isSelf, openPost],
  );

  // ── states ──
  if (!user && loading) {
    return <HeaderSkeleton cols={cols} tileSize={tileSize} />;
  }

  if (!user) {
    return (
      <View style={styles.centered}>
        <MaterialIcons name="person-off" size={56} color={colors.textMuted} />
        <Text style={styles.errorText}>
          {error === 'unavailable' ? t('profile.unavailable') : t('profile.loadFailed')}
        </Text>
        {error !== 'unavailable' && (
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); load(); }} activeOpacity={0.85}>
            <Text style={styles.retryBtnText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <>
      <FlatList
        style={styles.list}
        data={canView ? posts : []}
        key={`grid-${cols}`}
        numColumns={cols}
        columnWrapperStyle={cols > 1 ? styles.gridRow : undefined}
        keyExtractor={(item) => `pp_${item.id}`}
        renderItem={renderPost}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.more} color={colors.primary} /> : null}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={(
          <RefreshControl refreshing={refreshing} onRefresh={() => load({ pull: true })} tintColor="#fff" colors={[colors.primary]} />
        )}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        removeClippedSubviews
        initialNumToRender={cols * 5}
        maxToRenderPerBatch={cols * 5}
        windowSize={7}
      />

      {!isSelf && (
        <>
          <ChoiceSheet
            visible={menuOpen}
            title={`@${name}`}
            onClose={() => setMenuOpen(false)}
            cancelLabel={t('common.cancel')}
            options={[
              { key: 'report', label: t('common.report'), icon: 'flag', onPress: () => setReportOpen(true) },
              { key: 'block', label: t('common.block'), icon: 'block', destructive: true, onPress: handleBlock },
            ]}
          />
          <ReportModal
            visible={reportOpen}
            onClose={() => setReportOpen(false)}
            contentType="user"
            objectId={userId}
            title={`@${name}`}
          />
        </>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: 'transparent' },
  listContent: { paddingBottom: spacing.xxl },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  errorText: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm, marginBottom: spacing.md, textAlign: 'center' },
  retryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, ...shadows.sm },
  retryBtnText: { ...typography.button, color: colors.white },

  cover: { width: '100%', height: 130 },
  avatarRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
    paddingHorizontal: spacing.md, marginTop: -(AVATAR_SIZE / 2),
  },
  avatarWrapper: {
    borderRadius: AVATAR_SIZE / 2, borderWidth: 3,
    borderColor: 'rgba(232,198,107,0.6)', // soft gold ring
    ...shadows.lg,
  },
  avatar: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, backgroundColor: colors.surface },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1, marginLeft: spacing.sm },
  followBtn: {
    backgroundColor: colors.primary, borderRadius: radius.full,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.xs + 4,
    minWidth: 96, alignItems: 'center', ...shadows.sm,
  },
  followingBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  // Pending request: muted, so it reads as "waiting" rather than "done".
  requestedBtn: { backgroundColor: colors.textMuted, borderWidth: 1, borderColor: colors.border },
  followBtnText: { ...typography.label, color: colors.white, fontWeight: '700' },
  roundBtn: {
    backgroundColor: colors.card, borderRadius: radius.full,
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border, ...shadows.sm,
  },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.primary, borderRadius: radius.full,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 4, ...shadows.sm,
  },
  editBtnText: { ...typography.label, color: colors.white },

  nameBlock: { paddingHorizontal: spacing.md, marginTop: spacing.sm },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  nameLock: { marginTop: 2 },
  displayName: {
    ...typography.h2, color: colors.textPrimary, flexShrink: 1,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  handle: { ...typography.body, color: colors.textSecondary, marginTop: 2 },
  followsYou: {
    marginTop: 2, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  followsYouText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },

  statsRow: {
    flexDirection: 'row', marginHorizontal: spacing.md, marginTop: spacing.md,
    backgroundColor: 'rgba(16,28,46,0.85)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
    paddingVertical: spacing.md,
  },
  statBox: { flex: 1, alignItems: 'center' },
  statValue: { ...typography.h3, color: colors.textPrimary },
  statLabel: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  statDivider: { width: 1, backgroundColor: colors.border, marginVertical: spacing.xs },

  favoritesLink: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.md, marginTop: spacing.md,
    paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.4)',
  },
  favoritesLinkText: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  chevron: { marginLeft: 'auto' },
  infoSection: { marginHorizontal: spacing.md, marginTop: spacing.md, gap: spacing.sm },
  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: 'rgba(16,28,46,0.85)', borderRadius: radius.md, padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
  },
  infoText: { ...typography.body, color: colors.textPrimary, flex: 1 },

  sectionTitle: {
    ...typography.h3, color: colors.textPrimary,
    marginHorizontal: spacing.md, marginTop: spacing.lg, marginBottom: spacing.sm,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  gridRow: { paddingHorizontal: GRID_GAP, gap: GRID_GAP },
  tile: { marginBottom: GRID_GAP, backgroundColor: colors.surface, borderRadius: 4, overflow: 'hidden' },
  tileFallback: { alignItems: 'center', justifyContent: 'center' },
  videoBadge: {
    position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: radius.full, width: 22, height: 22, alignItems: 'center', justifyContent: 'center',
  },
  lockBadge: { position: 'absolute', top: 5, left: 5, padding: 3, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.55)' },
  viewsBadge: { position: 'absolute', bottom: 5, left: 5, flexDirection: 'row', alignItems: 'center', gap: 2 },
  viewsBadgeText: {
    color: colors.white, fontSize: 11, fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.75)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  more: { marginVertical: spacing.md },
  postsEmpty: {
    backgroundColor: 'rgba(16,28,46,0.85)', borderRadius: radius.lg,
    marginHorizontal: spacing.md, paddingVertical: spacing.xxl, alignItems: 'center', gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
  },
  postsEmptyText: { ...typography.body, color: colors.textMuted },
  postsLockedSub: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs, textAlign: 'center', paddingHorizontal: spacing.lg },

  skel: { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: radius.sm },
  skelGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.lg },
});

export default ProfileView;

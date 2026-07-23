import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Image, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialIcons, Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { fetchUserById, followUser, getOrCreateConversation, blockUser } from '../services/api';
import { useAuth } from '../context/useAuth';
import RotatingBackground from './RotatingBackground';
import ScreenVignette from './ScreenVignette';
import useGridColumns from '../utils/useGridColumns';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const AVATAR_SIZE = 96;
const GRID_GAP = 2;
const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

/** Build a still-image thumbnail for a post (videos -> poster frame). */
const getPostThumb = (post) => {
  // Videos: use the poster frame captured on-device at upload and served as
  // thumbnail_url. R2 stores the raw mp4 verbatim — there's no server-side frame
  // extraction or Cloudinary-style URL transform, so the old `.mp4`→`.jpg` /
  // `/video/upload/so_0,.../` rewrite produced a broken URL and a blank tile.
  if (post.content_type === 'video') {
    return post.thumbnail_url || null;
  }
  return post.optimized_url || post.media_url || null;
};

const StatBox = ({ value, label }) => (
  <View style={styles.statBox}>
    <Text style={styles.statValue}>{value ?? 0}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const UserProfileScreen = () => {
  const navigation = useNavigation();
  // Responsive photo grid: 3 columns on a phone, more on tablets / landscape.
  const { cols, tileSize } = useGridColumns({
    target: 124, min: 3, max: 6, horizontalPadding: 0, gap: GRID_GAP,
  });
  const route = useRoute();
  const { currentUser } = useAuth();
  const userId = route.params?.userId;
  const initialUsername = route.params?.username;

  const [user, setUser] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [avatarFailed, setAvatarFailed] = useState(false);

  // Follow state (optimistic). followStatus carries the third case the boolean
  // can't: a request to a private account that's still awaiting approval.
  const [isFollowing, setIsFollowing] = useState(false);
  const [followStatus, setFollowStatus] = useState('none');
  const [followersCount, setFollowersCount] = useState(0);
  const [followBusy, setFollowBusy] = useState(false);
  const [messageBusy, setMessageBusy] = useState(false);

  const isOwnProfile = currentUser?.id === userId;

  const loadProfile = useCallback(async () => {
    if (!userId) {
      setError(new Error('No user specified'));
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const data = await fetchUserById(userId);
      setUser(data);
      setPosts(Array.isArray(data?.social_posts) ? data.social_posts : []);
      setIsFollowing(!!data?.is_following);
      setFollowStatus(data?.follow_status ?? (data?.is_following ? 'following' : 'none'));
      setFollowersCount(data?.followers_count ?? 0);
      setAvatarFailed(false);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // Keep the header title in sync with the loaded username, and theme the
  // native header dark so it sits cohesively over the wallpaper.
  useEffect(() => {
    navigation.setOptions?.({
      title: user?.username || initialUsername || 'Profile',
      headerStyle: { backgroundColor: '#0A1628' },
      headerTintColor: colors.textPrimary,
      headerShadowVisible: false,
    });
  }, [navigation, user?.username, initialUsername]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadProfile();
  }, [loadProfile]);

  const handleFollow = useCallback(async () => {
    if (followBusy || isOwnProfile) return;
    const prevFollowing = isFollowing;
    const prevCount = followersCount;
    // Optimistic update
    setIsFollowing(!prevFollowing);
    setFollowersCount(prevFollowing ? Math.max(0, prevCount - 1) : prevCount + 1);
    setFollowBusy(true);
    try {
      const res = await followUser(userId);
      setIsFollowing(res.is_following);
      setFollowStatus(res.follow_status ?? (res.is_following ? 'following' : 'none'));
      setFollowersCount(res.followers_count);
    } catch {
      // Roll back on failure
      setIsFollowing(prevFollowing);
      setFollowStatus(prevFollowing ? 'following' : 'none');
      setFollowersCount(prevCount);
      Alert.alert('Error', 'Could not update follow status. Please try again.');
    } finally {
      setFollowBusy(false);
    }
  }, [followBusy, isOwnProfile, isFollowing, followersCount, userId]);

  const handleBlock = useCallback(() => {
    if (isOwnProfile || !userId) return;
    const name = user?.username || initialUsername || 'this user';
    Alert.alert(
      `Block @${name}?`,
      "They won't be able to see your content or message you, and you won't see theirs. You can undo this in Settings → Privacy.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              await blockUser(userId);
              Alert.alert('Blocked', `You've blocked @${name}.`);
              navigation.goBack();
            } catch {
              Alert.alert('Error', 'Could not block this user. Please try again.');
            }
          },
        },
      ]
    );
  }, [isOwnProfile, userId, user, initialUsername, navigation]);

  const handleMessage = useCallback(async () => {
    if (messageBusy || !userId) return;
    setMessageBusy(true);
    try {
      const conversation = await getOrCreateConversation(userId);
      navigation.navigate('Chat', {
        conversationId: conversation.id,
        otherUser: conversation.other_participant ?? user,
      });
    } catch {
      Alert.alert('Error', 'Could not open conversation. Please try again.');
    } finally {
      setMessageBusy(false);
    }
  }, [messageBusy, userId, navigation, user]);

  const renderHeader = useCallback(() => {
    const profile = user?.profile || {};
    const avatarUri = user?.profile_picture || profile.picture_url;
    const avatarSource = avatarUri && !avatarFailed ? { uri: avatarUri } : DEFAULT_AVATAR;

    return (
      <View>
        <LinearGradient colors={['rgba(16,46,80,0.55)', 'rgba(10,22,40,0.2)']} style={styles.cover} />

        <View style={styles.avatarRow}>
          <View style={styles.avatarWrapper}>
            <Image
              source={avatarSource}
              defaultSource={DEFAULT_AVATAR}
              style={styles.avatar}
              onError={() => setAvatarFailed(true)}
            />
          </View>

          <View style={styles.actionRow}>
            {isOwnProfile ? (
              <TouchableOpacity
                style={styles.editBtn}
                onPress={() => navigation.navigate('CreateProfile')}
                activeOpacity={0.85}
              >
                <Ionicons name="pencil-outline" size={15} color={colors.white} />
                <Text style={styles.editBtnText}>Edit</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity
                  style={[
                    styles.followBtn,
                    isFollowing && styles.followingBtn,
                    followStatus === 'requested' && styles.requestedBtn,
                  ]}
                  onPress={handleFollow}
                  disabled={followBusy}
                  activeOpacity={0.85}
                >
                  {followBusy ? (
                    <ActivityIndicator size="small" color={colors.white} />
                  ) : (
                    <Text style={styles.followBtnText}>
                      {isFollowing
                        ? 'Following'
                        : followStatus === 'requested' ? 'Requested' : 'Follow'}
                    </Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.messageBtn}
                  onPress={handleMessage}
                  disabled={messageBusy}
                  activeOpacity={0.85}
                >
                  {messageBusy ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Ionicons name="chatbubble-outline" size={18} color={colors.primary} />
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.messageBtn}
                  onPress={handleBlock}
                  activeOpacity={0.85}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="ellipsis-horizontal" size={18} color={colors.primary} />
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        <View style={styles.nameBlock}>
          <Text style={styles.displayName}>{user?.username || initialUsername}</Text>
          <Text style={styles.handle}>@{user?.username || initialUsername}</Text>
        </View>

        <View style={styles.statsRow}>
          <StatBox value={posts.length} label="Posts" />
          <View style={styles.statDivider} />
          <StatBox value={followersCount} label="Followers" />
          <View style={styles.statDivider} />
          <StatBox value={user?.following_count ?? 0} label="Following" />
        </View>

        {(profile.bio || profile.location) ? (
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
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Posts</Text>
      </View>
    );
  }, [
    user, avatarFailed, isOwnProfile, isFollowing, followStatus, followBusy, followersCount,
    messageBusy, posts.length, initialUsername, navigation, handleFollow, handleMessage,
  ]);

  const renderPost = useCallback(({ item, index }) => {
    const thumb = getPostThumb(item);
    const isLastInRow = (index + 1) % cols === 0;
    return (
      <TouchableOpacity
        style={[styles.tile, { width: tileSize, height: tileSize }, !isLastInRow && { marginRight: GRID_GAP }]}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('PostDetail', { postId: item.id })}
      >
        {thumb ? (
          <Image source={{ uri: thumb }} style={styles.tileImage} resizeMode="cover" />
        ) : (
          <View style={[styles.tileImage, styles.tileFallback]}>
            <Feather name="image" size={22} color={colors.textMuted} />
          </View>
        )}
        {item.content_type === 'video' && (
          <View style={styles.videoBadge}>
            <Ionicons name="play" size={12} color={colors.white} />
          </View>
        )}
      </TouchableOpacity>
    );
  }, [navigation, cols, tileSize]);

  // A private account the viewer hasn't been approved for shows a locked state
  // rather than "No posts yet", which would misrepresent an account that simply
  // hasn't let them in. The server withholds the posts either way.
  const renderEmptyPosts = useCallback(() => {
    const locked = user?.is_private && user?.can_view === false;
    if (locked) {
      return (
        <View style={styles.postsEmpty}>
          <MaterialIcons name="lock-outline" size={40} color={colors.textMuted} />
          <Text style={styles.postsEmptyText}>This account is private</Text>
          <Text style={styles.postsLockedSub}>
            {followStatus === 'requested'
              ? 'Your follow request is waiting to be approved.'
              : 'Follow this account to see their posts.'}
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.postsEmpty}>
        <MaterialIcons name="photo-library" size={40} color={colors.textMuted} />
        <Text style={styles.postsEmptyText}>No posts yet</Text>
      </View>
    );
  }, [user?.is_private, user?.can_view, followStatus]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error || !user) {
    return (
      <View style={styles.centered}>
        <MaterialIcons name="person-off" size={56} color={colors.textMuted} />
        <Text style={styles.errorText}>
          {error?.message?.includes('not found') || error?.message?.includes('404')
            ? 'This profile is unavailable.'
            : "Couldn't load this profile."}
        </Text>
        <TouchableOpacity style={styles.retryBtn} onPress={loadProfile} activeOpacity={0.85}>
          <Text style={styles.retryBtnText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Luxury backdrop: rotating wallpaper + navy vignette behind the profile. */}
      <RotatingBackground intervalMs={60000} scrimColor="rgba(10,22,40,0.5)" />
      <ScreenVignette tintRgb="6,16,34" zIndex={1} />

      <FlatList
        style={styles.container}
        data={posts}
        key={`grid-${cols}`}
        numColumns={cols}
        keyExtractor={(item) => `up_post_${item.id}`}
        renderItem={renderPost}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmptyPosts}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        removeClippedSubviews
        initialNumToRender={12}
        windowSize={7}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A1628' },
  container: { flex: 1, backgroundColor: 'transparent', zIndex: 2 },
  listContent: { paddingBottom: spacing.xxl },
  centered: {
    flex: 1, backgroundColor: colors.bg,
    justifyContent: 'center', alignItems: 'center', padding: spacing.lg,
  },
  errorText: {
    ...typography.body, color: colors.textMuted,
    marginTop: spacing.sm, marginBottom: spacing.md, textAlign: 'center',
  },
  retryBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, ...shadows.sm,
  },
  retryBtnText: { ...typography.button, color: colors.white },

  cover: { width: '100%', height: 130 },
  avatarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    marginTop: -(AVATAR_SIZE / 2),
  },
  avatarWrapper: {
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 3,
    borderColor: 'rgba(232,198,107,0.6)', // soft gold ring
    ...shadows.lg,
  },
  avatar: {
    width: AVATAR_SIZE, height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2, backgroundColor: colors.surface,
  },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  followBtn: {
    backgroundColor: colors.primary, borderRadius: radius.full,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.xs + 4,
    minWidth: 96, alignItems: 'center', ...shadows.sm,
  },
  followingBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  // Pending request: muted, so it reads as "waiting" rather than "done".
  requestedBtn: { backgroundColor: colors.textMuted, borderWidth: 1, borderColor: colors.border },
  followBtnText: { ...typography.label, color: colors.white, fontWeight: '700' },
  messageBtn: {
    backgroundColor: colors.card, borderRadius: radius.full,
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border, ...shadows.sm,
  },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.primary, borderRadius: radius.full,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, ...shadows.sm,
  },
  editBtnText: { ...typography.label, color: colors.white },

  nameBlock: { paddingHorizontal: spacing.md, marginTop: spacing.sm },
  displayName: {
    ...typography.h2, color: colors.textPrimary,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  handle: { ...typography.body, color: colors.textSecondary, marginTop: 2 },

  statsRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.md, marginTop: spacing.md,
    backgroundColor: 'rgba(16,28,46,0.85)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
    paddingVertical: spacing.md,
  },
  statBox: { flex: 1, alignItems: 'center' },
  statValue: { ...typography.h3, color: colors.textPrimary },
  statLabel: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  statDivider: { width: 1, backgroundColor: colors.border, marginVertical: spacing.xs },

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
  tile: {
    marginBottom: GRID_GAP,
    backgroundColor: colors.surface,
  },
  tileImage: { width: '100%', height: '100%' },
  tileFallback: { alignItems: 'center', justifyContent: 'center' },
  videoBadge: {
    position: 'absolute', top: 6, right: 6,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radius.full,
    width: 22, height: 22, alignItems: 'center', justifyContent: 'center',
  },
  postsEmpty: {
    backgroundColor: 'rgba(16,28,46,0.85)', borderRadius: radius.lg,
    marginHorizontal: spacing.md, paddingVertical: spacing.xxl,
    alignItems: 'center', gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
  },
  postsEmptyText: { ...typography.body, color: colors.textMuted },
  postsLockedSub: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
});

export default UserProfileScreen;

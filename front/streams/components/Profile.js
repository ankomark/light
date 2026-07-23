import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, Image, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialIcons, Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { fetchProfile, fetchUserPosts } from '../services/api';
import useGridColumns from '../utils/useGridColumns';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const AVATAR_SIZE = 90;
const GRID_GAP = 6;
const GRID_PADDING = spacing.md;
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

const StatBox = ({ value, label, onPress }) => {
  const content = (
    <>
      <Text style={styles.statValue}>{value ?? '—'}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </>
  );
  if (onPress) {
    return (
      <TouchableOpacity style={styles.statBox} onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }
  return <View style={styles.statBox}>{content}</View>;
};

const Profile = () => {
  const { t } = useI18n();
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const navigation = useNavigation();
  // Responsive photo grid: 3 columns on a phone, more on tablets / landscape.
  const { cols, tileSize } = useGridColumns({
    target: 124, min: 3, max: 6, horizontalPadding: GRID_PADDING * 2, gap: GRID_GAP,
  });

  const loadProfile = useCallback(async () => {
    try {
      const data = await fetchProfile();
      setProfile(data);
      setAvatarFailed(false);

      // Fetch this user's posts (images + videos) for the grid.
      if (data?.user_id) {
        try {
          const res = await fetchUserPosts(data.user_id);
          const list = Array.isArray(res) ? res : (res?.results ?? []);
          setPosts(list);
        } catch (postErr) {
          console.error('Error fetching user posts:', postErr);
          setPosts([]);
        }
      }
    } catch (error) {
      if (error.response?.status !== 401) {
        console.error('Error fetching profile:', error);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadProfile();
  }, [loadProfile]);

  const renderHeader = useCallback(() => {
    if (!profile) return null;
    const avatarSource = profile.picture_url && !avatarFailed
      ? { uri: profile.picture_url }
      : DEFAULT_AVATAR;

    return (
      <View>
        {/* Cover area */}
        <LinearGradient colors={['rgba(16,46,80,0.55)', 'rgba(10,22,40,0.2)']} style={styles.cover} />

        {/* Avatar + edit row */}
        <View style={styles.avatarRow}>
          <View style={styles.avatarWrapper}>
            <Image
              source={avatarSource}
              defaultSource={DEFAULT_AVATAR}
              style={styles.avatar}
              onError={() => setAvatarFailed(true)}
            />
          </View>
          <TouchableOpacity
            style={styles.editBtn}
            onPress={() => navigation.navigate('CreateProfile')}
            activeOpacity={0.8}
          >
            <Ionicons name="pencil-outline" size={15} color={colors.white} />
            <Text style={styles.editBtnText}>{t('profile.editProfile')}</Text>
          </TouchableOpacity>
        </View>

        {/* Name & username */}
        <View style={styles.nameBlock}>
          <Text style={styles.displayName}>{profile.username}</Text>
          <Text style={styles.username}>@{profile.username}</Text>
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <StatBox
            value={profile.followers_count ?? 0}
            label="Followers"
            onPress={() => navigation.navigate('FollowList', {
              userId: profile.user_id,
              type: 'followers',
              username: profile.username,
            })}
          />
          <View style={styles.statDivider} />
          <StatBox
            value={profile.following_count ?? 0}
            label="Following"
            onPress={() => navigation.navigate('FollowList', {
              userId: profile.user_id,
              type: 'following',
              username: profile.username,
            })}
          />
          <View style={styles.statDivider} />
          <StatBox value={profile.posts_count ?? posts.length} label="Posts" />
        </View>

        {/* Quick link to saved music & posts */}
        <TouchableOpacity
          style={styles.favoritesLink}
          onPress={() => navigation.navigate('Favorites')}
          activeOpacity={0.85}
        >
          <Ionicons name="heart" size={18} color={colors.accent} />
          <Text style={styles.favoritesLinkText}>{t('profile.myFavorites')}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} style={{ marginLeft: 'auto' }} />
        </TouchableOpacity>

        {/* Info cards */}
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

          {profile.birth_date ? (
            <View style={styles.infoCard}>
              <Ionicons name="calendar-outline" size={18} color={colors.primary} />
              <Text style={styles.infoText}>
                Born {new Date(profile.birth_date).toLocaleDateString('en-US', {
                  year: 'numeric', month: 'long', day: 'numeric',
                })}
              </Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>{t('profile.posts')}</Text>
      </View>
    );
  }, [profile, avatarFailed, posts.length, navigation, t]);

  const renderPost = useCallback(({ item }) => {
    const thumb = getPostThumb(item);
    return (
      <TouchableOpacity
        style={[styles.tile, { width: tileSize, height: tileSize }]}
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
  }, [navigation, tileSize]);

  const renderEmptyPosts = useCallback(() => (
    <View style={styles.postsEmpty}>
      <MaterialIcons name="photo-library" size={40} color={colors.textMuted} />
      <Text style={styles.postsEmptyText}>{t('profile.noPosts')}</Text>
    </View>
  ), [t]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.centered}>
        <MaterialIcons name="person-off" size={56} color={colors.textMuted} />
        <Text style={styles.emptyText}>{t('profile.notFound')}</Text>
        <TouchableOpacity
          style={styles.createBtn}
          onPress={() => navigation.navigate('CreateProfile')}
        >
          <Text style={styles.createBtnText}>{t('profile.create')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={posts}
      key={`grid-${cols}`}
      numColumns={cols}
      columnWrapperStyle={styles.gridRow}
      keyExtractor={(item) => `my_post_${item.id}`}
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
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  listContent: { paddingBottom: spacing.xxl },
  centered: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  createBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    ...shadows.sm,
  },
  createBtnText: {
    ...typography.button,
    color: colors.white,
  },
  cover: {
    width: '100%',
    height: 140,
  },
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
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.surface,
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    ...shadows.sm,
  },
  favoritesLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(244,162,97,0.4)',
  },
  favoritesLinkText: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  editBtnText: {
    ...typography.label,
    color: colors.white,
  },
  nameBlock: {
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  displayName: {
    ...typography.h2,
    color: colors.textPrimary,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  username: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    backgroundColor: 'rgba(16,28,46,0.85)',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
    paddingVertical: spacing.md,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  infoSection: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: 'rgba(16,28,46,0.85)',
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  infoText: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  gridRow: {
    paddingHorizontal: GRID_PADDING,
    gap: GRID_GAP,
  },
  tile: {
    marginBottom: GRID_GAP,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  tileImage: { width: '100%', height: '100%' },
  tileFallback: { alignItems: 'center', justifyContent: 'center' },
  videoBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: radius.full,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postsEmpty: {
    backgroundColor: 'rgba(16,28,46,0.85)',
    borderRadius: radius.lg,
    marginHorizontal: spacing.md,
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  postsEmptyText: {
    ...typography.body,
    color: colors.textMuted,
  },
});

export default Profile;

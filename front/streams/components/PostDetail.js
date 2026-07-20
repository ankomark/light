import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Image,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { createSound } from '../services/audioPlayer';
import AppVideo from './AppVideo';
import axios from 'axios';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import { API_URL } from '../services/api';
import CommentAction from './CommentAction';
import PostActions from '../components/PostActions';
import RotatingBackground from './RotatingBackground';
import ScreenVignette from './ScreenVignette';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

const getOptimizedUrl = (url, type = 'image') => {
  if (!url) return null;
  if (type === 'profile' && url.includes('res.cloudinary.com')) {
    return url.replace('/upload/', '/upload/w_100,h_100,c_fill,g_face/');
  }
  return url;
};

/** Aspect ratio for the media frame — uses real dimensions when known. */
const getAspectRatio = (post) => {
  if (post?.width && post?.height && post.height > 0) {
    const ratio = post.width / post.height;
    // Clamp so very tall/wide posts stay within a comfortable frame.
    return Math.min(Math.max(ratio, 0.6), 1.91);
  }
  return post?.content_type === 'video' ? 16 / 9 : 1;
};

const processPost = (post) => ({
  ...post,
  mediaUrl: post.optimized_url || post.media_url,
  thumbnailUrl: post.optimized_url || post.media_url,
  user: {
    ...post.user,
    profile_picture: post.user?.profile_picture || null,
  },
});

const PostDetail = ({ route, navigation }) => {
  const { postId, commentId, shouldOpenComments } = route.params;
  const [commentsVisible, setCommentsVisible] = useState(false);
  const flatListRef = useRef(null);
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [commentsCount, setCommentsCount] = useState(0);
  const videoRef = useRef(null);
  const [mediaError, setMediaError] = useState(false);
  const audioRef = useRef(null);
  const timeoutRef = useRef(null);

  // Auto-open comments if coming from a notification
  useEffect(() => {
    if (shouldOpenComments) {
      setCommentsVisible(true);
    }
  }, [shouldOpenComments]);

  useEffect(() => {
    const fetchPostDetail = async () => {
      try {
        setLoading(true);
        const response = await axios.get(`${API_URL}/social-posts/${postId}/`);
        const processedPost = processPost(response.data);
        setPost(processedPost);
        setCommentsCount(response.data.comments_count || 0);
      } catch (err) {
        console.error('Error fetching post details:', err);
        setError('Failed to load post details.');
      } finally {
        setLoading(false);
      }
    };

    fetchPostDetail();
  }, [postId]);

  // Normalized song fields — prefer the post's denormalized snapshot, fall
  // back to the nested track. (track.artist is an object, so read .username.)
  const songTitle = post?.song_title || post?.song?.title || null;
  const songArtist = post?.song_artist || post?.song?.artist?.username || null;
  const songAudioUrl = post?.song_audio_url || post?.song?.audio_file || null;
  const songStart = post?.song_start_time ?? post?.song?.start_time ?? 0;
  const songEnd = post?.song_end_time ?? post?.song?.end_time ?? null;
  const hasSong = !!(songTitle || songAudioUrl);

  useEffect(() => {
    // Play the attached song for image posts (with trimmed start/end)
    const playSong = async () => {
      if (post?.content_type === 'image' && songAudioUrl) {
        try {
          if (audioRef.current) {
            await audioRef.current.unloadAsync();
            audioRef.current = null;
          }

          const { sound } = await createSound({ uri: songAudioUrl });
          audioRef.current = sound;

          await sound.playFromPositionAsync((songStart || 0) * 1000);

          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
          }

          if (songEnd != null) {
            const duration = (songEnd - (songStart || 0)) * 1000;
            timeoutRef.current = setTimeout(async () => {
              if (audioRef.current) {
                await audioRef.current.stopAsync();
              }
            }, duration);
          }
        } catch {
          // Audio failed — continue silently
        }
      }
    };

    playSong();

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (audioRef.current) {
        audioRef.current.unloadAsync();
        audioRef.current = null;
      }
    };
  }, [post]);

  const handleCommentsLoaded = (comments) => {
    if (commentId && flatListRef.current) {
      const index = comments.findIndex((c) => c.id === commentId);
      if (index >= 0) {
        setTimeout(() => {
          flatListRef.current?.scrollToIndex({ index, viewOffset: 50, animated: true });
        }, 500);
      }
    }
  };

  const updateCommentsCount = (newCount) => setCommentsCount(newCount);
  const handleMediaError = () => setMediaError(true);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error || !post) {
    return (
      <View style={styles.centered}>
        <Feather name="alert-circle" size={48} color={colors.textMuted} />
        <Text style={styles.errorText}>{error || 'Post not found.'}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => navigation.goBack()}>
          <Text style={styles.retryButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const aspectRatio = getAspectRatio(post);

  return (
    <View style={styles.container}>
      {/* Luxury backdrop: rotating wallpaper + navy vignette behind glass cards. */}
      <RotatingBackground intervalMs={60000} scrimColor="rgba(10,22,40,0.5)" />
      <ScreenVignette tintRgb="6,16,34" zIndex={1} />

      <SafeAreaView style={styles.content} edges={['top']}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}>
          <Feather name="arrow-left" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Post</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Author row */}
        <View style={styles.authorRow}>
          <TouchableOpacity
            style={styles.userInfo}
            activeOpacity={0.7}
            onPress={() =>
              post.user?.id &&
              navigation.navigate('UserProfile', {
                userId: post.user.id,
                username: post.user.username,
              })
            }
          >
            <Image
              source={
                post.user.profile_picture
                  ? { uri: getOptimizedUrl(post.user.profile_picture, 'profile') }
                  : DEFAULT_AVATAR
              }
              defaultSource={DEFAULT_AVATAR}
              style={styles.profileImage}
              onError={() =>
                setPost((prev) => ({
                  ...prev,
                  user: { ...prev.user, profile_picture: null },
                }))
              }
            />
            <View style={styles.authorText}>
              <Text style={styles.username}>{post.user.username}</Text>
              {post.location ? (
                <Text style={styles.authorLocation} numberOfLines={1}>
                  <Feather name="map-pin" size={11} color={colors.textSecondary} /> {post.location}
                </Text>
              ) : null}
            </View>
          </TouchableOpacity>

          <PostActions
            post={post}
            onUpdate={(updatedPost) => setPost(processPost(updatedPost))}
            onDelete={() => navigation.goBack()}
            navigation={navigation}
          />
        </View>

        {/* Media */}
        <View style={[styles.mediaFrame, { aspectRatio }]}>
          {mediaError ? (
            <View style={styles.errorMediaContainer}>
              <Feather name="image" size={44} color={colors.textMuted} />
              <Text style={styles.errorMediaText}>Media unavailable</Text>
              <TouchableOpacity style={styles.retryButton} onPress={() => setMediaError(false)}>
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : post.content_type === 'video' ? (
            <AppVideo
              ref={videoRef}
              source={{ uri: post.mediaUrl }}
              style={styles.media}
              useNativeControls
              resizeMode="contain"
              shouldPlay
              isLooping
              onError={handleMediaError}
            />
          ) : (
            <Image
              source={{ uri: post.mediaUrl }}
              style={styles.media}
              resizeMode="cover"
              onError={handleMediaError}
            />
          )}
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statChip}>
            <Ionicons name="heart" size={16} color={colors.error} />
            <Text style={styles.statText}>{post.likes_count || 0}</Text>
          </View>
          <View style={styles.statChip}>
            <Ionicons name="chatbubble-outline" size={15} color={colors.textSecondary} />
            <Text style={styles.statText}>{commentsCount}</Text>
          </View>
          <Text style={styles.timestamp}>
            {new Date(post.created_at).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </Text>
        </View>

        {/* Caption */}
        {post.caption ? (
          <View style={styles.captionCard}>
            <Text style={styles.caption}>
              <Text style={styles.captionAuthor}>{post.user.username} </Text>
              {post.caption}
            </Text>
          </View>
        ) : null}

        {/* Attached song */}
        {hasSong ? (
          <View style={styles.songCard}>
            <View style={styles.songIcon}>
              <Ionicons name="musical-notes" size={18} color={colors.primary} />
            </View>
            <View style={styles.songInfo}>
              <Text style={styles.songTitle} numberOfLines={1}>
                {songTitle || 'Original audio'}
              </Text>
              {songArtist ? (
                <Text style={styles.songArtist} numberOfLines={1}>
                  {songArtist}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <CommentAction
        postId={postId}
        commentCount={commentsCount}
        flatListRef={flatListRef}
        autoOpen={shouldOpenComments}
        onCommentsLoaded={handleCommentsLoaded}
        onCommentPosted={updateCommentsCount}
        triggerVariant="bar"
      />
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A1628',
  },
  content: {
    flex: 1,
    zIndex: 2, // above the vignette (zIndex 1)
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  errorText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(8,20,40,0.55)',
  },
  topBarTitle: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scrollContainer: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },

  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  profileImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: 'rgba(232,198,107,0.55)', // soft gold ring
  },
  authorText: {
    marginLeft: spacing.sm,
    flex: 1,
  },
  username: {
    ...typography.label,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  authorLocation: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 1,
  },

  mediaFrame: {
    // Cap + center on wide screens (tablets) so the media doesn't stretch huge.
    width: Math.min(SCREEN_WIDTH - spacing.md * 2, 600),
    marginTop: spacing.xs,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.black,
    alignSelf: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    ...shadows.md,
  },
  media: {
    width: '100%',
    height: '100%',
  },
  errorMediaContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
  },
  errorMediaText: {
    ...typography.body,
    color: colors.textMuted,
  },
  retryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs + 4,
    marginTop: spacing.xs,
  },
  retryButtonText: {
    ...typography.label,
    color: colors.white,
    fontWeight: '600',
  },

  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(16,28,46,0.85)',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    ...typography.label,
    color: colors.textPrimary,
  },
  timestamp: {
    ...typography.caption,
    color: colors.textMuted,
    marginLeft: 'auto',
  },

  captionCard: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: 'rgba(16,28,46,0.85)',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  caption: {
    ...typography.body,
    color: colors.textPrimary,
  },
  captionAuthor: {
    fontWeight: '700',
    color: colors.textPrimary,
  },

  songCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: spacing.sm + 2,
    backgroundColor: 'rgba(16,28,46,0.85)',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  songIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  songInfo: { flex: 1 },
  songTitle: {
    ...typography.label,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  songArtist: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 1,
  },
});

export default PostDetail;

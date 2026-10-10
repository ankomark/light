import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Image,
  ScrollView,
  TouchableOpacity,
  Pressable,
  AppState,
  useWindowDimensions,
} from 'react-native';
import { createSound } from '../services/audioPlayer';
import AppVideo from './AppVideo';
import BookPostMedia from './BookPostMedia';
import ItemPostMedia from './ItemPostMedia';
import axios from 'axios';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import { API_URL } from '../services/api';
import CommentAction from './CommentAction';
import RichCaption from './RichCaption';
import PostActions from '../components/PostActions';
import RotatingBackground from './RotatingBackground';
import ScreenVignette from './ScreenVignette';
import ImageViewer from './ImageViewer';
import { LikeButton, SaveButton } from './SocialActions';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';
import { peekCache, readCache, writeCache, dropCache, userKey } from '../utils/screenCache';
import ResilientImage, { PLACEHOLDER_BG } from './ResilientImage';
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
    // The same bounds as the feed (0.5-1.91), so a 9:16 photo isn't cropped here.
    return Math.min(Math.max(ratio, 0.5), 1.91);
  }
  return post?.content_type === 'video' ? 16 / 9 : 1;
};

const processPost = (post) => ({
  ...post,
  mediaUrl: post.optimized_url || post.media_url,
  thumbnailUrl: post.optimized_url || post.media_url,
  // Every photo of a 1-4 photo post (the feed's carousel), not just the first.
  photos: (Array.isArray(post.media_items) ? post.media_items : [])
    .map((m) => m?.optimized_url || m?.media_url).filter(Boolean),
  user: {
    ...post.user,
    profile_picture: post.user?.profile_picture || null,
  },
});

/** "5 Oct 2026" in the reader's language. */
const postedOn = (dateStr, t) => {
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  const months = t('tix.months').split(',');
  return months.length === 12 ? `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const PostDetail = ({ route, navigation }) => {
  const { t } = useI18n();
  const { postId, commentId, shouldOpenComments } = route.params;
  const { currentUser } = useAuth();
  // Per viewer: what a post shows depends on who looks (private accounts,
  // followers-only posts).
  const cacheKey = userKey(currentUser?.id, `post:${postId}`);
  const cached = peekCache(cacheKey);
  // Reactive media width — capped + centered on wide screens; reflows on
  // rotation / web resize (was a module-scope Dimensions.get snapshot).
  const { width: winW } = useWindowDimensions();
  const mediaFrameW = Math.min(winW - spacing.md * 2, 600);
  const [commentsVisible, setCommentsVisible] = useState(false);
  const flatListRef = useRef(null);
  // The last copy at once (a post opened before, or offline); the fresh one
  // replaces it.
  const [post, setPost] = useState(() => (cached ? processPost(cached) : null));
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState(null);
  const [commentsCount, setCommentsCount] = useState(() => cached?.comments_count || 0);
  const videoRef = useRef(null);
  const [mediaError, setMediaError] = useState(false);
  const audioRef = useRef(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [viewerAt, setViewerAt] = useState(null);   // full screen, at this photo

  // Auto-open comments if coming from a notification
  useEffect(() => {
    if (shouldOpenComments) {
      setCommentsVisible(true);
    }
  }, [shouldOpenComments]);

  useEffect(() => {
    let alive = true;
    let shown = !!peekCache(cacheKey);
    const fetchPostDetail = async () => {
      if (!shown) {
        const disk = await readCache(cacheKey);
        if (alive && disk) {
          shown = true;
          setPost(processPost(disk));
          setCommentsCount(disk.comments_count || 0);
          setLoading(false);
        }
      }
      try {
        const response = await axios.get(`${API_URL}/social-posts/${postId}/`);
        if (!alive) return;
        const processedPost = processPost(response.data);
        setPost(processedPost);
        setError(null);
        setCommentsCount(response.data.comments_count || 0);
        writeCache(cacheKey, response.data);
      } catch (err) {
        if (!alive) return;
        // 404 = the post is gone or no longer visible to this person (deleted,
        // taken down, made private, or on a private account they don't
        // follow). Say that, rather than a generic failure that invites a
        // pointless retry - and the kept copy goes too.
        if (err?.response?.status === 404) {
          dropCache(cacheKey);
          setPost(null);
          setError(t('post.unavailable'));
        } else if (!shown) {
          if (__DEV__) console.warn('Error fetching post details:', err?.message);
          setError(t('post.loadFailed'));
        }
        // Otherwise the kept copy stays up: offline is not "gone".
      } finally {
        if (alive) setLoading(false);
      }
    };

    fetchPostDetail();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, cacheKey]);

  // Normalized song fields — prefer the post's denormalized snapshot, fall
  // back to the nested track. (track.artist is an object, so read .username.)
  const songTitle = post?.song_title || post?.song?.title || null;
  const songArtist = post?.song_artist || post?.song?.artist?.username || null;
  const songAudioUrl = post?.song_audio_url || post?.song?.audio_file || null;
  const songStart = post?.song_start_time ?? post?.song?.start_time ?? 0;
  const songEnd = post?.song_end_time ?? post?.song?.end_time ?? null;
  const hasSong = !!(songTitle || songAudioUrl);

  // The attached song of a photo post: its trimmed window, looped. Started
  // once per post (not again on every change to the post's state), and
  // stopped for good on leaving - also when leaving while it is still
  // loading, which used to leave it playing with no screen to stop it.
  const postKey = post?.content_type === 'image' ? post.id : null;
  useEffect(() => {
    if (!postKey || !songAudioUrl) return undefined;
    let alive = true;
    let sound = null;
    const start = (songStart || 0) * 1000;
    const end = songEnd != null && songEnd > (songStart || 0) ? songEnd * 1000 : null;
    (async () => {
      try {
        const created = await createSound({ uri: songAudioUrl }, { shouldPlay: false, isLooping: true });
        if (!alive) { created.sound.unloadAsync?.().catch?.(() => {}); return; }
        sound = created.sound;
        audioRef.current = sound;
        if (end) {
          sound.setOnPlaybackStatusUpdate?.((st) => {
            if (st?.isLoaded && st.positionMillis >= end) sound.setPositionAsync(start).catch(() => {});
          });
        }
        await sound.playFromPositionAsync(start);
      } catch {
        // Audio failed - continue silently
      }
    })();
    // Leaving the app stops it, as on the feed.
    const appSub = AppState.addEventListener('change', (st) => {
      if (st === 'background') audioRef.current?.pauseAsync?.()?.catch?.(() => {});
    });
    return () => {
      alive = false;
      appSub.remove();
      if (sound) sound.unloadAsync?.()?.catch?.(() => {});
      audioRef.current = null;
    };
  }, [postKey, songAudioUrl, songStart, songEnd]);

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
        <Text style={styles.errorText}>{error || t('post.unavailable')}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => navigation.goBack()}>
          <Text style={styles.retryButtonText}>{t('common.goBack')}</Text>
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
        <Text style={styles.topBarTitle}>{t('post.title')}</Text>
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
            // An edit sends back the text it changed; the media stays as shown.
            onUpdate={(updatedPost) => setPost((prev) => ({
              ...prev, ...updatedPost, user: prev.user, mediaUrl: prev.mediaUrl, thumbnailUrl: prev.thumbnailUrl,
              photos: prev.photos, media_url: prev.media_url, optimized_url: prev.optimized_url,
              media_items: prev.media_items,
            }))}
            onDelete={() => navigation.goBack()}
          />
        </View>

        {/* Media — a book post is the book's card, not a picture. */}
        {post.content_type === 'book' ? (
          <View style={[styles.bookFrame, { width: mediaFrameW }]}>
            <BookPostMedia item={post} width={mediaFrameW} />
          </View>
        ) : post.content_type === 'product' || post.content_type === 'service' ? (
          <View style={[styles.bookFrame, { width: mediaFrameW }]}>
            <ItemPostMedia item={post} width={mediaFrameW} />
          </View>
        ) : (
        <View style={[styles.mediaFrame, { aspectRatio, width: mediaFrameW }]}>
          {mediaError ? (
            <View style={styles.errorMediaContainer}>
              <Feather name="image" size={44} color={colors.textMuted} />
              <Text style={styles.errorMediaText}>{t('feed.mediaUnavailable')}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={() => setMediaError(false)}>
                <Text style={styles.retryButtonText}>{t('feed.retry')}</Text>
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
          ) : post.photos.length > 1 ? (
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => setPhotoIndex(Math.round(e.nativeEvent.contentOffset.x / mediaFrameW))}
              testID="post-photos"
            >
              {post.photos.map((url, i) => (
                <Pressable key={`${i}_${url}`} onPress={() => setViewerAt(i)} style={{ width: mediaFrameW, height: '100%' }}>
                  <ResilientImage uri={url} style={styles.media} onFailed={handleMediaError} />
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <Pressable style={styles.media} onPress={() => setViewerAt(0)} testID="post-photo">
              <ResilientImage uri={post.mediaUrl} previewUri={post.thumbnail_url} style={styles.media}
                              onFailed={handleMediaError} />
            </Pressable>
          )}
          {post.content_type === 'image' && post.photos.length > 1 && !mediaError ? (
            <View style={styles.dots} pointerEvents="none">
              {post.photos.map((_, i) => (
                <View key={i} style={[styles.dot, i === photoIndex && styles.dotActive]} />
              ))}
            </View>
          ) : null}
        </View>
        )}

        {/* Like and save here too: a post opened from a notification is
            still a post. */}
        <View style={styles.statsRow}>
          <LikeButton
            postId={post.id}
            initialLikes={post.likes_count || 0}
            isLiked={post.is_liked || false}
            onLikeChange={({ is_liked, likes_count }) => setPost((prev) => ({ ...prev, is_liked, likes_count }))}
          />
          <View style={styles.statChip}>
            <Ionicons name="chatbubble-outline" size={15} color={colors.textSecondary} />
            <Text style={styles.statText}>{commentsCount}</Text>
          </View>
          <Text style={styles.timestamp}>{postedOn(post.created_at, t)}</Text>
          <SaveButton
            postId={post.id}
            initialSaved={post.is_saved || false}
            onSaveChange={(is_saved) => setPost((prev) => ({ ...prev, is_saved }))}
          />
        </View>

        {/* Caption */}
        {post.caption ? (
          <View style={styles.captionCard}>
            <RichCaption
              style={styles.caption}
              text={post.caption}
              prefix={<Text style={styles.captionAuthor}>{post.user.username} </Text>}
            />
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
                {songTitle || t('music.originalAudio')}
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

      <ImageViewer
        visible={viewerAt != null}
        urls={post.content_type === 'image' ? (post.photos.length ? post.photos : [post.mediaUrl].filter(Boolean)) : []}
        index={viewerAt || 0}
        caption={post.caption || ''}
        author={post.user?.username || ''}
        onClose={() => setViewerAt(null)}
      />

      <CommentAction
        postId={postId}
        commentCount={commentsCount}
        autoOpen={shouldOpenComments}
        // Opened from a notification: the sheet finds this comment (opening
        // its thread if it's a reply), scrolls to it and flashes it.
        highlightCommentId={commentId}
        onCommentPosted={updateCommentsCount}
        commentsEnabled={post?.comments_enabled !== false}
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

  bookFrame: { alignSelf: 'center', borderRadius: radius.md, overflow: 'hidden' },
  mediaFrame: {
    // Cap + center on wide screens (tablets) so the media doesn't stretch huge.
    // width applied inline via useWindowDimensions() so it reflows on resize.
    marginTop: spacing.xs,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: PLACEHOLDER_BG,     // never a black box while loading
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
  dots: {
    position: 'absolute', bottom: 10, alignSelf: 'center', flexDirection: 'row', gap: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.45)' },
  dotActive: { backgroundColor: '#fff' },
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

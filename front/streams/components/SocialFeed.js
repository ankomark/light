import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  Pressable,
  Dimensions,
} from 'react-native';
import { Video, Audio } from 'expo-av';
import { BlurView } from 'expo-blur';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/useAuth';
import { usePlayer } from '../context/PlayerContext';
import SearchBaar from '../components/SearchBaar';
import { fetchSocialPosts } from '../services/api';
import FollowButton from '../components/FollowButton';
import PostActions from './PostActions';
import CommentAction from './CommentAction';
import { DownloadButton, SaveButton, LikeButton } from './SocialActions';
import { PostSkeleton } from './SkeletonLoader';
import StoriesBar from './StoriesBar';
import AudioVisualizer from './AudioVisualizer';
import { colors, radius, typography, shadows } from '../constants/theme';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const AVATAR_FAILED = '__failed__';
const CARD_W = Dimensions.get('window').width - 24; // postContainer marginHorizontal 12 each side

// Compact relative time, e.g. "now", "5m", "3h", "2d", "4w", or a date.
const timeAgo = (dateStr) => {
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  const w = Math.floor(days / 7);
  if (w < 5) return `${w}w`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// Instagram-style aspect-ratio clamp: width:height between 1.91:1 (landscape)
// and 4:5 (portrait, ratio 0.8). Media outside this range is center-cropped
// (resizeMode="cover") rather than driving an arbitrary height — a 4:5 cap keeps
// the tallest post at width/0.8 = 1.25×width, so it never runs past the screen.
const mediaAspectRatio = (width, height) => {
  if (!width || !height) return 1;
  const r = width / height;
  if (!isFinite(r) || r <= 0) return 1;
  return Math.min(1.91, Math.max(0.8, r));
};

const processPost = (post, existingFollowStates = {}) => {
  if (!post.user || typeof post.user !== 'object') {
    post.user = {
      id: 0,
      username: 'Unknown',
      profile_picture: null,
      followers_count: 0,
      is_following: false
    };
  }
  let profilePic = post.user?.profile_picture;
  if (typeof profilePic !== 'string') {
    profilePic = profilePic?.secure_url || profilePic?.url || null;
  }
  if (!profilePic) profilePic = null;

  const existingState = existingFollowStates[post.user?.id];
  const userFollowersCount = typeof existingState?.followers_count === 'number'
    ? existingState.followers_count
    : post.user?.followers_count ?? 0;
  const userIsFollowing = typeof existingState?.is_following === 'boolean'
    ? existingState.is_following
    : post.user?.is_following ?? false;

  // 1–4 image carousel: prefer the per-item gallery URLs (media_items); fall
  // back to the single optimized/media URL for legacy/video posts.
  const itemUrls = (Array.isArray(post.media_items) ? post.media_items : [])
    .map((it) => it?.optimized_url || it?.media_url)
    .filter(Boolean);
  const primaryUrl = itemUrls[0] || post.optimized_url || post.media_url;

  return {
    ...post,
    user: {
      id: post.user?.id || 0,
      username: String(post.user?.username || 'Unknown'),
      profile_picture: profilePic,
      followers_count: userFollowersCount,
      is_following: userIsFollowing
    },
    mediaUrl: primaryUrl,
    thumbnailUrl: primaryUrl,
    mediaItems: itemUrls.length ? itemUrls : (primaryUrl ? [primaryUrl] : []),
  };
};

// Swipeable image carousel for 1–4 image posts. All slides share one aspect
// ratio so the card height is steady as you swipe; dots + a counter show progress.
const FeedCarousel = React.memo(function FeedCarousel({ urls, aspectRatio, onPressSlide }) {
  const [index, setIndex] = useState(0);
  return (
    <View style={[styles.mediaContainer, { aspectRatio }]}>
      <FlatList
        data={urls}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        style={{ width: '100%', height: '100%' }}
        keyExtractor={(_, i) => `slide_${i}`}
        getItemLayout={(_, i) => ({ length: CARD_W, offset: CARD_W * i, index: i })}
        onMomentumScrollEnd={(e) =>
          setIndex(Math.round(e.nativeEvent.contentOffset.x / CARD_W))
        }
        renderItem={({ item: url }) => (
          <Pressable onPress={onPressSlide} disabled={!onPressSlide} style={{ width: CARD_W, height: '100%' }}>
            <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          </Pressable>
        )}
      />
      <BlurView intensity={28} tint="dark" style={styles.carouselCounter} pointerEvents="none">
        <Text style={styles.carouselCounterText}>{index + 1}/{urls.length}</Text>
      </BlurView>
      <View style={styles.carouselDots} pointerEvents="none">
        {urls.map((_, i) => (
          <View key={i} style={[styles.carouselDot, i === index && styles.carouselDotActive]} />
        ))}
      </View>
    </View>
  );
});

const PostMedia = React.memo(function PostMedia({
  item, videoRefs, isFocused, isMuted, onToggleMute,
  isAudioActive, isAudioPlaying, onToggleAudio,
}) {
  const [currentUrl, setCurrentUrl] = useState(item.mediaUrl);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [manualPaused, setManualPaused] = useState(false); // tap-to-pause for video
  const aspectRatio = mediaAspectRatio(item.width, item.height);

  useEffect(() => {
    setCurrentUrl(item.mediaUrl);
    setIsLoading(true);
    setHasError(false);
  }, [item.id, item.mediaUrl]);

  // Resume autoplay next time the video scrolls into focus.
  useEffect(() => {
    if (!isFocused) setManualPaused(false);
  }, [isFocused]);

  const handleError = useCallback(() => {
    if (currentUrl !== item.media_url) {
      setCurrentUrl(item.media_url);
    } else {
      setHasError(true);
      setIsLoading(false);
    }
  }, [currentUrl, item.media_url]);

  const handleLoad = useCallback(() => {
    setIsLoading(false);
  }, []);

  if (!currentUrl || hasError) {
    return (
      <View style={[styles.errorMediaContainer, { aspectRatio: 1 }]}>
        <MaterialIcons name="broken-image" size={48} color={colors.textMuted} />
        <Text style={styles.errorMediaText}>Media unavailable</Text>
        <TouchableOpacity 
          style={styles.retryButton}
          onPress={() => {
            setCurrentUrl(item.mediaUrl);
            setIsLoading(true);
            setHasError(false);
          }}
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (item.content_type === 'video') {
    return (
      <Pressable
        style={[styles.mediaContainer, { aspectRatio }]}
        onPress={isFocused ? () => setManualPaused((p) => !p) : undefined}
      >
        {isLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        )}
        <Video
          ref={ref => ref && (videoRefs.current[item.id] = ref)}
          source={{ uri: currentUrl }}
          style={[styles.media, { aspectRatio }]}
          resizeMode="cover"
          isLooping
          shouldPlay={isFocused && !manualPaused}
          isMuted={isMuted}
          onError={handleError}
          onLoad={handleLoad}
        />
        {/* Tap-to-pause indicator */}
        {isFocused && !isLoading && manualPaused && (
          <View style={styles.audioPausedOverlay} pointerEvents="none">
            <BlurView intensity={32} tint="dark" style={styles.audioPlayBadge}>
              <MaterialIcons name="play-arrow" size={40} color={colors.white} />
            </BlurView>
          </View>
        )}
        {isFocused && !isLoading && (
          <TouchableOpacity
            style={styles.muteButton}
            onPress={onToggleMute}
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
            <MaterialIcons
              name={isMuted ? 'volume-off' : 'volume-up'}
              size={18}
              color={colors.white}
            />
          </TouchableOpacity>
        )}
      </Pressable>
    );
  }

  const hasAudio = item.content_type === 'image' && !!item.song_audio_url;
  const galleryUrls = Array.isArray(item.mediaItems) ? item.mediaItems : [];

  // Multi-image carousel (overlay the audio affordances on top of the pager).
  if (galleryUrls.length > 1) {
    return (
      <View>
        <FeedCarousel
          urls={galleryUrls}
          aspectRatio={aspectRatio}
          onPressSlide={hasAudio ? () => onToggleAudio?.(item) : undefined}
        />
        {hasAudio && isAudioActive && isAudioPlaying && (
          <BlurView intensity={28} tint="dark" style={styles.audioVizPill} pointerEvents="none">
            <MaterialIcons name="music-note" size={16} color={colors.white} />
            <AudioVisualizer playing height={20} />
          </BlurView>
        )}
        {hasAudio && isAudioActive && !isAudioPlaying && (
          <View style={styles.audioPausedOverlay} pointerEvents="none">
            <BlurView intensity={32} tint="dark" style={styles.audioPlayBadge}>
              <MaterialIcons name="play-arrow" size={40} color={colors.white} />
            </BlurView>
          </View>
        )}
      </View>
    );
  }

  return (
    <Pressable
      style={styles.mediaContainer}
      onPress={hasAudio ? () => onToggleAudio?.(item) : undefined}
      disabled={!hasAudio}
    >
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#1DA1F2" />
        </View>
      )}
      <Image
        source={{ uri: currentUrl }}
        style={[styles.media, { aspectRatio }, isLoading && { opacity: 0 }]}
        resizeMode="cover"
        onError={handleError}
        onLoad={handleLoad}
      />

      {/* Accompanying-audio affordances (image posts with a song). */}
      {hasAudio && isAudioActive && isAudioPlaying && (
        <View style={styles.audioVizPill} pointerEvents="none">
          <MaterialIcons name="music-note" size={16} color={colors.white} />
          <AudioVisualizer playing height={20} />
        </View>
      )}
      {hasAudio && isAudioActive && !isAudioPlaying && (
        <View style={styles.audioPausedOverlay} pointerEvents="none">
          <View style={styles.audioPlayBadge}>
            <MaterialIcons name="play-arrow" size={40} color={colors.white} />
          </View>
        </View>
      )}
    </Pressable>
  );
});

const SocialFeed = () => {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [feedType, setFeedType] = useState('following'); // 'following' | 'for_you'
  const [newPostsAvailable, setNewPostsAvailable] = useState(false);
  const [topBarH, setTopBarH] = useState(0);
  const [error, setError] = useState(null);
  const [followStates, setFollowStates] = useState({});
  const navigation = useNavigation();
  const videoRefs = useRef({});
  const audioRef = useRef(null);
  const { currentUser } = useAuth();
  const { pause: pauseMusic } = usePlayer();
  const lastFetchTimeRef = useRef(0);
  const [currentlyPlayingPostId, setCurrentlyPlayingPostId] = useState(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false); // play/pause of attached song
  const playingSongPostIdRef = useRef(null); // mirrors the attached-song post id

  // Video autoplay: the in-view video post drives muted autoplay; mute is shared
  // across all feed videos so the user's choice persists as they scroll.
  const [focusedVideoId, setFocusedVideoId] = useState(null);
  const focusedVideoIdRef = useRef(null);
  const [isMuted, setIsMuted] = useState(true);

  // Stable refs so the (necessarily stable) viewability handler always calls the
  // latest versions without being re-created mid-scroll.
  const playSongRef = useRef(() => {});
  const stopSongRef = useRef(() => {});
  const pauseMusicRef = useRef(() => {});
  pauseMusicRef.current = pauseMusic;

  // Search & feed are resolved server-side. Refs avoid stale closures in the
  // debounced loaders; topPostIdRef powers the lightweight "new posts" check.
  const searchRef = useRef('');
  const debounceRef = useRef(null);
  const flatListRef = useRef(null);
  const topPostIdRef = useRef(null);

  useEffect(() => { topPostIdRef.current = posts[0]?.id ?? null; }, [posts]);

  const loadPosts = useCallback(async (isRefresh = false) => {
    const now = Date.now();
    if (!isRefresh && now - lastFetchTimeRef.current < 1000) return;

    try {
      if (isRefresh) setRefreshing(true); else setLoading(true);
      setError(null);

      // Search is global; otherwise honor the selected feed tab.
      const search = searchRef.current;
      const response = await fetchSocialPosts(1, search ? null : feedType, search);
      const raw = response?.results ?? [];
      const valid = raw.filter(p => p.user && typeof p.user === 'object');
      const processed = valid.map(p => processPost(p, followStates));

      setPosts(processed);
      setPage(1);
      setHasMore(!!response?.next);
      setNewPostsAvailable(false);
      lastFetchTimeRef.current = now;
    } catch (err) {
      setError(err);
      if (!isRefresh) {
        Alert.alert(
          'Error Loading Posts',
          err.response?.status === 500
            ? 'Server error. Please try again later.'
            : 'Failed to load posts. Please check your connection.',
          [{ text: 'OK' }, { text: 'Retry', onPress: () => loadPosts(false) }]
        );
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [followStates, feedType]);

  const loadMorePosts = useCallback(async () => {
    if (loadingMore || !hasMore || loading) return;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const search = searchRef.current;
      const response = await fetchSocialPosts(nextPage, search ? null : feedType, search);
      const raw = response?.results ?? [];
      const processed = raw
        .filter(p => p.user && typeof p.user === 'object')
        .map(p => processPost(p, followStates));
      setPosts(prev => [...prev, ...processed]);
      setPage(nextPage);
      setHasMore(!!response?.next);
    } catch {
      // silent — user can pull-to-refresh
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, loading, page, followStates, feedType]);

  const handleRefresh = useCallback(() => loadPosts(true), [loadPosts]);

  // Debounced server-side search.
  const handleSearch = useCallback((term) => {
    setSearchQuery(term);
    searchRef.current = (term ?? '').trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadPosts(true), 350);
  }, [loadPosts]);

  // Switch between For You (everyone) and Following.
  const selectFeed = useCallback((type) => {
    if (type === feedType) return;
    searchRef.current = '';
    setSearchQuery('');
    lastFetchTimeRef.current = 0; // bypass the throttle so the tab reloads now
    setFeedType(type);
  }, [feedType]);

  // Tap the "new posts" pill: refresh and jump to the top.
  const handleShowNewPosts = useCallback(() => {
    setNewPostsAvailable(false);
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    loadPosts(true);
  }, [loadPosts]);

  // Quietly check page 1 for newer posts instead of replacing the feed mid-scroll.
  const checkForNewPosts = useCallback(async () => {
    if (refreshing || loading || searchRef.current) return;
    try {
      const response = await fetchSocialPosts(1, feedType, '');
      const newest = response?.results?.[0];
      if (newest && topPostIdRef.current && newest.id !== topPostIdRef.current) {
        setNewPostsAvailable(true);
      }
    } catch {
      // ignore — best-effort
    }
  }, [refreshing, loading, feedType]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  useEffect(() => {
    const interval = setInterval(checkForNewPosts, 90000);
    return () => clearInterval(interval);
  }, [checkForNewPosts]);

  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - lastFetchTimeRef.current > 120000) loadPosts();
      // Leaving the screen: pause the focused video and stop attached-song audio.
      return () => {
        focusedVideoIdRef.current = null;
        setFocusedVideoId(null);
        stopSongRef.current?.();
      };
    }, [loadPosts])
  );

  useEffect(() => () => {
    clearTimeout(debounceRef.current);
    if (audioRef.current) audioRef.current.unloadAsync().catch(() => {});
  }, []);

  const stopSong = useCallback(async () => {
    if (audioRef.current) {
      try {
        await audioRef.current.stopAsync();
        await audioRef.current.unloadAsync();
      } catch {
      } finally {
        audioRef.current = null;
        playingSongPostIdRef.current = null;
        setCurrentlyPlayingPostId(null);
        setIsAudioPlaying(false);
      }
    }
  }, []);

  // Plays a post's trimmed audio clip (image posts only), starting at
  // song_start_time and auto-stopping at song_end_time. A focused video always
  // wins over attached-song audio, so callers gate this on there being no video.
  const playSong = useCallback(async (post) => {
    if (!post?.song_audio_url || playingSongPostIdRef.current === post.id) return;
    try {
      if (audioRef.current) await stopSong();
      const { sound } = await Audio.Sound.createAsync(
        { uri: post.song_audio_url },
        { shouldPlay: false, isLooping: true }
      );
      audioRef.current = sound;
      playingSongPostIdRef.current = post.id;
      setCurrentlyPlayingPostId(post.id);
      setIsAudioPlaying(true);
      const start = post.song_start_time || 0;
      await sound.playFromPositionAsync(start * 1000);
      if (post.song_end_time && post.song_end_time > start) {
        // Loop the trimmed window: jump back to the start when the clip ends.
        sound.setOnPlaybackStatusUpdate((status) => {
          if (
            status.isLoaded &&
            status.positionMillis >= post.song_end_time * 1000 &&
            playingSongPostIdRef.current === post.id
          ) {
            sound.setPositionAsync(start * 1000).catch(() => {});
          }
        });
      }
    } catch {
      // Audio failed — continue silently
    }
  }, [stopSong]);

  playSongRef.current = playSong;
  stopSongRef.current = stopSong;

  // Tap-on-image handler: pause/resume the post's accompanying audio. If the clip
  // isn't loaded yet (e.g. tapped before autoplay kicked in), start it.
  const toggleSongPlayback = useCallback(async (post) => {
    if (playingSongPostIdRef.current !== post.id || !audioRef.current) {
      playSongRef.current?.(post);
      return;
    }
    try {
      const status = await audioRef.current.getStatusAsync();
      if (!status.isLoaded) return;
      if (status.isPlaying) {
        await audioRef.current.pauseAsync();
        setIsAudioPlaying(false);
      } else {
        await audioRef.current.playAsync();
        setIsAudioPlaying(true);
      }
    } catch {}
  }, []);

  // Toggle the shared mute for feed videos. Unmuting means real audio, so we
  // silence anything else first: the global music player and attached-song clips.
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      if (!next) {
        pauseMusicRef.current?.();
        stopSongRef.current?.();
      }
      return next;
    });
  }, []);

  // Stable (never re-created) so FlatList doesn't warn about a changing handler.
  // Reads live values through refs/stable setters instead of closing over state.
  const onViewableItemsChanged = useRef(({ viewableItems, changed }) => {
    // The first viewable video post becomes the autoplay target.
    const focusVideo = viewableItems.find(
      v => v.isViewable && v.item?.content_type === 'video'
    );
    const newFocus = focusVideo ? focusVideo.item.id : null;
    if (newFocus !== focusedVideoIdRef.current) {
      focusedVideoIdRef.current = newFocus;
      setFocusedVideoId(newFocus);
      // A video taking focus overrides any attached-song audio.
      if (newFocus != null) stopSongRef.current?.();
    }

    changed.forEach((entry) => {
      const post = entry.item;
      if (!post) return;
      if (entry.isViewable) {
        if (
          post.content_type === 'image' &&
          post.song_audio_url &&
          focusedVideoIdRef.current == null
        ) {
          playSongRef.current?.(post);
        }
      } else if (playingSongPostIdRef.current === post.id) {
        stopSongRef.current?.();
      }
    });
  }).current;

  const viewabilityConfig = useMemo(() => ({
    itemVisiblePercentThreshold: 80,
    waitForInteraction: false,
    minimumViewTime: 100,
  }), []);

  const handleFollowChange = useCallback((data) => {
    setFollowStates(prev => ({
      ...prev,
      [data.id]: {
        is_following: data.is_following,
        followers_count: data.followers_count
      }
    }));
    setPosts(prev => prev.map(post => {
      if (post.user.id === data.id) {
        return {
          ...post,
          user: {
            ...post.user,
            is_following: data.is_following,
            followers_count: data.followers_count ?? post.user.followers_count
          }
        };
      }
      return post;
    }));
  }, []);

  const handlePostUpdate = useCallback(updatedPost => {
    // Editing a post only changes text (caption/tags/location) — never the media
    // or author. The PATCH response can return null optimized_url/media_url, which
    // would blank the image, so we keep the already-rendered media + processed
    // user and overlay just the edited fields.
    setPosts(prev => prev.map(post =>
      post.id === updatedPost.id
        ? {
            ...post,
            ...updatedPost,
            user: post.user,
            mediaUrl: post.mediaUrl,
            thumbnailUrl: post.thumbnailUrl,
            media_url: post.media_url,
            optimized_url: post.optimized_url,
            media_file: post.media_file,
          }
        : post
    ));
  }, []);

  const handlePostDelete = useCallback(postId => {
    setPosts(prev => prev.filter(post => post.id !== postId));
  }, []);

  // Persist a post's saved/favorite state so it survives row re-mounts & refresh.
  const handleSaveChange = useCallback((postId, isSaved) => {
    setPosts(prev => prev.map(post =>
      post.id === postId ? { ...post, is_saved: isSaved } : post
    ));
  }, []);

  // Persist a post's like state + count so it survives row re-mounts & refresh.
  const handleLikeChange = useCallback((postId, { is_liked, likes_count }) => {
    setPosts(prev => prev.map(post =>
      post.id === postId ? { ...post, is_liked, likes_count } : post
    ));
  }, []);

  const renderPostHeader = useCallback(({ item }) => {
    if (!item.user || typeof item.user !== 'object') {
      return null;
    }
    return (
      <View style={styles.postHeader}>
        <TouchableOpacity
          style={styles.userInfo}
          activeOpacity={0.7}
          onPress={() => item.user?.id && navigation.navigate('UserProfile', {
            userId: item.user.id,
            username: item.user.username,
          })}
        >
          <View style={styles.avatarRing}>
            <Image
              source={
                item.user.profile_picture && item.user.profile_picture !== AVATAR_FAILED
                  ? { uri: item.user.profile_picture }
                  : DEFAULT_AVATAR
              }
              defaultSource={DEFAULT_AVATAR}
              style={styles.profileImage}
              onError={() => setPosts(prev => prev.map(p =>
                p.id === item.id
                  ? { ...p, user: { ...p.user, profile_picture: AVATAR_FAILED } }
                  : p
              ))}
            />
          </View>
          <View style={styles.userTextContainer}>
            <Text style={styles.username} numberOfLines={1}>
              {String(item.user.username || 'Unknown user')}
            </Text>
            <Text style={styles.metaText} numberOfLines={1}>
              {timeAgo(item.created_at)}
              {item.location ? `  ·  ${item.location}` : ''}
            </Text>
          </View>
        </TouchableOpacity>
        <View style={styles.headerActions}>
          {currentUser?.id !== item.user.id && (
            <FollowButton 
              userId={item.user.id}
              initialFollowing={item.user.is_following}
              initialFollowersCount={item.user.followers_count}
              onFollowChange={handleFollowChange}
            />
          )}
          <PostActions
            post={item}
            onUpdate={handlePostUpdate}
            onDelete={() => handlePostDelete(item.id)}
          />
        </View>
      </View>
    );
  }, [currentUser?.id, handleFollowChange, handlePostUpdate, handlePostDelete, navigation]);

  const renderPostFooter = useCallback(({ item }) => (
    <View style={styles.postFooter}>
      <View style={styles.actions}>
        <View style={styles.actionsLeft}>
          <LikeButton
            postId={item.id}
            initialLikes={item.likes_count || 0}
            isLiked={item.is_liked || false}
            onLikeChange={(d) => handleLikeChange(item.id, d)}
          />
          <CommentAction
            postId={item.id}
            commentCount={item.comments_count || 0}
            currentUserAvatar={currentUser?.profile_picture}
          />
          <DownloadButton
            mediaUrl={item.mediaUrl}
            contentType={item.content_type}
          />
        </View>
        <SaveButton
          postId={item.id}
          initialSaved={item.is_saved || false}
          onSaveChange={(val) => handleSaveChange(item.id, val)}
        />
      </View>
      <View style={styles.postInfo}>
        {item.caption ? (
          <Text style={styles.caption} numberOfLines={3}>{item.caption}</Text>
        ) : null}
      </View>
    </View>
  ), [currentUser?.profile_picture, handleSaveChange, handleLikeChange]);

  const renderItem = useCallback(({ item }) => (
    <View style={styles.postContainer}>
      {renderPostHeader({ item })}
      <PostMedia
        item={item}
        videoRefs={videoRefs}
        isFocused={focusedVideoId === item.id}
        isMuted={isMuted}
        onToggleMute={toggleMute}
        isAudioActive={currentlyPlayingPostId === item.id}
        isAudioPlaying={currentlyPlayingPostId === item.id ? isAudioPlaying : false}
        onToggleAudio={toggleSongPlayback}
      />
      {renderPostFooter({ item })}
    </View>
  ), [renderPostHeader, renderPostFooter, focusedVideoId, isMuted, toggleMute,
      currentlyPlayingPostId, isAudioPlaying, toggleSongPlayback]);

  const renderEmptyComponent = useCallback(() => {
    if (loading) return null;
    if (error) {
      return (
        <View style={styles.emptyContainer}>
          <MaterialIcons name="error-outline" size={48} color={colors.textMuted} />
          <Text style={styles.errorText}>
            {error.message?.includes('Session expired')
              ? 'Session expired. Please log in again.'
              : error.response?.status === 500
                ? 'Server error. Please try again.'
                : 'Failed to load posts.'}
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => loadPosts()}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (searchQuery) {
      return (
        <View style={styles.emptyContainer}>
          <Feather name="search" size={46} color={colors.textMuted} />
          <Text style={styles.emptyText}>No results for &quot;{searchQuery}&quot;</Text>
        </View>
      );
    }
    if (feedType === 'following') {
      return (
        <View style={styles.emptyContainer}>
          <MaterialIcons name="people-outline" size={48} color={colors.textMuted} />
          <Text style={styles.emptyText}>Your following feed is quiet</Text>
          <Text style={styles.emptySub}>Follow people, or see what everyone&apos;s posting.</Text>
          <TouchableOpacity style={styles.createFirstPostButton} onPress={() => selectFeed('for_you')}>
            <Text style={styles.createFirstPostText}>Explore For You</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <MaterialIcons name="photo-library" size={48} color={colors.textMuted} />
        <Text style={styles.emptyText}>No posts yet</Text>
        <TouchableOpacity style={styles.createFirstPostButton} onPress={() => navigation.navigate('CreatePost')}>
          <Text style={styles.createFirstPostText}>Share Something</Text>
        </TouchableOpacity>
      </View>
    );
  }, [loading, error, searchQuery, feedType, navigation, loadPosts, selectFeed]);

  const keyExtractor = useCallback(item => `post_${item.id}`, []);

  const renderFooter = useCallback(() =>
    loadingMore
      ? <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 16 }} />
      : null
  , [loadingMore]);

  return (
    <View style={styles.container}>
      {/* Frosted glass top bar: search + create, then feed tabs. Stays pinned;
          the stories row lives in the list header so it scrolls away. */}
      <BlurView
        intensity={40}
        tint="dark"
        style={styles.topBar}
        onLayout={(e) => setTopBarH(e.nativeEvent.layout.height)}
      >
        <View style={styles.searchRow}>
          <View style={{ flex: 1 }}>
            <SearchBaar
              onSearch={handleSearch}
              placeholder="Search posts, users, locations..."
            />
          </View>
          <TouchableOpacity
            style={styles.createBtn}
            onPress={() => navigation.navigate('CreatePost')}
            activeOpacity={0.85}
          >
            <MaterialIcons name="add" size={26} color={colors.white} />
          </TouchableOpacity>
        </View>

        {/* Feed tabs (hidden while searching) */}
        {!searchQuery.trim() && (
          <View style={styles.tabs}>
            <TouchableOpacity
              style={[styles.tab, feedType === 'following' && styles.tabActive]}
              onPress={() => selectFeed('following')}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, feedType === 'following' && styles.tabTextActive]}>
                Following
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, feedType === 'for_you' && styles.tabActive]}
              onPress={() => selectFeed('for_you')}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, feedType === 'for_you' && styles.tabTextActive]}>
                For You
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </BlurView>

      {newPostsAvailable && (
        <TouchableOpacity
          style={[styles.newPostsPill, { top: topBarH + 8 }]}
          onPress={handleShowNewPosts}
          activeOpacity={0.85}
        >
          <MaterialIcons name="arrow-upward" size={16} color={colors.white} />
          <Text style={styles.newPostsText}>New posts</Text>
        </TouchableOpacity>
      )}

      <FlatList
        ref={flatListRef}
        data={posts}
        renderItem={renderItem}
        ListHeaderComponent={
          <View>
            {/* Spacer so content starts below the absolute glass bar, then
                scrolls up behind it for the frosted-glass effect. */}
            <View style={{ height: topBarH }} />
            <StoriesBar navigation={navigation} />
          </View>
        }
        ListEmptyComponent={renderEmptyComponent}
        keyExtractor={keyExtractor}
        contentContainerStyle={[
          styles.listContent,
          posts.length === 0 && styles.emptyListContent
        ]}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        progressViewOffset={topBarH}
        showsVerticalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onEndReached={loadMorePosts}
        onEndReachedThreshold={0.5}
        ListFooterComponent={renderFooter}
        maxToRenderPerBatch={5}
        updateCellsBatchingPeriod={100}
        initialNumToRender={5}
        windowSize={10}
      />

      {loading && !refreshing && posts.length === 0 && (
        <View style={styles.skeletonContainer}>
          <PostSkeleton />
          <PostSkeleton />
          <PostSkeleton />
        </View>
      )}
    </View>
  );
};




const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 8,
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: 'rgba(10,22,40,0.55)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    overflow: 'hidden',
    zIndex: 10,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  createBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },

  tabs: {
    flexDirection: 'row',
    paddingTop: 10,
    gap: 8,
  },
  tab: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: colors.card,
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  tabText: {
    ...typography.label,
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: colors.white,
    fontWeight: '700',
  },

  newPostsPill: {
    position: 'absolute',
    top: 8,
    alignSelf: 'center',
    zIndex: 1000,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.full,
    ...shadows.md,
  },
  newPostsText: {
    color: colors.white,
    fontWeight: '700',
    fontSize: 13,
  },

  listContent: {
    paddingBottom: 20,
  },

  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  postContainer: {
    backgroundColor: colors.card,
    borderRadius: 18,
    marginVertical: 8,
    marginHorizontal: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadows.md,
  },

  postHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },

  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },

  avatarRing: {
    width: 46,
    height: 46,
    borderRadius: 23,
    marginRight: 10,
    padding: 2,
    borderWidth: 1.5,
    borderColor: 'rgba(29,161,242,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  profileImage: {
    width: '100%',
    height: '100%',
    borderRadius: 21,
    backgroundColor: colors.surface,
  },

  userTextContainer: {
    justifyContent: 'center',
    flex: 1,
  },

  username: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: 0.2,
  },

  metaText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },

  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  mediaContainer: {
    width: '100%',
    backgroundColor: colors.black,
    justifyContent: 'center',
    alignItems: 'center',
  },

  media: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: colors.black,
  },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },

  muteButton: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    zIndex: 2,
    width: 34,
    height: 34,
    borderRadius: 17,
    overflow: 'hidden',
    backgroundColor: 'rgba(10,22,40,0.35)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  audioVizPill: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: radius.full,
    overflow: 'hidden',
    backgroundColor: 'rgba(10,22,40,0.3)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
  },

  audioPausedOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },

  audioPlayBadge: {
    width: 66,
    height: 66,
    borderRadius: 33,
    overflow: 'hidden',
    backgroundColor: 'rgba(10,22,40,0.3)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  carouselCounter: {
    position: 'absolute',
    top: 10,
    right: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(10,22,40,0.3)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  carouselCounterText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '700',
  },
  carouselDots: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  carouselDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  carouselDotActive: {
    backgroundColor: colors.white,
  },

  errorMediaContainer: {
    width: '100%',
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },

  errorMediaText: {
    color: colors.textMuted,
    marginTop: 8,
    fontSize: 15,
  },

  retryButton: {
    marginTop: 12,
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },

  retryButtonText: {
    color: colors.white,
    fontWeight: '600',
    fontSize: 14,
  },

  postFooter: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 14,
  },

  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  actionsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  postInfo: {
    marginTop: 10,
  },

  caption: {
    fontSize: 14,
    color: colors.textPrimary,
    lineHeight: 20,
  },

  captionUser: {
    fontWeight: '700',
    color: colors.textPrimary,
  },

  location: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 4,
  },

  timestamp: {
    fontSize: 11.5,
    color: colors.textMuted,
  },

  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },

  emptyText: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 12,
  },

  emptySub: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 6,
  },

  errorText: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 12,
  },

  createFirstPostButton: {
    marginTop: 16,
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
  },

  createFirstPostText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },

  topFab: {
    position: 'absolute',
    top: 10,
    right: 14,
    zIndex: 1000,
    backgroundColor: colors.primary,
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.md,
  },

  skeletonContainer: {
    flex: 1,
    paddingTop: 8,
  },
});

export default SocialFeed;
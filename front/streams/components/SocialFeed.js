import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  Pressable,
  Platform,
  AppState,
  Animated,
} from 'react-native';
import { Image } from 'expo-image';
import { createSound } from '../services/audioPlayer';
import AppVideo from './AppVideo';
import BookPostMedia from './BookPostMedia';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import GlassView from './GlassView';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/useAuth';
import { usePlayer } from '../context/PlayerContext';
import { usePreferences } from '../context/PreferencesContext';
import { PREF_KEYS, resolveVideoQuality } from '../utils/preferences';
import { useI18n } from '../context/I18nContext';
import SearchBaar from '../components/SearchBaar';
import { fetchSocialPosts, fetchFeedByUrl, logWatchEvents, markPostsViewed, fetchLatestPostId, likePost } from '../services/api';
import FollowButton from '../components/FollowButton';
import PostActions from './PostActions';
import CommentAction from './CommentAction';
import RichCaption from './RichCaption';
import PendingPosts from './PendingPosts';
import { DownloadButton, SaveButton, LikeButton, ShareButton } from './SocialActions';
import { PostSkeleton } from './SkeletonLoader';
import StoriesBar from './StoriesBar';
import AudioVisualizer from './AudioVisualizer';
import RotatingBackground from './RotatingBackground';
import ScreenVignette from './ScreenVignette';
import formatCount from '../utils/formatCount';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import { on, EVENTS } from '../utils/appEvents';
import { useContentWidth, useMaxMediaHeight, FONT_SCALE } from '../utils/layout';
import { colors, radius, typography, shadows } from '../constants/theme';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const AVATAR_FAILED = '__failed__';

// "Why you're seeing this" chip for the ranked For You feed (backend sends
// feed_reason). Turns the ranking into a visible, made-for-me signal.
// Module scope can't call t(), so these carry a key the render site resolves.
const FEED_REASON = {
  following: { key: 'feed.reason.following', icon: 'people' },
  discovery: { key: 'feed.reason.discovery', icon: 'explore' },
  trending: { key: 'feed.reason.trending', icon: 'trending-up' },
};
// Post card width: full width minus the 12px side margins on a phone, capped to
// a centered column on tablets/web. Now the shared app-wide rule (utils/layout)
// rather than a private constant, so the music library and the mini player
// centre to the same column instead of stretching.
const useCardWidth = () => useContentWidth({ gutter: 24 }).width;

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

// Size the card to each image's true width:height so it shows uncropped, the way
// it was uploaded. Only a generous safety guard remains — ratios are clamped to
// [0.5, 1.91] so an extreme panorama can't crop and a pathological ultra-tall
// image (max height = 2×width) can't run past the screen. Real photos (9:16
// portrait = 0.5625 through 16:9 landscape = 1.78) fall inside and render whole.
const mediaAspectRatio = (width, height) => {
  if (!width || !height) return 1;
  const r = width / height;
  if (!isFinite(r) || r <= 0) return 1;
  return Math.min(1.91, Math.max(0.5, r));
};

// One cached payload per (account, tab). Keyed by account so a second login on
// a shared phone never paints the previous user's feed, and by tab because For
// You and Following are different lists — sharing a key would flash the wrong
// one every time the user switches.
const feedCacheKey = (userId, feedType) => userKey(userId, `feed:${feedType}`);

// The tab the app lands on. Named because the cached first paint below has to
// read the same tab the feed is about to show — two places agreeing by
// coincidence is how a stale Following feed ends up flashing under For You.
const DEFAULT_FEED_TYPE = 'for_you';

// How stale a feed may be and still be worth painting instantly. Half an hour
// of drift on a social feed is invisible — the revalidation lands a moment
// later anyway — but a day-old feed opening as if it were current is not.
const FEED_MAX_AGE_MS = 30 * 60 * 1000;

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
  const mediaList = Array.isArray(post.media_items) ? post.media_items : [];
  const itemUrls = mediaList
    .map((it) => it?.optimized_url || it?.media_url)
    .filter(Boolean);
  const primaryUrl = itemUrls[0] || post.optimized_url || post.media_url;

  // Primary media dimensions, resolved synchronously so the card mounts at the
  // right aspect ratio (uncropped) with no post-load resize/jitter. Prefer the
  // top-level width/height, then the first gallery item's — both are served by
  // the API (see the social serializer).
  const primaryItem = mediaList[0] || null;
  const primaryW = Number(post.width) || Number(primaryItem?.width) || null;
  const primaryH = Number(post.height) || Number(primaryItem?.height) || null;

  // Video poster: use the stored thumbnail_url (a real image). primaryUrl for a
  // video is the .mp4, which can't render in <Image>, so it's not a valid poster.
  const isVideo = post.content_type === 'video';
  const posterUrl = isVideo ? (post.thumbnail_url || null) : primaryUrl;

  return {
    ...post,
    user: {
      id: post.user?.id || 0,
      username: String(post.user?.username || 'Unknown'),
      profile_picture: profilePic,
      followers_count: userFollowersCount,
      is_following: userIsFollowing
    },
    width: primaryW,
    height: primaryH,
    mediaUrl: primaryUrl,
    thumbnailUrl: posterUrl,
    mediaItems: itemUrls.length ? itemUrls : (primaryUrl ? [primaryUrl] : []),
  };
};

// Swipeable image carousel for 1–4 image posts. All slides share one aspect
// ratio so the card height is steady as you swipe; dots + a counter show progress.
const FeedCarousel = React.memo(function FeedCarousel({ urls, aspectRatio, onPressSlide }) {
  const [index, setIndex] = useState(0);
  const cardW = useCardWidth();
  return (
    <View style={[styles.mediaContainer, { aspectRatio }]}>
      <FlatList
        data={urls}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        style={{ width: '100%', height: '100%' }}
        keyExtractor={(_, i) => `slide_${i}`}
        getItemLayout={(_, i) => ({ length: cardW, offset: cardW * i, index: i })}
        onMomentumScrollEnd={(e) =>
          setIndex(Math.round(e.nativeEvent.contentOffset.x / cardW))
        }
        renderItem={({ item: url }) => (
          <Pressable onPress={onPressSlide} disabled={!onPressSlide} style={{ width: cardW, height: '100%' }}>
            <Image
              source={{ uri: url }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
              transition={150}
              cachePolicy="memory-disk"
              recyclingKey={url}
            />
          </Pressable>
        )}
      />
      <GlassView intensity={28} tint="dark" style={styles.carouselCounter} pointerEvents="none">
        <Text style={styles.carouselCounterText} maxFontSizeMultiplier={FONT_SCALE.tight}>{index + 1}/{urls.length}</Text>
      </GlassView>
      <View style={styles.carouselDots} pointerEvents="none">
        {urls.map((_, i) => (
          <View key={i} style={[styles.carouselDot, i === index && styles.carouselDotActive]} />
        ))}
      </View>
    </View>
  );
});

// Instagram-style heart burst shown over the media on a double-tap-to-like.
const HeartBurst = ({ scale }) => (
  <Animated.View
    style={[styles.heartBurst, { opacity: scale, transform: [{ scale }] }]}
    pointerEvents="none"
  >
    <MaterialIcons name="favorite" size={96} color="rgba(255,255,255,0.95)" />
  </Animated.View>
);

const PostMedia = React.memo(function PostMedia({
  item, isFocused, isMuted, onToggleMute,
  isAudioActive, isAudioPlaying, onToggleAudio, onDoubleTapLike,
}) {
  const { preferences } = usePreferences();
  // One resolver drives autoplay and buffering, so "Data saver" and the Video
  // quality tiers stay consistent.
  const { t } = useI18n();
  const quality = resolveVideoQuality(
    preferences[PREF_KEYS.videoQuality],
    preferences[PREF_KEYS.dataSaver],
  );
  // Honor the user's "Autoplay videos" choice; the data-saver tier also
  // suppresses autoplay so videos only stream when the user taps to play.
  const autoplay = !!preferences[PREF_KEYS.autoplayVideo] && quality.autoplayAllowed;

  const [currentUrl, setCurrentUrl] = useState(item.mediaUrl);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  // Video-only: the poster stays painted on top of the <Video> until the decoder
  // has a real first frame to show (onReadyForDisplay). This kills the black flash
  // between the thumbnail and playback — see the video branch below.
  const [videoReady, setVideoReady] = useState(false);
  const posterFade = useRef(new Animated.Value(1)).current;
  // When autoplay is off, the video starts paused; tap toggles play/pause.
  const [manualPaused, setManualPaused] = useState(!autoplay);
  // The post's own ratio, then floored so the card can never be taller than the
  // viewport allows. Without the floor an extreme portrait runs several screens
  // tall for a single post on a short viewport (split screen, a foldable's
  // cover display, any unlocked landscape surface) and the feed stops reading
  // as a feed — you can't see that anything follows. contentFit="cover" centre-
  // crops the overflow, which is what every feed does at the extremes.
  const cardW = useCardWidth();
  const maxMediaH = useMaxMediaHeight();
  const aspectRatio = useMemo(() => {
    const raw = mediaAspectRatio(item.width, item.height);
    const tallestAllowed = maxMediaH > 0 ? cardW / maxMediaH : 0;
    return Math.max(raw, tallestAllowed);
  }, [item.width, item.height, cardW, maxMediaH]);

  useEffect(() => {
    setCurrentUrl(item.mediaUrl);
    setIsLoading(true);
    setHasError(false);
    setVideoReady(false);
    posterFade.setValue(1);
  }, [item.id, item.mediaUrl, posterFade]);

  // Apply the autoplay-derived default whenever focus changes OR the preference
  // is toggled — so flipping "Autoplay videos" in Settings immediately plays/
  // pauses the on-screen video. A manual tap only changes manualPaused (not these
  // deps), so user taps while focused are preserved until the next scroll/toggle.
  // Losing focus unmounts the <Video>, so re-show the poster for the next focus.
  useEffect(() => {
    setManualPaused(!autoplay);
    if (!isFocused) {
      setVideoReady(false);
      posterFade.setValue(1);
    }
  }, [isFocused, autoplay, posterFade]);

  // First frame is decoded and on-screen — fade the poster out over it so the
  // hand-off from thumbnail to video is seamless instead of a black cut.
  const revealVideo = useCallback(() => {
    setIsLoading(false);
    Animated.timing(posterFade, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(() => setVideoReady(true));
  }, [posterFade]);

  // Fallback: some Android builds don't emit onReadyForDisplay for a video that
  // mounts paused (autoplay off). onLoad still fires, and the paused first frame
  // is already rendered, so reveal it here too — but only when paused, so the
  // autoplaying case still waits for the true first-frame signal below.
  const handleVideoLoad = useCallback(() => {
    setIsLoading(false);
    if (manualPaused) revealVideo();
  }, [manualPaused, revealVideo]);

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

  // Double-tap-to-like: heart burst + haptic + like (never unlikes — a
  // double-tap only ever adds a like, Instagram-style).
  const heartScale = useRef(new Animated.Value(0)).current;
  const tapStateRef = useRef({ t: 0, timer: null });
  const burstLike = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    heartScale.setValue(0);
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1, friction: 4, useNativeDriver: true }),
      Animated.timing(heartScale, { toValue: 0, duration: 250, delay: 350, useNativeDriver: true }),
    ]).start();
    onDoubleTapLike?.(item);
  }, [heartScale, onDoubleTapLike, item]);

  // A single tap runs `singleAction` after a short delay unless a second tap
  // arrives first (which fires the like instead).
  const handleTap = useCallback((singleAction) => {
    const s = tapStateRef.current;
    const now = Date.now();
    if (now - s.t < 280) {
      if (s.timer) { clearTimeout(s.timer); s.timer = null; }
      s.t = 0;
      burstLike();
    } else {
      s.t = now;
      if (singleAction) s.timer = setTimeout(() => { s.timer = null; singleAction(); }, 280);
    }
  }, [burstLike]);

  // Video tap handling via gesture-handler: reliable single/double-tap
  // discrimination over the native VideoView (the setTimeout+onPress approach the
  // image branch uses is flaky on top of the native video surface). A drag past
  // the tap slop cancels both, so vertical scrolling still passes to the FlatList.
  const videoTapGesture = useMemo(() => {
    const singleTap = Gesture.Tap()
      .maxDuration(250)
      .runOnJS(true)
      .onEnd(() => setManualPaused((p) => !p));
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDuration(250)
      .runOnJS(true)
      .onEnd(() => burstLike());
    return Gesture.Exclusive(doubleTap, singleTap);
  }, [burstLike]);

  if (!currentUrl || hasError) {
    return (
      <View style={[styles.errorMediaContainer, { aspectRatio: 1 }]}>
        <MaterialIcons name="broken-image" size={48} color={colors.textMuted} />
        <Text style={styles.errorMediaText}>{t('feed.mediaUnavailable')}</Text>
        <TouchableOpacity 
          style={styles.retryButton}
          onPress={() => {
            setCurrentUrl(item.mediaUrl);
            setIsLoading(true);
            setHasError(false);
          }}
        >
          <Text style={styles.retryButtonText}>{t('feed.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (item.content_type === 'video') {
    // CRASH GUARD: only the focused card mounts a real <Video> (a native
    // decoder). Off-screen video cards show a lightweight poster image instead,
    // so we never hold more than ~1 decoder — Android has a hard decoder limit
    // and exceeding it crashes the app on a video-heavy feed.
    if (!isFocused) {
      return (
        <View style={[styles.mediaContainer, { aspectRatio }]}>
          {item.thumbnailUrl ? (
            <Image
              source={{ uri: item.thumbnailUrl }}
              style={[styles.media, { aspectRatio }]}
              contentFit="cover"
              transition={150}
              cachePolicy="memory-disk"
              recyclingKey={String(item.id)}
            />
          ) : (
            <View style={[styles.media, styles.videoPosterFallback, { aspectRatio }]} />
          )}
          <View style={styles.audioPausedOverlay} pointerEvents="none">
            <GlassView intensity={32} tint="dark" style={styles.audioPlayBadge}>
              <MaterialIcons name="play-arrow" size={40} color={colors.white} />
            </GlassView>
          </View>
        </View>
      );
    }

    // There is only ONE rendition today: R2 has no delivery-transform tier, so
    // the serializer returns the same URL for media_url and optimized_url.
    // Quality rides on buffering/autoplay (resolveVideoQuality) instead of file
    // choice; preferring optimized_url means this starts picking the lighter
    // file automatically once renditions exist. If an onError already swapped
    // currentUrl to media_url, stick with that.
    const videoUri = currentUrl === item.media_url
      ? item.media_url
      : quality.tier === 'data_saver'
        ? (item.optimized_url || item.media_url)
        : (item.media_url || item.optimized_url);
    return (
      <View style={[styles.mediaContainer, { aspectRatio }]}>
        <AppVideo
          source={{ uri: videoUri }}
          style={[styles.media, { aspectRatio }]}
          resizeMode="cover"
          isLooping
          shouldPlay={isFocused && !manualPaused}
          isMuted={isMuted}
          bufferOptions={quality.bufferOptions}
          onError={handleError}
          onLoad={handleVideoLoad}
          onReadyForDisplay={revealVideo}
        />
        {/* Poster held on top of the <Video> until the first frame is decoded,
            then faded out — so the crisp thumbnail is what the user sees during
            buffering instead of a black rectangle. */}
        {!videoReady && item.thumbnailUrl && (
          <Animated.View
            style={[styles.videoPosterOverlay, { opacity: posterFade }]}
            pointerEvents="none"
          >
            <Image
              source={{ uri: item.thumbnailUrl }}
              style={[styles.media, { aspectRatio }]}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={String(item.id)}
            />
          </Animated.View>
        )}
        {/* Buffering spinner sits over the poster, not a black screen. */}
        {isLoading && (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        )}
        {/* Transparent tap layer ON TOP of the native VideoView, which swallows
            touches on Android (so a parent Pressable never sees them). Handles
            tap-to-pause + double-tap-to-like via gesture-handler. The mute button
            renders after this, so it stays on top and tappable. */}
        <GestureDetector gesture={videoTapGesture}>
          <View style={StyleSheet.absoluteFill} />
        </GestureDetector>
        {/* Tap-to-pause indicator */}
        {isFocused && videoReady && manualPaused && (
          <View style={styles.audioPausedOverlay} pointerEvents="none">
            <GlassView intensity={32} tint="dark" style={styles.audioPlayBadge}>
              <MaterialIcons name="play-arrow" size={40} color={colors.white} />
            </GlassView>
          </View>
        )}
        {isFocused && videoReady && (
          <TouchableOpacity
            style={styles.muteButton}
            onPress={onToggleMute}
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <GlassView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
            <MaterialIcons
              name={isMuted ? 'volume-off' : 'volume-up'}
              size={18}
              color={colors.white}
            />
          </TouchableOpacity>
        )}
        <HeartBurst scale={heartScale} />
      </View>
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
          onPressSlide={() => handleTap(hasAudio ? () => onToggleAudio?.(item) : null)}
        />
        <HeartBurst scale={heartScale} />
        {hasAudio && isAudioActive && isAudioPlaying && (
          <GlassView intensity={28} tint="dark" style={styles.audioVizPill} pointerEvents="none">
            <MaterialIcons name="music-note" size={16} color={colors.white} />
            <AudioVisualizer playing height={20} />
          </GlassView>
        )}
        {hasAudio && isAudioActive && !isAudioPlaying && (
          <View style={styles.audioPausedOverlay} pointerEvents="none">
            <GlassView intensity={32} tint="dark" style={styles.audioPlayBadge}>
              <MaterialIcons name="play-arrow" size={40} color={colors.white} />
            </GlassView>
          </View>
        )}
      </View>
    );
  }

  return (
    <Pressable
      style={styles.mediaContainer}
      onPress={() => handleTap(hasAudio ? () => onToggleAudio?.(item) : null)}
    >
      {/* No spinner and no opacity-0 here any more. The card already reserves
          the image's exact aspect ratio, the feed prefetched this URL when the
          page landed, and expo-image fades in from its own cache — so hiding
          the image until onLoad fired was showing a spinner over a picture that
          was ready to draw. The reserved box means nothing below it shifts. */}
      <Image
        source={{ uri: currentUrl }}
        style={[styles.media, { aspectRatio }]}
        contentFit="cover"
        transition={150}
        // Keep decoded bitmaps in memory as well as on disk: scrolling back up
        // then re-paints instead of re-decoding from the file.
        cachePolicy="memory-disk"
        // FlatList recycles cells. Without this, a recycled cell keeps drawing
        // the previous post's photo until the new one decodes — the flash of
        // "wrong image" people read as jank.
        recyclingKey={String(item.id)}
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
      <HeartBurst scale={heartScale} />
    </Pressable>
  );
});

// One feed card, memoized.
//
// `renderItem` has to depend on the focus/audio state, which changes on every
// scroll as posts come into view — and when renderItem's identity changes,
// FlatList re-renders every visible cell. Without a component boundary here,
// that meant rebuilding each card's whole header and footer subtree (avatar,
// follow button, like/save/share/comment/download) several times a second
// while scrolling.
//
// With it, a cell re-render is just recreating this element and a shallow prop
// compare; only the one or two cards whose focus actually changed do real work.
// Hence the primitives rather than an object: `isFocused` and `isAudioActive`
// are resolved by the caller so this compares cheaply.
const PostCard = React.memo(function PostCard({
  item, cardW, isFocused, isMuted, isAudioActive, isAudioPlaying,
  onToggleMute, onToggleAudio, onDoubleTapLike, renderHeader, renderFooter,
}) {
  return (
    <View style={[styles.postContainer, { width: cardW }]}>
      {renderHeader({ item })}
      {item.content_type === 'book' ? (
        <BookPostMedia item={item} width={cardW} onDoubleTapLike={onDoubleTapLike} />
      ) : (
        <PostMedia
          item={item}
          isFocused={isFocused}
          isMuted={isMuted}
          onToggleMute={onToggleMute}
          isAudioActive={isAudioActive}
          isAudioPlaying={isAudioPlaying}
          onToggleAudio={onToggleAudio}
          onDoubleTapLike={onDoubleTapLike}
        />
      )}
      {renderFooter({ item })}
    </View>
  );
});

const SocialFeed = ({ showBackground = true }) => {
  const { t } = useI18n();
  const cardW = useCardWidth();
  const { currentUser: _cu } = useAuth();
  // Paint whatever this session already has for this tab, with no await at all:
  // a tab switch back to Home is then a plain re-render, not a fetch-and-flash.
  // A cold start misses here and is filled by the disk read in the effect below.
  const [posts, setPosts] = useState(
    () => peekCache(feedCacheKey(_cu?.id, DEFAULT_FEED_TYPE)) ?? []
  );
  // `loading` now means "nothing to show yet", not "a request is in flight".
  // With rows already on screen the refresh happens behind them, so the
  // skeleton — which is what the user reads as slowness — never appears.
  const [loading, setLoading] = useState(() => posts.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextUrl, setNextUrl] = useState(null); // full `next` URL for the next page
  const [hasMore, setHasMore] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [feedType, setFeedType] = useState(DEFAULT_FEED_TYPE); // 'following' | 'for_you' — land on the ranked feed
  const [newPostsAvailable, setNewPostsAvailable] = useState(false);
  const [topBarH, setTopBarH] = useState(0);
  const [error, setError] = useState(null);
  // Local follow overrides, applied to freshly-fetched rows so a follow the user
  // just made isn't undone by a page that was already in flight.
  //
  // This is a ref, NOT state, and that is the whole point: as state it sat in
  // loadPosts's dependency list, so every Follow tap re-created loadPosts, which
  // re-ran the mount effect below, which refetched the entire feed and threw the
  // user back to the top. The visible post rows are patched directly by
  // handleFollowChange's setPosts — this map only needs to survive, not to
  // re-render anything.
  const followStatesRef = useRef({});
  const navigation = useNavigation();
  const audioRef = useRef(null);
  const currentUser = _cu;
  const { pause: pauseMusic } = usePlayer();
  const { preferences } = usePreferences();
  const lastFetchTimeRef = useRef(0);

  // Warm the image cache for a freshly-loaded batch so posts appear instantly as
  // the user scrolls into them. Skipped under Data saver (don't pre-download on a
  // metered connection). Best-effort — prefetch failures are ignored.
  // Read through a ref: `preferences` flips once from defaults to the stored
  // values just after boot, and as a dependency that rebuilt prefetchMedia,
  // then loadPosts, then re-ran the mount effect — a second full feed fetch
  // during the slowest moment of startup.
  const dataSaverRef = useRef(false);
  dataSaverRef.current = !!preferences[PREF_KEYS.dataSaver];
  const prefetchMedia = useCallback((list) => {
    if (dataSaverRef.current) return;
    const urls = [];
    for (const p of list) {
      if (p.content_type === 'video') {
        if (p.thumbnailUrl) urls.push(p.thumbnailUrl);
      } else if (p.mediaUrl) {
        urls.push(p.mediaUrl);
      }
      const pic = p.user?.profile_picture;
      if (pic && pic !== AVATAR_FAILED) urls.push(pic);
    }
    if (urls.length) Image.prefetch(urls).catch(() => {});
  }, []);
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

  // Watch-time (dwell) tracking: enter-time per post + a batched send buffer.
  const viewStartRef = useRef({});          // postId -> ms timestamp entered view
  const watchBufferRef = useRef([]);        // [{ post_id, dwell_ms }] pending upload

  // View counting, batched on the same flush as dwell. `seen` is the session
  // guard: a post scrolled past twice only reports once, so we don't spend
  // requests on views the server's per-viewer cooldown would drop anyway.
  const viewBufferRef = useRef([]);         // [postId] pending upload
  const seenPostsRef = useRef(new Set());

  // Send buffered dwell events (best-effort). closeOpen finalizes posts still in
  // view — used when leaving the screen / backgrounding.
  const flushWatch = useCallback((closeOpen = false) => {
    if (closeOpen) {
      const now = Date.now();
      Object.entries(viewStartRef.current).forEach(([id, start]) => {
        const dwell = now - start;
        if (dwell >= 500) watchBufferRef.current.push({ post_id: Number(id), dwell_ms: dwell });
      });
      viewStartRef.current = {};
    }
    const views = viewBufferRef.current;
    if (views.length) {
      viewBufferRef.current = [];
      markPostsViewed(views).catch(() => {});
    }
    const events = watchBufferRef.current;
    if (!events.length) return;
    watchBufferRef.current = [];
    logWatchEvents(events).catch(() => {});
  }, []);

  // Mirrors `posts` for callbacks that need the current length but must not be
  // re-created when it changes (loadPosts is one — see followStatesRef).
  const postsRef = useRef(posts);
  useEffect(() => {
    postsRef.current = posts;
    topPostIdRef.current = posts[0]?.id ?? null;
  }, [posts]);

  const cacheKey = useMemo(
    () => feedCacheKey(currentUser?.id, feedType),
    [currentUser?.id, feedType],
  );

  // Which cache key the rows currently on screen came from. Without this, the
  // hydration below can't tell "we already have the right rows" from "we have
  // the OTHER tab's rows" — and switching For You <-> Following left the
  // previous tab's posts on screen until the network answered, which is both
  // wrong content and the slowest possible way to show it.
  const postsKeyRef = useRef(null);

  // Fill from disk on a cold start, on a tab this session hasn't shown yet, and
  // whenever the rows on screen belong to a different tab. Rows fetched for THIS
  // key always win — the peek above and any landed response are fresher than a
  // slower disk read.
  useEffect(() => {
    let cancelled = false;
    if (searchRef.current) return undefined;
    const key = cacheKey;
    readCache(key, FEED_MAX_AGE_MS).then((cached) => {
      if (cancelled || !Array.isArray(cached) || !cached.length) return;
      setPosts((prev) => {
        if (prev.length && postsKeyRef.current === key) return prev;
        postsKeyRef.current = key;
        return cached;
      });
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [cacheKey]);

  // Switching tabs: drop the outgoing tab's rows immediately rather than
  // leaving them under the new tab's header. The hydration above repaints from
  // cache on the next tick when there is one, so this is a flash of skeleton
  // only for a tab that has never been opened.
  useEffect(() => {
    if (postsKeyRef.current && postsKeyRef.current !== cacheKey) {
      setPosts((prev) => (prev.length ? [] : prev));
      setLoading(true);
    }
  }, [cacheKey]);

  const loadPosts = useCallback(async (isRefresh = false) => {
    const now = Date.now();
    if (!isRefresh && now - lastFetchTimeRef.current < 1000) return;

    try {
      // Only claim "loading" when there is genuinely nothing on screen. With
      // rows already painted this is a silent background revalidation, which is
      // the difference between a feed that flashes and one that just updates.
      if (isRefresh) setRefreshing(true);
      else setLoading((wasLoading) => wasLoading && postsRef.current.length === 0);
      setError(null);

      // Search is global; otherwise honor the selected feed tab. Pull-to-refresh
      // bypasses the server's short feed cache so it's always live.
      const search = searchRef.current;
      // For You is the ranked feed (?rank=1); Following stays chronological.
      const useRank = !search && feedType === 'for_you';
      const response = await fetchSocialPosts(null, search ? null : feedType, search, { fresh: isRefresh, rank: useRank });
      const raw = response?.results ?? [];
      const valid = raw.filter(p => p.user && typeof p.user === 'object');
      const processed = valid.map(p => processPost(p, followStatesRef.current));

      setPosts(processed);
      postsKeyRef.current = search ? null : cacheKey;
      prefetchMedia(processed);
      setNextUrl(response?.next ?? null);
      setHasMore(!!response?.next);
      setNewPostsAvailable(false);
      lastFetchTimeRef.current = now;
      // Only page one, never a search result, and never before we know who the
      // viewer is — a write under the anonymous key would be a payload no
      // signed-in session ever reads back.
      if (!search && processed.length && currentUser?.id) {
        writeCache(cacheKey, processed);
      }
    } catch (err) {
      setError(err);
      if (!isRefresh) {
        Alert.alert(
          t('feed.loadErrorTitle'),
          err.response?.status === 500
            ? t('feed.loadErrorServer')
            : t('feed.loadErrorNetwork'),
          [{ text: 'OK' }, { text: 'Retry', onPress: () => loadPosts(false) }]
        );
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [feedType, prefetchMedia, cacheKey, currentUser?.id, t]);

  // A background upload just finished: put the post at the top of this feed
  // now. The feed only revalidates every couple of minutes, so without this
  // the author would come back to a feed that doesn't have their post yet.
  useEffect(() => on(EVENTS.POST_CREATED, (post) => {
    if (!post?.id || searchRef.current) return;
    if (!post.user || typeof post.user !== 'object') {
      loadPosts(true);  // unexpected shape — fall back to a real refresh
      return;
    }
    const row = processPost(post, followStatesRef.current);
    setPosts((prev) => {
      const next = [row, ...prev.filter((p) => p.id !== row.id)];
      if (postsKeyRef.current === cacheKey) writeCache(cacheKey, next.slice(0, 20));
      return next;
    });
  }), [loadPosts, cacheKey]);

  const loadMorePosts = useCallback(async () => {
    if (loadingMore || !hasMore || loading || !nextUrl) return;
    setLoadingMore(true);
    try {
      // Follow the server's `next` link — carries the feed's mode + pagination
      // style (page for ranked, cursor for chronological).
      const response = await fetchFeedByUrl(nextUrl);
      const raw = response?.results ?? [];
      const processed = raw
        .filter(p => p.user && typeof p.user === 'object')
        .map(p => processPost(p, followStatesRef.current));
      setPosts(prev => [...prev, ...processed]);
      prefetchMedia(processed);
      setNextUrl(response?.next ?? null);
      setHasMore(!!response?.next);
    } catch {
      // silent — user can pull-to-refresh
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, loading, nextUrl, prefetchMedia]);

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

  // Quietly probe for newer posts. Only meaningful on the chronological
  // Following tab — For You is ranked (not newest-first), so a "new posts" pill
  // there would be misleading; pull-to-refresh recomputes it instead. Uses the
  // lightweight /latest/ endpoint (just the newest id) — no full feed fetch.
  const checkForNewPosts = useCallback(async () => {
    if (refreshing || loading || searchRef.current || feedType !== 'following') return;
    try {
      const response = await fetchLatestPostId('following');
      const latestId = response?.latest_id;
      if (latestId && topPostIdRef.current && latestId !== topPostIdRef.current) {
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

  // Flush dwell events periodically, on background, and on unmount.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') flushWatch(true);
    });
    const iv = setInterval(() => flushWatch(false), 30000);
    return () => { sub.remove(); clearInterval(iv); flushWatch(true); };
  }, [flushWatch]);

  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - lastFetchTimeRef.current > 120000) loadPosts();
      // Leaving the screen: pause the focused video, stop audio, send dwell.
      return () => {
        focusedVideoIdRef.current = null;
        setFocusedVideoId(null);
        stopSongRef.current?.();
        flushWatch(true);
      };
    }, [loadPosts, flushWatch])
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
      const { sound } = await createSound(
        { uri: post.song_audio_url },
        { shouldPlay: false, isLooping: true }
      );
      audioRef.current = sound;
      playingSongPostIdRef.current = post.id;
      setCurrentlyPlayingPostId(post.id);
      setIsAudioPlaying(true);
      // Paused because another sound started (music player, a voice note):
      // show it as paused; a tap on the post resumes it.
      sound.setOnFocusLost(() => setIsAudioPlaying(false));
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
        // Start the dwell timer for this post.
        viewStartRef.current[post.id] = Date.now();
        // Becoming viewable (80% on screen for 100ms, per viewabilityConfig)
        // is the view. Once per post per session; the buffer flushes with dwell.
        if (!seenPostsRef.current.has(post.id)) {
          seenPostsRef.current.add(post.id);
          viewBufferRef.current.push(post.id);
        }
        if (
          post.content_type === 'image' &&
          post.song_audio_url &&
          focusedVideoIdRef.current == null
        ) {
          playSongRef.current?.(post);
        }
      } else {
        // Left view: bank the dwell time.
        const started = viewStartRef.current[post.id];
        if (started) {
          const dwell = Date.now() - started;
          delete viewStartRef.current[post.id];
          if (dwell >= 500) watchBufferRef.current.push({ post_id: post.id, dwell_ms: dwell });
        }
        if (playingSongPostIdRef.current === post.id) {
          stopSongRef.current?.();
        }
      }
    });
  }).current;

  const viewabilityConfig = useMemo(() => ({
    itemVisiblePercentThreshold: 80,
    waitForInteraction: false,
    minimumViewTime: 100,
  }), []);

  const handleFollowChange = useCallback((data) => {
    followStatesRef.current = {
      ...followStatesRef.current,
      [data.id]: {
        is_following: data.is_following,
        followers_count: data.followers_count
      }
    };
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

  // Double-tap-to-like: only ever ADDS a like (never toggles off). Optimistic +
  // reconciled; the like button reflects it via the post's is_liked/likes_count.
  const handleDoubleTapLike = useCallback((post) => {
    if (!post || post.is_liked) return;  // already liked — burst only, no API
    handleLikeChange(post.id, { is_liked: true, likes_count: (post.likes_count || 0) + 1 });
    likePost(post.id)
      .then((res) => {
        if (typeof res?.is_liked === 'boolean' && typeof res?.likes_count === 'number') {
          handleLikeChange(post.id, { is_liked: res.is_liked, likes_count: res.likes_count });
        }
      })
      .catch(() => {
        handleLikeChange(post.id, { is_liked: false, likes_count: post.likes_count || 0 });
      });
  }, [handleLikeChange]);

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
              placeholder={DEFAULT_AVATAR}
              contentFit="cover"
              transition={150}
              cachePolicy="memory-disk"
              recyclingKey={`avatar_${item.user.id}`}
              style={styles.profileImage}
              onError={() => setPosts(prev => prev.map(p =>
                p.id === item.id
                  ? { ...p, user: { ...p.user, profile_picture: AVATAR_FAILED } }
                  : p
              ))}
            />
          </View>
          <View style={styles.userTextContainer}>
            <Text style={styles.username} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE.chrome}>
              {String(item.user.username || 'Unknown user')}
            </Text>
            <Text style={styles.metaText} numberOfLines={1}>
              {timeAgo(item.created_at)}
              {item.location ? `  ·  ${item.location}` : ''}
            </Text>
            {FEED_REASON[item.feed_reason] && (
              <View style={styles.reasonChip}>
                <MaterialIcons
                  name={FEED_REASON[item.feed_reason].icon}
                  size={11}
                  color={colors.primary}
                />
                <Text style={styles.reasonChipText} numberOfLines={1}>
                  {t(FEED_REASON[item.feed_reason].key)}
                </Text>
              </View>
            )}
            {/* Who can see it — only worth saying when it isn't everyone. */}
            {item.visibility && item.visibility !== 'public' && (
              <View style={styles.reasonChip}>
                <MaterialIcons name={item.visibility === 'private' ? 'lock' : 'people'} size={11} color={colors.primary} />
                <Text style={styles.reasonChipText} numberOfLines={1}>
                  {t(item.visibility === 'private' ? 'create.post.visPrivate' : 'create.post.visFollowers')}
                </Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
        <View style={styles.headerActions}>
          {currentUser?.id !== item.user.id && !item.user.is_following && (
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
            onNotInterested={() => handlePostDelete(item.id)}
          />
        </View>
      </View>
    );
  }, [currentUser?.id, handleFollowChange, handlePostUpdate, handlePostDelete, navigation, t]);

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
            commentsEnabled={item.comments_enabled !== false}
          />
          <ShareButton
            postId={item.id}
            caption={item.caption}
            username={item.user?.username}
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
        <View style={styles.viewsRow}>
          <MaterialIcons name="play-arrow" size={14} color={colors.textMuted} />
          <Text style={styles.viewsText} maxFontSizeMultiplier={FONT_SCALE.tight}>
            {t('post.viewsCount', { count: formatCount(item.view_count || 0) })}
          </Text>
        </View>
        {/* No maxFontSizeMultiplier here, deliberately: the caption is content,
            and content honours the reader's font size. The caps above are only
            on chrome that lives in a fixed-size container. */}
        {item.caption ? (
          <RichCaption style={styles.caption} numberOfLines={3} text={item.caption} />
        ) : null}
      </View>
    </View>
  ), [currentUser?.profile_picture, handleSaveChange, handleLikeChange, t]);

  const renderItem = useCallback(({ item }) => (
    <PostCard
      item={item}
      cardW={cardW}
      isFocused={focusedVideoId === item.id}
      isMuted={isMuted}
      onToggleMute={toggleMute}
      isAudioActive={currentlyPlayingPostId === item.id}
      isAudioPlaying={currentlyPlayingPostId === item.id ? isAudioPlaying : false}
      onToggleAudio={toggleSongPlayback}
      onDoubleTapLike={handleDoubleTapLike}
      renderHeader={renderPostHeader}
      renderFooter={renderPostFooter}
    />
  ), [cardW, renderPostHeader, renderPostFooter, focusedVideoId, isMuted, toggleMute,
      currentlyPlayingPostId, isAudioPlaying, toggleSongPlayback, handleDoubleTapLike]);

  const renderEmptyComponent = useCallback(() => {
    if (loading) return null;
    if (error) {
      return (
        <View style={styles.emptyContainer}>
          <MaterialIcons name="error-outline" size={48} color={colors.textMuted} />
          <Text style={styles.errorText}>
            {error.message?.includes('Session expired')
              ? t('feed.sessionExpired')
              : error.response?.status === 500
                ? t('feed.serverError')
                : t('feed.loadFailedShort')}
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => loadPosts()}>
            <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
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
          <Text style={styles.emptyText}>{t('feed.followingQuiet')}</Text>
          <Text style={styles.emptySub}>{t('feed.followingQuietSub')}</Text>
          <TouchableOpacity style={styles.createFirstPostButton} onPress={() => selectFeed('for_you')}>
            <Text style={styles.createFirstPostText}>{t('feed.exploreForYou')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <MaterialIcons name="photo-library" size={48} color={colors.textMuted} />
        <Text style={styles.emptyText}>{t('feed.noPosts')}</Text>
        <TouchableOpacity style={styles.createFirstPostButton} onPress={() => navigation.navigate('CreatePost')}>
          <Text style={styles.createFirstPostText}>{t('feed.shareSomething')}</Text>
        </TouchableOpacity>
      </View>
    );
  }, [loading, error, searchQuery, feedType, navigation, loadPosts, selectFeed, t]);

  const keyExtractor = useCallback(item => `post_${item.id}`, []);

  const renderFooter = useCallback(() =>
    loadingMore
      ? <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 16 }} />
      : null
  , [loadingMore]);

  return (
    <View style={styles.container}>
      {/* Rotating wallpaper behind the feed — light blur, no color overlay.
          Skipped when a parent already provides a shared background (e.g. the
          Home screen, where one wallpaper spans the nav bar and the feed). */}
      {showBackground && (
        <RotatingBackground intervalMs={60000} scrimColor="rgba(10,22,40,0.28)" />
      )}

      {/* Frosted glass top bar: the rotating wallpaper shows through the blur,
          with a soft top-down scrim keeping search + tabs legible. Stays pinned;
          the stories row lives in the list header so it scrolls away. */}
      {/* NOTE: in Expo Go on Android, real background blur is unavailable, so
          BlurView falls back to a translucent tint — keep the intensity low so
          the wallpaper behind it stays visible (a dev build gives true blur). */}
      <GlassView
        intensity={18}
        tint="dark"
        experimentalBlurMethod="dimezisBlurView"
        style={styles.topBar}
        onLayout={(e) => setTopBarH(e.nativeEvent.layout.height)}
      >
        {/* Dark-blue glass scrim — same recipe as the app header, deeper toward
            the tabs so the search + tabs read cleanly over the wallpaper. */}
        <LinearGradient
          colors={['rgba(8,22,46,0.5)', 'rgba(8,20,40,0.68)']}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={styles.searchRow}>
          <View style={{ flex: 1 }}>
            <SearchBaar
              onSearch={handleSearch}
              placeholder={t('feed.searchPlaceholder')}
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
              <Text style={[styles.tabText, feedType === 'following' && styles.tabTextActive]} maxFontSizeMultiplier={FONT_SCALE.chrome}>
                Following
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, feedType === 'for_you' && styles.tabActive]}
              onPress={() => selectFeed('for_you')}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, feedType === 'for_you' && styles.tabTextActive]} maxFontSizeMultiplier={FONT_SCALE.chrome}>
                For You
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </GlassView>

      {newPostsAvailable && (
        <TouchableOpacity
          style={[styles.newPostsPill, { top: topBarH + 8 }]}
          onPress={handleShowNewPosts}
          activeOpacity={0.85}
        >
          <MaterialIcons name="arrow-upward" size={16} color={colors.white} />
          <Text style={styles.newPostsText} maxFontSizeMultiplier={FONT_SCALE.chrome}>{t('feed.newPosts')}</Text>
        </TouchableOpacity>
      )}

      <FlatList
        // Each row hosts a comment sheet (a Modal). Touches inside a Modal still
        // bubble through this list in the React tree, and with the default
        // ('never') the list swallowed the first tap to close the keyboard, so
        // posting a comment took two taps. 'handled' lets the button take it.
        keyboardShouldPersistTaps="handled"
        ref={flatListRef}
        data={posts}
        renderItem={renderItem}
        ListHeaderComponent={
          <View>
            {/* Spacer so content starts below the absolute glass bar, then
                scrolls up behind it for the frosted-glass effect. */}
            <View style={{ height: topBarH }} />
            <StoriesBar navigation={navigation} />
            {/* Your own posts that are still uploading. */}
            <PendingPosts />
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
        // Start the next page a screen and a half early. At 0.5 the request
        // only began once the user had nearly hit the bottom, so the footer
        // spinner was almost guaranteed; at 1.5 the rows are usually already
        // there by the time they're scrolled to, and the spinner never shows.
        onEndReachedThreshold={1.5}
        ListFooterComponent={renderFooter}
        maxToRenderPerBatch={5}
        updateCellsBatchingPeriod={100}
        // Feed cards are close to a full screen each, so rendering five before
        // first paint delays it for four cards nobody can see yet.
        initialNumToRender={3}
        windowSize={10}
        removeClippedSubviews={Platform.OS === 'android'}
      />

      {loading && !refreshing && posts.length === 0 && (
        <View style={styles.skeletonContainer}>
          <PostSkeleton />
          <PostSkeleton />
          <PostSkeleton />
        </View>
      )}

      {/* Navy curved-glass edge vignette — matches the app header. zIndex 20
          lifts it above the frosted top bar (zIndex 10) so the same edge framing
          wraps the top bar too. */}
      <ScreenVignette tintRgb="6,16,34" zIndex={20} />
    </View>
  );
};




const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent', // RotatingBackground shows through behind the cards
  },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 8,
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: 'transparent',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(11,6,83,0.18)',
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
    // width applied inline via useCardWidth() so it reflows on resize/rotation
    alignSelf: 'center',  // centered column on wide screens
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
  reasonChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 3,
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(29,161,242,0.12)',
  },
  reasonChipText: {
    fontSize: 10.5,
    fontWeight: '600',
    color: colors.primary,
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
  // Dark placeholder for an off-screen video with no poster frame yet.
  videoPosterFallback: {
    backgroundColor: '#0A1628',
  },
  // Poster kept on top of the focused <Video> until its first frame is decoded.
  videoPosterOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    backgroundColor: colors.black,
  },
  // Double-tap-to-like heart burst, centered over the media.
  heartBurst: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    textShadowColor: 'rgba(0,0,0,0.4)',
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

  viewsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginBottom: 4,
  },

  viewsText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },

  caption: {
    fontSize: 14,
    color: colors.textPrimary,
    lineHeight: 20,
    fontWeight: '700',
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
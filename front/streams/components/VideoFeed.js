// The Videos page: full-screen clips, one at a time, swiped up.
//
// - For You is ranked (the server's ?rank=1 blend, videos only): what people
//   respond to, from those you follow and those near them, nothing twice until
//   the new ones run out — then the older videos, so it never just stops.
//   Following is everyone you follow, newest first.
// - How long each clip is watched is reported (batched with the views), the
//   strongest sign of what someone wants more of.
// - Opens at once on the copy kept from last time (per tab, per person), so
//   it starts with something to watch even offline, and refreshes behind it.
// - The right-hand column — like, comment, share, save, more — is bold and
//   filled, readable over any frame. "More" has Not interested and Report (or
//   Edit / Delete on your own).
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, useWindowDimensions, StyleSheet, ActivityIndicator,
  TouchableOpacity, Image, StatusBar, Animated, AppState,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { setAudioModeAsync } from '../services/audioPlayer';
import AppVideo from './AppVideo';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as Poster } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import VideoModeToggle from './VideoModeToggle';
import {
  fetchSocialPosts, fetchFeedByUrl, followUser, likePost, markPostsViewed, logWatchEvents,
} from '../services/api';
import formatCount from '../utils/formatCount';
import useOnline from '../hooks/useOnline';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import { usePlayer } from '../context/PlayerContext';
import { useAuth } from '../context/useAuth';
import { usePreferences } from '../context/PreferencesContext';
import { PREF_KEYS, resolveVideoQuality } from '../utils/preferences';
import { useI18n } from '../context/I18nContext';
import { LikeButton, SaveButton, ShareButton, RailLabel } from './SocialActions';
import CommentAction from './CommentAction';
import PostActions from './PostActions';
import RichCaption from './RichCaption';
import { colors, typography } from '../constants/theme';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

// How long buffered view and watch-time reports wait for more company.
const VIEW_FLUSH_MS = 4000;
// The first page of each tab, kept for an instant (and offline) start.
const KEEP_MS = 3 * 24 * 60 * 60 * 1000;
const feedKey = (uid, tab) => userKey(uid, `videos:${tab}`);
// The spinner waits this long: a clip that starts quickly never shows it.
const SPINNER_DELAY_MS = 600;
// Posters of the clips ahead are fetched as soon as their page arrives.
const prefetchPosters = (items = []) => {
  const urls = items.map((p) => p.thumbnail_url).filter(Boolean).slice(0, 10);
  if (urls.length) Poster.prefetch?.(urls)?.catch?.(() => {});
};
/** Fill the screen with a portrait clip (as short-video apps do); show the
 *  whole of a square or landscape one. */
const fitFor = (item, screenW, screenH) => {
  const w = Number(item.width) || 0;
  const h = Number(item.height) || 0;
  if (!w || !h) return 'contain';
  const clip = h / w;
  const screen = screenH / Math.max(screenW, 1);
  return clip >= 1.5 && Math.abs(clip - screen) / screen < 0.25 ? 'cover' : 'contain';
};
const TEXT_SHADOW = { textShadowColor: 'rgba(0,0,0,0.75)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 };

// ── A single full-screen video page ─────────────────────────────────────────
const VideoItem = ({
  item, height, isActive, screenFocused, muted, onToggleMute, currentUser, navigation, bottomOffset = 120,
  onRemove,
}) => {
  const videoRef = useRef(null);
  const { width: screenW } = useWindowDimensions();
  const { preferences } = usePreferences();
  const { t } = useI18n();
  // One resolver drives both autoplay and buffering, so "Data saver" and the
  // Video quality tiers stay consistent.
  const quality = resolveVideoQuality(
    preferences[PREF_KEYS.videoQuality],
    preferences[PREF_KEYS.dataSaver],
  );
  // Respect the "Autoplay videos" choice here too; the data-saver tier
  // suppresses autoplay so a video only streams once the user taps to play.
  const autoplay = !!preferences[PREF_KEYS.autoplayVideo] && quality.autoplayAllowed;

  const [manualPaused, setManualPaused] = useState(!autoplay);
  const [loading, setLoading] = useState(true);
  // The first frame is on screen: the poster under it can go.
  const [shown, setShown] = useState(false);
  const [slow, setSlow] = useState(false);
  const [errored, setErrored] = useState(false);
  // A failed clip can be tried again (a new player for it).
  const [attempt, setAttempt] = useState(0);
  // Follow state lives on the post author (item.user.is_following), same field
  // the feed's FollowButton uses.
  const [following, setFollowing] = useState(!!item.user?.is_following);
  const [followBusy, setFollowBusy] = useState(false);
  // Like state lifted here so double-tap-to-like and the rail LikeButton stay in
  // sync (LikeButton re-syncs from its isLiked / initialLikes props).
  const [liked, setLiked] = useState(item.is_liked ?? item.liked_by_me ?? false);
  const [likesCount, setLikesCount] = useState(item.likes_count || 0);
  const heartScale = useRef(new Animated.Value(0)).current;
  // There is only ONE rendition: R2 has no delivery-transform tier, so the
  // serializer returns the same URL for media_url and optimized_url. Quality is
  // therefore expressed through buffering/autoplay (see resolveVideoQuality),
  // not by picking a smaller file. Prefer optimized_url so this starts choosing
  // the lighter file automatically once renditions exist.
  const uri = quality.tier === 'data_saver'
    ? (item.optimized_url || item.media_url)
    : (item.media_url || item.optimized_url);
  const playing = isActive && screenFocused && !manualPaused;
  // The clips either side are got ready ahead, for an instant swipe — except
  // on Data saver, where nothing streams until it is the one on screen.
  const load = isActive || quality.tier !== 'data_saver';

  // Hard-pause whenever this item is no longer the active one (kills audio on
  // swipe). Also (re)apply the autoplay-derived default on active change OR when
  // the preference is toggled, so flipping "Autoplay videos" in Settings takes
  // effect on the on-screen video immediately. Manual taps only change
  // manualPaused (not these deps), so they're preserved until the next swipe/toggle.
  useEffect(() => {
    if (!isActive) videoRef.current?.pauseAsync?.().catch(() => {});
    setManualPaused(!autoplay);
  }, [isActive, autoplay]);

  const author = item.user || {};
  const myId = currentUser?.id ?? currentUser?.user_id;
  const isMine = myId && author.id === myId;
  const songTitle = item.song_title || item.song?.title;
  const showFollowPlus = !isMine && !!author.id && !following;
  const openAuthor = () => author.id && navigation.navigate('UserProfile', { userId: author.id, username: author.username });

  const handleFollow = async () => {
    if (followBusy || !author.id) return;
    setFollowBusy(true);
    setFollowing(true); // optimistic — the + vanishes immediately
    try {
      const res = await followUser(author.id, true);    // the + only ever follows
      setFollowing(res?.is_following ?? true);           // trust the server, like FollowButton
    } catch {
      setFollowing(false); // revert if it failed
    } finally {
      setFollowBusy(false);
    }
  };

  // Double-tap-to-like: heart burst always; the like itself only ever ADDS
  // (Instagram-style), never unlikes. Optimistic + reconciled with the server.
  const handleDoubleTapLike = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    heartScale.setValue(0);
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1, friction: 4, useNativeDriver: true }),
      Animated.timing(heartScale, { toValue: 0, duration: 250, delay: 350, useNativeDriver: true }),
    ]).start();
    if (liked) return; // already liked — burst only, no API call
    setLiked(true);
    setLikesCount((c) => c + 1);
    likePost(item.id, { liked: true })
      .then((res) => {
        if (typeof res?.is_liked === 'boolean') setLiked(res.is_liked);
        if (typeof res?.likes_count === 'number') setLikesCount(res.likes_count);
      })
      .catch(() => { setLiked(false); setLikesCount((c) => Math.max(0, c - 1)); });
  }, [liked, heartScale, item.id]);

  // Tap layer over the native video: single tap = pause, double tap = like.
  const tapGesture = useMemo(() => {
    const singleTap = Gesture.Tap()
      .maxDuration(250)
      .runOnJS(true)
      .onEnd(() => { if (isActive) setManualPaused((p) => !p); });
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDuration(250)
      .runOnJS(true)
      .onEnd(() => handleDoubleTapLike());
    return Gesture.Exclusive(doubleTap, singleTap);
  }, [isActive, handleDoubleTapLike]);

  const retry = () => { setErrored(false); setLoading(true); setShown(false); setAttempt((n) => n + 1); };

  // A spinner only for a clip that is taking its time.
  useEffect(() => {
    if (!isActive || !loading) { setSlow(false); return undefined; }
    const timer = setTimeout(() => setSlow(true), SPINNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isActive, loading]);
  // Should the first-frame signal never come, the poster steps aside soon
  // after the clip has loaded.
  useEffect(() => {
    if (loading || shown) return undefined;
    const timer = setTimeout(() => setShown(true), 1200);
    return () => clearTimeout(timer);
  }, [loading, shown]);
  const fit = fitFor(item, screenW, height);

  return (
    <View style={{ height, width: screenW, backgroundColor: '#000' }} testID={`video-${item.id}`}>
      {uri && !errored && load ? (
        <AppVideo
          key={attempt}
          ref={videoRef}
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          resizeMode={fit}
          isLooping
          useCaching
          shouldPlay={playing}
          isMuted={muted}
          bufferOptions={quality.bufferOptions}
          onLoad={() => setLoading(false)}
          // The first frame on screen also ends the wait: a clip already in
          // the cache can finish loading before the load listener is attached.
          onReadyForDisplay={() => { setLoading(false); setShown(true); }}
          onError={() => { setErrored(true); setLoading(false); }}
        />
      ) : null}

      {/* The clip's poster, at once from the cache, over the video until its
          first frame is painted (a video surface is black until then), so it
          appears out of its own picture rather than out of black. */}
      {item.thumbnail_url && !shown && !errored ? (
        <Poster source={{ uri: item.thumbnail_url }} style={StyleSheet.absoluteFill} contentFit={fit}
                cachePolicy="memory-disk" transition={0} recyclingKey={String(item.id)}
                pointerEvents="none" testID={`poster-${item.id}`} />
      ) : null}

      {loading && slow && !errored && uri && load ? (
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
        </View>
      ) : null}
      {isActive && !loading && !errored && manualPaused && (
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
          <MaterialIcons name="play-arrow" size={84} color="rgba(255,255,255,0.9)" style={styles.iconShadow} />
        </View>
      )}

      {/* Tap layer above the native video surface: single tap = pause, double
          tap = like. Rendered before the action rail / caption below, so those
          stay on top and tappable. */}
      <GestureDetector gesture={tapGesture}>
        <View style={StyleSheet.absoluteFill} />
      </GestureDetector>

      {/* A clip that would not play: say so, and offer it again (a dropped
          connection is the usual reason). Above the tap layer. */}
      {(!uri || errored) && (
        <View style={[StyleSheet.absoluteFill, styles.center]} testID={`video-failed-${item.id}`}>
          <MaterialIcons name="videocam-off" size={44} color={colors.textMuted} />
          <Text style={styles.unavailable}>{t('video.unavailable')}</Text>
          {uri ? (
            <TouchableOpacity style={styles.retryBtn} onPress={retry} accessibilityRole="button">
              <Text style={styles.retryText}>{t('feed.retry')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {/* Double-tap heart burst, centered over the video. */}
      <Animated.View
        style={[styles.heartBurst, { opacity: heartScale, transform: [{ scale: heartScale }] }]}
        pointerEvents="none"
      >
        <MaterialIcons name="favorite" size={110} color="#FF2D55" style={styles.iconShadow} />
      </Animated.View>

      {/* Legibility gradient behind the overlays */}
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.75)']} style={styles.bottomGradient} pointerEvents="none" />

      {/* Right action rail — author avatar at the top, then like/comment/etc. */}
      <View style={[styles.rightRail, { bottom: bottomOffset }]}>
        <View style={styles.railAvatarWrap}>
          <TouchableOpacity activeOpacity={0.85} onPress={openAuthor} accessibilityRole="button"
                            accessibilityLabel={`@${author.username || ''}`}>
            <Image
              source={author.profile_picture ? { uri: author.profile_picture } : DEFAULT_AVATAR}
              defaultSource={DEFAULT_AVATAR}
              style={styles.railAvatar}
            />
          </TouchableOpacity>
          {/* TikTok-style red + — tap to follow, then it disappears. */}
          {showFollowPlus && (
            <TouchableOpacity style={styles.plusBadge} onPress={handleFollow} hitSlop={8} activeOpacity={0.85}
                              accessibilityRole="button" accessibilityLabel={t('video.follow')} testID="rail-follow">
              <Ionicons name="add" size={16} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
        <LikeButton
          variant="rail"
          postId={item.id}
          initialLikes={likesCount}
          isLiked={liked}
          onLikeChange={(d) => { setLiked(d.is_liked); setLikesCount(d.likes_count); }}
        />
        <CommentAction
          triggerVariant="rail"
          postId={item.id}
          commentCount={item.comments_count || 0}
          currentUserAvatar={currentUser?.profile_picture}
          commentsEnabled={item.comments_enabled !== false}
        />
        <ShareButton variant="rail" postId={item.id} caption={item.caption} username={author.username} />
        <SaveButton variant="rail" postId={item.id} initialSaved={item.is_saved ?? item.saved_by_me ?? false} />
        <TouchableOpacity style={styles.railButton} onPress={onToggleMute} hitSlop={8} activeOpacity={0.8}
                          accessibilityRole="button" accessibilityState={{ checked: !muted }}
                          accessibilityLabel={t(muted ? 'video.unmute' : 'video.mute')} testID="rail-mute">
          <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={30} color="#fff" style={styles.iconShadow} />
          <RailLabel>{t(muted ? 'video.muted' : 'video.sound')}</RailLabel>
        </TouchableOpacity>
        <PostActions
          variant="rail"
          post={item}
          onDelete={() => onRemove?.(item.id)}
          onNotInterested={() => onRemove?.(item.id)}
        />
      </View>

      {/* Bottom-left author + caption */}
      <View style={[styles.bottomInfo, { bottom: bottomOffset }]}>
        <TouchableOpacity activeOpacity={0.8} onPress={openAuthor} style={styles.authorRow}>
          <Text style={styles.authorName} numberOfLines={1}>@{author.username || 'user'}</Text>
          {author.is_verified ? <MaterialIcons name="verified" size={16} color="#4FC3F7" style={styles.iconShadow} /> : null}
        </TouchableOpacity>
        {item.caption ? (
          <RichCaption style={styles.caption} numberOfLines={2} text={item.caption} linkStyle={styles.captionLink} />
        ) : null}
        <View style={styles.metaRow}>
          <View style={styles.viewsRow}>
            <Ionicons name="play" size={13} color="#fff" style={styles.iconShadow} />
            <Text style={styles.viewsText}>{t('video.views', { n: formatCount(item.view_count || 0) })}</Text>
          </View>
          {songTitle ? (
            <View style={styles.songRow}>
              <Ionicons name="musical-notes" size={14} color="#fff" style={styles.iconShadow} />
              <Text style={styles.songText} numberOfLines={1}>{songTitle}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
};

// Footer nav button (icon + label) → navigates to an existing screen.
const FooterBtn = ({ icon, label, onPress, testID }) => (
  <TouchableOpacity style={styles.footerBtn} onPress={onPress} activeOpacity={0.8}
                    accessibilityRole="button" accessibilityLabel={label} testID={testID}>
    <Ionicons name={icon} size={24} color="#fff" />
    <Text style={styles.footerLabel} numberOfLines={1}>{label}</Text>
  </TouchableOpacity>
);

// ── The vertical pager ──────────────────────────────────────────────────────
const VideoFeed = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { currentUser } = useAuth();
  const uid = currentUser?.id ?? currentUser?.user_id;
  const player = usePlayer();
  // Initial page height from the live window (onLayout below is the source of
  // truth and corrects it on resize/rotation).
  const { height: winH } = useWindowDimensions();

  const [tab, setTab] = useState('foryou'); // 'foryou' (ranked) | 'following'
  const kept = peekCache(feedKey(uid, 'foryou'));
  const [posts, setPosts] = useState(() => kept?.results || []);
  const [loading, setLoading] = useState(!kept?.results?.length);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [offline, setOffline] = useState(false);
  const [muted, setMuted] = useState(false);
  const [activeId, setActiveId] = useState(() => kept?.results?.[0]?.id ?? null);
  const [screenFocused, setScreenFocused] = useState(true);
  // In the background the player stops by itself; back in front it must be
  // told to play again (and the time away is not watch time).
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background');
  const online = useOnline();
  const listRef = useRef(null);
  const [containerH, setContainerH] = useState(winH);

  const activeIdRef = useRef(activeId);
  const nextUrlRef = useRef(kept?.next ?? null);
  const loadingMoreRef = useRef(false);
  const tabRef = useRef('foryou');
  // Each load is numbered: an answer for a tab left meanwhile is dropped.
  const requestRef = useRef(0);
  // The server has answered: a kept copy read from disk after that is too old.
  const answeredRef = useRef(false);

  // View counting: a clip taking the screen is the view. Buffered and sent in
  // batches so a fast swipe-through doesn't fire a request per video, and
  // guarded per session so swiping back up doesn't re-report.
  const viewBufferRef = useRef([]);
  const seenPostsRef = useRef(new Set());
  const flushTimerRef = useRef(null);
  // Watch time: how long the current clip has had the screen.
  const watchBufferRef = useRef([]);
  const watchStartRef = useRef({ id: activeId, at: Date.now() });

  const FOOTER_H = 58 + insets.bottom;

  // Play sound even if the device is on silent (iOS).
  useEffect(() => {
    setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: false }).catch(() => {});
  }, []);

  const showPage = useCallback((res) => {
    const items = res?.results || [];
    prefetchPosters(items);
    // A new page starts at its top: the list would otherwise stay where the
    // last one was, playing a clip that is not the one on screen.
    listRef.current?.scrollToOffset?.({ offset: 0, animated: false });
    setPosts(items);
    nextUrlRef.current = res?.next ?? null;
    activeIdRef.current = items.length ? items[0].id : null;
    setActiveId(activeIdRef.current);
    watchStartRef.current = { id: activeIdRef.current, at: Date.now() };
  }, []);

  const load = useCallback(async ({ refresh = false } = {}) => {
    const which = tabRef.current;
    const n = ++requestRef.current;
    if (refresh) setRefreshing(true);
    setError(false);
    try {
      const res = await fetchSocialPosts(null, which === 'following' ? 'following' : null, '', {
        contentType: 'video', fresh: true, rank: which === 'foryou',
      });
      if (n !== requestRef.current) return;
      answeredRef.current = true;
      showPage(res);
      setOffline(false);
      writeCache(feedKey(uid, which), { results: (res?.results || []).slice(0, 20), next: res?.next ?? null });
    } catch {
      if (n !== requestRef.current) return;
      // With something on screen, keep it and say it may be old; with
      // nothing, the full-page message.
      setOffline(true);
      setError(true);
    } finally {
      if (n === requestRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [uid, showPage]);

  // First open: the kept copy (from disk after a restart), then the server.
  useEffect(() => {
    let live = true;
    if (!posts.length) {
      readCache(feedKey(uid, 'foryou'), KEEP_MS).then((copy) => {
        if (live && copy?.results?.length && tabRef.current === 'foryou' && !answeredRef.current) {
          showPage(copy);
          setLoading(false);
        }
      });
    }
    load();
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !nextUrlRef.current) return;
    loadingMoreRef.current = true;
    const n = requestRef.current;
    try {
      // The `next` link as the server gave it: ranked pages and cursor pages alike.
      const res = await fetchFeedByUrl(nextUrlRef.current);
      if (n !== requestRef.current) return;
      const items = res?.results || [];
      prefetchPosters(items);
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...items.filter((p) => !seen.has(p.id))];
      });
      nextUrlRef.current = res?.next ?? null;
    } catch {
      // keep what we have; the next swipe near the end asks again
    } finally {
      loadingMoreRef.current = false;
    }
  }, []);

  const switchTab = useCallback((next) => {
    if (next === tabRef.current) return;
    tabRef.current = next;
    setTab(next);
    const copy = peekCache(feedKey(uid, next));
    if (copy?.results?.length) {
      showPage(copy);
      setLoading(false);
    } else {
      setPosts([]);
      activeIdRef.current = null;
      setActiveId(null);
      nextUrlRef.current = null;
      setLoading(true);
    }
    load();
  }, [load, uid, showPage]);

  const removePost = useCallback((id) => {
    setPosts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // Pause the global music mini-player while watching; stop video audio on blur.
  useFocusEffect(useCallback(() => {
    setScreenFocused(true);
    player?.pause?.();
    return () => setScreenFocused(false);
  }, [player]));

  // Send whatever views and watch time have piled up (best-effort — a dropped
  // report just means an uncounted view, never a broken feed).
  const flushViews = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const ids = viewBufferRef.current;
    if (ids.length) {
      viewBufferRef.current = [];
      markPostsViewed(ids).catch(() => {});
    }
    const events = watchBufferRef.current;
    if (events.length) {
      watchBufferRef.current = [];
      logWatchEvents(events).catch(() => {});
    }
  }, []);

  const schedule = useCallback(() => {
    // Coalesce a burst of swipes into one request.
    if (!flushTimerRef.current) flushTimerRef.current = setTimeout(flushViews, VIEW_FLUSH_MS);
  }, [flushViews]);

  const queueView = useCallback((id) => {
    if (!id || seenPostsRef.current.has(id)) return;
    seenPostsRef.current.add(id);
    viewBufferRef.current.push(id);
    schedule();
  }, [schedule]);

  // The clip that had the screen until now: how long it was watched.
  const endWatch = useCallback(() => {
    const { id, at } = watchStartRef.current || {};
    if (id) {
      const ms = Date.now() - at;
      if (ms > 0) {
        watchBufferRef.current.push({ post_id: id, dwell_ms: Math.round(ms) });
        schedule();
      }
    }
  }, [schedule]);

  // Ref-held so the (deliberately stable) viewability handler can reach the
  // latest version without being re-created and tripping FlatList's warning.
  const queueViewRef = useRef(queueView);
  const endWatchRef = useRef(endWatch);
  useEffect(() => { queueViewRef.current = queueView; endWatchRef.current = endWatch; }, [queueView, endWatch]);

  // Coming back starts the clip's watch again; leaving ends it and must not
  // strand buffered reports (the cleanup runs on both blur and unmount).
  // Stable deps only: a re-run would restart the clock mid-video.
  useFocusEffect(useCallback(() => {
    watchStartRef.current = { id: activeIdRef.current, at: Date.now() };
    return () => {
      endWatch();
      watchStartRef.current = { id: null, at: Date.now() };
      flushViews();
    };
  }, [flushViews, endWatch]));

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    const first = viewableItems.find((v) => v.isViewable);
    const id = first ? first.item.id : null;
    if (id && id !== activeIdRef.current) {
      endWatchRef.current();
      activeIdRef.current = id;
      watchStartRef.current = { id, at: Date.now() };
      setActiveId(id);
      queueViewRef.current(id);
    }
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 80 }).current;

  // The app leaving the screen: the clip stops, its watch time ends; back
  // in front, both start again.
  useEffect(() => {
    const sub = AppState.addEventListener?.('change', (state) => {
      const active = state === 'active';
      setAppActive(active);
      if (active) {
        watchStartRef.current = { id: activeIdRef.current, at: Date.now() };
      } else {
        endWatchRef.current();
        watchStartRef.current = { id: null, at: Date.now() };
        flushViews();
      }
    });
    return () => sub?.remove?.();
  }, [flushViews]);

  // Back online after a failed load: try again by itself.
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current && error) load();
    wasOnline.current = online;
  }, [online, error, load]);

  // Turned (or resized): stay on the same clip, not between two.
  useEffect(() => {
    const i = posts.findIndex((p) => p.id === activeIdRef.current);
    if (i > 0) listRef.current?.scrollToOffset?.({ offset: i * containerH, animated: false });
  }, [containerH]); // eslint-disable-line react-hooks/exhaustive-deps

  const getItemLayout = useCallback((_d, index) => (
    { length: containerH, offset: containerH * index, index }
  ), [containerH]);

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  const renderItem = useCallback(({ item }) => (
    <VideoItem
      item={item}
      height={containerH}
      isActive={item.id === activeId}
      screenFocused={screenFocused && appActive}
      muted={muted}
      onToggleMute={toggleMute}
      currentUser={currentUser}
      navigation={navigation}
      bottomOffset={FOOTER_H + 14}
      onRemove={removePost}
    />
  ), [containerH, activeId, screenFocused, appActive, muted, toggleMute, currentUser, navigation, FOOTER_H, removePost]);

  return (
    <View style={styles.root} onLayout={(e) => {
      const h = e.nativeEvent.layout.height;
      if (h && Math.abs(h - containerH) > 1) setContainerH(h);
    }}>
      <StatusBar barStyle="light-content" />

      {posts.length ? (
        <FlatList
          ref={listRef}
          // Each row hosts a comment sheet (a Modal). Touches inside a Modal still
          // bubble through this list in the React tree, and with the default
          // ('never') the list swallowed the first tap to close the keyboard, so
          // posting a comment took two taps. 'handled' lets the button take it.
          keyboardShouldPersistTaps="handled"
          data={posts}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          pagingEnabled
          snapToInterval={containerH}
          snapToAlignment="start"
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
          getItemLayout={getItemLayout}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          onEndReached={loadMore}
          onEndReachedThreshold={1.5}
          refreshing={refreshing}
          onRefresh={() => load({ refresh: true })}
          windowSize={3}
          initialNumToRender={2}
          maxToRenderPerBatch={3}
          removeClippedSubviews
          testID="video-list"
        />
      ) : loading ? (
        <View style={[StyleSheet.absoluteFill, styles.center]}><ActivityIndicator size="large" color="#fff" /></View>
      ) : error ? (
        <View style={[StyleSheet.absoluteFill, styles.center]} testID="video-error">
          <MaterialIcons name="cloud-off" size={48} color={colors.textMuted} />
          <Text style={styles.unavailable}>{t('video.loadFailed')}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); load(); }}>
            <Text style={styles.retryText}>{t('feed.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.center]} testID="video-empty">
          <MaterialIcons name="videocam-off" size={48} color={colors.textMuted} />
          <Text style={styles.unavailable}>
            {tab === 'following' ? t('video.noFollowing') : t('video.noVideos')}
          </Text>
        </View>
      )}

      {/* Top bar: close · Explore · Following/For You tabs · video mode · Search */}
      <LinearGradient colors={['rgba(0,0,0,0.6)', 'transparent']} style={[styles.topGradient, { height: insets.top + 72 }]} pointerEvents="none" />
      <View style={[styles.topBar, { top: insets.top + 6, left: insets.left, right: insets.right }]}>
        <View style={styles.topSide}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button"
                            accessibilityLabel={t('common.close')}>
            <Ionicons name="chevron-down" size={28} color="#fff" style={styles.iconShadow} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Explore')} hitSlop={8} accessibilityRole="button"
                            accessibilityLabel={t('video.explore')}>
            <Ionicons name="compass" size={26} color="#fff" style={styles.iconShadow} />
          </TouchableOpacity>
        </View>
        <View style={styles.tabs} accessibilityRole="tablist">
          {['following', 'foryou'].map((key, i) => (
            <React.Fragment key={key}>
              {i > 0 ? <View style={styles.tabRule} /> : null}
              <TouchableOpacity onPress={() => switchTab(key)} accessibilityRole="tab"
                                accessibilityState={{ selected: tab === key }} testID={`video-tab-${key}`}>
                <Text style={[styles.tabText, tab === key && styles.tabActive]}>
                  {t(key === 'following' ? 'video.following' : 'video.forYou')}
                </Text>
                <View style={[styles.tabBar, tab === key && styles.tabBarOn]} />
              </TouchableOpacity>
            </React.Fragment>
          ))}
        </View>
        <View style={[styles.topSide, styles.topRight]}>
          {/* Video mode: open the app here next time. */}
          <VideoModeToggle />
          <TouchableOpacity onPress={() => navigation.navigate('Explore')} hitSlop={8} accessibilityRole="button"
                            accessibilityLabel={t('video.search')}>
            <Ionicons name="search" size={26} color="#fff" style={styles.iconShadow} />
          </TouchableOpacity>
        </View>
      </View>
      {offline && posts.length > 0 ? (
        <View style={[styles.offline, { top: insets.top + 52 }]} pointerEvents="none" testID="video-offline">
          <Ionicons name="cloud-offline" size={13} color="#fff" />
          <Text style={styles.offlineText}>{t('video.offline')}</Text>
        </View>
      ) : null}

      {/* Bottom footer — pure navigation links to existing screens */}
      <View style={[styles.footer, { height: FOOTER_H, paddingBottom: insets.bottom }]}>
        <FooterBtn icon="home" label={t('video.footer.home')} onPress={() => navigation.navigate('Home')} testID="video-home" />
        <FooterBtn icon="people" label={t('video.footer.followers')}
          onPress={() => navigation.navigate('FollowList', { userId: uid, type: 'followers', username: currentUser?.username })} />
        <TouchableOpacity style={styles.createBtn} onPress={() => navigation.navigate('CreatePost')} activeOpacity={0.85}
                          accessibilityRole="button" accessibilityLabel={t('video.create')}>
          <Ionicons name="add" size={28} color="#0A1628" />
        </TouchableOpacity>
        <FooterBtn icon="chatbubble-ellipses" label={t('video.footer.inbox')} onPress={() => navigation.navigate('Inbox')} />
        <FooterBtn icon="person" label={t('video.footer.you')} onPress={() => navigation.navigate('Profile')} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  heartBurst: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  iconShadow: { textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  unavailable: { ...typography.body, color: colors.textSecondary, fontWeight: '700' },
  retryBtn: { marginTop: 8, paddingHorizontal: 22, paddingVertical: 9, borderRadius: 999, backgroundColor: colors.primary },
  retryText: { color: '#fff', fontWeight: '800' },

  bottomGradient: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 280 },
  topGradient: { position: 'absolute', left: 0, right: 0, top: 0 },

  // Top bar
  topBar: { position: 'absolute', zIndex: 5, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  topSide: { flexDirection: 'row', alignItems: 'center', gap: 16, width: 76 },
  topRight: { justifyContent: 'flex-end' },
  tabs: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  tabText: { color: 'rgba(255,255,255,0.7)', fontSize: 17, fontWeight: '800', ...TEXT_SHADOW },
  tabActive: { color: '#fff', fontWeight: '900' },
  tabBar: { alignSelf: 'center', marginTop: 4, width: 22, height: 3, borderRadius: 2, backgroundColor: 'transparent' },
  tabBarOn: { backgroundColor: '#fff' },
  tabRule: { width: StyleSheet.hairlineWidth * 2, height: 14, backgroundColor: 'rgba(255,255,255,0.5)', marginBottom: 6 },
  offline: {
    position: 'absolute', alignSelf: 'center', zIndex: 5, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.6)',
  },
  offlineText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // Footer
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 5,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    backgroundColor: 'rgba(0,0,0,0.7)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.15)',
  },
  footerBtn: { alignItems: 'center', justifyContent: 'center', gap: 2, minWidth: 56, maxWidth: 80 },
  footerLabel: { color: '#fff', fontSize: 11, fontWeight: '800' },
  createBtn: { width: 50, height: 32, borderRadius: 10, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },

  rightRail: { position: 'absolute', right: 6, alignItems: 'center', gap: 16 },
  railButton: { alignItems: 'center', justifyContent: 'center', minWidth: 56, gap: 2 },
  railAvatarWrap: { width: 50, alignItems: 'center', marginBottom: 10 },
  railAvatar: { width: 50, height: 50, borderRadius: 25, borderWidth: 2, borderColor: '#fff', backgroundColor: colors.surface },
  plusBadge: {
    position: 'absolute', bottom: -10, left: 14, width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#FF2D55', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#fff', zIndex: 6, elevation: 6,
  },

  // A tablet keeps the caption a readable width, not across the screen.
  bottomInfo: { position: 'absolute', left: 14, right: 86, maxWidth: 520 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6, alignSelf: 'flex-start' },
  authorName: { color: '#fff', fontWeight: '900', fontSize: 17, letterSpacing: 0.2, ...TEXT_SHADOW },
  caption: { color: '#fff', fontSize: 15, lineHeight: 20, fontWeight: '600', ...TEXT_SHADOW },
  // Over video, the brand blue is hard to read — bold white stands out instead.
  captionLink: { color: '#fff', fontWeight: '900' },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 14, rowGap: 4, marginTop: 8 },
  viewsRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  viewsText: { color: '#fff', fontSize: 13, fontWeight: '800', ...TEXT_SHADOW },
  songRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  songText: { color: '#fff', fontSize: 13, fontWeight: '700', flexShrink: 1, ...TEXT_SHADOW },
});

export default VideoFeed;

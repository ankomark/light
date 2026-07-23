import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, Dimensions, StyleSheet, ActivityIndicator,
  TouchableOpacity, Image, StatusBar, Animated,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { setAudioModeAsync } from '../services/audioPlayer';
import AppVideo from './AppVideo';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { fetchSocialPosts, cursorFromUrl, followUser, likePost } from '../services/api';
import { usePlayer } from '../context/PlayerContext';
import { useAuth } from '../context/useAuth';
import { usePreferences } from '../context/PreferencesContext';
import { PREF_KEYS, resolveVideoQuality } from '../utils/preferences';
import { LikeButton, SaveButton, ShareButton } from './SocialActions';
import CommentAction from './CommentAction';
import { colors, typography } from '../constants/theme';

const { height: SCREEN_H, width: SCREEN_W } = Dimensions.get('window');
const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

// ── A single full-screen video page ─────────────────────────────────────────
const VideoItem = ({ item, height, isActive, screenFocused, muted, onToggleMute, currentUser, navigation, bottomOffset = 120 }) => {
  const videoRef = useRef(null);
  const { preferences } = usePreferences();
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
  const [errored, setErrored] = useState(false);
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

  const handleFollow = async () => {
    if (followBusy || !author.id) return;
    setFollowBusy(true);
    setFollowing(true); // optimistic — the + vanishes immediately
    try {
      const res = await followUser(author.id);          // POST /users/:id/follow/
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
    likePost(item.id)
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

  return (
    <View style={{ height, width: SCREEN_W, backgroundColor: '#000' }}>
      {uri && !errored ? (
        <AppVideo
          ref={videoRef}
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          isLooping
          shouldPlay={playing}
          isMuted={muted}
          bufferOptions={quality.bufferOptions}
          onLoad={() => setLoading(false)}
          onError={() => { setErrored(true); setLoading(false); }}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <MaterialIcons name="videocam-off" size={44} color={colors.textMuted} />
          <Text style={styles.unavailable}>Video unavailable</Text>
        </View>
      )}

      {loading && !errored && (
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}
      {isActive && !loading && manualPaused && (
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
          <MaterialIcons name="play-arrow" size={72} color="rgba(255,255,255,0.85)" />
        </View>
      )}

      {/* Tap layer above the native video surface: single tap = pause, double
          tap = like. Rendered before the action rail / caption below, so those
          stay on top and tappable. */}
      <GestureDetector gesture={tapGesture}>
        <View style={StyleSheet.absoluteFill} />
      </GestureDetector>

      {/* Double-tap heart burst, centered over the video. */}
      <Animated.View
        style={[styles.heartBurst, { opacity: heartScale, transform: [{ scale: heartScale }] }]}
        pointerEvents="none"
      >
        <MaterialIcons name="favorite" size={100} color="rgba(255,255,255,0.95)" />
      </Animated.View>

      {/* Legibility gradient behind the overlays */}
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.65)']} style={styles.bottomGradient} pointerEvents="none" />

      {/* Right action rail — author avatar at the top, then like/comment/etc. */}
      <View style={[styles.rightRail, { bottom: bottomOffset }]}>
        <View style={styles.railAvatarWrap}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => author.id && navigation.navigate('UserProfile', { userId: author.id, username: author.username })}
          >
            <Image
              source={author.profile_picture ? { uri: author.profile_picture } : DEFAULT_AVATAR}
              defaultSource={DEFAULT_AVATAR}
              style={styles.railAvatar}
            />
          </TouchableOpacity>
          {/* TikTok-style red + — tap to follow, then it disappears. */}
          {showFollowPlus && (
            <TouchableOpacity style={styles.plusBadge} onPress={handleFollow} hitSlop={8} activeOpacity={0.85}>
              <Ionicons name="add" size={14} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.railItem}>
          <LikeButton
            postId={item.id}
            initialLikes={likesCount}
            isLiked={liked}
            onLikeChange={(d) => { setLiked(d.is_liked); setLikesCount(d.likes_count); }}
          />
        </View>
        <View style={styles.railItem}>
          <CommentAction postId={item.id} commentCount={item.comments_count || 0} currentUserAvatar={currentUser?.profile_picture} />
        </View>
        <View style={styles.railItem}>
          <ShareButton postId={item.id} caption={item.caption} username={author.username} />
        </View>
        <View style={styles.railItem}>
          <SaveButton postId={item.id} initialSaved={item.is_saved ?? item.saved_by_me ?? false} />
        </View>
        <TouchableOpacity style={styles.railItem} onPress={onToggleMute} hitSlop={8} activeOpacity={0.8}>
          <MaterialIcons name={muted ? 'volume-off' : 'volume-up'} size={26} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Bottom-left author + caption */}
      <View style={[styles.bottomInfo, { bottom: bottomOffset }]}>
        <View style={styles.authorRow}>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => author.id && navigation.navigate('UserProfile', { userId: author.id, username: author.username })}
          >
            <Text style={styles.authorName} numberOfLines={1}>@{author.username || 'user'}</Text>
          </TouchableOpacity>
        </View>
        {item.caption ? <Text style={styles.caption} numberOfLines={2}>{item.caption}</Text> : null}
        {songTitle ? (
          <View style={styles.songRow}>
            <Ionicons name="musical-notes" size={13} color="#fff" />
            <Text style={styles.songText} numberOfLines={1}>{songTitle}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
};

// Footer nav button (icon + tiny label) → navigates to an existing screen.
const FooterBtn = ({ icon, label, onPress }) => (
  <TouchableOpacity style={styles.footerBtn} onPress={onPress} activeOpacity={0.8}>
    <Ionicons name={icon} size={22} color="#fff" />
    <Text style={styles.footerLabel}>{label}</Text>
  </TouchableOpacity>
);

// ── The vertical pager ──────────────────────────────────────────────────────
const VideoFeed = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { currentUser } = useAuth();
  const player = usePlayer();

  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [muted, setMuted] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [screenFocused, setScreenFocused] = useState(true);
  const [containerH, setContainerH] = useState(SCREEN_H);
  const [tab, setTab] = useState('foryou'); // 'foryou' (all) | 'following'

  const activeIdRef = useRef(null);
  const nextCursorRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const tabRef = useRef('foryou');

  const FOOTER_H = 54 + insets.bottom;
  const feedFor = (t) => (t === 'following' ? 'following' : null);

  // Play sound even if the device is on silent (iOS).
  useEffect(() => {
    setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: false }).catch(() => {});
  }, []);

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    setError(false);
    try {
      const res = await fetchSocialPosts(null, feedFor(tabRef.current), '', { contentType: 'video', fresh: true });
      const items = res?.results || [];
      setPosts(items);
      nextCursorRef.current = cursorFromUrl(res?.next);
      activeIdRef.current = items.length ? items[0].id : null;
      setActiveId(items.length ? items[0].id : null);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !nextCursorRef.current) return;
    loadingMoreRef.current = true;
    try {
      const res = await fetchSocialPosts(nextCursorRef.current, feedFor(tabRef.current), '', { contentType: 'video' });
      const items = res?.results || [];
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...items.filter((p) => !seen.has(p.id))];
      });
      nextCursorRef.current = cursorFromUrl(res?.next);
    } catch {
      // keep what we have
    } finally {
      loadingMoreRef.current = false;
    }
  }, []);

  const switchTab = useCallback((t) => {
    if (t === tabRef.current) return;
    tabRef.current = t;
    setTab(t);
    setPosts([]);
    activeIdRef.current = null;
    setActiveId(null);
    nextCursorRef.current = null;
    load();
  }, [load]);

  // Pause the global music mini-player while watching; stop video audio on blur.
  useFocusEffect(useCallback(() => {
    setScreenFocused(true);
    player?.pause?.();
    return () => setScreenFocused(false);
  }, [player]));

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    const first = viewableItems.find((v) => v.isViewable);
    const id = first ? first.item.id : null;
    if (id && id !== activeIdRef.current) {
      activeIdRef.current = id;
      setActiveId(id);
    }
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 80 }).current;

  const getItemLayout = useCallback((_d, index) => (
    { length: containerH, offset: containerH * index, index }
  ), [containerH]);

  const renderItem = useCallback(({ item }) => (
    <VideoItem
      item={item}
      height={containerH}
      isActive={item.id === activeId}
      screenFocused={screenFocused}
      muted={muted}
      onToggleMute={() => setMuted((m) => !m)}
      currentUser={currentUser}
      navigation={navigation}
      bottomOffset={FOOTER_H + 14}
    />
  ), [containerH, activeId, screenFocused, muted, currentUser, navigation, FOOTER_H]);

  return (
    <View style={styles.root} onLayout={(e) => {
      const h = e.nativeEvent.layout.height;
      if (h && Math.abs(h - containerH) > 1) setContainerH(h);
    }}>
      <StatusBar barStyle="light-content" />

      {loading ? (
        <View style={[StyleSheet.absoluteFill, styles.center]}><ActivityIndicator size="large" color="#fff" /></View>
      ) : error ? (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <MaterialIcons name="cloud-off" size={48} color={colors.textMuted} />
          <Text style={styles.unavailable}>Couldn't load videos</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load()}><Text style={styles.retryText}>Retry</Text></TouchableOpacity>
        </View>
      ) : posts.length === 0 ? (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <MaterialIcons name="videocam-off" size={48} color={colors.textMuted} />
          <Text style={styles.unavailable}>No videos yet</Text>
        </View>
      ) : (
        <FlatList
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
        />
      )}

      {/* Top bar: close · Explore · Following/For You tabs · Search */}
      <LinearGradient colors={['rgba(0,0,0,0.55)', 'transparent']} style={[styles.topGradient, { height: insets.top + 60 }]} pointerEvents="none" />
      <View style={[styles.topBar, { top: insets.top + 6 }]}>
        <View style={styles.topSide}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <Ionicons name="chevron-down" size={26} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Explore')} hitSlop={8}>
            <Ionicons name="compass-outline" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
        <View style={styles.tabs}>
          <TouchableOpacity onPress={() => switchTab('following')}>
            <Text style={[styles.tabText, tab === 'following' && styles.tabActive]}>Following</Text>
          </TouchableOpacity>
          <Text style={styles.tabDot}>•</Text>
          <TouchableOpacity onPress={() => switchTab('foryou')}>
            <Text style={[styles.tabText, tab === 'foryou' && styles.tabActive]}>For You</Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.topSide, { justifyContent: 'flex-end' }]}>
          <TouchableOpacity onPress={() => navigation.navigate('Explore')} hitSlop={8}>
            <Ionicons name="search" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Bottom footer — pure navigation links to existing screens */}
      <View style={[styles.footer, { height: FOOTER_H, paddingBottom: insets.bottom }]}>
        <FooterBtn icon="home-outline" label="Home" onPress={() => navigation.navigate('Home')} />
        <FooterBtn icon="people-outline" label="Followers"
          onPress={() => navigation.navigate('FollowList', { userId: currentUser?.user_id ?? currentUser?.id, type: 'followers', username: currentUser?.username })} />
        <TouchableOpacity style={styles.createBtn} onPress={() => navigation.navigate('CreatePost')} activeOpacity={0.85}>
          <Ionicons name="add" size={26} color="#0A1628" />
        </TouchableOpacity>
        <FooterBtn icon="chatbubble-ellipses-outline" label="Inbox" onPress={() => navigation.navigate('Inbox')} />
        <FooterBtn icon="person-outline" label="You" onPress={() => navigation.navigate('Profile')} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  heartBurst: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  unavailable: { ...typography.body, color: colors.textSecondary },
  retryBtn: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.primary },
  retryText: { color: '#fff', fontWeight: '700' },

  bottomGradient: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 240 },
  topGradient: { position: 'absolute', left: 0, right: 0, top: 0 },

  // Top bar
  topBar: { position: 'absolute', left: 0, right: 0, zIndex: 5, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  topSide: { flexDirection: 'row', alignItems: 'center', gap: 16, width: 72 },
  tabs: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  tabText: { color: 'rgba(255,255,255,0.6)', fontSize: 16, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  tabActive: { color: '#fff', fontWeight: '800' },
  tabDot: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },

  // Footer
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 5,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    backgroundColor: 'rgba(0,0,0,0.6)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)',
  },
  footerBtn: { alignItems: 'center', justifyContent: 'center', gap: 2, minWidth: 56 },
  footerLabel: { color: '#fff', fontSize: 10, fontWeight: '600' },
  createBtn: { width: 46, height: 30, borderRadius: 9, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },

  rightRail: { position: 'absolute', right: 8, alignItems: 'center', gap: 18 },
  railItem: { alignItems: 'center', justifyContent: 'center' },
  railAvatarWrap: { width: 46, alignItems: 'center', marginBottom: 10 },
  railAvatar: { width: 46, height: 46, borderRadius: 23, borderWidth: 2, borderColor: '#fff', backgroundColor: colors.surface },
  plusBadge: {
    position: 'absolute', bottom: -9, left: 13, width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#FF2D55', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#000', zIndex: 6, elevation: 6,
  },

  bottomInfo: { position: 'absolute', left: 12, right: 80, bottom: 36 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  authorTap: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  authorAvatar: { width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)' },
  authorName: { color: '#fff', fontWeight: '800', fontSize: 15, textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  caption: { color: '#fff', fontSize: 14, lineHeight: 19, textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  songRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  songText: { color: '#fff', fontSize: 13, flexShrink: 1, textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
});

export default VideoFeed;

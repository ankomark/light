import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, Dimensions, StyleSheet, ActivityIndicator,
  Pressable, TouchableOpacity, Image, StatusBar,
} from 'react-native';
import { Video, Audio } from 'expo-av';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { fetchSocialPosts, cursorFromUrl } from '../services/api';
import { usePlayer } from '../context/PlayerContext';
import { useAuth } from '../context/useAuth';
import { LikeButton, SaveButton, ShareButton } from './SocialActions';
import CommentAction from './CommentAction';
import FollowButton from './FollowButton';
import { colors, typography } from '../constants/theme';

const { height: SCREEN_H, width: SCREEN_W } = Dimensions.get('window');
const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

// ── A single full-screen video page ─────────────────────────────────────────
const VideoItem = ({ item, height, isActive, screenFocused, muted, onToggleMute, currentUser, navigation }) => {
  const videoRef = useRef(null);
  const [manualPaused, setManualPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const uri = item.optimized_url || item.media_url;
  const playing = isActive && screenFocused && !manualPaused;

  // Hard-pause whenever this item is no longer the focused one (kills audio on swipe).
  useEffect(() => {
    if (!isActive && videoRef.current) {
      videoRef.current.pauseAsync?.().catch(() => {});
      setManualPaused(false);
    }
  }, [isActive]);

  const author = item.user || {};
  const isMine = currentUser?.id && author.id === currentUser.id;
  const songTitle = item.song_title || item.song?.title;

  return (
    <View style={{ height, width: SCREEN_W, backgroundColor: '#000' }}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => isActive && setManualPaused((p) => !p)}>
        {uri && !errored ? (
          <Video
            ref={videoRef}
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            resizeMode="contain"
            isLooping
            shouldPlay={playing}
            isMuted={muted}
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
      </Pressable>

      {/* Legibility gradient behind the overlays */}
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.65)']} style={styles.bottomGradient} pointerEvents="none" />

      {/* Right action rail */}
      <View style={styles.rightRail}>
        <View style={styles.railItem}>
          <LikeButton postId={item.id} initialLikes={item.likes_count || 0} isLiked={item.is_liked ?? item.liked_by_me ?? false} />
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
      <View style={styles.bottomInfo}>
        <View style={styles.authorRow}>
          <TouchableOpacity
            style={styles.authorTap}
            activeOpacity={0.8}
            onPress={() => author.id && navigation.navigate('UserProfile', { userId: author.id, username: author.username })}
          >
            <Image
              source={author.profile_picture ? { uri: author.profile_picture } : DEFAULT_AVATAR}
              defaultSource={DEFAULT_AVATAR}
              style={styles.authorAvatar}
            />
            <Text style={styles.authorName} numberOfLines={1}>@{author.username || 'user'}</Text>
          </TouchableOpacity>
          {!isMine && author.id ? (
            <FollowButton userId={author.id} initialFollowing={item.author_is_following ?? false} />
          ) : null}
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

  const activeIdRef = useRef(null);
  const nextCursorRef = useRef(null);
  const loadingMoreRef = useRef(false);

  // Play sound even if the device is on silent (iOS).
  useEffect(() => {
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: false }).catch(() => {});
  }, []);

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    setError(false);
    try {
      const res = await fetchSocialPosts(null, null, '', { contentType: 'video', fresh: true });
      const items = res?.results || [];
      setPosts(items);
      nextCursorRef.current = cursorFromUrl(res?.next);
      if (items.length) { activeIdRef.current = items[0].id; setActiveId(items[0].id); }
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
      const res = await fetchSocialPosts(nextCursorRef.current, null, '', { contentType: 'video' });
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
    />
  ), [containerH, activeId, screenFocused, muted, currentUser, navigation]);

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

      {/* Top bar (back + title) over a gradient */}
      <LinearGradient colors={['rgba(0,0,0,0.5)', 'transparent']} style={[styles.topGradient, { height: insets.top + 56 }]} pointerEvents="none" />
      <TouchableOpacity
        style={[styles.backBtn, { top: insets.top + 8 }]}
        onPress={() => navigation.goBack()}
        hitSlop={10}
        activeOpacity={0.8}
      >
        <Ionicons name="chevron-back" size={28} color="#fff" />
      </TouchableOpacity>
      <Text style={[styles.title, { top: insets.top + 12 }]}>Videos</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  unavailable: { ...typography.body, color: colors.textSecondary },
  retryBtn: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.primary },
  retryText: { color: '#fff', fontWeight: '700' },

  bottomGradient: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 220 },
  topGradient: { position: 'absolute', left: 0, right: 0, top: 0 },
  backBtn: { position: 'absolute', left: 8, zIndex: 5, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { position: 'absolute', alignSelf: 'center', zIndex: 5, color: '#fff', fontWeight: '800', fontSize: 17, letterSpacing: 0.5, textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },

  rightRail: { position: 'absolute', right: 8, bottom: 120, alignItems: 'center', gap: 18 },
  railItem: { alignItems: 'center', justifyContent: 'center' },

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

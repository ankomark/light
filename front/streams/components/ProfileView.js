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
import { Ionicons, MaterialIcons, Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  fetchUserById, fetchUserPosts, fetchUserTracks, fetchUserPlaylists, followUser, getOrCreateConversation, blockUser,
} from '../services/api';
import { usePlayer } from '../context/PlayerContext';
import { useAuth } from '../context/useAuth';
import { useI18n } from '../context/I18nContext';
import useGridColumns from '../utils/useGridColumns';
import formatCount from '../utils/formatCount';
import { mergePage } from '../utils/exploreLogic';
import { peekCache, readCache, writeCache, dropCache, userKey } from '../utils/screenCache';
import ChoiceSheet from './ChoiceSheet';
import ReportModal from './ReportModal';
import TrackItem from './TrackItem';
import PlaylistCover from './PlaylistCover';
import toQueueTrack from '../utils/queueTrack';
import { colors, typography, spacing, radius, profileColors as P } from '../constants/theme';

const AVATAR_SIZE = 90;
const GRID_GAP = 1;
// Grid tiles are portrait (3:4), like the rest of the social screens.
const tileHeightFor = (size) => Math.round((size * 4) / 3);
const PAGE_SIZE = 30;
const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const STALE_MS = 30 * 1000;
// On a tablet the header and song rows stay a readable width, centred; the
// post grid still uses the full width (more columns).
const CONTENT_MAX = 560;
const TRACKS_MAX = 720;

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
    <TouchableOpacity style={styles.statBox} onPress={onPress} activeOpacity={0.7} accessibilityRole="button">{body}</TouchableOpacity>
  ) : (
    <View style={styles.statBox}>{body}</View>
  );
};

const PostTile = memo(({ post, size, isSelf, onPress }) => {
  const thumb = getPostThumb(post);
  return (
    <TouchableOpacity style={[styles.tile, { width: size, height: tileHeightFor(size) }]} activeOpacity={0.85} onPress={() => onPress(post)}>
      {thumb ? (
        <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={120} recyclingKey={String(post.id)} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.tileFallback]}>
          <Feather name="image" size={22} color={P.dim} />
        </View>
      )}
      {post.content_type === 'video' && (
        <View style={styles.videoBadge}><Ionicons name="play" size={10} color={colors.white} /></View>
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
  <View style={styles.list}>
    <View style={styles.head}>
      <Pulse style={{ width: AVATAR_SIZE + 10, height: AVATAR_SIZE + 10, borderRadius: (AVATAR_SIZE + 10) / 2 }} />
      <Pulse style={{ width: 130, height: 16, marginTop: spacing.md }} />
      <View style={styles.statsRow}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.statBox}>
            <Pulse style={{ width: 44, height: 18 }} />
            <Pulse style={{ width: 60, height: 11, marginTop: 6 }} />
          </View>
        ))}
      </View>
      <View style={styles.actionRow}>
        <Pulse style={{ width: 164, height: 44 }} />
        <Pulse style={{ width: 48, height: 44 }} />
      </View>
      <Pulse style={{ width: 240, height: 13, marginTop: spacing.md }} />
    </View>
    <View style={[styles.gridRow, styles.skelGrid]}>
      {Array.from({ length: cols * 2 }, (_, i) => <Pulse key={i} style={{ width: tileSize, height: tileHeightFor(tileSize), borderRadius: 0 }} />)}
    </View>
  </View>
);

const ProfileView = ({ userId, initialUsername, onLoaded }) => {
  const { t, resolvedLanguage } = useI18n();
  const navigation = useNavigation();
  const { currentUser } = useAuth();
  const { cols, tileSize } = useGridColumns({
    target: 124, min: 3, max: 6, horizontalPadding: 0, gap: GRID_GAP,
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

  // Music tab: loaded the first time it's opened, from cache first.
  const tracksKey = userKey(currentUser?.id, `profile:${userId}:tracks`);
  const [tab, setTab] = useState('posts');
  const [tracks, setTracks] = useState(() => peekCache(tracksKey) ?? null);
  const [tracksHasMore, setTracksHasMore] = useState(false);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [tracksError, setTracksError] = useState(false);
  const tracksPageRef = useRef(1);
  const tracksReqRef = useRef(0);
  const { playQueue } = usePlayer();

  // Playlists tab: their public playlists (all of yours), loaded when opened.
  const playlistsKey = userKey(currentUser?.id, `profile:${userId}:playlists`);
  const [playlists, setPlaylists] = useState(() => peekCache(playlistsKey) ?? null);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistsError, setPlaylistsError] = useState(false);
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

  const loadTracks = useCallback(async ({ more = false } = {}) => {
    if (!userId) return;
    const req = ++tracksReqRef.current;
    const page = more ? tracksPageRef.current + 1 : 1;
    setTracksLoading(true);
    try {
      const res = await fetchUserTracks(userId, page);
      if (req !== tracksReqRef.current) return;
      const list = res?.results ?? [];
      tracksPageRef.current = page;
      setTracksHasMore(!!res?.next);
      setTracksError(false);
      if (more) {
        setTracks((prev) => mergePage(prev ?? [], list));
      } else {
        setTracks(list);
        writeCache(tracksKey, list);
      }
    } catch {
      if (req !== tracksReqRef.current) return;
      setTracksError(true);
      if (more) setTracksHasMore(false);
    } finally {
      if (req === tracksReqRef.current) setTracksLoading(false);
    }
  }, [userId, tracksKey]);

  const loadPlaylists = useCallback(async () => {
    if (!userId) return;
    setPlaylistsLoading(true);
    try {
      const rows = await fetchUserPlaylists(userId);
      setPlaylists(rows);
      setPlaylistsError(false);
      writeCache(playlistsKey, rows);
    } catch {
      setPlaylistsError(true);
    } finally {
      setPlaylistsLoading(false);
    }
  }, [userId, playlistsKey]);

  const openTab = useCallback((next) => {
    setTab(next);
    if (next === 'playlists') {
      if (playlists === null) {
        readCache(playlistsKey).then((c) => { if (Array.isArray(c)) setPlaylists((cur) => cur ?? c); });
      }
      loadPlaylists();
      return;
    }
    if (next !== 'music') return;
    if (tracks === null) {
      readCache(tracksKey).then((c) => { if (Array.isArray(c)) setTracks((cur) => cur ?? c); });
    }
    loadTracks();
  }, [tracks, tracksKey, loadTracks, playlists, playlistsKey, loadPlaylists]);

  const onEndReached = useCallback(() => {
    if (tab === 'posts') loadMore();
    else if (tab === 'music' && tracksHasMore && !tracksLoading) loadTracks({ more: true });
  }, [tab, loadMore, tracksHasMore, tracksLoading, loadTracks]);

  const onPull = useCallback(() => {
    load({ pull: true });
    if (tab === 'music') loadTracks();
    if (tab === 'playlists') loadPlaylists();
  }, [load, tab, loadTracks, loadPlaylists]);

  // Play from this row, with the rest of the account's songs as the queue.
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const playFrom = useCallback((index) => {
    playQueue((tracksRef.current ?? []).map(toQueueTrack), index, { source: 'profile' });
  }, [playQueue]);

  const onTrackDeleted = useCallback((id) => {
    setTracks((prev) => (prev ?? []).filter((tr) => tr.id !== id));
    setUser((u) => (u ? { ...u, tracks_count: Math.max(0, (u.tracks_count ?? 1) - 1) } : u));
  }, []);

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

  const followOff = !!user?.is_following || user?.follow_status === 'requested';
  const showMusic = isSelf || (user?.tracks_count ?? 0) > 0;
  const showPlaylists = isSelf || (user?.playlists_count ?? 0) > 0;

  const header = user ? (
    <View>
      <View style={styles.head}>
        <View style={styles.avatarRing}>
          <Image
            source={user.profile_picture ? { uri: user.profile_picture } : DEFAULT_AVATAR}
            placeholder={DEFAULT_AVATAR}
            cachePolicy="memory-disk"
            contentFit="cover"
            transition={150}
            style={styles.avatar}
          />
        </View>

        <View style={styles.nameRow}>
          <Text style={styles.handle} numberOfLines={1}>@{user.username}</Text>
          {user.is_private && <Feather name="lock" size={14} color={P.muted} />}
        </View>
        {user.follows_you && !isSelf && (
          <View style={styles.followsYou}><Text style={styles.followsYouText}>{t('profile.followsYou')}</Text></View>
        )}

        <View style={styles.statsRow}>
          <StatBox value={user.following_count} label={t('profile.following')} onPress={canView ? () => openList('following') : undefined} />
          <View style={styles.statDivider} />
          <StatBox value={user.followers_count} label={t('profile.followers')} onPress={canView ? () => openList('followers') : undefined} />
          <View style={styles.statDivider} />
          {/* Lifetime likes across this user's posts, tracks and publications. */}
          <StatBox value={user.total_likes ?? 0} label={t('profile.likes')} />
        </View>

        <View style={styles.actionRow}>
          {isSelf ? (
            <>
              <TouchableOpacity style={[styles.mainBtn, styles.mainBtnQuiet]} onPress={() => navigation.navigate('CreateProfile')} activeOpacity={0.85}>
                <Text style={[styles.mainBtnText, styles.mainBtnTextQuiet]}>{t('profile.editProfile')}</Text>
              </TouchableOpacity>
              {/* Saved music & posts (your own profile only). */}
              <TouchableOpacity
                style={styles.squareBtn}
                onPress={() => navigation.navigate('Favorites')}
                activeOpacity={0.85}
                accessibilityLabel={t('profile.myFavorites')}
              >
                <Ionicons name="heart-outline" size={20} color={P.text} />
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.mainBtn, followOff && styles.mainBtnQuiet]}
                onPress={handleFollow}
                disabled={followBusy}
                activeOpacity={0.85}
              >
                <Text style={[styles.mainBtnText, followOff && styles.mainBtnTextQuiet]}>{followLabel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.squareBtn} onPress={handleMessage} disabled={messageBusy} activeOpacity={0.85} accessibilityLabel={t('profile.message')}>
                {messageBusy
                  ? <ActivityIndicator size="small" color={P.text} />
                  : <Ionicons name="chatbubble-outline" size={19} color={P.text} />}
              </TouchableOpacity>
              <TouchableOpacity style={styles.squareBtn} onPress={() => setMenuOpen(true)} activeOpacity={0.85} accessibilityLabel={t('profile.moreOptions')}>
                <Ionicons name="ellipsis-horizontal" size={19} color={P.text} />
              </TouchableOpacity>
            </>
          )}
        </View>

        {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
        {(profile.location || bornText) ? (
          <View style={styles.metaRow}>
            {profile.location ? (
              <View style={styles.metaItem}>
                <Ionicons name="location-outline" size={14} color={P.muted} />
                <Text style={styles.metaText}>{profile.location}</Text>
              </View>
            ) : null}
            {bornText ? (
              <View style={styles.metaItem}>
                <Ionicons name="calendar-outline" size={14} color={P.muted} />
                <Text style={styles.metaText}>{bornText}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* Posts / Music / Playlists. The counts live here now the stats row is
          three wide. Music shows once the account has uploaded a song,
          Playlists once it has a public one (both always on your own). */}
      <View style={styles.tabBar}>
        {[
          { key: 'posts', icon: 'grid-outline', label: t('profile.posts'), count: user.posts_count ?? posts.length },
          ...(showMusic ? [{ key: 'music', icon: 'musical-notes-outline', label: t('profile.music'), count: user.tracks_count ?? 0 }] : []),
          ...(showPlaylists ? [{
            key: 'playlists',
            icon: 'list-outline',
            label: t('playlist.title'),
            // Yours: every playlist once loaded; theirs: the public ones.
            count: isSelf && playlists ? playlists.length : (user.playlists_count ?? 0),
          }] : []),
        ].map((it) => {
          const on = tab === it.key;
          return (
            <TouchableOpacity
              key={it.key}
              style={[styles.tab, on && styles.tabOn]}
              onPress={() => openTab(it.key)}
              activeOpacity={0.8}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Ionicons name={it.icon} size={18} color={on ? P.text : P.dim} />
              <Text style={[styles.tabText, !on && styles.tabTextOff]} numberOfLines={1}>{it.label} · {formatCount(it.count)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  ) : null;

  const empty = !user ? null : !canView ? (
    // A private account the viewer isn't approved for: a locked state, not
    // "No posts yet", which would misrepresent it.
    <View style={styles.postsEmpty}>
      <MaterialIcons name="lock-outline" size={40} color={P.dim} />
      <Text style={styles.postsEmptyText}>{t('profile.private')}</Text>
      <Text style={styles.postsLockedSub}>
        {user.follow_status === 'requested' ? t('profile.privateRequestPending') : t('profile.privateFollowPrompt')}
      </Text>
    </View>
  ) : (
    <View style={styles.postsEmpty}>
      <MaterialIcons name="photo-library" size={40} color={P.dim} />
      <Text style={styles.postsEmptyText}>{t('profile.noPosts')}</Text>
    </View>
  );

  const musicEmpty = !user ? null : !canView ? empty : tracksLoading && !tracks?.length ? (
    <ActivityIndicator style={styles.more} color={P.muted} />
  ) : tracksError && !tracks?.length ? (
    <View style={styles.postsEmpty}>
      <MaterialIcons name="wifi-off" size={40} color={P.dim} />
      <Text style={styles.postsEmptyText}>{t('profile.musicLoadFailed')}</Text>
      <TouchableOpacity style={styles.retryBtn} onPress={() => loadTracks()} activeOpacity={0.85}>
        <Text style={styles.retryBtnText}>{t('common.retry')}</Text>
      </TouchableOpacity>
    </View>
  ) : (
    <View style={styles.postsEmpty}>
      <MaterialIcons name="library-music" size={40} color={P.dim} />
      <Text style={styles.postsEmptyText}>{t('profile.noMusic')}</Text>
    </View>
  );

  const playlistsEmpty = !user ? null : !canView ? empty : playlistsLoading && !playlists?.length ? (
    <ActivityIndicator style={styles.more} color={P.muted} />
  ) : playlistsError && !playlists?.length ? (
    <View style={styles.postsEmpty}>
      <MaterialIcons name="wifi-off" size={40} color={P.dim} />
      <Text style={styles.postsEmptyText}>{t('library.loadFailed')}</Text>
      <TouchableOpacity style={styles.retryBtn} onPress={loadPlaylists} activeOpacity={0.85}>
        <Text style={styles.retryBtnText}>{t('common.retry')}</Text>
      </TouchableOpacity>
    </View>
  ) : (
    <View style={styles.postsEmpty}>
      <MaterialIcons name="queue-music" size={40} color={P.dim} />
      <Text style={styles.postsEmptyText}>{t('library.noPlaylists')}</Text>
    </View>
  );

  const renderPlaylist = useCallback(({ item }) => (
    <TouchableOpacity
      style={styles.playlistRow}
      activeOpacity={0.85}
      onPress={() => navigation.navigate('PlaylistDetail', { playlistId: item.id, name: item.name })}
    >
      <PlaylistCover cover={item.cover_image} images={item.cover_images} size={56} />
      <View style={styles.playlistBody}>
        <Text style={styles.playlistName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.playlistMeta} numberOfLines={1}>
          {[t('library.songCount', { n: item.track_count ?? 0 }),
            isSelf && item.visibility ? t(`playlist.visibility.${item.visibility}`) : null].filter(Boolean).join('  ·  ')}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={P.dim} />
    </TouchableOpacity>
  ), [navigation, isSelf, t]);

  const renderTrack = useCallback(({ item, index }) => (
    <View style={styles.trackRow}>
      <TrackItem track={item} index={index} onPlay={playFrom} onDelete={onTrackDeleted} onRefresh={loadTracks} />
    </View>
  ), [playFrom, onTrackDeleted, loadTracks]);

  const renderPost = useCallback(
    ({ item }) => <PostTile post={item} size={tileSize} isSelf={isSelf} onPress={openPost} />,
    [tileSize, isSelf, openPost],
  );

  // Your own profile always has the tab; someone else's loses it if their
  // last song goes, so fall back to Posts rather than an empty tab.
  const onMusic = tab === 'music' && showMusic;
  const onPlaylists = tab === 'playlists' && showPlaylists;

  // ── states ──
  if (!user && loading) {
    return <HeaderSkeleton cols={cols} tileSize={tileSize} />;
  }

  if (!user) {
    return (
      <View style={styles.centered}>
        <MaterialIcons name="person-off" size={56} color={P.dim} />
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
        key={onMusic ? 'music' : onPlaylists ? 'playlists' : `grid-${cols}`}
        {...(onPlaylists ? {
          data: canView ? (playlists ?? []) : [],
          numColumns: 1,
          keyExtractor: (item) => `ppl_${item.id}`,
          renderItem: renderPlaylist,
          ListEmptyComponent: playlistsEmpty,
          ListFooterComponent: null,
        } : onMusic ? {
          data: canView ? (tracks ?? []) : [],
          numColumns: 1,
          keyExtractor: (item) => `pt_${item.id}`,
          renderItem: renderTrack,
          ListEmptyComponent: musicEmpty,
          ListFooterComponent: tracksLoading && tracks?.length ? <ActivityIndicator style={styles.more} color={P.muted} /> : null,
        } : {
          data: canView ? posts : [],
          numColumns: cols,
          columnWrapperStyle: cols > 1 ? styles.gridRow : undefined,
          keyExtractor: (item) => `pp_${item.id}`,
          renderItem: renderPost,
          ListEmptyComponent: empty,
          ListFooterComponent: loadingMore ? <ActivityIndicator style={styles.more} color={P.muted} /> : null,
        })}
        ListHeaderComponent={header}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.6}
        refreshControl={(
          <RefreshControl refreshing={refreshing} onRefresh={onPull} tintColor={P.text} colors={[P.gold]} progressBackgroundColor={P.raised} />
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
  list: { flex: 1, backgroundColor: P.bg },
  listContent: { paddingBottom: spacing.xxl },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg, backgroundColor: P.bg },
  errorText: { ...typography.body, color: P.muted, marginTop: spacing.sm, marginBottom: spacing.md, textAlign: 'center' },
  retryBtn: { backgroundColor: P.gold, borderRadius: 6, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryBtnText: { ...typography.button, color: P.onGold },

  head: {
    alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md,
    width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center',
  },
  // Gold ring with a dark gap between it and the photo.
  avatarRing: {
    width: AVATAR_SIZE + 10, height: AVATAR_SIZE + 10, borderRadius: (AVATAR_SIZE + 10) / 2,
    borderWidth: 2, borderColor: P.gold, alignItems: 'center', justifyContent: 'center',
  },
  avatar: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, backgroundColor: P.raised },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm + 4, maxWidth: '100%' },
  handle: { fontSize: 17, fontWeight: '600', color: P.text, flexShrink: 1 },
  followsYou: { marginTop: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, backgroundColor: 'rgba(232,198,107,0.14)' },
  followsYouText: { color: P.gold, fontSize: 11, fontWeight: '700' },

  statsRow: { flexDirection: 'row', alignSelf: 'stretch', marginTop: spacing.md + 2 },
  statBox: { flex: 1, alignItems: 'center', paddingVertical: 2 },
  statValue: { fontSize: 20, fontWeight: '700', color: P.text },
  statLabel: { fontSize: 13, color: P.muted, marginTop: 1 },
  statDivider: { width: 1, height: 18, backgroundColor: P.divider, marginTop: 8 },

  actionRow: { flexDirection: 'row', gap: 6, marginTop: spacing.md + 2 },
  mainBtn: {
    minWidth: 164, height: 44, borderRadius: 6, paddingHorizontal: spacing.md,
    backgroundColor: P.gold, alignItems: 'center', justifyContent: 'center',
  },
  // Following / Requested / Edit profile: the quiet grey button.
  mainBtnQuiet: { backgroundColor: P.raised },
  mainBtnText: { fontSize: 15, fontWeight: '700', color: P.onGold },
  mainBtnTextQuiet: { color: P.text, fontWeight: '600' },
  squareBtn: { width: 48, height: 44, borderRadius: 6, backgroundColor: P.raised, alignItems: 'center', justifyContent: 'center' },

  bio: { fontSize: 14, lineHeight: 20, color: P.body, textAlign: 'center', marginTop: spacing.md - 2, maxWidth: 320 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 14, marginTop: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, color: P.muted },

  tabBar: {
    flexDirection: 'row', justifyContent: 'center', marginTop: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: P.divider,
  },
  tab: {
    flex: 1, maxWidth: CONTENT_MAX / 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, height: 46, borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabOn: { borderBottomColor: P.text },
  tabText: { fontSize: 13, fontWeight: '600', color: P.text },
  tabTextOff: { color: P.dim },
  playlistRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    width: '100%', maxWidth: TRACKS_MAX, alignSelf: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  playlistBody: { flex: 1 },
  playlistName: { fontSize: 15, fontWeight: '700', color: P.text },
  playlistMeta: { fontSize: 13, color: P.muted, marginTop: 2 },
  trackRow: { width: '100%', maxWidth: TRACKS_MAX, alignSelf: 'center', paddingHorizontal: spacing.sm },

  gridRow: { gap: GRID_GAP },
  tile: { marginTop: GRID_GAP, backgroundColor: P.raised, overflow: 'hidden' },
  tileFallback: { alignItems: 'center', justifyContent: 'center' },
  videoBadge: {
    position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: radius.full, width: 20, height: 20, alignItems: 'center', justifyContent: 'center',
  },
  lockBadge: { position: 'absolute', top: 5, left: 5, padding: 3, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.55)' },
  viewsBadge: { position: 'absolute', bottom: 6, left: 6, flexDirection: 'row', alignItems: 'center', gap: 3 },
  viewsBadgeText: {
    color: colors.white, fontSize: 12, fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  more: { marginVertical: spacing.md },
  postsEmpty: { paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg, alignItems: 'center', gap: spacing.sm },
  postsEmptyText: { ...typography.body, color: P.muted },
  postsLockedSub: { ...typography.caption, color: P.dim, textAlign: 'center' },

  skel: { backgroundColor: P.raised, borderRadius: 6 },
  skelGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md },
});

export default ProfileView;

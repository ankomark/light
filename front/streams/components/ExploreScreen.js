// Explore: trending hashtags, people to follow and a trending grid; and search
// across people, hashtags, sounds, groups and posts.
//
// Built to feel instant, like Home and Music:
//   - the last Explore paints straight from cache (memory, then disk) and
//     refreshes behind it — no spinner on every visit;
//   - the grid is a virtualised list that loads more as you scroll;
//   - search keeps the previous results on screen while the next ones load,
//     remembers answers for the session, and ignores late replies to stale
//     queries; recent searches are one tap away.
import React, { useState, useCallback, useEffect, useRef, memo } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  RefreshControl, ScrollView, Keyboard,
} from 'react-native';
import { Image } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialIcons, Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { apiRequest, fetchTrendingHashtags } from '../services/api';
import { useAuth } from '../context/useAuth';
import FollowButton from './FollowButton';
import useGridColumns from '../utils/useGridColumns';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import formatCount from '../utils/formatCount';
import { pushRecent, mergePage, hasResults } from '../utils/exploreLogic';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const GAP = spacing.xs;
const REFRESH_AFTER_MS = 60 * 1000;
const RECENT_MAX = 12;

/**
 * Still-image thumbnail for a post. Videos use the poster frame captured on
 * upload (thumbnail_url) — a video's media URL is a raw .mp4 that can't render
 * as an image. Returns null when there's no still, so the tile shows a
 * placeholder.
 */
const getPostThumb = (post) => (post.content_type === 'video'
  ? post.thumbnail_url || null
  : post.thumbnail_url || post.optimized_url || post.media_url || null);

// ── API ──────────────────────────────────────────────────────────────────────
const fetchTrending = (page = 1) => apiRequest('get', '/explore/trending_posts/', null, { params: { page } });
const fetchSuggested = () => apiRequest('get', '/explore/suggested_users/');
const searchAll = (q) => apiRequest('get', '/explore/search/', null, { params: { q } });

// Search answers for this session: going back to a query is instant.
const searchMemo = new Map();

// ── Pieces ───────────────────────────────────────────────────────────────────
const PostTile = memo(({ post, onPress, size }) => {
  const thumb = getPostThumb(post);
  const isVideo = post.content_type === 'video';
  return (
    <TouchableOpacity style={[styles.tile, { width: size, height: size * 1.25 }]} onPress={() => onPress(post)} activeOpacity={0.85}>
      {thumb ? (
        <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={120} recyclingKey={String(post.id)} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.tilePlaceholder]}>
          <MaterialIcons name={isVideo ? 'videocam' : 'photo'} size={30} color={colors.textMuted} />
        </View>
      )}
      {isVideo && (
        <View style={styles.playBadge}><Ionicons name="play" size={13} color="#fff" /></View>
      )}
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.7)']} style={styles.tileOverlay}>
        <Ionicons name="heart" size={12} color="#fff" />
        <Text style={styles.tileStat}>{formatCount(post.likes_count ?? 0)}</Text>
        <Ionicons name="chatbubble" size={11} color="#fff" style={{ marginLeft: 8 }} />
        <Text style={styles.tileStat}>{formatCount(post.comments_count ?? 0)}</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
});
PostTile.displayName = 'PostTile';

const SkeletonTile = ({ size }) => <View style={[styles.tile, styles.skeleton, { width: size, height: size * 1.25 }]} />;

const Avatar = ({ uri, size }) => (
  <Image
    source={uri ? { uri } : DEFAULT_AVATAR}
    placeholder={DEFAULT_AVATAR}
    cachePolicy="memory-disk"
    contentFit="cover"
    style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surface }}
  />
);

const SuggestedCard = memo(({ user, onPress, t }) => (
  <TouchableOpacity style={styles.suggestedCard} onPress={() => onPress(user)} activeOpacity={0.85}>
    <Avatar uri={user.profile_picture} size={60} />
    <Text style={styles.suggestedName} numberOfLines={1}>@{user.username}</Text>
    <Text style={styles.suggestedMeta} numberOfLines={1}>
      {user.mutual_count > 0
        ? t('explore.mutual', { count: user.mutual_count })
        : t('explore.followers', { count: formatCount(user.followers_count ?? 0) })}
    </Text>
    <View style={styles.suggestedFollow}>
      <FollowButton userId={user.id} initialFollowing={false} initialFollowersCount={user.followers_count} />
    </View>
  </TouchableOpacity>
));
SuggestedCard.displayName = 'SuggestedCard';

const Section = ({ title, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);

// ── Screen ───────────────────────────────────────────────────────────────────
const ExploreScreen = ({ navigation }) => {
  const { t } = useI18n();
  const { currentUser } = useAuth();
  const { cols, tileSize } = useGridColumns({ target: 150, min: 3, max: 6, horizontalPadding: spacing.md * 2, gap: GAP });

  // Discover: painted from cache, refreshed behind it.
  const cacheKey = userKey(currentUser?.id, 'explore:discover');
  const initial = peekCache(cacheKey);
  const [trending, setTrending] = useState(initial?.trending ?? []);
  const [suggested, setSuggested] = useState(initial?.suggested ?? []);
  const [tags, setTags] = useState(initial?.tags ?? []);
  const [loading, setLoading] = useState(!initial);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const pageRef = useRef(1);
  const hasMoreRef = useRef(true);
  const lastFetchRef = useRef(initial ? Date.now() : 0);

  // Search.
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [recent, setRecent] = useState([]);
  const reqRef = useRef(0);
  const recentKey = `@explore:recent:${currentUser?.id ?? 'anon'}`;

  const loadDiscover = useCallback(async ({ pull = false } = {}) => {
    if (pull) setRefreshing(true);
    try {
      const [trend, sugg, hot] = await Promise.all([
        fetchTrending(1), fetchSuggested().catch(() => null), fetchTrendingHashtags().catch(() => null),
      ]);
      const next = {
        trending: Array.isArray(trend) ? trend : [],
        suggested: Array.isArray(sugg) ? sugg : suggested,
        tags: Array.isArray(hot) ? hot : tags,
      };
      setTrending(next.trending);
      setSuggested(next.suggested);
      setTags(next.tags);
      pageRef.current = 1;
      hasMoreRef.current = next.trending.length >= 30;
      lastFetchRef.current = Date.now();
      writeCache(cacheKey, next);
    } catch {
      // keep whatever is on screen; pull to refresh retries
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  // Cold start: the disk copy, if the network hasn't answered first.
  useEffect(() => {
    if (initial) return undefined;
    let cancelled = false;
    readCache(cacheKey).then((c) => {
      if (cancelled || !c) return;
      setTrending((p) => (p.length ? p : c.trending || []));
      setSuggested((p) => (p.length ? p : c.suggested || []));
      setTags((p) => (p.length ? p : c.tags || []));
      setLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  // Refresh on focus — but only when it's been a while, and silently.
  useFocusEffect(useCallback(() => {
    if (Date.now() - lastFetchRef.current > REFRESH_AFTER_MS) loadDiscover();
  }, [loadDiscover]));

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMoreRef.current || loading) return;
    setLoadingMore(true);
    try {
      const next = pageRef.current + 1;
      const rows = await fetchTrending(next);
      const list = Array.isArray(rows) ? rows : [];
      pageRef.current = next;
      hasMoreRef.current = list.length >= 30;
      setTrending((prev) => mergePage(prev, list));
    } catch {
      hasMoreRef.current = false;
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, loading]);

  // Recent searches (per account, on this device).
  useEffect(() => {
    AsyncStorage.getItem(recentKey).then((raw) => {
      try { setRecent(JSON.parse(raw || '[]')); } catch { setRecent([]); }
    }).catch(() => {});
  }, [recentKey]);
  const saveRecent = useCallback((q) => {
    setRecent((prev) => {
      const next = pushRecent(prev, q, RECENT_MAX);
      if (next === prev) return prev;
      AsyncStorage.setItem(recentKey, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, [recentKey]);
  const removeRecent = useCallback((term) => {
    setRecent((prev) => {
      const next = prev.filter((r) => r !== term);
      AsyncStorage.setItem(recentKey, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, [recentKey]);
  const clearRecent = useCallback(() => {
    setRecent([]);
    AsyncStorage.removeItem(recentKey).catch(() => {});
  }, [recentKey]);

  // Debounced search: previous results stay up while the next load; a late
  // answer to an older query is dropped; answers are remembered.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults(null); setSearching(false); return undefined; }
    if (searchMemo.has(q.toLowerCase())) {
      setResults(searchMemo.get(q.toLowerCase()));
      setSearching(false);
      return undefined;
    }
    const req = ++reqRef.current;
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await searchAll(q);
        if (req !== reqRef.current) return;
        searchMemo.set(q.toLowerCase(), res);
        setResults(res);
        if (hasResults(res)) saveRecent(q);
      } catch {
        if (req === reqRef.current) setResults({ users: [], hashtags: [], posts: [], tracks: [], groups: [] });
      } finally {
        if (req === reqRef.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query, saveRecent]);

  const openPost = useCallback((post) => navigation.navigate('PostDetail', { postId: post.id }), [navigation]);
  const openUser = useCallback((user) => navigation.navigate('UserProfile', { userId: user.id, username: user.username }), [navigation]);
  const openTag = useCallback((tag) => navigation.navigate('Hashtag', { tag }), [navigation]);
  const openTrack = useCallback((track) => navigation.navigate('TrackDetail', { trackId: track.id, track }), [navigation]);

  const renderTile = useCallback(({ item }) => <PostTile post={item} onPress={openPost} size={tileSize} />, [openPost, tileSize]);

  // ── discover ──
  const discoverHeader = (
    <View>
      {tags.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tagRow}>
          {tags.slice(0, 15).map((h) => (
            <TouchableOpacity key={h.tag} style={styles.tagChip} onPress={() => openTag(h.tag)} activeOpacity={0.85}>
              <Text style={styles.tagHash}>#</Text>
              <Text style={styles.tagText} numberOfLines={1}>{h.tag}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      {suggested.length > 0 && (
        <Section title={t('explore.peopleToFollow')}>
          <FlatList
            horizontal
            data={suggested}
            keyExtractor={(u) => `sg_${u.id}`}
            renderItem={({ item }) => <SuggestedCard user={item} onPress={openUser} t={t} />}
            contentContainerStyle={styles.suggestedRow}
            showsHorizontalScrollIndicator={false}
          />
        </Section>
      )}
      <Text style={[styles.sectionTitle, styles.gridTitle]}>{t('explore.trending')}</Text>
    </View>
  );

  const renderDiscover = () => (
    <FlatList
      key={`grid-${cols}`}
      data={trending}
      numColumns={cols}
      keyExtractor={(p) => `tr_${p.id}`}
      renderItem={renderTile}
      columnWrapperStyle={cols > 1 ? styles.gridRow : undefined}
      contentContainerStyle={styles.gridContent}
      ListHeaderComponent={discoverHeader}
      ListEmptyComponent={loading ? (
        <View style={[styles.gridRow, styles.skeletonGrid]}>
          {Array.from({ length: cols * 3 }, (_, i) => <SkeletonTile key={i} size={tileSize} />)}
        </View>
      ) : (
        <View style={styles.centered}>
          <MaterialIcons name="explore" size={52} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('explore.nothingTrending')}</Text>
        </View>
      )}
      onEndReached={loadMore}
      onEndReachedThreshold={0.6}
      ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.more} color={colors.primary} /> : null}
      refreshControl={(
        <RefreshControl refreshing={refreshing} onRefresh={() => loadDiscover({ pull: true })} tintColor="#fff" colors={[colors.primary]} />
      )}
      initialNumToRender={cols * 4}
      maxToRenderPerBatch={cols * 4}
      windowSize={7}
      removeClippedSubviews
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    />
  );

  // ── recent searches (focused, nothing typed) ──
  const renderRecent = () => (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.recentWrap}>
      {recent.length > 0 ? (
        <>
          <View style={styles.recentHead}>
            <Text style={styles.sectionTitleSmall}>{t('explore.recent')}</Text>
            <TouchableOpacity onPress={clearRecent} hitSlop={8}>
              <Text style={styles.clearText}>{t('explore.clearAll')}</Text>
            </TouchableOpacity>
          </View>
          {recent.map((term) => (
            <TouchableOpacity key={term} style={styles.recentRow} onPress={() => setQuery(term)} activeOpacity={0.7}>
              <Feather name="clock" size={16} color={colors.textMuted} />
              <Text style={styles.recentText} numberOfLines={1}>{term}</Text>
              <TouchableOpacity onPress={() => removeRecent(term)} hitSlop={10}>
                <Feather name="x" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
        </>
      ) : (
        <Text style={styles.hintText}>{t('explore.searchHint')}</Text>
      )}
    </ScrollView>
  );

  // ── search results ──
  const renderResults = () => {
    if (!results) {
      return searching ? <ActivityIndicator style={styles.more} color={colors.primary} /> : null;
    }
    const { users = [], hashtags = [], posts = [], tracks = [], groups = [] } = results;
    if (!hasResults(results)) {
      return (
        <View style={styles.centered}>
          <MaterialIcons name="search-off" size={48} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('explore.noResults', { q: query.trim() })}</Text>
        </View>
      );
    }
    const header = (
      <View>
        {users.length > 0 && (
          <Section title={t('explore.people')}>
            {users.map((u) => (
              <TouchableOpacity key={`u_${u.id}`} style={styles.resultRow} onPress={() => openUser(u)} activeOpacity={0.7}>
                <Avatar uri={u.profile_picture} size={42} />
                <View style={styles.resultInfo}>
                  <Text style={styles.resultName} numberOfLines={1}>@{u.username}</Text>
                  <Text style={styles.resultSub}>{t('explore.followers', { count: formatCount(u.followers_count ?? 0) })}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </Section>
        )}
        {hashtags.length > 0 && (
          <Section title={t('explore.hashtags')}>
            {hashtags.map((h) => (
              <TouchableOpacity key={`h_${h.tag}`} style={styles.resultRow} onPress={() => openTag(h.tag)} activeOpacity={0.7}>
                <View style={styles.hashIcon}><Text style={styles.hashIconText}>#</Text></View>
                <View style={styles.resultInfo}>
                  <Text style={styles.resultName} numberOfLines={1}>{h.tag}</Text>
                  <Text style={styles.resultSub}>{t('sound.uses', { count: formatCount(h.count) })}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </Section>
        )}
        {tracks.length > 0 && (
          <Section title={t('explore.music')}>
            {tracks.map((track) => (
              <TouchableOpacity key={`t_${track.id}`} style={styles.resultRow} onPress={() => openTrack(track)} activeOpacity={0.7}>
                <View style={styles.trackThumb}>
                  {track.cover_image
                    ? <Image source={{ uri: track.cover_image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
                    : <MaterialIcons name="music-note" size={20} color={colors.primary} />}
                </View>
                <View style={styles.resultInfo}>
                  <Text style={styles.resultName} numberOfLines={1}>{track.title}</Text>
                  <Text style={styles.resultSub} numberOfLines={1}>{track.artist?.username}</Text>
                </View>
                <Ionicons name="play-circle" size={24} color={colors.primary} />
              </TouchableOpacity>
            ))}
          </Section>
        )}
        {groups.length > 0 && (
          <Section title={t('explore.groups')}>
            {groups.map((group) => (
              <TouchableOpacity
                key={`g_${group.id}`}
                style={styles.resultRow}
                activeOpacity={0.7}
                onPress={() => navigation.navigate('GroupDetail', { groupSlug: group.slug, group })}
              >
                <View style={styles.trackThumb}><Ionicons name="people" size={20} color={colors.primary} /></View>
                <View style={styles.resultInfo}>
                  <Text style={styles.resultName} numberOfLines={1}>{group.name}</Text>
                  <Text style={styles.resultSub}>
                    {group.is_private ? t('explore.privateGroup') : t('explore.publicGroup')} · {t('explore.members', { count: group.members_count ?? 0 })}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </Section>
        )}
        {posts.length > 0 && <Text style={[styles.sectionTitle, styles.gridTitle]}>{t('explore.posts')}</Text>}
      </View>
    );
    return (
      <FlatList
        key={`res-${cols}`}
        data={posts}
        numColumns={cols}
        keyExtractor={(p) => `sp_${p.id}`}
        renderItem={renderTile}
        columnWrapperStyle={cols > 1 ? styles.gridRow : undefined}
        contentContainerStyle={styles.gridContent}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={Keyboard.dismiss}
        showsVerticalScrollIndicator={false}
      />
    );
  };

  const typed = query.trim().length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.placeholder} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('explore.searchPlaceholder')}
          placeholderTextColor={colors.placeholder}
          value={query}
          onChangeText={setQuery}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={() => saveRecent(query)}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {searching && typed && <ActivityIndicator size="small" color={colors.primary} style={styles.searchSpinner} />}
        {typed ? (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        ) : focused ? (
          <TouchableOpacity onPress={() => Keyboard.dismiss()} hitSlop={8}>
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {typed ? renderResults() : focused ? renderRecent() : renderDiscover()}
    </View>
  );
};

const GLASS = 'rgba(16,28,46,0.85)';
const HAIRLINE = 'rgba(255,255,255,0.10)';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: 'rgba(13,35,64,0.85)', borderRadius: radius.full,
    marginHorizontal: spacing.md, marginVertical: spacing.sm, paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)', height: 44,
  },
  searchIcon: { marginRight: 2 },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 15, paddingVertical: 0 },
  searchSpinner: { marginRight: 4 },
  cancelText: { color: colors.primary, fontSize: 14, fontWeight: '700' },

  tagRow: { paddingHorizontal: spacing.md, gap: spacing.xs, paddingBottom: spacing.sm },
  tagChip: {
    flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: GLASS, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(29,161,242,0.45)',
  },
  tagHash: { color: colors.primary, fontWeight: '900', fontSize: 14 },
  tagText: { color: colors.textPrimary, fontWeight: '700', fontSize: 13, maxWidth: 140 },

  section: { marginBottom: spacing.md },
  sectionTitle: {
    ...typography.h3, color: colors.textPrimary, paddingHorizontal: spacing.md,
    marginBottom: spacing.sm, marginTop: spacing.xs,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  sectionTitleSmall: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  gridTitle: { marginBottom: spacing.sm },

  suggestedRow: { paddingHorizontal: spacing.md, gap: spacing.sm },
  suggestedCard: {
    width: 118, backgroundColor: GLASS, borderRadius: radius.lg, padding: spacing.sm,
    alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE,
  },
  suggestedName: { ...typography.caption, color: colors.textPrimary, fontWeight: '700', marginTop: spacing.xs, maxWidth: '100%' },
  suggestedMeta: { ...typography.caption, color: colors.textMuted, marginTop: 1, fontSize: 11 },
  suggestedFollow: { marginTop: spacing.xs, transform: [{ scale: 0.85 }] },

  gridContent: { paddingBottom: spacing.xxl },
  gridRow: { gap: GAP, paddingHorizontal: spacing.md, marginBottom: GAP },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: {
    borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
  },
  skeleton: { backgroundColor: 'rgba(255,255,255,0.07)' },
  tilePlaceholder: { justifyContent: 'center', alignItems: 'center' },
  playBadge: {
    position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  tileOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 34,
    flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 6, paddingBottom: 5,
  },
  tileStat: { color: '#fff', fontSize: 11, fontWeight: '700', marginLeft: 3 },
  more: { marginVertical: spacing.md },

  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl * 1.5, gap: spacing.sm, paddingHorizontal: spacing.lg },
  emptyText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },

  recentWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  recentHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: spacing.sm },
  clearText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  recentRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE,
  },
  recentText: { flex: 1, color: colors.textPrimary, fontSize: 15 },
  hintText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', marginTop: spacing.xl },

  resultRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginHorizontal: spacing.md, marginBottom: spacing.xs,
    backgroundColor: 'rgba(16,28,46,0.82)', borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE,
  },
  resultInfo: { flex: 1 },
  resultName: { ...typography.label, color: colors.textPrimary },
  resultSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  hashIcon: {
    width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(29,161,242,0.16)',
  },
  hashIconText: { color: colors.primary, fontSize: 20, fontWeight: '900' },
  trackThumb: {
    width: 42, height: 42, borderRadius: radius.sm, backgroundColor: colors.surface,
    justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
  },
});

export default ExploreScreen;

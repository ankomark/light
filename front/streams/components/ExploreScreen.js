import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, FlatList, Image, TouchableOpacity,
  StyleSheet, ActivityIndicator, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { apiRequest } from '../services/api';
import useGridColumns from '../utils/useGridColumns';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

/**
 * Build a still-image thumbnail for a post. For videos we ask Cloudinary for a
 * single extracted frame (so_0 = first frame) as a JPG, so the grid shows a
 * poster image instead of a blank <Image> that can't render an .mp4.
 */
const getPostThumb = (post) => {
  const url = post.optimized_url || post.media_url;
  if (!url) return null;
  if (post.content_type === 'video') {
    return url
      .replace('/video/upload/', '/video/upload/so_0,w_600,h_600,c_fill/')
      .replace(/\.(mp4|mov|webm|m4v)$/i, '.jpg');
  }
  return url;
};

// ── API helpers ───────────────────────────────────────────────────────────────
const fetchTrending = () => apiRequest('get', '/explore/trending_posts/');
const fetchSuggested = () => apiRequest('get', '/explore/suggested_users/');
const searchAll = (q) => apiRequest('get', `/explore/search/?q=${encodeURIComponent(q)}`);

// ── Sub-components ────────────────────────────────────────────────────────────
const SuggestedUser = ({ user, onPress }) => (
  <TouchableOpacity style={styles.suggestedCard} onPress={() => onPress(user)} activeOpacity={0.8}>
    <Image
      source={user.profile_picture ? { uri: user.profile_picture } : DEFAULT_AVATAR}
      defaultSource={DEFAULT_AVATAR}
      style={styles.suggestedAvatar}
    />
    <Text style={styles.suggestedName} numberOfLines={1}>@{user.username}</Text>
    <Text style={styles.suggestedFollowers}>
      {user.followers_count ?? 0} followers
    </Text>
  </TouchableOpacity>
);

const TrendingPostCard = ({ post, onPress, size }) => {
  const thumb = getPostThumb(post);
  const isVideo = post.content_type === 'video';
  return (
    <TouchableOpacity style={[styles.gridCard, { width: size, height: size }]} onPress={() => onPress(post)} activeOpacity={0.85}>
      {thumb ? (
        <Image source={{ uri: thumb }} style={styles.gridImage} resizeMode="cover" />
      ) : (
        <View style={[styles.gridImage, styles.gridPlaceholder]}>
          <MaterialIcons name={isVideo ? 'videocam' : 'photo'} size={32} color={colors.textMuted} />
        </View>
      )}

      {isVideo && (
        <View style={styles.playBadge}>
          <Ionicons name="play" size={14} color="#fff" />
        </View>
      )}

      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.7)']}
        style={styles.gridOverlay}
      >
        <View style={styles.gridStats}>
          <Ionicons name="heart" size={12} color="#fff" />
          <Text style={styles.gridStatText}>{post.likes_count ?? 0}</Text>
          <Ionicons name="chatbubble" size={12} color="#fff" style={{ marginLeft: 6 }} />
          <Text style={styles.gridStatText}>{post.comments_count ?? 0}</Text>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
};

const SearchUserRow = ({ user, onPress }) => (
  <TouchableOpacity style={styles.resultRow} onPress={() => onPress(user)} activeOpacity={0.7}>
    <Image
      source={user.profile_picture ? { uri: user.profile_picture } : DEFAULT_AVATAR}
      defaultSource={DEFAULT_AVATAR}
      style={styles.resultAvatar}
    />
    <View style={styles.resultInfo}>
      <Text style={styles.resultName}>@{user.username}</Text>
    </View>
    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
  </TouchableOpacity>
);

// ── Main Screen ───────────────────────────────────────────────────────────────
const ExploreScreen = ({ navigation }) => {
  // Responsive grid tile: 2 across on a phone, more on tablets / landscape.
  const { tileSize } = useGridColumns({
    target: 175, min: 2, max: 5, horizontalPadding: spacing.md * 2, gap: spacing.xs,
  });
  const [query, setQuery] = useState('');
  const [trending, setTrending] = useState([]);
  const [suggested, setSuggested] = useState([]);
  const [searchResults, setSearchResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);

  const loadDiscover = useCallback(async () => {
    try {
      setLoading(true);
      const [trendData, suggestData] = await Promise.all([fetchTrending(), fetchSuggested()]);
      setTrending(Array.isArray(trendData) ? trendData : []);
      setSuggested(Array.isArray(suggestData) ? suggestData : []);
    } catch {
      // silent — no data shown
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadDiscover(); }, [loadDiscover]));

  // Debounced search
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!query.trim()) { setSearchResults(null); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await searchAll(query.trim());
        setSearchResults(res);
      } catch {
        setSearchResults({ users: [], posts: [], tracks: [] });
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const openPost = useCallback((post) => {
    navigation.navigate('PostDetail', { postId: post.id });
  }, [navigation]);

  const openUser = useCallback((user) => {
    navigation.navigate('UserProfile', { userId: user.id, username: user.username });
  }, [navigation]);

  // ── Discover mode (no query) ──
  const renderDiscover = () => (
    <ScrollView showsVerticalScrollIndicator={false}>
      {/* Suggested people */}
      {suggested.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>People to Follow</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.suggestedRow}>
            {suggested.map(u => (
              <SuggestedUser key={u.id} user={u} onPress={openUser} />
            ))}
          </ScrollView>
        </View>
      )}

      {/* Trending posts grid */}
      {trending.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Trending This Week</Text>
          <View style={styles.grid}>
            {trending.map(post => (
              <TrendingPostCard key={post.id} post={post} onPress={openPost} size={tileSize} />
            ))}
          </View>
        </View>
      )}

      {!loading && trending.length === 0 && suggested.length === 0 && (
        <View style={styles.centered}>
          <MaterialIcons name="explore" size={52} color={colors.textMuted} />
          <Text style={styles.emptyText}>Nothing trending yet</Text>
        </View>
      )}
    </ScrollView>
  );

  // ── Search results mode ──
  const renderSearch = () => {
    if (searching) {
      return <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary} /></View>;
    }
    if (!searchResults) return null;
    const { users = [], posts = [], tracks = [], groups = [] } = searchResults;
    const hasResults = users.length || posts.length || tracks.length || groups.length;

    if (!hasResults) {
      return (
        <View style={styles.centered}>
          <MaterialIcons name="search-off" size={48} color={colors.textMuted} />
          <Text style={styles.emptyText}>No results for "{query}"</Text>
        </View>
      );
    }

    return (
      <ScrollView showsVerticalScrollIndicator={false}>
        {users.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>People</Text>
            {users.map(u => <SearchUserRow key={u.id} user={u} onPress={openUser} />)}
          </View>
        )}
        {posts.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Posts</Text>
            <View style={styles.grid}>
              {posts.map(post => <TrendingPostCard key={post.id} post={post} onPress={openPost} size={tileSize} />)}
            </View>
          </View>
        )}
        {tracks.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Music</Text>
            {tracks.map(track => (
              <TouchableOpacity key={track.id} style={styles.resultRow} activeOpacity={0.7}>
                <View style={styles.trackThumb}>
                  {track.cover_image
                    ? <Image source={{ uri: track.cover_image }} style={styles.trackThumbImg} />
                    : <MaterialIcons name="music-note" size={20} color={colors.primary} />
                  }
                </View>
                <View style={styles.resultInfo}>
                  <Text style={styles.resultName}>{track.title}</Text>
                  <Text style={styles.resultSub}>{track.artist?.username}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {(searchResults.groups ?? []).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Groups</Text>
            {searchResults.groups.map(group => (
              <TouchableOpacity
                key={group.id}
                style={styles.resultRow}
                activeOpacity={0.7}
                onPress={() => navigation.navigate('GroupDetail', { groupSlug: group.slug, group })}
              >
                <View style={[styles.trackThumb, { backgroundColor: colors.surface }]}>
                  <Ionicons name="people" size={20} color={colors.primary} />
                </View>
                <View style={styles.resultInfo}>
                  <Text style={styles.resultName}>{group.name}</Text>
                  <Text style={styles.resultSub}>
                    {group.is_private ? '🔒 Private' : '🌐 Public'} · {group.members_count ?? 0} members
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    );
  };

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.placeholder} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search people, posts, music..."
          placeholderTextColor={colors.placeholder}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {loading && !query
        ? <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary} /></View>
        : query ? renderSearch() : renderDiscover()
      }
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(13,35,64,0.78)',
    borderRadius: radius.full,
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    height: 44,
  },
  searchIcon: { marginRight: spacing.xs },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 15 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xxl * 2,
    gap: spacing.sm,
  },
  emptyText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  section: { marginBottom: spacing.lg },
  sectionTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  // Suggested people
  suggestedRow: { paddingHorizontal: spacing.md, gap: spacing.sm },
  suggestedCard: {
    width: 100,
    backgroundColor: 'rgba(16,28,46,0.85)',
    borderRadius: radius.lg,
    padding: spacing.sm,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  suggestedAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    marginBottom: spacing.xs,
  },
  suggestedName: { ...typography.caption, color: colors.textPrimary, fontWeight: '600', textAlign: 'center' },
  suggestedFollowers: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: 2 },
  // Trending grid
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
  gridCard: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  gridImage: { width: '100%', height: '100%' },
  gridPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  playBadge: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 36,
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.xs,
  },
  gridStats: { flexDirection: 'row', alignItems: 'center' },
  gridStatText: { ...typography.caption, color: '#fff', marginLeft: 2 },
  // Search results
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    backgroundColor: 'rgba(16,28,46,0.82)',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
    gap: spacing.sm,
  },
  resultAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface },
  resultInfo: { flex: 1 },
  resultName: { ...typography.label, color: colors.textPrimary },
  resultSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  trackThumb: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  trackThumbImg: { width: '100%', height: '100%' },
});

export default ExploreScreen;

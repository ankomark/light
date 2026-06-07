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
} from 'react-native';
import { Video, Audio } from 'expo-av';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/useAuth';
import SearchBaar from '../components/SearchBaar';
import { fetchSocialPosts } from '../services/api';
import FollowButton from '../components/FollowButton';
import PostActions from './PostActions';
import CommentAction from './CommentAction';
import { DownloadButton, SaveButton, LikeButton } from './SocialActions';
import { PostSkeleton } from './SkeletonLoader';
import StoriesBar from './StoriesBar';
import { colors, radius, typography, shadows } from '../constants/theme';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const AVATAR_FAILED = '__failed__';

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

  return {
    ...post,
    user: {
      id: post.user?.id || 0,
      username: String(post.user?.username || 'Unknown'),
      profile_picture: profilePic,
      followers_count: userFollowersCount,
      is_following: userIsFollowing
    },
    mediaUrl: post.optimized_url || post.media_url,
    thumbnailUrl: post.optimized_url || post.media_url
  };
};

const PostMedia = React.memo(function PostMedia({ item, videoRefs, isFocused }) {
  const [currentUrl, setCurrentUrl] = useState(item.mediaUrl);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setCurrentUrl(item.mediaUrl);
    setIsLoading(true);
    setHasError(false);
  }, [item.id, item.mediaUrl]);

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
      <View style={styles.mediaContainer}>
        {isLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        )}
        <Video
          ref={ref => ref && (videoRefs.current[item.id] = ref)}
          source={{ uri: currentUrl }}
          style={styles.media}
          useNativeControls
          resizeMode="contain"
          isLooping
          shouldPlay={false}
          onError={handleError}
          onLoad={handleLoad}
        />
      </View>
    );
  }

  return (
    <View style={styles.mediaContainer}>
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#1DA1F2" />
        </View>
      )}
      <Image
        source={{ uri: currentUrl }}
        style={[styles.media, isLoading && { opacity: 0 }]}
        resizeMode="contain"
        onError={handleError}
        onLoad={handleLoad}
      />
    </View>
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
  const [error, setError] = useState(null);
  const [followStates, setFollowStates] = useState({});
  const navigation = useNavigation();
  const videoRefs = useRef({});
  const audioRef = useRef(null);
  const { currentUser } = useAuth();
  const lastFetchTimeRef = useRef(0);
  const [currentlyPlayingPostId, setCurrentlyPlayingPostId] = useState(null);

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
    }, [loadPosts])
  );

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const playSong = async (post) => {
    if (!post?.song?.audio_url || currentlyPlayingPostId === post.id) return;
    try {
      if (audioRef.current) await stopSong();
      const { sound } = await Audio.Sound.createAsync(
        { uri: post.song.audio_url },
        { shouldPlay: false }
      );
      audioRef.current = sound;
      setCurrentlyPlayingPostId(post.id);
      const startPosition = (post.song.start_time || 0) * 1000;
      await sound.playFromPositionAsync(startPosition);
      if (post.song.end_time) {
        const duration = (post.song.end_time - (post.song.start_time || 0)) * 1000;
        setTimeout(async () => {
          if (audioRef.current && currentlyPlayingPostId === post.id) {
            await stopSong();
          }
        }, duration);
      }
    } catch {
      // Audio failed — continue silently
    }
  };

  const stopSong = async () => {
    if (audioRef.current) {
      try {
        await audioRef.current.stopAsync();
        await audioRef.current.unloadAsync();
      } catch {
      } finally {
        audioRef.current = null;
        setCurrentlyPlayingPostId(null);
      }
    }
  };

  const onViewableItemsChanged = useRef(({ changed }) => {
    changed.forEach(item => {
      if (item.isViewable && 
          item.item.content_type === 'image' && 
          item.item.song?.audio_url) {
        playSong(item.item);
      } else if (!item.isViewable && 
                currentlyPlayingPostId === item.item.id) {
        stopSong();
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
    setPosts(prev => prev.map(post => 
      post.id === updatedPost.id ? updatedPost : post
    ));
  }, []);

  const handlePostDelete = useCallback(postId => {
    setPosts(prev => prev.filter(post => post.id !== postId));
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
          <View style={styles.userTextContainer}>
            <Text style={styles.username}>{String(item.user.username || 'Unknown user')}</Text>
            <Text style={styles.followersText}>
              {typeof item.user.followers_count === 'number' ? item.user.followers_count : 0} followers
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
        <LikeButton 
          postId={item.id} 
          initialLikes={item.likes_count || 0} 
          isLiked={item.is_liked || false} 
        />
        <CommentAction 
          postId={item.id} 
          commentCount={item.comments_count || 0} 
        />
        <DownloadButton 
          publicId={item.media_file} 
          contentType={item.content_type} 
        />
        <SaveButton 
          postId={item.id} 
          initialSaved={item.is_saved || false} 
        />
      </View>
      <View style={styles.postInfo}>
        {item.caption && <Text style={styles.caption} numberOfLines={3}>{item.caption}</Text>}
        {item.location && (
          <Text style={styles.location}>
            <Feather name="map-pin" size={14} color={colors.textSecondary} /> {item.location}
          </Text>
        )}
        <Text style={styles.timestamp}>
          {new Date(item.created_at).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
          })}
        </Text>
      </View>
    </View>
  ), []);

  const renderItem = useCallback(({ item }) => (
    <View style={styles.postContainer}>
      {renderPostHeader({ item })}
      <PostMedia 
        item={item} 
        videoRefs={videoRefs}
        isFocused={currentlyPlayingPostId === item.id} 
      />
      {renderPostFooter({ item })}
    </View>
  ), [renderPostHeader, renderPostFooter, currentlyPlayingPostId]);

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
      <StoriesBar navigation={navigation} />
      <SearchBaar
        onSearch={handleSearch}
        placeholder="Search posts, users, locations..."
      />

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

      <TouchableOpacity
        style={styles.topFab}
        onPress={() => navigation.navigate('CreatePost')}
        activeOpacity={0.8}
      >
        <MaterialIcons name="add" size={28} color={colors.white} />
      </TouchableOpacity>

      {newPostsAvailable && (
        <TouchableOpacity style={styles.newPostsPill} onPress={handleShowNewPosts} activeOpacity={0.85}>
          <MaterialIcons name="arrow-upward" size={16} color={colors.white} />
          <Text style={styles.newPostsText}>New posts</Text>
        </TouchableOpacity>
      )}

      <FlatList
        ref={flatListRef}
        data={posts}
        renderItem={renderItem}
        ListEmptyComponent={renderEmptyComponent}
        keyExtractor={keyExtractor}
        contentContainerStyle={[
          styles.listContent,
          posts.length === 0 && styles.emptyListContent
        ]}
        refreshing={refreshing}
        onRefresh={handleRefresh}
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

  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingBottom: 6,
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
    borderRadius: 12,
    marginVertical: 10,
    marginHorizontal: 12,
    overflow: 'hidden',
    ...shadows.sm,
  },

  postHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
  },

  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },

  profileImage: {
    width: 42,
    height: 42,
    borderRadius: 21,
    marginRight: 10,
    backgroundColor: colors.surface,
  },

  userTextContainer: {
    justifyContent: 'center',
  },

  username: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },

  followersText: {
    fontSize: 12,
    color: colors.textSecondary,
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
    padding: 12,
  },

  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },

  postInfo: {
    marginTop: 8,
  },

  caption: {
    fontSize: 14.5,
    color: colors.textPrimary,
    lineHeight: 20,
    marginBottom: 6,
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
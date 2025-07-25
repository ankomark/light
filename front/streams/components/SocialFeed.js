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
import { Video } from 'expo-av';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/useAuth';
import SearchBaar from '../components/SearchBaar';
import { fetchSocialPosts } from '../services/api';
import FollowButton from '../components/FollowButton';
import PostActions from './PostActions';
// import LikeButton from './LikeButton';
import CommentAction from './CommentAction';
import { DownloadButton, SaveButton,LikeButton } from './SocialActions';

const DEFAULT_PROFILE_IMAGE = 'https://via.placeholder.com/150';

// Simplified URL handler - only processes profile images
const getOptimizedUrl = (url, type = 'image') => {
  if (!url) return null;
  
  // Only process profile images
  if (type === 'profile' && url.includes('res.cloudinary.com')) {
    return url.replace('/upload/', '/upload/w_50,h_50,c_fill/');
  }
  
  return url; // Return original URL for all other cases
};

// Updated to use backend's optimized_url
const processPost = (post) => {
  let mediaUrl = post.optimized_url || post.media_url;
  
  // Fallback for auto-upload URLs
  if (mediaUrl?.includes('/auto/upload/')) {
    const parts = mediaUrl.split('/auto/upload/');
    const ext = post.content_type === 'image' ? '.jpg' : '.mp4';
    mediaUrl = `https://res.cloudinary.com/dxdmo9j4v/${post.content_type}/upload/${parts[1]}${ext}`;
  }
  
  return {
    ...post,
    mediaUrl,
    thumbnailUrl: mediaUrl,
    user: {
      ...post.user,
      profile_picture: post.user?.profile_picture || DEFAULT_PROFILE_IMAGE
    }
  };
};;

// Simplified media component with better error handling
const PostMedia = ({ item, videoRefs }) => {
  const [currentUrl, setCurrentUrl] = useState(item.mediaUrl);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // Reset states when item changes
  useEffect(() => {
    setCurrentUrl(item.mediaUrl);
    setIsLoading(true);
    setHasError(false);
    setDimensions({ width: 0, height: 0 });
  }, [item.id, item.mediaUrl]);

  const handleError = useCallback(() => {
    // Only try original media_url as fallback
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
        <MaterialIcons name="broken-image" size={48} color="#ccc" />
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
            <ActivityIndicator size="large" color="#1DA1F2" />
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
};

const SocialFeed = () => {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState(null);
  
  const navigation = useNavigation();
  const videoRefs = useRef({});
  const { currentUser } = useAuth();
  const loadingTimeoutRef = useRef(null);
  const lastFetchTimeRef = useRef(0);

  const filteredPosts = useMemo(() => {
    if (!searchQuery.trim()) return posts;
    const lowerQuery = searchQuery.toLowerCase().trim();
    return posts.filter(post => 
      (post.caption?.toLowerCase()?.includes(lowerQuery) ||
      post.user?.username?.toLowerCase()?.includes(lowerQuery) ||
      post.location?.toLowerCase()?.includes(lowerQuery))
    );
  }, [searchQuery, posts]);

  const loadPosts = useCallback(async (isRefresh = false) => {
    const now = Date.now();
    if (!isRefresh && now - lastFetchTimeRef.current < 5000) {
      return;
    }

    try {
      isRefresh ? setRefreshing(true) : setLoading(true);
      setError(null);

      loadingTimeoutRef.current = setTimeout(() => {
        isRefresh ? setRefreshing(false) : setLoading(false);
      }, 15000);

      const data = await fetchSocialPosts();
      
      if (!Array.isArray(data)) {
        throw new Error('Invalid data format');
      }

      const processedPosts = data.map(processPost);
      const sortedPosts = processedPosts.sort((a, b) => 
        new Date(b.created_at) - new Date(a.created_at)
      );
      
      setPosts(sortedPosts);
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
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const handleRefresh = useCallback(() => loadPosts(true), [loadPosts]);

  useEffect(() => {
    loadPosts();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!refreshing && !loading) {
        loadPosts();
      }
    }, 300000);
    
    return () => clearInterval(interval);
  }, [refreshing, loading, loadPosts]);

  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - lastFetchTimeRef.current > 120000) {
        loadPosts();
      }
    }, [loadPosts])
  );

  const onViewableItemsChanged = useRef(({ changed }) => {
    changed.forEach(item => {
      const videoRef = videoRefs.current[item.key];
      if (videoRef) {
        item.isViewable 
          ? videoRef.playAsync().catch(console.error)
          : videoRef.pauseAsync().catch(console.error);
      }
    });
  }).current;

  const viewabilityConfig = useMemo(() => ({
    itemVisiblePercentThreshold: 80,
    waitForInteraction: false,
    minimumViewTime: 100,
  }), []);

  const handleFollowChange = useCallback((userId, data) => {
    setPosts(prev => prev.map(post => 
      post.user.id === userId 
        ? { ...post, user: { ...post.user, ...data } }
        : post
    ));
  }, []);

  const handlePostUpdate = useCallback(updatedPost => {
    setPosts(prev => prev.map(post => 
      post.id === updatedPost.id ? updatedPost : post
    ));
  }, []);

  const handlePostDelete = useCallback(postId => {
    setPosts(prev => prev.filter(post => post.id !== postId));
  }, []);

  const renderPostHeader = useCallback(({ item }) => (
    <View style={styles.postHeader}>
      <View style={styles.userInfo}>
        <Image
          source={{ uri: item.user.profile_picture }}
          style={styles.profileImage}
          defaultSource={{ uri: DEFAULT_PROFILE_IMAGE }}
          onError={() => setPosts(prev => prev.map(p => 
            p.id === item.id 
              ? { ...p, user: { ...p.user, profile_picture: DEFAULT_PROFILE_IMAGE } }
              : p
          ))}
        />
        <View style={styles.userTextContainer}>
          <Text style={styles.username}>{item.user.username}</Text>
          <Text style={styles.followersText}>
            {item.user.followers_count || 0} followers
          </Text>
        </View>
      </View>
      <View style={styles.headerActions}>
        {currentUser?.id !== item.user.id && (
          <FollowButton 
            userId={item.user.id}
            initialFollowing={item.user.is_following}
            onFollowChange={(data) => handleFollowChange(item.user.id, data)}
          />
        )}
        {item.can_edit && (
          <PostActions 
            post={item} 
            onUpdate={handlePostUpdate}
            onDelete={() => handlePostDelete(item.id)}
          />
        )}
      </View>
    </View>
  ), [currentUser?.id, handleFollowChange, handlePostUpdate, handlePostDelete]);

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
            <Feather name="map-pin" size={14} color="#FFF" /> {item.location}
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
      />
      {renderPostFooter({ item })}
    </View>
  ), [renderPostHeader, renderPostFooter]);

  const renderEmptyComponent = useCallback(() => {
    if (loading) return null;
    return (
      <View style={styles.emptyContainer}>
        {error ? (
          <>
            <MaterialIcons name="error-outline" size={48} color="#666" />
            <Text style={styles.errorText}>
              {error.message.includes('Session expired')
                ? 'Session expired. Please log in again.'
                : error.response?.status === 500
                  ? 'Server error. Please try again.'
                  : 'Failed to load posts.'}
            </Text>
            <TouchableOpacity 
              style={styles.retryButton}
              onPress={() => loadPosts()}
            >
              <Text style={styles.retryButtonText}>Try Again</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <MaterialIcons name="photo-library" size={48} color="#666" />
            <Text style={styles.emptyText}>
              {searchQuery ? `No results for "${searchQuery}"` : 'No posts to show'}
            </Text>
            {!searchQuery && (
              <TouchableOpacity 
                style={styles.createFirstPostButton}
                onPress={() => navigation.navigate('CreatePost')}
              >
                <Text style={styles.createFirstPostText}>Create First Post</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    );
  }, [loading, error, searchQuery, navigation, loadPosts]);

  const keyExtractor = useCallback(item => `post_${item.id}`, []);
  const getItemLayout = useCallback((_, index) => ({
    length: 400,
    offset: 400 * index,
    index,
  }), []);

  return (
    <View style={styles.container}>
      <SearchBaar 
        onSearch={setSearchQuery} 
        placeholder="Search posts, users, locations..."
      />

      <TouchableOpacity
        style={styles.topFab}
        onPress={() => navigation.navigate('CreatePost')}
        activeOpacity={0.8}
      >
        <MaterialIcons name="add" size={28} color="white" />
      </TouchableOpacity>

      <FlatList
        data={filteredPosts}
        renderItem={renderItem}
        ListEmptyComponent={renderEmptyComponent}
        keyExtractor={keyExtractor}
        contentContainerStyle={[
          styles.listContent,
          filteredPosts.length === 0 && styles.emptyListContent
        ]}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        showsVerticalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        removeClippedSubviews
        maxToRenderPerBatch={5}
        updateCellsBatchingPeriod={100}
        initialNumToRender={3}
        windowSize={10}
        getItemLayout={getItemLayout}
      />

      {loading && !refreshing && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#1DA1F2" />
          <Text style={styles.loadingText}>Loading posts...</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D1B2A',
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
    backgroundColor: '#121E2E',
    borderRadius: 12,
    marginVertical: 10,
    marginHorizontal: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
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
    backgroundColor: '#2A2A2A',
  },

  userTextContainer: {
    justifyContent: 'center',
  },

  username: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#E0E1DD',
  },

  followersText: {
    fontSize: 12,
    color: '#A9BCD0',
  },

  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  mediaContainer: {
    width: '100%',
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },

  media: {
    width: '100%',
    aspectRatio: 1, // Should be dynamic ideally
    backgroundColor: '#000',
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
    backgroundColor: '#1C1C1C',
  },

  errorMediaText: {
    color: '#999',
    marginTop: 8,
    fontSize: 15,
  },

  retryButton: {
    marginTop: 12,
    backgroundColor: '#1DA1F2',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },

  retryButtonText: {
    color: '#fff',
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
    color: '#E0E1DD',
    lineHeight: 20,
    marginBottom: 6,
  },

  location: {
    fontSize: 13,
    color: '#aaa',
    marginBottom: 4,
  },

  timestamp: {
    fontSize: 11.5,
    color: '#6C757D',
  },

  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },

  emptyText: {
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
    marginTop: 12,
  },

  createFirstPostButton: {
    marginTop: 16,
    backgroundColor: '#1DA1F2',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
  },

  createFirstPostText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },

  topFab: {
    position: 'absolute',
    top: 10,
    right: 14,
    zIndex: 1000,
    backgroundColor: '#1DA1F2',
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },

  loadingText: {
    color: '#1DA1F2',
    marginTop: 12,
    fontSize: 16,
  },
});

export default SocialFeed;
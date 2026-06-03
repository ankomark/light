// import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
// import {
//   View,
//   Text,
//   FlatList,
//   Image,
//   StyleSheet,
//   ActivityIndicator,
//   Alert,
//   TouchableOpacity,
// } from 'react-native';
// import { Video } from 'expo-av';
// import { Audio } from 'expo-av';
// import { MaterialIcons, Feather } from '@expo/vector-icons';
// import { useNavigation, useFocusEffect } from '@react-navigation/native';
// import { useAuth } from '../context/useAuth';
// import SearchBaar from '../components/SearchBaar';
// import { fetchSocialPosts } from '../services/api';
// import FollowButton from '../components/FollowButton';
// import PostActions from './PostActions';
// import CommentAction from './CommentAction';
// import { DownloadButton, SaveButton, LikeButton } from './SocialActions';

// const DEFAULT_PROFILE_IMAGE = 'https://via.placeholder.com/150';

// // Only processes profile images
// const getOptimizedUrl = (url, type = 'image') => {
//   if (!url) return null;
//   if (type === 'profile' && url.includes('res.cloudinary.com')) {
//     return url.replace('/upload/', '/upload/w_50,h_50,c_fill/');
//   }
//   return url;
// };

// // Always sanitize user object and profile_picture
// const processPost = (post, existingFollowStates = {}) => {
//   // Ensure user object exists
//   if (!post.user || typeof post.user !== 'object') {
//     post.user = {
//       id: 0,
//       username: 'Unknown',
//       profile_picture: DEFAULT_PROFILE_IMAGE,
//       followers_count: 0,
//       is_following: false
//     };
//   }
//   // Ensure profile_picture is always a string
//   let profilePic = post.user?.profile_picture;
//   if (typeof profilePic !== 'string') {
//     profilePic = profilePic?.secure_url || profilePic?.url || DEFAULT_PROFILE_IMAGE;
//   }
//   if (!profilePic) profilePic = DEFAULT_PROFILE_IMAGE;

//   // Preserve follow state if available
//   const existingState = existingFollowStates[post.user?.id];
//   const userFollowersCount = typeof existingState?.followers_count === 'number'
//     ? existingState.followers_count
//     : post.user?.followers_count ?? 0;
//   const userIsFollowing = typeof existingState?.is_following === 'boolean'
//     ? existingState.is_following
//     : post.user?.is_following ?? false;

//   return {
//     ...post,
//     user: {
//       id: post.user?.id || 0,
//       username: String(post.user?.username || 'Unknown'),
//       profile_picture: profilePic,
//       followers_count: userFollowersCount,
//       is_following: userIsFollowing
//     },
//     mediaUrl: post.optimized_url || post.media_url,
//     thumbnailUrl: post.optimized_url || post.media_url
//   };
// };

// // Media component with error handling
// const PostMedia = ({ item, videoRefs,isFocused }) => {
//   const [currentUrl, setCurrentUrl] = useState(item.mediaUrl);
//   const [isLoading, setIsLoading] = useState(true);
//   const [hasError, setHasError] = useState(false);

//   useEffect(() => {
//     setCurrentUrl(item.mediaUrl);
//     setIsLoading(true);
//     setHasError(false);
//   }, [item.id, item.mediaUrl]);
//   // Audio focus handling - just for logging/debugging
//   useEffect(() => {
//     if (isFocused && item.content_type === 'image' && item.song?.audio_url) {
//       // console.log(`Post ${item.id} with song is now focused`);
//     } else if (!isFocused) {
//       // console.log(`Post ${item.id} is no longer focused`);
//     }
//   }, [isFocused, item]);

//   const handleError = useCallback(() => {
//     if (currentUrl !== item.media_url) {
//       setCurrentUrl(item.media_url);
//     } else {
//       setHasError(true);
//       setIsLoading(false);
//     }
//   }, [currentUrl, item.media_url]);

//   const handleLoad = useCallback(() => {
//     setIsLoading(false);
//   }, []);

//   if (!currentUrl || hasError) {
//     return (
//       <View style={[styles.errorMediaContainer, { aspectRatio: 1 }]}>
//         <MaterialIcons name="broken-image" size={48} color="#ccc" />
//         <Text style={styles.errorMediaText}>Media unavailable</Text>
//         <TouchableOpacity 
//           style={styles.retryButton}
//           onPress={() => {
//             setCurrentUrl(item.mediaUrl);
//             setIsLoading(true);
//             setHasError(false);
//           }}
//         >
//           <Text style={styles.retryButtonText}>Retry</Text>
//         </TouchableOpacity>
//       </View>
//     );
//   }

//   if (item.content_type === 'video') {
//     return (
//       <View style={styles.mediaContainer}>
//         {isLoading && (
//           <View style={styles.loadingOverlay}>
//             <ActivityIndicator size="large" color="#1DA1F2" />
//           </View>
//         )}
//         <Video
//           ref={ref => ref && (videoRefs.current[item.id] = ref)}
//           source={{ uri: currentUrl }}
//           style={styles.media}
//           useNativeControls
//           resizeMode="contain"
//           isLooping
//           shouldPlay={false}
//           onError={handleError}
//           onLoad={handleLoad}
//         />
//       </View>
//     );
//   }

//   return (
//     <View style={styles.mediaContainer}>
//       {isLoading && (
//         <View style={styles.loadingOverlay}>
//           <ActivityIndicator size="large" color="#1DA1F2" />
//         </View>
//       )}
//       <Image
//         source={{ uri: currentUrl }}
//         style={[styles.media, isLoading && { opacity: 0 }]}
//         resizeMode="contain"
//         onError={handleError}
//         onLoad={handleLoad}
//       />
//     </View>
//   );
// };

// const SocialFeed = () => {
//   const [posts, setPosts] = useState([]);
//   const [loading, setLoading] = useState(true);
//   const [refreshing, setRefreshing] = useState(false);
//   const [searchQuery, setSearchQuery] = useState('');
//   const [error, setError] = useState(null);
//   // const [currentAudio, setCurrentAudio] = useState(null);
//   const [followStates, setFollowStates] = useState({});
//   const navigation = useNavigation();
//   const videoRefs = useRef({});
//   const audioRef = useRef(null);
//   const { currentUser } = useAuth();
//   const loadingTimeoutRef = useRef(null);
//   const lastFetchTimeRef = useRef(0);
//   const [currentlyPlayingPostId, setCurrentlyPlayingPostId] = useState(null);

//   const filteredPosts = useMemo(() => {
//     if (!searchQuery.trim()) return posts;
//     const lowerQuery = searchQuery.toLowerCase().trim();
//     return posts.filter(post => 
//       (post.caption?.toLowerCase()?.includes(lowerQuery) ||
//       post.user?.username?.toLowerCase()?.includes(lowerQuery) ||
//       post.location?.toLowerCase()?.includes(lowerQuery))
//     );
//   }, [searchQuery, posts]);

//   const loadPosts = useCallback(async (isRefresh = false) => {
//     const now = Date.now();
//     if (!isRefresh && now - lastFetchTimeRef.current < 1000) {
//       return;
//     }

//     try {
//       isRefresh ? setRefreshing(true) : setLoading(true);
//       setError(null);

//       loadingTimeoutRef.current = setTimeout(() => {
//         isRefresh ? setRefreshing(false) : setLoading(false);
//       }, 2000);

//       const data = await fetchSocialPosts();
//       // Filter out posts with invalid user data
//       const validPosts = Array.isArray(data)
//         ? data.filter(post => post.user && typeof post.user === 'object')
//         : [];
//       if (!Array.isArray(data)) {
//         throw new Error('Invalid data format');
//       }
//       if (validPosts.length !== data.length) {
//         console.warn('Some posts had invalid user data and were filtered out.');
//       }

//       // Process posts while preserving existing follow states
//       const processedPosts = validPosts.map(post => processPost(post, followStates));
//       const sortedPosts = processedPosts.sort((a, b) => 
//         new Date(b.created_at) - new Date(a.created_at)
//       );
//       setPosts(sortedPosts);
//       lastFetchTimeRef.current = now;
//     } catch (err) {
//       setError(err);
//       if (!isRefresh) {
//         Alert.alert(
//           'Error Loading Posts',
//           err.response?.status === 500 
//             ? 'Server error. Please try again later.'
//             : 'Failed to load posts. Please check your connection.',
//           [{ text: 'OK' }, { text: 'Retry', onPress: () => loadPosts(false) }]
//         );
//       }
//     } finally {
//       clearTimeout(loadingTimeoutRef.current);
//       loadingTimeoutRef.current = null;
//       setLoading(false);
//       setRefreshing(false);
//     }
//   }, [followStates]);

//   const handleRefresh = useCallback(() => loadPosts(true), [loadPosts]);



  
//   useEffect(() => {
//     loadPosts();
//   }, []);

//   useEffect(() => {
//     const interval = setInterval(() => {
//       if (!refreshing && !loading) {
//         loadPosts();
//       }
//     }, 120000);
//     return () => clearInterval(interval);
//   }, [refreshing, loading, loadPosts]);

//   useFocusEffect(
//     useCallback(() => {
//       const now = Date.now();
//       if (now - lastFetchTimeRef.current > 120000) {
//         loadPosts();
//       }
//     }, [loadPosts])
//   );

//   // Helper to play song
//   // Enhanced playSong function
//   const playSong = async (post) => {
//     if (!post?.song?.audio_url || currentlyPlayingPostId === post.id) return;
    
//     try {
//       // Stop any currently playing audio
//       if (audioRef.current) {
//         await stopSong();
//       }

//       const { sound } = await Audio.Sound.createAsync(
//         { uri: post.song.audio_url },
//         { shouldPlay: false }
//       );
      
//       audioRef.current = sound;
//       setCurrentlyPlayingPostId(post.id);
      
//       // Play from the trimmed start position if available
//       const startPosition = (post.song.start_time || 0) * 1000;
//       await sound.playFromPositionAsync(startPosition);
      
//       // Set timeout to stop after trimmed duration if available
//       if (post.song.end_time) {
//         const duration = (post.song.end_time - (post.song.start_time || 0)) * 1000;
//         setTimeout(async () => {
//           if (audioRef.current && currentlyPlayingPostId === post.id) {
//             await stopSong();
//           }
//         }, duration);
//       }
//     } catch (e) {
//       console.log('Audio play error:', e);
//     }
//   };

//   // Enhanced stopSong function
//   const stopSong = async () => {
//     if (audioRef.current) {
//       try {
//         await audioRef.current.stopAsync();
//         await audioRef.current.unloadAsync();
//       } catch (e) {
//         console.log('Audio stop error:', e);
//       } finally {
//         audioRef.current = null;
//         setCurrentlyPlayingPostId(null);
//       }
//     }
//   };

//   // Detect viewable items
//   const onViewableItemsChanged = useRef(({ changed }) => {
//     changed.forEach(item => {
//       if (item.isViewable && 
//           item.item.content_type === 'image' && 
//           item.item.song?.audio_url) {
//         playSong(item.item);
//       } else if (!item.isViewable && 
//                 currentlyPlayingPostId === item.item.id) {
//         stopSong();
//       }
//     });
//   }).current;

//   const viewabilityConfig = useMemo(() => ({
//     itemVisiblePercentThreshold: 80,
//     waitForInteraction: false,
//     minimumViewTime: 100,
//   }), []);

//   const handleFollowChange = useCallback((data) => {
//     setFollowStates(prev => ({
//       ...prev,
//       [data.id]: {
//         is_following: data.is_following,
//         followers_count: data.followers_count
//       }
//     }));
//     setPosts(prev => prev.map(post => {
//       if (post.user.id === data.id) {
//         return {
//           ...post,
//           user: {
//             ...post.user,
//             is_following: data.is_following,
//             followers_count: data.followers_count ?? post.user.followers_count
//           }
//         };
//       }
//       return post;
//     }));
//   }, []);

//   const handlePostUpdate = useCallback(updatedPost => {
//     setPosts(prev => prev.map(post => 
//       post.id === updatedPost.id ? updatedPost : post
//     ));
//   }, []);

//   const handlePostDelete = useCallback(postId => {
//     setPosts(prev => prev.filter(post => post.id !== postId));
//   }, []);

//   // Always validate user object before rendering
//   const renderPostHeader = useCallback(({ item }) => {
//     if (!item.user || typeof item.user !== 'object') {
//       console.warn('Post missing user data:', item.id);
//       return null;
//     }
//     return (
//       <View style={styles.postHeader}>
//         <View style={styles.userInfo}>
//           <Image
//             source={{ uri: typeof item.user.profile_picture === 'string' ? item.user.profile_picture : DEFAULT_PROFILE_IMAGE }}
//             style={styles.profileImage}
//             defaultSource={{ uri: DEFAULT_PROFILE_IMAGE }}
//             onError={() => setPosts(prev => prev.map(p => 
//               p.id === item.id 
//                 ? { ...p, user: { ...p.user, profile_picture: DEFAULT_PROFILE_IMAGE } }
//                 : p
//             ))}
//           />
//           <View style={styles.userTextContainer}>
//             <Text style={styles.username}>{String(item.user.username || 'Unknown user')}</Text>
//             <Text style={styles.followersText}>
//               {typeof item.user.followers_count === 'number' ? item.user.followers_count : 0} followers
//             </Text>
//           </View>
//         </View>
//         <View style={styles.headerActions}>
//           {currentUser?.id !== item.user.id && (
//             <FollowButton 
//               userId={item.user.id}
//               initialFollowing={item.user.is_following}
//               initialFollowersCount={item.user.followers_count}
//               onFollowChange={handleFollowChange}
//             />
//           )}
//           {item.can_edit && (
//             <PostActions 
//               post={item} 
//               onUpdate={handlePostUpdate}
//               onDelete={() => handlePostDelete(item.id)}
//             />
//           )}
//         </View>
//       </View>
//     );
//   }, [currentUser?.id, handleFollowChange, handlePostUpdate, handlePostDelete]);

//   const renderPostFooter = useCallback(({ item }) => (
//     <View style={styles.postFooter}>
//       <View style={styles.actions}>
//         <LikeButton 
//           postId={item.id} 
//           initialLikes={item.likes_count || 0} 
//           isLiked={item.is_liked || false} 
//         />
//         <CommentAction 
//           postId={item.id} 
//           commentCount={item.comments_count || 0} 
//         />
//         <DownloadButton 
//           publicId={item.media_file} 
//           contentType={item.content_type} 
//         />
//         <SaveButton 
//           postId={item.id} 
//           initialSaved={item.is_saved || false} 
//         />
//       </View>
//       <View style={styles.postInfo}>
//         {item.caption && <Text style={styles.caption} numberOfLines={3}>{item.caption}</Text>}
//         {item.location && (
//           <Text style={styles.location}>
//             <Feather name="map-pin" size={14} color="#FFF" /> {item.location}
//           </Text>
//         )}
//         <Text style={styles.timestamp}>
//           {new Date(item.created_at).toLocaleDateString('en-US', {
//             year: 'numeric',
//             month: 'short',
//             day: 'numeric'
//           })}
//         </Text>
//       </View>
//     </View>
//   ), []);

//   const renderItem = useCallback(({ item }) => (
//     <View style={styles.postContainer}>
//       {renderPostHeader({ item })}
//       <PostMedia 
//         item={item} 
//         videoRefs={videoRefs}
//         isFocused={currentlyPlayingPostId === item.id} 
//       />
//       {renderPostFooter({ item })}
//     </View>
//   ), [renderPostHeader, renderPostFooter]);

//   const renderEmptyComponent = useCallback(() => {
//     if (loading) return null;
//     return (
//       <View style={styles.emptyContainer}>
//         {error ? (
//           <>
//             <MaterialIcons name="error-outline" size={48} color="#666" />
//             <Text style={styles.errorText}>
//               {error.message?.includes('Session expired')
//                 ? 'Session expired. Please log in again.'
//                 : error.response?.status === 500
//                   ? 'Server error. Please try again.'
//                   : 'Failed to load posts.'}
//             </Text>
//             <TouchableOpacity 
//               style={styles.retryButton}
//               onPress={() => loadPosts()}
//             >
//               <Text style={styles.retryButtonText}>Try Again</Text>
//             </TouchableOpacity>
//           </>
//         ) : (
//           <>
//             <MaterialIcons name="photo-library" size={48} color="#666" />
//             <Text style={styles.emptyText}>
//               {searchQuery ? `No results for "${searchQuery}"` : 'Getting new posts to show'}
//             </Text>
//             {!searchQuery && (
//               <TouchableOpacity 
//                 style={styles.createFirstPostButton}
//                 onPress={() => navigation.navigate('CreatePost')}
//               >
//                 <Text style={styles.createFirstPostText}>Hi Welcome Again</Text>
//               </TouchableOpacity>
//             )}
//           </>
//         )}
//       </View>
//     );
//   }, [loading, error, searchQuery, navigation, loadPosts]);

//   const keyExtractor = useCallback(item => `post_${item.id}`, []);
//   const getItemLayout = useCallback((_, index) => ({
//     length: 400,
//     offset: 400 * index,
//     index,
//   }), []);

//   return (
//     <View style={styles.container}>
//       <SearchBaar 
//         onSearch={setSearchQuery} 
//         placeholder="Search posts, users, locations..."
//       />

//       <TouchableOpacity
//         style={styles.topFab}
//         onPress={() => navigation.navigate('CreatePost')}
//         activeOpacity={0.8}
//       >
//         <MaterialIcons name="add" size={28} color="white" />
//       </TouchableOpacity>

//       <FlatList
//         data={filteredPosts}
//         renderItem={renderItem}
//         ListEmptyComponent={renderEmptyComponent}
//         keyExtractor={keyExtractor}
//         contentContainerStyle={[
//           styles.listContent,
//           filteredPosts.length === 0 && styles.emptyListContent
//         ]}
//         refreshing={refreshing}
//         onRefresh={handleRefresh}
//         showsVerticalScrollIndicator={false}
//         onViewableItemsChanged={onViewableItemsChanged}
//         viewabilityConfig={viewabilityConfig}
//         removeClippedSubviews
//         maxToRenderPerBatch={5}
//         updateCellsBatchingPeriod={100}
//         initialNumToRender={3}
//         windowSize={10}
//         getItemLayout={getItemLayout}
//       />

//       {loading && !refreshing && (
//         <View style={styles.loadingOverlay}>
//           <ActivityIndicator size="large" color="#1DA1F2" />
//           <Text style={styles.loadingText}>Loading posts...</Text>
//         </View>
//       )}
//     </View>
//   );
// };

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
import { Audio } from 'expo-av';
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
import { colors } from '../constants/theme';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const AVATAR_FAILED = '__failed__';

const getOptimizedUrl = (url, type = 'image') => {
  if (!url) return null;
  if (type === 'profile' && url.includes('res.cloudinary.com')) {
    return url.replace('/upload/', '/upload/w_50,h_50,c_fill/');
  }
  return url;
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

const PostMedia = React.memo(({ item, videoRefs, isFocused }) => {
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
});

const SocialFeed = () => {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState(null);
  const [followStates, setFollowStates] = useState({});
  const navigation = useNavigation();
  const videoRefs = useRef({});
  const audioRef = useRef(null);
  const { currentUser } = useAuth();
  const lastFetchTimeRef = useRef(0);
  const [currentlyPlayingPostId, setCurrentlyPlayingPostId] = useState(null);

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
    if (!isRefresh && now - lastFetchTimeRef.current < 1000) return;

    try {
      isRefresh ? setRefreshing(true) : setLoading(true);
      setError(null);

      const response = await fetchSocialPosts(1);
      const raw = response?.results ?? [];
      const valid = raw.filter(p => p.user && typeof p.user === 'object');
      const processed = valid.map(p => processPost(p, followStates));

      setPosts(processed);
      setPage(1);
      setHasMore(!!response?.next);
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
  }, [followStates]);

  const loadMorePosts = useCallback(async () => {
    if (loadingMore || !hasMore || loading) return;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const response = await fetchSocialPosts(nextPage);
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
  }, [loadingMore, hasMore, loading, page, followStates]);

  const handleRefresh = useCallback(() => loadPosts(true), [loadPosts]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!refreshing && !loading) loadPosts();
    }, 120000);
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
        <View style={styles.userInfo}>
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
        </View>
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
  }, [currentUser?.id, handleFollowChange, handlePostUpdate, handlePostDelete]);

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
        isFocused={currentlyPlayingPostId === item.id} 
      />
      {renderPostFooter({ item })}
    </View>
  ), [renderPostHeader, renderPostFooter, currentlyPlayingPostId]);

  const renderEmptyComponent = useCallback(() => {
    if (loading) return null;
    return (
      <View style={styles.emptyContainer}>
        {error ? (
          <>
            <MaterialIcons name="error-outline" size={48} color="#666" />
            <Text style={styles.errorText}>
              {error.message?.includes('Session expired')
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
              {searchQuery ? `No results for "${searchQuery}"` : 'Getting new posts to show'}
            </Text>
            {!searchQuery && (
              <TouchableOpacity
                style={styles.createFirstPostButton}
                onPress={() => navigation.navigate('CreatePost')}
              >
                <Text style={styles.createFirstPostText}>Share Something</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    );
  }, [loading, error, searchQuery, navigation, loadPosts]);

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

  errorText: {
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
  audioIndicator: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12,
    padding: 5,
  },
  skeletonContainer: {
    flex: 1,
    paddingTop: 8,
  },
});

export default SocialFeed;
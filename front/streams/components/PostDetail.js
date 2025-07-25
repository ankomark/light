
import React, { useEffect, useState, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ActivityIndicator, 
  Image,
  ScrollView,
  TouchableOpacity
} from 'react-native';
import { Video } from 'expo-av';
import axios from 'axios';
import { Feather } from '@expo/vector-icons';
import { API_URL } from '../services/api';
import CommentAction from './CommentAction';
import PostActions from '../components/PostActions';

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
  return {
    ...post,
    mediaUrl: post.optimized_url || post.media_url,
    thumbnailUrl: post.optimized_url || post.media_url,
    user: {
      ...post.user,
      profile_picture: post.user?.profile_picture || DEFAULT_PROFILE_IMAGE
    }
  };
};

const PostDetail = ({ route, navigation }) => {
  const { postId, commentId, shouldOpenComments } = route.params;
  const [commentsVisible, setCommentsVisible] = useState(false);
  const flatListRef = useRef(null);
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [commentsCount, setCommentsCount] = useState(0);
  const videoRef = useRef(null);
  const [mediaError, setMediaError] = useState(false);

  // Auto-open comments if coming from notification
  useEffect(() => {
    if (shouldOpenComments) {
      setCommentsVisible(true);
    }
  }, [shouldOpenComments]);

  useEffect(() => {
    const fetchPostDetail = async () => {
      try {
        setLoading(true);
        const response = await axios.get(`${API_URL}/social-posts/${postId}/`);
        
        // Apply processing
        const processedPost = processPost(response.data);
        
        setPost(processedPost);
        setCommentsCount(response.data.comments_count || 0);
      } catch (err) {
        console.error('Error fetching post details:', err);
        setError('Failed to load post details.');
      } finally {
        setLoading(false);
      }
    };

    fetchPostDetail();
  }, [postId]);

  const handleCommentsLoaded = (comments) => {
    if (commentId && flatListRef.current) {
      const index = comments.findIndex(c => c.id === commentId);
      if (index >= 0) {
        setTimeout(() => {
          flatListRef.current?.scrollToIndex({
            index,
            viewOffset: 50,
            animated: true
          });
        }, 500);
      }
    }
  };

  const updateCommentsCount = (newCount) => {
    setCommentsCount(newCount);
  };

  const handleMediaError = () => {
    console.log('Media failed to load:', post.mediaUrl);
    setMediaError(true);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1DA1F2" />
      </View>
    );
  }

  if (error || !post) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error || 'Post not found.'}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollContainer}>
        <View style={styles.header}>
          <TouchableOpacity 
            onPress={() => navigation.goBack()} 
            style={styles.backButton}
          >
            <Feather name="arrow-left" size={24} color="#1DA1F2" />
          </TouchableOpacity>
          
          <View style={styles.userInfo}>
            <Image
              source={{ uri: getOptimizedUrl(post.user.profile_picture, 'profile') }}
              style={styles.profileImage}
              defaultSource={{ uri: DEFAULT_PROFILE_IMAGE }}
              onError={() => setPost(prev => ({
                ...prev,
                user: {
                  ...prev.user,
                  profile_picture: DEFAULT_PROFILE_IMAGE
                }
              }))}
            />
            <Text style={styles.username}>{post.user.username}</Text>
          </View>
          
          <PostActions 
            post={post} 
            onUpdate={(updatedPost) => setPost(processPost(updatedPost))}
            onDelete={() => navigation.goBack()}
            navigation={navigation}
          />
        </View>
        
        {/* Media display with error handling */}
        {mediaError ? (
          <View style={styles.errorMediaContainer}>
            <Feather name="image" size={48} color="#ccc" />
            <Text style={styles.errorMediaText}>Media unavailable</Text>
            <TouchableOpacity 
              style={styles.retryButton}
              onPress={() => setMediaError(false)}
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : post.content_type === 'video' ? (
          <Video
            ref={videoRef}
            source={{ uri: post.mediaUrl }}
            style={styles.media}
            useNativeControls
            resizeMode="contain"
            shouldPlay
            onError={handleMediaError}
          />
        ) : (
          <Image 
            source={{ uri: post.mediaUrl }} 
            style={styles.image} 
            resizeMode="contain"
            onError={handleMediaError}
          />
        )}
        
        <View style={styles.captionContainer}>
          <Text style={styles.caption}>{post.caption}</Text>
          {post.location && (
            <Text style={styles.location}>
              <Feather name="map-pin" size={14} color="#666" /> {post.location}
            </Text>
          )}
          <Text style={styles.timestamp}>
            {new Date(post.created_at).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </Text>
        </View>
        
        <View style={styles.statsContainer}>
          <Text style={styles.statsText}>
            {post.likes_count || 0} likes • {commentsCount} comments
          </Text>
        </View>
      </ScrollView>

      <CommentAction 
        postId={postId}
        commentCount={commentsCount}
        flatListRef={flatListRef}
        autoOpen={shouldOpenComments}
        onCommentsLoaded={handleCommentsLoaded}
        onCommentPosted={updateCommentsCount}
      />
    </View>
  );
};
const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  backButton: {
    marginRight: 15,
  },
  title: {
    flex: 1, // Add this to allow title to take available space
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fff',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#333',
  },
  image: {
    width: '100%',
    height: 200,
    marginBottom: 16,
    resizeMode: 'cover',
  },
  content: {
    fontSize: 16,
    lineHeight: 22,
    color: '#444',
  },
  errorText: {
    fontSize: 16,
    color: 'red',
  },
  videoThumbnail: {
  width: '100%',
  height: '100%',
  resizeMode: 'cover',
},
videoContainer: {
  position: 'relative',
},
});

export default PostDetail;

// import React, { useEffect, useState } from 'react';
// import { 
//   View, 
//   Text, 
//   StyleSheet, 
//   ActivityIndicator, 
//   Image,
//   ScrollView,
//   Alert
// } from 'react-native';
// import axios from 'axios';
// import { API_URL } from '../services/api';
// // const BASE_URL = 'http://192.168.1.126:8000/';

// const PostDetail = ({ route, navigation }) => {
//   // Get postId from navigation params
//   const { postId, commentId, shouldOpenComments } = route.params;
//   const [commentsVisible, setCommentsVisible] = useState(false);
//   const flatListRef = useRef(null);
//   const [post, setPost] = useState(null);
//   const [loading, setLoading] = useState(true);
//   const [error, setError] = useState(null);
//   useEffect(() => {
//     if (shouldOpenComments) {
//       setCommentsVisible(true);
//     }
//   }, [shouldOpenComments]);

//   useEffect(() => {
//     const fetchPostDetail = async () => {
//       try {
//         const response = await axios.get(`${API_URL}/social-posts/${postId}/`);
//         setPost(response.data);
//       } catch (err) {
//         console.error('Error fetching post details:', err);
//         setError('Failed to load post details.');
//         Alert.alert('Error', 'Failed to load post details.');
//       } finally {
//         setLoading(false);
//       }
//     };

//     fetchPostDetail();
//   }, [postId]);

//   if (loading) {
//     return (
//       <View style={styles.centered}>
//         <ActivityIndicator size="large" color="#1DA1F2" />
//       </View>
//     );
//   }

//   if (error || !post) {
//     return (
//       <View style={styles.centered}>
//         <Text style={styles.errorText}>{error || 'Post not found.'}</Text>
//       </View>
//     );
//   }

//   return (
//     <ScrollView style={styles.container}>
//       <Text style={styles.title}>{post.title}</Text>
//       {post.image && (
//         <Image source={{ uri: post.image }} style={styles.image} />
//       )}
//       <Text style={styles.content}>{post.content}</Text>
//     </ScrollView>
//   );
// };

import React, { useEffect, useState, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ActivityIndicator, 
  Image,
  ScrollView,
  Alert,
  TouchableOpacity
} from 'react-native';
import axios from 'axios';
import { API_URL } from '../services/api';
import CommentAction from './CommentAction'; // Make sure to import your CommentAction component
import { Feather } from '@expo/vector-icons';
import PostActions from '../components/PostActions';

const PostDetail = ({ route, navigation }) => {
  const { postId, commentId, shouldOpenComments } = route.params;
  const [commentsVisible, setCommentsVisible] = useState(false);
  const flatListRef = useRef(null);
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [commentsCount, setCommentsCount] = useState(0);

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
        setPost(response.data);
        setCommentsCount(response.data.comment_count || 0);
      } catch (err) {
        console.error('Error fetching post details:', err);
        setError('Failed to load post details.');
        Alert.alert('Error', 'Failed to load post details.');
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
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Feather name="arrow-left" size={24} color="#1DA1F2" />
          </TouchableOpacity>
          <Text style={styles.title}>{post.title}</Text>
          <PostActions 
            post={post} 
            onUpdate={(updatedPost) => setPost(updatedPost)}
            onDelete={() => navigation.goBack()}
            navigation={navigation}
          />
        </View>
        
        {post.image && (
          <Image source={{ uri: post.image }} style={styles.image} />
        )}
        
        <Text style={styles.content}>{post.content}</Text>
        
        <View style={styles.statsContainer}>
          <Text style={styles.statsText}>
            {post.like_count || 0} likes • {commentsCount} comments
          </Text>
        </View>
      </ScrollView>

      {/* Comment Action Section */}
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
});

export default PostDetail;

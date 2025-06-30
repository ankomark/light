
import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  TextInput, 
  StyleSheet, 
  Modal, 
  FlatList, 
  Image,
  Alert
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { commentOnPost, fetchSocialPostComments } from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { API_URL } from '../services/api';

const DEFAULT_PROFILE_IMAGE = 'https://via.placeholder.com/150';

const CommentAction = ({ postId, commentCount, flatListRef, autoOpen, onCommentsLoaded }) => {
  const [comments, setComments] = useState([]);
  const [showComments, setShowComments] = useState(autoOpen || false);
  const [newComment, setNewComment] = useState('');
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const internalFlatListRef = useRef(null);
  const activeFlatListRef = flatListRef || internalFlatListRef;

  useEffect(() => {
    if (autoOpen) {
      setShowComments(true);
    }
  }, [autoOpen]);

  useEffect(() => {
    if (comments.length > 0 && onCommentsLoaded) {
      onCommentsLoaded(comments);
    }
  }, [comments]);

  const fetchComments = async () => {
    try {
      setLoading(true);
      const data = await fetchSocialPostComments(postId);
      const commentsWithProfiles = await Promise.all(
        data.map(async (comment) => {
          try {
            const token = await AsyncStorage.getItem('accessToken');
            if (!token) return comment;

            const response = await axios.get(
              `${API_URL}/profiles/by_user/${comment.user.id}/`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            
            return {
              ...comment,
              user: {
                ...comment.user,
                profile_picture: response.data?.picture || DEFAULT_PROFILE_IMAGE,
              },
            };
          } catch (error) {
            console.error('Profile fetch error:', error);
            return {
              ...comment,
              user: {
                ...comment.user,
                profile_picture: DEFAULT_PROFILE_IMAGE,
              },
            };
          }
        })
      );
      setComments(commentsWithProfiles);
    } catch (error) {
      Alert.alert('Error', 'Failed to load comments');
      console.error('Comments fetch error:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (showComments) {
      fetchComments();
    }
  }, [showComments]);

  const fetchUserProfile = async () => {
    try {
      const token = await AsyncStorage.getItem('accessToken');
      if (!token) return;

      const response = await axios.get(
        `${API_URL}/profiles/me/`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setUserProfile(response.data);
    } catch (error) {
      console.error('Profile fetch error:', error);
    }
  };

  useEffect(() => {
    fetchUserProfile();
  }, []);

  const handlePostComment = async () => {
    if (!newComment.trim()) {
      Alert.alert('Error', 'Comment cannot be empty');
      return;
    }

    try {
      await commentOnPost(postId, newComment);
      await fetchComments();
      setNewComment('');
    } catch (error) {
      Alert.alert('Error', 'Failed to post comment');
      console.error('Comment post error:', error);
    }
  };

  const scrollToComment = (commentId) => {
    if (!commentId || !activeFlatListRef.current) return;
    
    const index = comments.findIndex(c => c.id === commentId);
    if (index >= 0) {
      setTimeout(() => {
        activeFlatListRef.current?.scrollToIndex({
          index,
          viewOffset: 50,
          animated: true
        });
      }, 500);
    }
  };

  const handleScrollToIndexFailed = ({ index }) => {
    setTimeout(() => {
      activeFlatListRef.current?.scrollToIndex({ index });
    }, 500);
  };

  return (
    <>
      <TouchableOpacity 
        style={styles.actionButton} 
        onPress={() => setShowComments(true)}
      >
        <Feather name="message-circle" size={24} color="#FFF" />
        <Text style={styles.actionText}>{commentCount}</Text>
      </TouchableOpacity>

      <Modal
        visible={showComments}
        animationType="slide"
        onRequestClose={() => setShowComments(false)}
      >
        <View style={styles.modalContainer}>
          <TouchableOpacity 
            style={styles.closeButton}
            onPress={() => setShowComments(false)}
          >
            <Feather name="x" size={24} color="#000" />
          </TouchableOpacity>

          {loading ? (
            <View style={styles.loadingContainer}>
              <Text>Loading comments...</Text>
            </View>
          ) : (
            <FlatList
              ref={activeFlatListRef}
              data={comments}
              keyExtractor={(item) => item.id.toString()}
              renderItem={({ item }) => (
                <View style={styles.commentItem}>
                  <Image
                    source={{ uri: item.user.profile_picture }}
                    style={styles.avatar}
                  />
                  <View style={styles.commentContent}>
                    <Text style={styles.username}>{item.user.username}</Text>
                    <Text style={styles.commentText}>{item.content}</Text>
                  </View>
                </View>
              )}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Text>No comments yet</Text>
                </View>
              }
              onScrollToIndexFailed={handleScrollToIndexFailed}
            />
          )}

          <View style={styles.inputContainer}>
            <Image
              source={{ uri: userProfile?.picture || DEFAULT_PROFILE_IMAGE }}
              style={styles.userAvatar}
            />
            <TextInput
              style={styles.input}
              placeholder="Write a comment..."
              placeholderTextColor="#666"
              value={newComment}
              onChangeText={setNewComment}
              multiline
            />
            <TouchableOpacity 
              style={styles.postButton}
              onPress={handlePostComment}
              disabled={!newComment.trim()}
            >
              <Text style={styles.postText}>Post</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  actionText: {
    fontSize: 14,
    color: '#FFF',
  },
  modalContainer: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fff',
  },
  closeButton: {
    alignSelf: 'flex-end',
    padding: 10,
    marginBottom: 10,
  },
  commentItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
    padding: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  commentContent: {
    flex: 1,
  },
  username: {
    fontWeight: '600',
    marginBottom: 4,
    color: '#333',
  },
  commentText: {
    color: '#666',
    fontSize: 14,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
    fontSize: 14,
    color: '#333',
  },
  postButton: {
    backgroundColor: '#1DA1F2',
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 20,
    opacity: 1,
  },
  postText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
});

export default CommentAction;
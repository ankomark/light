import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { useAuth } from '../context/useAuth';
import { commentOnPost, fetchSocialPostComments, getAccessToken, API_URL } from '../services/api';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

// Lightweight placeholder rows shown only on the very first load (no cache yet),
// so the sheet feels instant instead of blocking on a "Loading..." message.
const CommentSkeleton = () => (
  <View style={{ paddingTop: 4 }}>
    {[0, 1, 2, 3, 4].map((i) => (
      <View key={i} style={styles.skeletonRow}>
        <View style={styles.skeletonAvatar} />
        <View style={{ flex: 1 }}>
          <View style={[styles.skeletonLine, { width: '35%' }]} />
          <View style={[styles.skeletonLine, { width: '80%', marginTop: 6 }]} />
        </View>
      </View>
    ))}
  </View>
);

const CommentAction = ({ postId, commentCount, flatListRef, autoOpen, onCommentsLoaded, currentUserAvatar }) => {
  const [comments, setComments] = useState([]);
  const [showComments, setShowComments] = useState(autoOpen || false);
  const [newComment, setNewComment] = useState('');
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const internalFlatListRef = useRef(null);
  const activeFlatListRef = flatListRef || internalFlatListRef;
  const profileFetchedRef = useRef(false);
  const commentsRef = useRef([]);
  const { currentUser } = useAuth();

  // Mirror comments into a ref so async callbacks can read the latest list
  // without being re-created (and going stale) on every change.
  useEffect(() => { commentsRef.current = comments; }, [comments]);

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

  // Stale-while-revalidate: only show the skeleton on a true cold load (no
  // comments cached yet). On reopen we keep showing the cached list and refresh
  // silently in the background, so the sheet never blocks.
  const fetchComments = useCallback(async () => {
    const hadCache = commentsRef.current.length > 0;
    try {
      if (!hadCache) setLoading(true);
      const data = await fetchSocialPostComments(postId);
      setComments(Array.isArray(data) ? data : (data ?? []));
    } catch (error) {
      // Only surface an error if there's nothing to show.
      if (!hadCache) Alert.alert('Error', 'Failed to load comments');
      console.error('Comments fetch error:', error);
    } finally {
      setLoading(false);
    }
  }, [postId]);

  const fetchUserProfile = async () => {
    try {
      const token = await getAccessToken();
      if (!token) return;

      const response = await fetch(`${API_URL}/profiles/me/`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      setUserProfile(data);
    } catch (error) {
      console.error('Profile fetch error:', error);
    }
  };

  // Load comments — and the input avatar — only when the modal is opened. This
  // used to fetch /profiles/me/ on mount for EVERY post in the feed, firing one
  // duplicate request per card and slowing the whole feed.
  useEffect(() => {
    if (!showComments) return;
    fetchComments();
    if (!currentUserAvatar && !profileFetchedRef.current) {
      profileFetchedRef.current = true;
      fetchUserProfile();
    }
  }, [showComments]);

  // Optimistic post: the comment appears at the top instantly (TikTok-style),
  // then we reconcile in place with the server's response — no full reload.
  const handlePostComment = async () => {
    const content = newComment.trim();
    if (!content) {
      Alert.alert('Error', 'Comment cannot be empty');
      return;
    }

    const tempId = `temp-${Date.now()}`;
    const optimistic = {
      id: tempId,
      content,
      pending: true,
      user: {
        username: currentUser?.username || 'You',
        profile_picture:
          currentUserAvatar || currentUser?.profile_picture || userProfile?.picture || null,
      },
    };

    setComments((prev) => [optimistic, ...prev]);
    setNewComment('');
    requestAnimationFrame(() =>
      activeFlatListRef.current?.scrollToOffset?.({ offset: 0, animated: true })
    );

    try {
      const created = await commentOnPost(postId, content);
      if (created && created.id) {
        // Swap the temp row for the real one in place (keeps its position).
        setComments((prev) =>
          prev.map((c) =>
            c.id === tempId ? { ...created, user: created.user || optimistic.user } : c
          )
        );
      } else {
        // Unknown response shape — reconcile quietly without a blocking spinner.
        fetchComments();
      }
    } catch (error) {
      // Roll back and restore the text so the user can retry.
      setComments((prev) => prev.filter((c) => c.id !== tempId));
      setNewComment(content);
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

          {loading && comments.length === 0 ? (
            <CommentSkeleton />
          ) : (
            <FlatList
              ref={activeFlatListRef}
              data={comments}
              keyExtractor={(item) => item.id.toString()}
              renderItem={({ item }) => (
                <View style={[styles.commentItem, item.pending && styles.commentItemPending]}>
                  <Image
                    source={item.user?.profile_picture ? { uri: item.user.profile_picture } : DEFAULT_AVATAR}
                    defaultSource={DEFAULT_AVATAR}
                    style={styles.avatar}
                  />
                  <View style={styles.commentContent}>
                    <Text style={styles.username}>{item.user?.username}</Text>
                    <Text style={styles.commentText}>{item.content}</Text>
                  </View>
                  {item.pending && <Feather name="clock" size={14} color="#999" style={styles.pendingIcon} />}
                </View>
              )}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Text>No comments yet</Text>
                </View>
              }
              onScrollToIndexFailed={handleScrollToIndexFailed}
              initialNumToRender={10}
              maxToRenderPerBatch={10}
              windowSize={7}
              removeClippedSubviews
              keyboardShouldPersistTaps="handled"
            />
          )}

          <View style={styles.inputContainer}>
            <Image
              source={
                currentUserAvatar || userProfile?.picture
                  ? { uri: currentUserAvatar || userProfile.picture }
                  : DEFAULT_AVATAR
              }
              defaultSource={DEFAULT_AVATAR}
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
  commentItemPending: {
    opacity: 0.6,
  },
  pendingIcon: {
    marginLeft: 8,
    alignSelf: 'center',
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
    padding: 12,
  },
  skeletonAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
    backgroundColor: '#ececec',
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ececec',
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
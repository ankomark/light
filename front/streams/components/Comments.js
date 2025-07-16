import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  TextInput, 
  StyleSheet, 
  FlatList, 
  Modal, 
  Dimensions, 
  Image,
  Alert
} from 'react-native';
import { fetchComments, postComment } from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { API_URL } from '../services/api';
import { useFocusEffect } from '@react-navigation/native';


const { width, height } = Dimensions.get('window');
const DEFAULT_PROFILE_IMAGE = 'https://via.placeholder.com/50';

const Comments = ({ trackId, highlightCommentId, autoOpen = false }) => {
    const flatListRef = useRef(null);
    const [highlightedComment, setHighlightedComment] = useState(null);
    const [comments, setComments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [newComment, setNewComment] = useState('');
    const [showComments, setShowComments] = useState(autoOpen);
    const [userProfile, setUserProfile] = useState(null);

    const fetchCommentData = async () => {
        try {
            setLoading(true);
            const data = await fetchComments(trackId);
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
                        console.error('Error fetching profile picture:', error);
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
            console.error('Failed to fetch comments:', error);
            Alert.alert('Error', 'Failed to load comments');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCommentData();
    }, [trackId]);

    useEffect(() => {
        if (autoOpen) {
            setShowComments(true);
        }
    }, [autoOpen]);

    useFocusEffect(
        React.useCallback(() => {
            if (highlightCommentId && comments.length > 0) {
                const index = comments.findIndex(c => c.id === highlightCommentId);
                if (index !== -1) {
                    setTimeout(() => {
                        flatListRef.current?.scrollToIndex({ 
                            index,
                            viewOffset: 50,
                            animated: true 
                        });
                        setHighlightedComment(highlightCommentId);
                    }, 500);
                }
            }
        }, [comments, highlightCommentId])
    );

    const fetchUserProfile = async () => {
        try {
            const token = await AsyncStorage.getItem('accessToken');
            if (!token) return;

            const response = await axios.get(`${API_URL}/profiles/me/`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            setUserProfile(response.data);
        } catch (error) {
            console.error('Error fetching user profile:', error);
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
            const token = await AsyncStorage.getItem('accessToken');
            if (!token) {
                Alert.alert('Error', 'You need to be logged in to post a comment.');
                return;
            }

            const postedComment = await postComment(trackId, newComment, token);
            postedComment.user = {
                ...postedComment.user,
                profile_picture: userProfile?.picture || DEFAULT_PROFILE_IMAGE,
            };
            setComments(prev => [...prev, postedComment]);
            setNewComment('');
            
            // Scroll to the new comment
            setTimeout(() => {
                flatListRef.current?.scrollToEnd({ animated: true });
            }, 300);
        } catch (error) {
            console.error('Failed to post comment:', error);
            Alert.alert('Error', 'Failed to post comment');
        }
    };

    const toggleComments = () => setShowComments(prev => !prev);

    const handleScrollToIndexFailed = ({ index }) => {
        setTimeout(() => {
            flatListRef.current?.scrollToIndex({ index });
        }, 500);
    };

    return (
        <View style={styles.commentsSection}>
            <TouchableOpacity onPress={toggleComments} style={styles.avatarButton}>
                <Text style={styles.avatarButtonText}>
                    💬 {comments.length}
                </Text>
            </TouchableOpacity>
            
            <Modal
                visible={showComments}
                animationType="slide"
                transparent={false}
                onRequestClose={toggleComments}
            >
                <View style={styles.modalContainer}>
                    <TouchableOpacity onPress={toggleComments} style={styles.closeButton}>
                        <Text style={styles.closeButtonText}>↩️</Text>
                    </TouchableOpacity>
                    
                    {loading ? (
                        <View style={styles.loadingContainer}>
                            <Text>Loading comments...</Text>
                        </View>
                    ) : (
                        <FlatList
                            ref={flatListRef}
                            data={comments}
                            keyExtractor={item => item.id.toString()}
                            renderItem={({ item }) => (
                                <View style={[
                                    styles.commentItem,
                                    item.id === highlightedComment && styles.highlightedComment
                                ]}>
                                    <Image
                                        source={{ uri: item.user.profile_picture }}
                                        style={styles.userImage}
                                    />
                                    <View style={styles.commentContentContainer}>
                                        <Text style={styles.commentUser}>{item.user.username}</Text>
                                        <Text style={styles.commentContent}>{item.content}</Text>
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
                    
                    <View style={styles.commentInputSection}>
                        <Image
                            source={{ uri: userProfile?.picture || DEFAULT_PROFILE_IMAGE }}
                            style={styles.currentUserImage}
                        />
                        <TextInput
                            style={styles.commentInput}
                            value={newComment}
                            onChangeText={setNewComment}
                            placeholder="Write a comment..."
                            placeholderTextColor="#999"
                            multiline
                        />
                        <TouchableOpacity 
                            onPress={handlePostComment}
                            style={styles.commentPostButton}
                            disabled={!newComment.trim()}
                        >
                            <Text style={styles.buttonText}>Post</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </View>
    );
};

const styles = StyleSheet.create({
  commentsSection: {
    marginTop: 10,
    paddingHorizontal: 10,
  },
  avatarButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#0c2756',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    elevation: 2,
  },
  avatarButtonText: {
    color: '#ffffff',
    fontSize: 14,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#0f4b74ff',
    paddingTop: 40,
    paddingHorizontal: 16,
  },
  closeButton: {
    alignSelf: 'flex-end',
    marginBottom: 10,
    padding: 4,
  },
  closeButtonText: {
    color: '#ff4d4d',
    fontSize: 26,
    fontWeight: 'bold',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  commentItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  highlightedComment: {
    backgroundColor: '#e0f7fa',
    borderLeftWidth: 3,
    borderLeftColor: '#00bcd4',
  },
  userImage: {
    width: 42,
    height: 42,
    borderRadius: 21,
    marginRight: 12,
  },
  commentContentContainer: {
    flex: 1,
  },
  commentUser: {
    fontWeight: '600',
    fontSize: 15,
    color: '#333',
    marginBottom: 2,
  },
  commentContent: {
    fontSize: 14,
    color: '#555',
    lineHeight: 20,
  },
  commentInputSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#ddd',
    marginTop: 8,
    gap: 8,
  },
  currentUserImage: {
    width: 38,
    height: 38,
    borderRadius: 19,
    marginTop: 6,
  },
  commentInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingTop: 10,
    fontSize: 14,
    backgroundColor: '#fff',
    color: '#000',
    borderColor: '#ccc',
    borderWidth: 1,
  },
  commentPostButton: {
    backgroundColor: '#007bff',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  emptyContainer: {
    padding: 20,
    alignItems: 'center',
  },
});


export default Comments;
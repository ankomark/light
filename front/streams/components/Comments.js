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
                        <Text style={styles.closeButtonText}>✕</Text>
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


// import React, { useState, useEffect, useRef } from 'react';
// import { 
//   View, 
//   Text, 
//   TouchableOpacity, 
//   TextInput, 
//   StyleSheet, 
//   FlatList, 
//   Modal, 
//   Dimensions, 
//   Image,
//   Alert,
//   ActivityIndicator
// } from 'react-native';
// import { fetchComments, postComment } from '../services/api';
// import AsyncStorage from '@react-native-async-storage/async-storage';
// import { API_URL } from '../services/api';
// import { useFocusEffect } from '@react-navigation/native';

// const { width } = Dimensions.get('window');
// const DEFAULT_PROFILE_IMAGE = 'https://via.placeholder.com/50';

// const CommentItem = React.memo(({ item, highlightedComment }) => (
//   <View style={[
//     styles.commentItem,
//     item.id === highlightedComment && styles.highlightedComment
//   ]}>
//     <Image
//       source={{ uri: item.user.profile_picture || DEFAULT_PROFILE_IMAGE }}
//       style={styles.userImage}
//       onError={() => console.log('Failed to load profile image')}
//     />
//     <View style={styles.commentContentContainer}>
//       <Text style={styles.commentUser}>{item.user.username}</Text>
//       <Text style={styles.commentContent}>{item.content}</Text>
//     </View>
//   </View>
// ));

// const Comments = ({ trackId, highlightCommentId, autoOpen = false }) => {
//     const flatListRef = useRef(null);
//     const [highlightedComment, setHighlightedComment] = useState(null);
//     const [comments, setComments] = useState([]);
//     const [loading, setLoading] = useState(true);
//     const [newComment, setNewComment] = useState('');
//     const [showComments, setShowComments] = useState(autoOpen);
//     const [userProfile, setUserProfile] = useState(null);
//     const [isPosting, setIsPosting] = useState(false);

//     const fetchCommentData = async () => {
//         try {
//             setLoading(true);
//             const data = await fetchComments(trackId);
//             const commentsWithProfiles = await Promise.all(
//                 data.map(async (comment) => {
//                     try {
//                         const response = await axios.get(
//                             `${API_URL}/profiles/by_user/${comment.user.id}/`
//                         );
//                         return {
//                             ...comment,
//                             user: {
//                                 ...comment.user,
//                                 profile_picture: response.data?.picture || DEFAULT_PROFILE_IMAGE,
//                             },
//                         };
//                     } catch (error) {
//                         console.error('Error fetching profile:', error);
//                         return {
//                             ...comment,
//                             user: {
//                                 ...comment.user,
//                                 profile_picture: DEFAULT_PROFILE_IMAGE,
//                             },
//                         };
//                     }
//                 })
//             );
//             setComments(commentsWithProfiles);
//         } catch (error) {
//             console.error('Failed to fetch comments:', error);
//             Alert.alert('Error', 'Failed to load comments');
//         } finally {
//             setLoading(false);
//         }
//     };

//     useEffect(() => {
//         fetchCommentData();
//     }, [trackId]);

//     useFocusEffect(
//         React.useCallback(() => {
//             if (highlightCommentId && comments.length > 0) {
//                 const index = comments.findIndex(c => c.id === highlightCommentId);
//                 if (index !== -1) {
//                     setTimeout(() => {
//                         flatListRef.current?.scrollToIndex({ 
//                             index,
//                             viewOffset: 50,
//                             animated: true 
//                         });
//                         setHighlightedComment(highlightCommentId);
//                     }, 500);
//                 }
//             }
//         }, [comments, highlightCommentId])
//     );

//     const fetchUserProfile = async () => {
//         try {
//             const response = await axios.get(`${API_URL}/profiles/me/`);
//             setUserProfile(response.data);
//         } catch (error) {
//             console.error('Error fetching user profile:', error);
//         }
//     };

//     useEffect(() => {
//         fetchUserProfile();
//     }, []);

//     const handlePostComment = async () => {
//         if (!newComment.trim() || isPosting) return;
        
//         setIsPosting(true);
//         try {
//             const postedComment = await postComment(trackId, newComment);
            
//             setComments(prev => [{
//                 ...postedComment,
//                 user: {
//                     ...postedComment.user,
//                     profile_picture: userProfile?.picture || DEFAULT_PROFILE_IMAGE,
//                 }
//             }, ...prev]);
            
//             setNewComment('');
            
//             setTimeout(() => {
//                 flatListRef.current?.scrollToIndex({ index: 0, animated: true });
//             }, 300);
            
//         } catch (error) {
//             console.error('Failed to post comment:', error);
//             Alert.alert(
//                 'Error', 
//                 error.response?.data?.detail || 
//                 error.message || 
//                 'Failed to post comment'
//             );
//         } finally {
//             setIsPosting(false);
//         }
//     };

//     const toggleComments = () => setShowComments(prev => !prev);

//     const handleScrollToIndexFailed = ({ index }) => {
//         setTimeout(() => {
//             flatListRef.current?.scrollToIndex({ index });
//         }, 500);
//     };

//     return (
//         <View style={styles.commentsSection}>
//             <TouchableOpacity onPress={toggleComments} style={styles.avatarButton}>
//                 <Text style={styles.avatarButtonText}>
//                     💬 {comments.length}
//                 </Text>
//             </TouchableOpacity>
            
//             <Modal
//                 visible={showComments}
//                 animationType="slide"
//                 transparent={false}
//                 onRequestClose={toggleComments}
//             >
//                 <View style={styles.modalContainer}>
//                     <TouchableOpacity onPress={toggleComments} style={styles.closeButton}>
//                         <Text style={styles.closeButtonText}>✕</Text>
//                     </TouchableOpacity>
                    
//                     {loading ? (
//                         <View style={styles.loadingContainer}>
//                             <ActivityIndicator size="large" />
//                         </View>
//                     ) : (
//                         <FlatList
//                             ref={flatListRef}
//                             data={comments}
//                             keyExtractor={item => item.id.toString()}
//                             renderItem={({ item }) => (
//                                 <CommentItem 
//                                     item={item} 
//                                     highlightedComment={highlightedComment} 
//                                 />
//                             )}
//                             ListEmptyComponent={
//                                 <View style={styles.emptyContainer}>
//                                     <Text>No comments yet</Text>
//                                 </View>
//                             }
//                             inverted
//                             initialNumToRender={10}
//                             maxToRenderPerBatch={10}
//                             windowSize={10}
//                             onScrollToIndexFailed={handleScrollToIndexFailed}
//                         />
//                     )}
                    
//                     <View style={styles.commentInputSection}>
//                         <Image
//                             source={{ uri: userProfile?.picture || DEFAULT_PROFILE_IMAGE }}
//                             style={styles.currentUserImage}
//                         />
//                         <TextInput
//                             style={styles.commentInput}
//                             value={newComment}
//                             onChangeText={setNewComment}
//                             placeholder="Write a comment..."
//                             placeholderTextColor="#999"
//                             multiline
//                             editable={!isPosting}
//                         />
//                         <TouchableOpacity 
//                             onPress={handlePostComment}
//                             style={[
//                                 styles.commentPostButton,
//                                 (!newComment.trim() || isPosting) && styles.disabledButton
//                             ]}
//                             disabled={!newComment.trim() || isPosting}
//                         >
//                             {isPosting ? (
//                                 <ActivityIndicator color="#fff" />
//                             ) : (
//                                 <Text style={styles.buttonText}>Post</Text>
//                             )}
//                         </TouchableOpacity>
//                     </View>
//                 </View>
//             </Modal>
//         </View>
//     );
// };




const styles = StyleSheet.create({
    commentsSection: {
        marginTop: 10,
    },
    avatarButton: {
        padding: 5,
    },
    avatarButtonText: {
        color: 'white',
        fontSize: 14,
    },
    modalContainer: {
        flex: 1,
        padding: 20,
        backgroundColor: '#708F96',
    },
    closeButton: {
        alignSelf: 'flex-end',
        marginBottom: 10,
    },
    closeButtonText: {
        color: 'red',
        fontSize: 30,
    },
    commentItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
    },
    userImage: {
        width: 40,
        height: 40,
        borderRadius: 20,
        marginRight: 10,
    },
    commentContentContainer: {
        flex: 1,
    },
    commentUser: {
        fontWeight: 'bold',
        fontSize: 14,
        color: 'black',
    },
    commentContent: {
        fontSize: 14,
        color: 'azure',
    },
    commentInputSection: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 10,

    },
    currentUserImage: {
        width: 40,
        height: 40,
        borderRadius: 20,
        marginRight: 10,
    },
    commentInput: {
        flex: 1,
        height: 60,
        padding: 5,
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 4,
        color: 'white',
    },
    commentPostButton: {
        marginLeft: 10,
        padding: 10,
        backgroundColor: '#007bff',
        borderRadius: 4,
    },
    buttonText: {
        color: '#fff',
        textAlign: 'center',
    },
});

export default Comments;
import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  FlatList, 
  ActivityIndicator, 
  KeyboardAvoidingView,
  Platform,
  Alert,
  SafeAreaView,
  RefreshControl,
  Keyboard
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../context/useAuth';
import { 
  fetchGroupDetails, 
  requestJoinGroup, 
  fetchGroupPosts, 
  createGroupPost,
  checkGroupMembership
} from '../services/api';
import GroupHeader from './GroupHeader';
import GroupPostItem from './GroupPostItem';
import GroupPostInputBar from './GroupPostInputBar';
import CreateGroupPost from './CreateGroupPost';
import GroupMembers from './GroupMembers';
import GroupJoinRequests from './GroupJoinRequests';
import AsyncStorage from '@react-native-async-storage/async-storage';

const GroupDetail = ({ route, navigation }) => {
  const { groupSlug, group: initialGroup } = route.params;
  const [group, setGroup] = useState(initialGroup || null);
  const [posts, setPosts] = useState([]);
  const [isMember, setIsMember] = useState(initialGroup?.is_member || false);
  const [isAdmin, setIsAdmin] = useState(initialGroup?.is_admin || false);
  const [loading, setLoading] = useState(!initialGroup);
  const [refreshing, setRefreshing] = useState(false);
  const [showMediaModal, setShowMediaModal] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const [creatingPost, setCreatingPost] = useState(false);
  const [membershipCheckInterval, setMembershipCheckInterval] = useState(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const { currentUser } = useAuth();

  useEffect(() => {
    if (!initialGroup) {
      loadGroupData();
    }

    const keyboardDidShowListener = Keyboard.addListener(
      'keyboardDidShow',
      (e) => {
        setKeyboardHeight(e.endCoordinates.height);
      }
    );
    const keyboardDidHideListener = Keyboard.addListener(
      'keyboardDidHide',
      () => {
        setKeyboardHeight(0);
      }
    );

    return () => {
      if (membershipCheckInterval) {
        clearInterval(membershipCheckInterval);
      }
      keyboardDidShowListener.remove();
      keyboardDidHideListener.remove();
    };
  }, [groupSlug]);

  const loadGroupData = async () => {
    try {
      setLoading(true);
      const groupData = await fetchGroupDetails(groupSlug);
      setGroup(groupData);
      setIsMember(groupData.is_member);
      setIsAdmin(groupData.is_admin);
      
      if (groupData.is_member || !groupData.is_private) {
        await loadPosts();
      }
    } catch (error) {
      console.error('Failed to load group data:', error);
      Alert.alert('Error', 'Failed to load group data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // In loadPosts():
const loadPosts = async () => {
  try {
    const postsData = await fetchGroupPosts(groupSlug);
    setPosts(postsData.map(post => ({
      ...post,
      user: post.user || { username: 'Unknown' },
      created_at: post.created_at || new Date().toISOString(),
      attachments: post.attachments || []
    })));
  } catch (error) {
    console.error('Failed to load posts:', error);
    setPosts([]);
  }
};

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadGroupData();
    } finally {
      setRefreshing(false);
    }
  };

  const checkMembershipStatus = async () => {
    try {
      const status = await checkGroupMembership(groupSlug);
      if (status.is_member !== isMember) {
        setIsMember(status.is_member);
        setIsAdmin(status.is_admin);
        if (status.is_member) {
          await loadPosts();
          await AsyncStorage.removeItem(`joinRequest-${groupSlug}`);
          if (membershipCheckInterval) {
            clearInterval(membershipCheckInterval);
          }
        }
      }
    } catch (error) {
      console.error('Membership check error:', error);
    }
  };

  const handleJoinRequest = async () => {
    try {
      const message = "Request to join group";
      await requestJoinGroup(groupSlug, message);
      
      const interval = setInterval(checkMembershipStatus, 10000);
      setMembershipCheckInterval(interval);
      
      setTimeout(() => {
        clearInterval(interval);
        setMembershipCheckInterval(null);
      }, 300000);
      
      return true;
    } catch (error) {
      console.error('Failed to send join request:', error);
      Alert.alert(
        'Error',
        error.error || error.message || 'Failed to send join request. Please try again.'
      );
      throw error;
    }
  };

  const handleCreatePost = async (formData) => {
  try {
    setCreatingPost(true);
    
    // Create the post
    const newPost = await createGroupPost(
      formData.get('content') || '',
      groupSlug,
      Array.from(formData.getAll('attachments')) // Convert to proper array
    );

    // Update state with proper merging
    setPosts(prevPosts => {
      const updatedPosts = [{
        ...newPost,
        // Ensure complete user data for immediate UI
        user: {
          ...newPost.user,
          profile: currentUser?.profile || {}
        },
        // Ensure attachments array exists
        attachments: newPost.attachments || []
      }, ...prevPosts];
      
      console.log('Updated posts:', updatedPosts); // Debug log
      return updatedPosts;
    });

    setShowMediaModal(false);
    
    // Optional: Refresh to ensure consistency
    await loadPosts();
    
  } catch (error) {
    console.error('Failed to create post:', error);
    Alert.alert(
      'Error',
      error.message || 'Failed to create post. Please try again.'
    );
  } finally {
    setCreatingPost(false);
  }
};

  if (loading || !group) {
    return (
      <SafeAreaView style={styles.loaderContainer}>
        <ActivityIndicator size="large" color="#4F46E5" />
      </SafeAreaView>
    );
  }

  const canViewContent = isMember || !group.is_private;

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <View style={styles.contentContainer}>
          <FlatList
            ListHeaderComponent={
              <>
                <GroupHeader 
                  group={group} 
                  isMember={isMember}
                  isAdmin={isAdmin}
                  onJoinRequest={handleJoinRequest}
                  onShowMembers={() => setShowMembers(true)}
                  onShowRequests={() => setShowRequests(true)}
                  groupSlug={groupSlug}
                />
                
                {!canViewContent && (
                  <View style={styles.privateNotice}>
                    <MaterialIcons name="lock-outline" size={20} color="#6B7280" style={styles.lockIcon} />
                    <Text style={styles.privateText}>
                      This is a private group. Request to join to see content.
                    </Text>
                  </View>
                )}
              </>
            }
            data={canViewContent ? posts : []}
            keyExtractor={(item) => item.id.toString()}
            renderItem={({ item }) => <GroupPostItem post={item} />}
            ListEmptyComponent={
              canViewContent ? (
                <View style={styles.emptyContainer}>
                  <MaterialIcons name="post-add" size={48} color="#E5E7EB" />
                  <Text style={styles.emptyText}>No posts yet</Text>
                  {isMember && (
                    <Text style={styles.emptySubtext}>Be the first to share something</Text>
                  )}
                </View>
              ) : null
            }
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor="#4F46E5"
                colors={['#4F46E5']}
              />
            }
            keyboardDismissMode="interactive"
          />
          
          {isMember && (
            <View style={[styles.inputBarContainer, { bottom: keyboardHeight > 0 ? keyboardHeight : 0 }]}>
              <GroupPostInputBar 
                onSubmit={(text) => {
                  const formData = new FormData();
                  formData.append('content', text);
                  handleCreatePost(formData);
                }}
                onAttachPress={() => setShowMediaModal(true)}
                loading={creatingPost}
              />
            </View>
          )}
        </View>
        
        {showMediaModal && (
          <CreateGroupPost 
            onSubmit={handleCreatePost}
            onCancel={() => setShowMediaModal(false)}
          />
        )}
        
        {showMembers && (
          <GroupMembers 
            groupSlug={groupSlug}
            onClose={() => setShowMembers(false)}
          />
        )}
        
        {showRequests && (
          <GroupJoinRequests 
            groupSlug={groupSlug}
            onClose={() => setShowRequests(false)}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  contentContainer: {
    flex: 1,
    position: 'relative',
  },
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  privateNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  lockIcon: {
    marginRight: 8,
  },
  privateText: {
    color: '#4B5563',
    fontSize: 14,
    fontWeight: '500',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 12,
    fontWeight: '500',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 4,
  },
  listContent: {
    paddingBottom: Platform.OS === 'ios' ? 100 : 80,
  },
  inputBarContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'ios' ? 16 : 8,
    backgroundColor: '#F9FAFB',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
});

export default GroupDetail;
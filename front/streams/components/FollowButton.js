
import React, { useState, useEffect } from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, View } from 'react-native';
import { followUser } from '../services/api';

const FollowButton = ({ userId, initialFollowing, initialFollowersCount, onFollowChange }) => {
  const [isFollowing, setIsFollowing] = useState(initialFollowing ?? false);
  const [followersCount, setFollowersCount] = useState(initialFollowersCount || 0);
  const [loading, setLoading] = useState(false);

  // Update internal state when props change (important for refresh scenarios)
  useEffect(() => {
    setIsFollowing(initialFollowing ?? false);
    setFollowersCount(initialFollowersCount || 0);
  }, [initialFollowing, initialFollowersCount]);

  const handleFollow = async () => {
    if (loading) return; // Prevent double-tap issues
    
    try {
      setLoading(true);
      
      // Store original states for rollback
      const originalFollowing = isFollowing;
      const originalCount = followersCount;
      
      // Optimistic UI update
      const newFollowingState = !isFollowing;
      const newCount = newFollowingState ? followersCount + 1 : Math.max(0, followersCount - 1);
      
      setIsFollowing(newFollowingState);
      setFollowersCount(newCount);

      // Make API call
      const response = await followUser(userId);
      
      // Update state with actual server response
      const serverFollowing = response.is_following;
      const serverCount = response.followers_count;
      
      setIsFollowing(serverFollowing);
      setFollowersCount(serverCount);
      
      // Notify parent component
      if (onFollowChange) {
        onFollowChange({
          id: userId,
          is_following: serverFollowing,
          followers_count: serverCount
        });
      }
      
    } catch (error) {
      console.error('Follow error:', error);
      
      // Revert optimistic updates on error
      setIsFollowing(initialFollowing ?? false);
      setFollowersCount(initialFollowersCount || 0);
      
      // You might want to show an error message to the user here
      // Alert.alert('Error', 'Failed to update follow status. Please try again.');
      
    } finally {
      setLoading(false);
    }
  };

  return (
    <TouchableOpacity
      style={[
        styles.button, 
        isFollowing ? styles.unfollowButton : styles.followButton,
        loading && styles.disabledButton
      ]}
      onPress={handleFollow}
      disabled={loading}
      activeOpacity={0.7}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <View style={styles.buttonContent}>
          <Text style={[styles.buttonText, loading && styles.disabledText]}>
            {isFollowing ? 'Following' : 'Follow'}
          </Text>
          {/* Only show count when following and count > 0 */}
          {isFollowing && followersCount > 0 && (
            <Text style={[styles.followersCountText, loading && styles.disabledText]}>
              {followersCount}
            </Text>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 15,
    paddingVertical: 6,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    minWidth: 80, // Prevent button width changes
  },
  followButton: {
    backgroundColor: '#1DA1F2',
  },
  unfollowButton: {
    backgroundColor: 'orange',
    borderWidth: 1,
    borderColor: '#657786',
  },
  disabledButton: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  followersCountText: {
    color: '#fff',
    fontSize: 12,
    marginLeft: 5,
    fontWeight: '600',
  },
  disabledText: {
    opacity: 0.8,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default FollowButton;
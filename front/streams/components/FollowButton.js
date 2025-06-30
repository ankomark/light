import React, { useState } from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import axios from 'axios';
import { API_URL } from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';

const FollowButton = ({ userId, initialFollowing, onFollowChange }) => {
  const [isFollowing, setIsFollowing] = useState(initialFollowing);
  const [loading, setLoading] = useState(false);

  const handleFollow = async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('accessToken');
      const response = await axios.post(
        `${API_URL}/users/${userId}/follow/`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      setIsFollowing(!isFollowing);
      if (onFollowChange) {
        onFollowChange(response.data);
      }
    } catch (error) {
      console.error('Error following user:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.button, isFollowing ? styles.unfollowButton : styles.followButton]}
      onPress={handleFollow}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <Text style={styles.buttonText}>
          {isFollowing ? 'Following' : 'Follow'}
        </Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  followButton: {
    backgroundColor: '#1DA1F2',
  },
  unfollowButton: {
    backgroundColor: 'orange',
    borderWidth: 1,
    borderColor: '#657786',
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
});

export default FollowButton;
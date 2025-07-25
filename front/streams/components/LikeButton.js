
import React, { useState,useEffect } from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { likePost } from '../services/api'; // API to handle like updates
import { toggleTrackLike } from '../services/api';
const LikeButton = ({ trackId, initialLikes, initialIsLiked }) => {
    const [likes, setLikes] = useState(initialLikes);
    const [isLiked, setIsLiked] = useState(initialIsLiked);
    // const [isLiked, setIsLiked] = useState(false);
    useEffect(() => {
        setLikes(initialLikes);
        setIsLiked(initialIsLiked);
      }, [initialLikes, initialIsLiked]);

    const handleLikeClick = async () => {
        try {
            const response = await toggleTrackLike(trackId);
            
            if (response && typeof response.likes_count === 'number') {
              setLikes(response.likes_count);
              setIsLiked(response.is_liked);
              
              // Optional feedback
              if (response.is_liked) {
                Alert.alert('Liked!', 'You liked this track', { duration: 1000 });
              }
            }
          } catch (error) {
            Alert.alert('Error', error.message || 'Failed to update like status');
          }
        };


    return (
        <TouchableOpacity
        style={styles.likeButton}
        onPress={handleLikeClick}
        testID="like-button"
    >
        <Text style={[styles.likeText, isLiked && styles.liked]}>
        {isLiked ? '👍' : '🤍'} {likes}
        </Text>
    </TouchableOpacity>
    );
};

export default LikeButton;

const styles = StyleSheet.create({
    likeButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
        backgroundColor: 'transparent',
    },
    likeText: {
        fontSize: 18,
        color: '#f30b3a', // Default color
        fontWeight: 'bold',
        textAlign: 'center',
    },
    liked: {
        color: '#ff6b81', // Liked color
    },
});
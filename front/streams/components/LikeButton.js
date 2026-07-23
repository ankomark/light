
import React, { useState, useEffect } from 'react';
import { TouchableOpacity, Text, StyleSheet, Alert } from 'react-native';
import { toggleTrackLike } from '../services/api';
import { useI18n } from '../context/I18nContext';
const LikeButton = ({ trackId, initialLikes, initialIsLiked }) => {
  const { t } = useI18n();
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
            }
          } catch (error) {
            Alert.alert(t('common.error'), error.message || t('social.likeStatusFailed'));
          }
        };


    return (
        <TouchableOpacity
        style={styles.likeButton}
        onPress={handleLikeClick}
        testID="like-button"
    >
        <Text style={[styles.likeText, isLiked && styles.liked]}>
        {isLiked ? '❤️' : '🤍'} {likes}
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
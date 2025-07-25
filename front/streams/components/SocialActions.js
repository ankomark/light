import React, { useState } from 'react';
import { 
  TouchableOpacity, 
  Text, 
  StyleSheet, 
  Alert,
  View,
  ActivityIndicator
} from 'react-native';
import { 
  MaterialCommunityIcons,
  Feather 
} from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import config from '../config';
import { likePost, savePost } from '../services/api';

export const LikeButton = ({ postId, initialLikes, isLiked }) => {
  const [likes, setLikes] = useState(initialLikes);
  const [liked, setLiked] = useState(isLiked);
  const [loading, setLoading] = useState(false);

  const handleLike = async () => {
    try {
      setLoading(true);
      const updatedPost = await likePost(postId);
      setLikes(updatedPost.likes_count);
      setLiked(updatedPost.is_liked);
    } catch (error) {
      console.error('Like error:', error);
      Alert.alert('Error', 'Failed to like post. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <TouchableOpacity 
      style={styles.actionButton} 
      onPress={handleLike}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator size="small" color={liked ? "#e74c3c" : "#FFF"} />
      ) : (
        <>
          <MaterialCommunityIcons 
            name={liked ? "thumb-up" : "thumb-up-outline"} 
            size={24} 
            color={liked ? "#e74c3c" : "#FFF"} 
          />
          <Text style={styles.actionText}>{likes}</Text>
        </>
      )}
    </TouchableOpacity>
  );
};

export const SaveButton = ({ postId, initialSaved }) => {
  const [saved, setSaved] = useState(initialSaved);
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    try {
      setLoading(true);
      const updatedPost = await savePost(postId);
      setSaved(updatedPost.is_saved);
    } catch (error) {
      console.error('Save error:', error);
      Alert.alert('Error', 'Failed to save post. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <TouchableOpacity 
      style={styles.actionButton} 
      onPress={handleSave}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator size="small" color={saved ? "#1DA1F2" : "#FFF"} />
      ) : (
        <Feather 
          name="bookmark" 
          size={24} 
          color={saved ? "#1DA1F2" : "#FFF"} 
        />
      )}
    </TouchableOpacity>
  );
};

export const DownloadButton = ({ publicId, contentType }) => {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);

  const getCloudinaryUrl = () => {
    const resourceType = contentType === 'video' ? 'video' : 'image';
    return `https://res.cloudinary.com/${config.cloudinary.cloudName}/${resourceType}/upload/fl_attachment/${publicId}`;
  };

  const handleDownload = async () => {
    if (!publicId) {
      Alert.alert("Error", "No media file available");
      return;
    }

    try {
      setDownloading(true);
      setProgress(0);

      // Check permissions
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        throw new Error('Storage permission not granted');
      }

      // Prepare download
      const fileExtension = contentType === 'video' ? 'mp4' : 'jpg';
      const fileName = `social_${Date.now()}.${fileExtension}`;
      const fileUri = `${FileSystem.documentDirectory}${fileName}`;
      const downloadUrl = getCloudinaryUrl();

      // Start download with progress tracking
      const downloadResumable = FileSystem.createDownloadResumable(
        downloadUrl,
        fileUri,
        {},
        ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
          setProgress(totalBytesWritten / totalBytesExpectedToWrite);
        }
      );

      const { uri } = await downloadResumable.downloadAsync();
      
      // Save to media library
      const asset = await MediaLibrary.createAssetAsync(uri);
      
      // Try to organize in album
      try {
        await MediaLibrary.createAlbumAsync("Social App", asset, false);
      } catch (albumError) {
        console.log('Saved to default gallery location');
      }

      // Offer sharing
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          dialogTitle: 'Share Media',
          mimeType: contentType === 'video' ? 'video/mp4' : 'image/jpeg'
        });
      } else {
        Alert.alert(
          "Success",
          "Media saved to your device gallery",
          [{ text: "OK" }]
        );
      }
    } catch (error) {
      console.error('Download error:', error);
      
      let errorMessage = "Failed to download media";
      if (error.message.includes('permission')) {
        errorMessage = "Please enable storage permissions in settings";
      } else if (error.message.includes('network')) {
        errorMessage = "Network error - please check your connection";
      }

      Alert.alert("Error", errorMessage);
    } finally {
      setDownloading(false);
      setProgress(0);
    }
  };

  return (
    <TouchableOpacity 
      style={styles.actionButton} 
      onPress={handleDownload}
      disabled={downloading}
    >
      {downloading ? (
        <View style={styles.progressContainer}>
          <ActivityIndicator size="small" color="#FFF" />
          <Text style={styles.progressText}>
            {Math.round(progress * 100)}%
          </Text>
        </View>
      ) : (
        <Feather name="download" size={24} color="#FFF" />
      )}
    </TouchableOpacity>
  );
};

// Export CommentAction separately if needed
export { default as CommentAction } from './CommentAction';

const styles = StyleSheet.create({
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    minWidth: 50,
  },
  actionText: {
    fontSize: 14,
    color: '#FFF',
    minWidth: 20,
    textAlign: 'center',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  progressText: {
    color: '#FFF',
    fontSize: 12,
  },
  videoThumbnail: {
  width: '100%',
  height: '100%',
  resizeMode: 'cover',
},
videoContainer: {
  position: 'relative',
},
});
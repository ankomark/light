import React from 'react';
import { TouchableOpacity, Text, StyleSheet, Alert } from 'react-native';
import { Ionicons, Feather, MaterialIcons,MaterialCommunityIcons } from '@expo/vector-icons';
import { likePost, savePost, commentOnPost, downloadPostMedia } from '../services/api';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';

export const LikeButton = ({ postId, initialLikes, isLiked }) => {
  const [likes, setLikes] = React.useState(initialLikes);
  const [liked, setLiked] = React.useState(isLiked);

  const handleLike = async () => {
    try {
      const updatedPost = await likePost(postId);
      setLikes(updatedPost.likes_count);
      setLiked(updatedPost.is_liked);
    } catch (error) {
      Alert.alert('Error', 'Failed to like post');
    }
  };

  return (
    <TouchableOpacity style={styles.actionButton} onPress={handleLike}>
      <MaterialCommunityIcons 
        name={liked ? "thumb-up" : "thumb-up-outline"} 
        size={24} 
        color={liked ? "#e74c3c" : "#FFF"} 
      />
      <Text style={styles.actionText}>{likes}</Text>
    </TouchableOpacity>
  );
};

export const SaveButton = ({ postId, initialSaved }) => {
  const [saved, setSaved] = React.useState(initialSaved);

  const handleSave = async () => {
    try {
      const updatedPost = await savePost(postId);
      setSaved(updatedPost.is_saved);
    } catch (error) {
      Alert.alert('Error', 'Failed to save post');
    }
  };

  return (
    <TouchableOpacity style={styles.actionButton} onPress={handleSave}>
      <Feather 
        name="bookmark" 
        size={24} 
        color={saved ? "#1DA1F2" : "#FFF"} 
      />
    </TouchableOpacity>
  );
};
export { default as CommentAction } from './CommentAction';


export const DownloadButton = ({ mediaUrl, contentType }) => {
  const handleDownload = async () => {
    if (!mediaUrl) {
      Alert.alert("Error", "No media file available");
      return;
    }

    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert("Permission Denied", "Need storage access to download");
        return;
      }

      const fileExtension = mediaUrl.split('.').pop();
      const fileName = `download_${Date.now()}.${fileExtension || (contentType === 'video' ? 'mp4' : 'jpg')}`;
      const fileUri = `${FileSystem.documentDirectory}${fileName}`;

      const downloadResumable = FileSystem.createDownloadResumable(
        mediaUrl,
        fileUri
      );

      const { uri } = await downloadResumable.downloadAsync();
      const asset = await MediaLibrary.createAssetAsync(uri);
      
      try {
        await MediaLibrary.createAlbumAsync("Social Downloads", asset, false);
      } catch (albumError) {
        console.log('Saved to gallery without album');
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      }
      Alert.alert("Success", "Media saved to your device!");
    } catch (error) {
      console.error('Download error:', error);
      Alert.alert("Download Failed", error.message || "Unknown error occurred");
    }
  };

  return (
    <TouchableOpacity style={styles.actionButton} onPress={handleDownload}>
      <Feather name="download" size={24} color="#FFF" />
    </TouchableOpacity>
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
});
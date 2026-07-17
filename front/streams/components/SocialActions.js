import React, { useState, useEffect } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  Alert,
  View,
  ActivityIndicator,
  Share
} from 'react-native';
import { 
  MaterialCommunityIcons,
  Feather 
} from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';
import config from '../config';
import { likePost, savePost, PUBLIC_BASE } from '../services/api';

// Brand gold for the "liked" state — ties the action into the app's gold
// wordmark + medallion for a premium feel.
const LIKE_GOLD = '#E8C66B';

export const LikeButton = ({ postId, initialLikes, isLiked, onLikeChange }) => {
  const [likes, setLikes] = useState(initialLikes || 0);
  const [liked, setLiked] = useState(!!isLiked);
  const [loading, setLoading] = useState(false);

  // Reflect persisted values when the row re-mounts / the post updates.
  useEffect(() => { setLikes(initialLikes || 0); }, [initialLikes]);
  useEffect(() => { setLiked(!!isLiked); }, [isLiked]);

  const handleLike = async () => {
    if (loading) return;
    const prevLiked = liked;
    const prevLikes = likes;
    const nextLiked = !prevLiked;
    const nextLikes = Math.max(0, prevLikes + (nextLiked ? 1 : -1));

    // A light tap on like, a soft one on unlike — tactile "premium" feedback.
    Haptics.impactAsync(
      nextLiked ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Soft
    ).catch(() => {});
    setLiked(nextLiked);                                  // optimistic
    setLikes(nextLikes);
    onLikeChange?.({ is_liked: nextLiked, likes_count: nextLikes });
    setLoading(true);
    try {
      const res = await likePost(postId);
      const cLiked = typeof res?.is_liked === 'boolean' ? res.is_liked : nextLiked;
      const cLikes = typeof res?.likes_count === 'number' ? res.likes_count : nextLikes;
      setLiked(cLiked);
      setLikes(cLikes);
      onLikeChange?.({ is_liked: cLiked, likes_count: cLikes });
    } catch (error) {
      console.error('Like error:', error);
      setLiked(prevLiked);                                // rollback
      setLikes(prevLikes);
      onLikeChange?.({ is_liked: prevLiked, likes_count: prevLikes });
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
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      {loading ? (
        <ActivityIndicator size="small" color={liked ? LIKE_GOLD : "#FFF"} />
      ) : (
        <>
          <MaterialCommunityIcons
            name={liked ? "heart" : "heart-outline"}
            size={24}
            color={liked ? LIKE_GOLD : "#FFF"}
            style={liked ? styles.likeGlow : undefined}
          />
          <Text style={[styles.actionText, liked && { color: LIKE_GOLD }]}>{likes}</Text>
        </>
      )}
    </TouchableOpacity>
  );
};

export const SaveButton = ({ postId, initialSaved, onSaveChange }) => {
  const [saved, setSaved] = useState(!!initialSaved);
  const [loading, setLoading] = useState(false);

  // Reflect the persisted value when the row re-mounts / the post updates.
  useEffect(() => { setSaved(!!initialSaved); }, [initialSaved]);

  const handleSave = async () => {
    if (loading) return;
    const previous = saved;
    const next = !previous;
    setSaved(next);           // optimistic
    onSaveChange?.(next);     // persist to the feed immediately
    setLoading(true);
    try {
      const res = await savePost(postId);
      const confirmed = typeof res?.is_saved === 'boolean' ? res.is_saved : next;
      setSaved(confirmed);
      onSaveChange?.(confirmed);
    } catch (error) {
      console.error('Save error:', error);
      setSaved(previous);     // rollback
      onSaveChange?.(previous);
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
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      {loading ? (
        <ActivityIndicator size="small" color={saved ? "#1DA1F2" : "#FFF"} />
      ) : (
        <MaterialCommunityIcons
          name={saved ? "bookmark" : "bookmark-outline"}
          size={24}
          color={saved ? "#1DA1F2" : "#FFF"}
        />
      )}
    </TouchableOpacity>
  );
};

export const ShareButton = ({ postId, caption, username }) => {
  const handleShare = async () => {
    // Share the post's web page (NOT the raw media): it renders a rich preview
    // card with a thumbnail and deep-links back into the app to this exact post.
    const link = `${PUBLIC_BASE}/post/${postId}/`;
    const parts = [];
    if (caption?.trim()) parts.push(caption.trim());
    parts.push(username ? `Shared from ${username} on Adventist Life` : 'Shared via Adventist Life');
    parts.push(link);
    const message = parts.join('\n\n');

    try {
      await Share.share(
        // On iOS, url is surfaced separately; on Android it's folded into message.
        { message, url: link },
        { dialogTitle: 'Share post' }
      );
    } catch (error) {
      // Sharing dismissed or failed — nothing to do.
      console.warn('Share error:', error?.message);
    }
  };

  return (
    <TouchableOpacity
      style={styles.actionButton}
      onPress={handleShare}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel="Share post"
    >
      <Feather name="share-2" size={24} color="#FFF" />
    </TouchableOpacity>
  );
};

export const DownloadButton = ({ mediaUrl, publicId, contentType }) => {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);

  // The API always returns absolute media URLs now; publicId is a legacy prop
  // kept only so old call sites don't crash.
  const resolveUrl = () => mediaUrl || (typeof publicId === 'string' && publicId.startsWith('http') ? publicId : null);

  const handleDownload = async () => {
    const downloadUrl = resolveUrl();
    if (!downloadUrl) {
      Alert.alert("Error", "No media available to download");
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
      const fileName = `advent_${Date.now()}.${fileExtension}`;
      const fileUri = `${FileSystem.documentDirectory}${fileName}`;

      // Start download with progress tracking
      const downloadResumable = FileSystem.createDownloadResumable(
        downloadUrl,
        fileUri,
        {},
        ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
          if (totalBytesExpectedToWrite > 0) {
            setProgress(totalBytesWritten / totalBytesExpectedToWrite);
          }
        }
      );

      const result = await downloadResumable.downloadAsync();
      if (!result?.uri) throw new Error('Download failed');

      // Save to the device gallery
      const asset = await MediaLibrary.createAssetAsync(result.uri);
      try {
        await MediaLibrary.createAlbumAsync("Advent", asset, false);
      } catch (albumError) {
        // Saved to the default gallery location — fine.
      }

      Alert.alert("Saved", "Media saved to your gallery.");
    } catch (error) {
      console.error('Download error:', error);

      let errorMessage = "Failed to download media";
      if (error.message?.includes('permission')) {
        errorMessage = "Please enable storage permission in settings";
      } else if (error.message?.toLowerCase().includes('network')) {
        errorMessage = "Network error — please check your connection";
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
  // Soft gold halo around the filled heart when liked.
  likeGlow: {
    textShadowColor: 'rgba(232,198,107,0.7)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
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
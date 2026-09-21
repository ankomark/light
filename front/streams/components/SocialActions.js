import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';
import config from '../config';
import { likePost, savePost, PUBLIC_BASE } from '../services/api';
import { useI18n } from '../context/I18nContext';

// Brand gold for the "liked" state — ties the action into the app's gold
// wordmark + medallion for a premium feel.
const LIKE_GOLD = '#E8C66B';

// Optimistic toggles, without the spinner that used to hide them.
//
// The old shape set the optimistic state and then rendered an ActivityIndicator
// in place of the icon until the server answered — so the work of updating
// instantly was done and then thrown away, and every tap read as a wait. It
// also locked the button for the duration, which meant a quick like/unlike
// silently dropped the second tap.
//
// What replaces it: the icon always shows what the user last asked for, and a
// tiny reconcile loop pushes that intent at the server. `desired` is what the
// user wants, `server` is what we believe is stored. When they differ and
// nothing is in flight, we send one toggle. Taps landing mid-request just move
// `desired`; the loop re-checks on settle and sends another toggle only if the
// two still disagree. So N fast taps cost at most 2 requests and always land on
// what the user actually chose.
const useToggle = ({ initial, request, onSettle, onFail }) => {
  const [value, setValue] = useState(!!initial);
  const desired = useRef(!!initial);
  const server = useRef(!!initial);
  const inFlight = useRef(false);

  // Adopt a new persisted value from the parent (row recycled, post refreshed),
  // but never while the user's own intent is still unresolved — that would
  // overwrite a tap with the stale prop it hasn't been told about yet.
  useEffect(() => {
    if (inFlight.current || desired.current !== server.current) return;
    setValue(!!initial);
    desired.current = !!initial;
    server.current = !!initial;
  }, [initial]);

  const sync = useCallback(async () => {
    if (inFlight.current || desired.current === server.current) return;
    inFlight.current = true;
    try {
      const res = await request();
      server.current = typeof res?.confirmed === 'boolean'
        ? res.confirmed
        : !server.current;
      if (server.current === desired.current) {
        setValue(server.current);          // settled: adopt the server's word
        onSettle?.(server.current, res);
      }
    } catch (error) {
      desired.current = server.current;    // roll back to the last known truth
      setValue(server.current);
      onFail?.(server.current, error);
    } finally {
      inFlight.current = false;
      if (desired.current !== server.current) sync();   // tapped again mid-flight
    }
  }, [request, onSettle, onFail]);

  const toggle = useCallback(() => {
    const next = !desired.current;
    desired.current = next;
    setValue(next);                        // paints this frame, no await
    return next;
  }, []);

  return { value, toggle, sync };
};

export const LikeButton = ({ postId, initialLikes, isLiked, onLikeChange }) => {
  const { t } = useI18n();
  const [likes, setLikes] = useState(initialLikes || 0);
  const likesRef = useRef(initialLikes || 0);       // what's on screen now
  const serverLikesRef = useRef(initialLikes || 0); // last count the server gave
  const setLikeCount = useCallback((n) => {
    likesRef.current = n;
    setLikes(n);
  }, []);

  useEffect(() => {
    setLikeCount(initialLikes || 0);
    serverLikesRef.current = initialLikes || 0;
  }, [initialLikes, setLikeCount]);

  const request = useCallback(async () => {
    const res = await likePost(postId);
    return {
      confirmed: typeof res?.is_liked === 'boolean' ? res.is_liked : undefined,
      count: typeof res?.likes_count === 'number' ? res.likes_count : undefined,
    };
  }, [postId]);

  const onSettle = useCallback((confirmed, res) => {
    // The server's count is authoritative once the toggles have settled — it
    // also folds in likes other people added while we were tapping.
    const count = res?.count;
    if (typeof count === 'number') {
      serverLikesRef.current = count;
      setLikeCount(count);
    }
    onLikeChange?.({ is_liked: confirmed, likes_count: count ?? likesRef.current });
  }, [onLikeChange, setLikeCount]);

  const onFail = useCallback((restored) => {
    // Roll the number back to the last count the server actually confirmed —
    // undoing one optimistic step isn't enough when the user tapped repeatedly
    // before the request failed.
    setLikeCount(serverLikesRef.current);
    onLikeChange?.({ is_liked: restored, likes_count: serverLikesRef.current });
    Alert.alert(t('common.error'), t('social.likeFailed'));
  }, [onLikeChange, setLikeCount, t]);

  const { value: liked, toggle, sync } = useToggle({
    initial: isLiked, request, onSettle, onFail,
  });

  const handleLike = useCallback(() => {
    const next = toggle();
    setLikeCount(Math.max(0, likesRef.current + (next ? 1 : -1)));
    onLikeChange?.({ is_liked: next, likes_count: likesRef.current });
    // A light tap on like, a soft one on unlike — tactile "premium" feedback.
    Haptics.impactAsync(
      next ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Soft
    ).catch(() => {});
    sync();
  }, [toggle, sync, onLikeChange, setLikeCount]);

  return (
    <TouchableOpacity
      style={styles.actionButton}
      onPress={handleLike}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityState={{ selected: liked }}
    >
      <MaterialCommunityIcons
        name={liked ? "heart" : "heart-outline"}
        size={24}
        color={liked ? LIKE_GOLD : "#FFF"}
        style={liked ? styles.likeGlow : undefined}
      />
      <Text style={[styles.actionText, liked && { color: LIKE_GOLD }]}>{likes}</Text>
    </TouchableOpacity>
  );
};

export const SaveButton = ({ postId, initialSaved, onSaveChange }) => {
  const { t } = useI18n();

  const request = useCallback(async () => {
    const res = await savePost(postId);
    return { confirmed: typeof res?.is_saved === 'boolean' ? res.is_saved : undefined };
  }, [postId]);

  const onSettle = useCallback((confirmed) => onSaveChange?.(confirmed), [onSaveChange]);
  const onFail = useCallback((restored) => {
    onSaveChange?.(restored);
    Alert.alert(t('common.error'), t('social.saveFailed'));
  }, [onSaveChange, t]);

  const { value: saved, toggle, sync } = useToggle({
    initial: initialSaved, request, onSettle, onFail,
  });

  const handleSave = useCallback(() => {
    onSaveChange?.(toggle());   // paints immediately, and tells the feed row
    sync();
  }, [toggle, sync, onSaveChange]);

  return (
    <TouchableOpacity
      style={styles.actionButton}
      onPress={handleSave}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityState={{ selected: saved }}
    >
      <MaterialCommunityIcons
        name={saved ? "bookmark" : "bookmark-outline"}
        size={24}
        color={saved ? "#1DA1F2" : "#FFF"}
      />
    </TouchableOpacity>
  );
};

export const ShareButton = ({ postId, caption, username }) => {
  const { t } = useI18n();
  const handleShare = async () => {
    // Share the post's web page (NOT the raw media): it renders a rich preview
    // card with a thumbnail and deep-links back into the app to this exact post.
    const link = `${PUBLIC_BASE}/post/${postId}/`;
    const parts = [];
    if (caption?.trim()) parts.push(caption.trim());
    parts.push(username ? `Shared from ${username} on Adventist Life` : t('social.sharedVia'));
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

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TouchableOpacity, Text, StyleSheet, Alert } from 'react-native';
import { toggleTrackLike } from '../services/api';
import { useI18n } from '../context/I18nContext';

const LikeButton = ({ trackId, initialLikes, initialIsLiked }) => {
  const { t } = useI18n();
  const [likes, setLikes] = useState(initialLikes || 0);
  const [isLiked, setIsLiked] = useState(!!initialIsLiked);

  // This button had no optimistic update at all: the heart only changed once
  // the server answered, so liking a track always felt like a wait — and the
  // in-flight lock meant a quick second tap was dropped rather than queued.
  //
  // Now the heart shows the user's intent immediately and a reconcile loop
  // pushes it at the server: `desired` is what the user wants, `server` is what
  // we believe is stored, and we send a toggle only while they disagree. Taps
  // during a request just move `desired`, so N taps cost at most 2 requests and
  // always settle on what the user chose.
  const desired = useRef(!!initialIsLiked);
  const server = useRef(!!initialIsLiked);
  const serverLikes = useRef(initialLikes || 0);
  const inFlight = useRef(false);

  useEffect(() => {
    // Don't let a stale prop overwrite an intent that hasn't settled yet.
    if (inFlight.current || desired.current !== server.current) return;
    setLikes(initialLikes || 0);
    setIsLiked(!!initialIsLiked);
    desired.current = !!initialIsLiked;
    server.current = !!initialIsLiked;
    serverLikes.current = initialLikes || 0;
  }, [initialLikes, initialIsLiked]);

  const sync = useCallback(async () => {
    if (inFlight.current || desired.current === server.current) return;
    inFlight.current = true;
    try {
      const response = await toggleTrackLike(trackId);
      server.current = typeof response?.is_liked === 'boolean'
        ? response.is_liked
        : !server.current;
      if (typeof response?.likes_count === 'number') {
        serverLikes.current = response.likes_count;
      }
      if (server.current === desired.current) {
        setIsLiked(server.current);          // settled — take the server's word
        setLikes(serverLikes.current);
      }
    } catch (error) {
      desired.current = server.current;      // roll back to the last known truth
      setIsLiked(server.current);
      setLikes(serverLikes.current);
      Alert.alert(t('common.error'), error.message || t('social.likeStatusFailed'));
    } finally {
      inFlight.current = false;
      if (desired.current !== server.current) sync();   // tapped again mid-flight
    }
  }, [trackId, t]);

  const handleLikeClick = useCallback(() => {
    const next = !desired.current;
    desired.current = next;
    setIsLiked(next);                                   // paints this frame
    setLikes((n) => Math.max(0, n + (next ? 1 : -1)));
    sync();
  }, [sync]);

  return (
    <TouchableOpacity
      style={styles.likeButton}
      onPress={handleLikeClick}
      testID="like-button"
      accessibilityRole="button"
      accessibilityState={{ selected: isLiked }}
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
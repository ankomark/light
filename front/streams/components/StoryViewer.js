import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet, Dimensions,
  StatusBar, Animated, Modal, ActivityIndicator,
} from 'react-native';
import { Video } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { viewStory } from '../services/api';
import { colors, spacing, radius } from '../constants/theme';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const STORY_DURATION = 5000; // ms per story

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

const StoryViewer = ({ route, navigation }) => {
  const { group } = route.params;
  const insets = useSafeAreaInsets();
  const stories = group.stories ?? [];

  const [currentIndex, setCurrentIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(true);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const timerRef = useRef(null);
  const animRef = useRef(null);

  const currentStory = stories[currentIndex];

  const markViewed = useCallback((story) => {
    if (!story) return;
    viewStory(story.id).catch(() => {});
  }, []);

  const startProgress = useCallback(() => {
    progressAnim.setValue(0);
    animRef.current = Animated.timing(progressAnim, {
      toValue: 1,
      duration: STORY_DURATION,
      useNativeDriver: false,
    });
    animRef.current.start(({ finished }) => {
      if (finished) goNext();
    });
  }, [progressAnim]);

  const stopProgress = useCallback(() => {
    animRef.current?.stop();
    clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    if (!currentStory) return;
    markViewed(currentStory);
    if (!paused && !mediaLoading) startProgress();
    return stopProgress;
  }, [currentIndex, paused, mediaLoading]);

  const goNext = useCallback(() => {
    stopProgress();
    if (currentIndex < stories.length - 1) {
      setCurrentIndex(i => i + 1);
      setMediaLoading(true);
    } else {
      navigation.goBack();
    }
  }, [currentIndex, stories.length, navigation]);

  const goPrev = useCallback(() => {
    stopProgress();
    if (currentIndex > 0) {
      setCurrentIndex(i => i - 1);
      setMediaLoading(true);
    }
  }, [currentIndex]);

  const handleMediaReady = useCallback(() => {
    setMediaLoading(false);
    if (!paused) startProgress();
  }, [paused, startProgress]);

  if (!currentStory) {
    navigation.goBack();
    return null;
  }

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      {/* Media */}
      {currentStory.content_type === 'video' ? (
        <Video
          source={{ uri: currentStory.media_url }}
          style={styles.media}
          resizeMode="cover"
          shouldPlay={!paused}
          isLooping={false}
          onReadyForDisplay={handleMediaReady}
          onPlaybackStatusUpdate={s => {
            if (s.didJustFinish) goNext();
          }}
        />
      ) : (
        <Image
          source={{ uri: currentStory.media_url }}
          style={styles.media}
          resizeMode="cover"
          onLoad={handleMediaReady}
        />
      )}

      {mediaLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}

      {/* Dark gradient header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        {/* Progress bars */}
        <View style={styles.progressRow}>
          {stories.map((_, i) => (
            <View key={i} style={styles.progressTrack}>
              <Animated.View
                style={[
                  styles.progressFill,
                  {
                    width: i < currentIndex
                      ? '100%'
                      : i === currentIndex
                        ? progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })
                        : '0%',
                  },
                ]}
              />
            </View>
          ))}
        </View>

        {/* User info */}
        <View style={styles.userRow}>
          <Image
            source={group.user.profile_picture ? { uri: group.user.profile_picture } : DEFAULT_AVATAR}
            defaultSource={DEFAULT_AVATAR}
            style={styles.avatar}
          />
          <Text style={styles.username}>{group.user.username}</Text>
          <Text style={styles.timeAgo}>{timeAgo(currentStory.created_at)}</Text>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeBtn}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Caption */}
        {currentStory.caption ? (
          <Text style={styles.caption}>{currentStory.caption}</Text>
        ) : null}
      </View>

      {/* Tap zones: left = prev, right = next, hold = pause */}
      <View style={styles.tapZones}>
        <TouchableOpacity
          style={styles.tapLeft}
          onPress={goPrev}
          onLongPress={() => { setPaused(true); stopProgress(); }}
          onPressOut={() => { setPaused(false); startProgress(); }}
          activeOpacity={1}
        />
        <TouchableOpacity
          style={styles.tapRight}
          onPress={goNext}
          onLongPress={() => { setPaused(true); stopProgress(); }}
          onPressOut={() => { setPaused(false); startProgress(); }}
          activeOpacity={1}
        />
      </View>
    </View>
  );
};

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  media: { width: SCREEN_W, height: SCREEN_H, position: 'absolute' },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.md,
    background: 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)',
  },
  progressRow: { flexDirection: 'row', gap: 3, marginBottom: spacing.sm },
  progressTrack: {
    flex: 1,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.4)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: '#fff' },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: '#fff' },
  username: { flex: 1, color: '#fff', fontWeight: '600', fontSize: 14 },
  timeAgo: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  closeBtn: { padding: spacing.xs },
  caption: {
    color: '#fff',
    fontSize: 14,
    marginTop: spacing.sm,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  tapZones: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    marginTop: 100,
  },
  tapLeft: { flex: 1 },
  tapRight: { flex: 1 },
});

export default StoryViewer;

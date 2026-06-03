import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Image, StyleSheet, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { fetchStoryFeed } from '../services/api';
import { useAuth } from '../context/useAuth';
import { colors, spacing, radius, typography } from '../constants/theme';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

// The colored ring shown around an avatar that has unviewed stories
const StoryRing = ({ hasUnviewed, size }) => {
  if (!hasUnviewed) {
    return (
      <View style={[styles.ring, styles.ringViewed, { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 }]} />
    );
  }
  return (
    <LinearGradient
      colors={['#F9A825', '#E91E63', '#9C27B0']}
      start={{ x: 0, y: 1 }}
      end={{ x: 1, y: 0 }}
      style={[styles.ring, { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 }]}
    />
  );
};

const StoryBubble = ({ group, onPress, isOwn, onCreatePress }) => {
  const avatarSize = 58;
  const avatar = group.user.profile_picture;
  const hasStories = group.stories?.length > 0;

  return (
    <TouchableOpacity
      style={styles.bubble}
      onPress={() => hasStories ? onPress(group) : isOwn ? onCreatePress() : null}
      activeOpacity={0.8}
    >
      <View style={styles.ringWrap}>
        {hasStories
          ? <StoryRing hasUnviewed={group.has_unviewed} size={avatarSize} />
          : <View style={[styles.ring, styles.ringDashed, { width: avatarSize + 6, height: avatarSize + 6, borderRadius: (avatarSize + 6) / 2 }]} />
        }
        <Image
          source={avatar ? { uri: avatar } : DEFAULT_AVATAR}
          defaultSource={DEFAULT_AVATAR}
          style={[styles.avatar, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 }]}
        />
        {isOwn && !hasStories && (
          <View style={styles.plusBadge}>
            <Ionicons name="add" size={12} color="#fff" />
          </View>
        )}
      </View>
      <Text style={styles.username} numberOfLines={1}>
        {isOwn ? 'Your Story' : group.user.username}
      </Text>
    </TouchableOpacity>
  );
};

const StoriesBar = ({ navigation }) => {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const { currentUser } = useAuth();

  const load = useCallback(async () => {
    try {
      const data = await fetchStoryFeed();
      setGroups(Array.isArray(data) ? data : []);
    } catch {
      // silent — stories bar should never crash the feed
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openViewer = useCallback((group) => {
    navigation.navigate('StoryViewer', { group });
  }, [navigation]);

  const openCreate = useCallback(() => {
    navigation.navigate('CreateStory');
  }, [navigation]);

  // Always show own bubble even if no story yet
  const ownGroup = groups.find(g => g.user.id === currentUser?.id) ?? {
    user: { id: currentUser?.id, username: currentUser?.username, profile_picture: currentUser?.profile_picture },
    stories: [],
    has_unviewed: false,
  };
  const others = groups.filter(g => g.user.id !== currentUser?.id);
  const allGroups = [ownGroup, ...others];

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={allGroups}
        keyExtractor={(item) => String(item.user.id)}
        renderItem={({ item, index }) => (
          <StoryBubble
            group={item}
            onPress={openViewer}
            isOwn={index === 0}
            onCreatePress={openCreate}
          />
        )}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.xs,
  },
  loadingWrap: {
    height: 90,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: { paddingHorizontal: spacing.sm, gap: spacing.sm },
  bubble: { alignItems: 'center', width: 72 },
  ringWrap: { position: 'relative', justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  ring: { position: 'absolute', justifyContent: 'center', alignItems: 'center' },
  ringViewed: { borderWidth: 2.5, borderColor: colors.textMuted, backgroundColor: 'transparent' },
  ringDashed: { borderWidth: 2, borderColor: colors.border, borderStyle: 'dashed', backgroundColor: 'transparent' },
  avatar: { backgroundColor: colors.surface },
  plusBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.bg,
  },
  username: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', width: 70 },
});

export default StoriesBar;

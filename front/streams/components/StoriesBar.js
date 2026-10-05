import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
} from 'react-native';
// expo-image, not RN's: it keeps a real memory+disk cache keyed by URL, so an
// avatar already seen anywhere in the app paints from cache instead of being
// re-fetched every time the bar mounts.
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { fetchStoryFeed } from '../services/api';
import { useAuth } from '../context/useAuth';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import { on, EVENTS } from '../utils/appEvents';
import { useI18n } from '../context/I18nContext';
import { colors, spacing, typography } from '../constants/theme';

// Stories expire in 24h and the ring state changes rarely, so a cached bar is
// accurate for far longer than the few minutes we keep it.
const STORIES_MAX_AGE_MS = 10 * 60 * 1000;
// Don't re-hit the endpoint on every single Home focus — moving between tabs
// was a full request each way.
const STORIES_REFETCH_MS = 60 * 1000;

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

/** The picture of a group's newest story: a photo, or a video's poster
 *  (older video stories have none — the newest one with a picture, then). */
const pictureOf = (s) => (s?.content_type === 'video' ? s.thumbnail_url : s?.media_url) || null;
export const storyCover = (stories = []) => {
  const withPicture = stories.filter((s) => s && pictureOf(s));
  if (!withPicture.length) return null;
  const newest = withPicture.reduce((a, b) => (new Date(b.created_at) > new Date(a.created_at) ? b : a));
  return pictureOf(newest);
};

const StoryBubble = React.memo(function StoryBubble({ group, onPress, isOwn, onCreatePress, ownLabel }) {
  const avatarSize = 58;
  const avatar = group.user.profile_picture;
  const hasStories = group.stories?.length > 0;
  // With stories up, the bubble shows one of them (the newest photo or video
  // poster), as Facebook does — the profile picture moves to a small badge.
  // Only old videos without a poster: the profile picture, with a play mark.
  const cover = hasStories ? storyCover(group.stories) : null;
  const onlyVideos = hasStories && !cover;

  return (
    <TouchableOpacity
      style={styles.bubble}
      onPress={() => hasStories ? onPress(group) : isOwn ? onCreatePress() : null}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={isOwn ? ownLabel : group.user.username}
      testID={isOwn ? 'story-own' : `story-${group.user.id}`}
    >
      <View style={styles.ringWrap}>
        {hasStories
          ? <StoryRing hasUnviewed={group.has_unviewed} size={avatarSize} />
          : <View style={[styles.ring, styles.ringDashed, { width: avatarSize + 6, height: avatarSize + 6, borderRadius: (avatarSize + 6) / 2 }]} />
        }
        <Image
          source={cover ? { uri: cover } : avatar ? { uri: avatar } : DEFAULT_AVATAR}
          placeholder={DEFAULT_AVATAR}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={120}
          recyclingKey={cover || avatar || 'default'}
          style={[styles.avatar, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 }]}
          testID={isOwn ? 'story-own-cover' : `story-cover-${group.user.id}`}
        />
        {/* Whose it is, when the bubble shows the story itself (your own has the "+" there). */}
        {!!cover && !isOwn && (
          <Image
            source={avatar ? { uri: avatar } : DEFAULT_AVATAR}
            placeholder={DEFAULT_AVATAR}
            contentFit="cover"
            cachePolicy="memory-disk"
            style={styles.ownerBadge}
          />
        )}
        {onlyVideos && (
          <View style={styles.playBadge} pointerEvents="none">
            <Ionicons name="play" size={11} color="#fff" />
          </View>
        )}
        {/* Your own bubble always has its "+": with stories up, the bubble
            plays them and the "+" adds another. */}
        {isOwn && (
          <TouchableOpacity style={styles.plusBadge} onPress={onCreatePress} hitSlop={12}
                            accessibilityRole="button" accessibilityLabel={ownLabel} testID="story-add">
            <Ionicons name="add" size={14} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
      <Text style={styles.username} numberOfLines={1}>
        {isOwn ? ownLabel : group.user.username}
      </Text>
    </TouchableOpacity>
  );
});

const StoriesBar = ({ navigation }) => {
  const { currentUser } = useAuth();
  const { t } = useI18n();
  const ownLabel = t('story.yours');
  const cacheKey = userKey(currentUser?.id, 'stories');

  // Same instant-paint rule as the feed: show the last known bar immediately,
  // then revalidate behind it. The bar used to mount empty with a spinner and
  // refetch on every focus, so returning to Home always cost a visible gap in
  // the header.
  const [groups, setGroups] = useState(() => peekCache(cacheKey) ?? []);
  const [loaded, setLoaded] = useState(() => (peekCache(cacheKey) ?? []).length > 0);
  const lastFetchRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    readCache(cacheKey, STORIES_MAX_AGE_MS).then((cached) => {
      if (cancelled || !Array.isArray(cached) || !cached.length) return;
      setGroups((prev) => (prev.length ? prev : cached));
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [cacheKey]);

  const load = useCallback(async () => {
    try {
      const data = await fetchStoryFeed();
      const next = Array.isArray(data) ? data : [];
      setGroups(next);
      lastFetchRef.current = Date.now();
      if (next.length) writeCache(cacheKey, next);
    } catch {
      // silent — stories bar should never crash the feed
    } finally {
      setLoaded(true);
    }
  }, [cacheKey]);

  useFocusEffect(useCallback(() => {
    if (Date.now() - lastFetchRef.current > STORIES_REFETCH_MS) load();
  }, [load]));

  // A story just shared or deleted: the row follows now, not after its next
  // refresh. A reaction is kept on its story, so reopening shows it.
  useEffect(() => {
    const offs = [
      on(EVENTS.STORY_CREATED, () => { load(); }),
      on(EVENTS.STORY_DELETED, ({ storyId } = {}) => {
        setGroups((prev) => prev
          .map((g) => ({ ...g, stories: (g.stories || []).filter((s) => s.id !== storyId) }))
          .filter((g) => g.stories.length || g.user.id === currentUser?.id));
      }),
      on(EVENTS.STORY_REACTED, ({ storyId, emoji } = {}) => {
        setGroups((prev) => prev.map((g) => ({
          ...g,
          stories: (g.stories || []).map((s) => (s.id === storyId ? { ...s, my_reaction: emoji } : s)),
        })));
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [load, currentUser?.id]);

  const openViewer = useCallback((group) => {
    navigation.navigate('StoryViewer', { group });
    // Opened is seen: the ring greys straight away.
    if (group.has_unviewed) {
      setGroups((prev) => prev.map((g) => (g.user.id === group.user.id ? { ...g, has_unviewed: false } : g)));
    }
  }, [navigation]);

  const openCreate = useCallback(() => {
    navigation.navigate('CreateStory');
  }, [navigation]);

  // Always show own bubble even if no story yet.
  const allGroups = useMemo(() => {
    const own = groups.find(g => g.user.id === currentUser?.id) ?? {
      user: {
        id: currentUser?.id,
        username: currentUser?.username,
        profile_picture: currentUser?.profile_picture,
      },
      stories: [],
      has_unviewed: false,
    };
    return [own, ...groups.filter(g => g.user.id !== currentUser?.id)];
  }, [groups, currentUser?.id, currentUser?.username, currentUser?.profile_picture]);

  // Stable identity, so a parent re-render doesn't re-render every bubble.
  const renderItem = useCallback(({ item, index }) => (
    <StoryBubble
      group={item}
      onPress={openViewer}
      isOwn={index === 0}
      onCreatePress={openCreate}
      ownLabel={ownLabel}
    />
  ), [openViewer, openCreate, ownLabel]);

  const keyExtractor = useCallback((item) => String(item.user.id), []);

  // Nothing cached and nothing fetched yet: hold the bar's height rather than
  // showing a spinner, so the feed below doesn't jump when the row arrives.
  if (!loaded && groups.length === 0) {
    return <View style={styles.loadingWrap} />;
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={allGroups}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        initialNumToRender={6}
        windowSize={3}
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
  ownerBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.bg,
    backgroundColor: colors.surface,
  },
  playBadge: {
    position: 'absolute',
    top: 2,
    left: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  plusBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.bg,
  },
  username: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', width: 70 },
});

export default StoriesBar;

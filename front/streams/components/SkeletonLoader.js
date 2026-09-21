import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../constants/theme';

const SkeletonBox = ({ width, height, borderRadius = radius.sm, style }) => {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.8, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius, backgroundColor: colors.surface },
        { opacity },
        style,
      ]}
    />
  );
};

export const PostSkeleton = () => (
  <View style={styles.postCard}>
    <View style={styles.postHeader}>
      <SkeletonBox width={42} height={42} borderRadius={21} />
      <View style={styles.postHeaderText}>
        <SkeletonBox width={130} height={13} style={{ marginBottom: 6 }} />
        <SkeletonBox width={80} height={10} />
      </View>
    </View>
    <SkeletonBox width="100%" height={260} borderRadius={0} />
    <View style={styles.postFooter}>
      <SkeletonBox width={56} height={22} borderRadius={radius.full} />
      <SkeletonBox width={56} height={22} borderRadius={radius.full} />
      <SkeletonBox width={56} height={22} borderRadius={radius.full} />
      <SkeletonBox width={56} height={22} borderRadius={radius.full} />
    </View>
    <View style={styles.captionRow}>
      <SkeletonBox width="80%" height={12} style={{ marginBottom: 6 }} />
      <SkeletonBox width="55%" height={12} />
    </View>
  </View>
);

// Mirrors a TrackItem row (cover, title, artist, action) so the library fills
// in place instead of jumping when the real rows land.
export const TrackSkeleton = () => (
  <View style={styles.trackRow}>
    <SkeletonBox width={52} height={52} borderRadius={radius.sm} />
    <View style={styles.trackText}>
      <SkeletonBox width="65%" height={14} style={{ marginBottom: 7 }} />
      <SkeletonBox width="40%" height={11} />
    </View>
    <SkeletonBox width={24} height={24} borderRadius={12} />
  </View>
);

/** `count` skeleton rows — what a list screen shows when it has nothing cached
 *  to paint. A list of rows reads as "about to fill in"; a centered spinner
 *  reads as "stopped". */
export const TrackListSkeleton = ({ count = 8 }) => (
  <View>
    {Array.from({ length: count }, (_, i) => <TrackSkeleton key={i} />)}
  </View>
);

// Mirrors a person row — avatar, name, a preview line, and (for follow lists)
// the button on the right. Shared by the inbox and the follower lists.
export const PersonSkeleton = ({ avatar = 48, withButton = false }) => (
  <View style={styles.personRow}>
    <SkeletonBox width={avatar} height={avatar} borderRadius={avatar / 2} />
    <View style={styles.trackText}>
      <SkeletonBox width="45%" height={14} style={{ marginBottom: 7 }} />
      {!withButton && <SkeletonBox width="70%" height={11} />}
    </View>
    {withButton && <SkeletonBox width={84} height={30} borderRadius={radius.full} />}
  </View>
);

export const PersonListSkeleton = ({ count = 8, ...row }) => (
  <View>
    {Array.from({ length: count }, (_, i) => <PersonSkeleton key={i} {...row} />)}
  </View>
);

export const ProfileSkeleton = () => (
  <View style={styles.profileCard}>
    <SkeletonBox width="100%" height={140} borderRadius={0} />
    <View style={styles.profileAvatarRow}>
      <SkeletonBox width={90} height={90} borderRadius={45} style={{ marginTop: -45 }} />
    </View>
    <View style={styles.profileName}>
      <SkeletonBox width={180} height={18} style={{ marginBottom: 8 }} />
      <SkeletonBox width={120} height={13} />
    </View>
    <View style={styles.profileStats}>
      <SkeletonBox width={70} height={40} borderRadius={radius.md} />
      <SkeletonBox width={70} height={40} borderRadius={radius.md} />
      <SkeletonBox width={70} height={40} borderRadius={radius.md} />
    </View>
  </View>
);

const styles = StyleSheet.create({
  postCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    marginVertical: 10,
    marginHorizontal: 12,
    overflow: 'hidden',
  },
  postHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm,
  },
  postHeaderText: {
    flex: 1,
  },
  postFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  captionRow: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  trackText: {
    flex: 1,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  profileCard: {
    backgroundColor: colors.card,
  },
  profileAvatarRow: {
    paddingHorizontal: spacing.md,
  },
  profileName: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    alignItems: 'flex-start',
  },
  profileStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: spacing.md,
  },
});

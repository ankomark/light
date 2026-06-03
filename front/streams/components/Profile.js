import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, Image, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { fetchProfile } from '../services/api';
import { useAuth } from '../context/useAuth';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const { width } = Dimensions.get('window');
const AVATAR_SIZE = 90;
const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const AVATAR_FAILED = '__failed__';

const StatBox = ({ value, label }) => (
  <View style={styles.statBox}>
    <Text style={styles.statValue}>{value ?? '—'}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const Profile = () => {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const navigation = useNavigation();
  const { currentUser } = useAuth();

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchProfile();
      setProfile(data);
    } catch (error) {
      if (error.response?.status !== 401) {
        console.error('Error fetching profile:', error);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.centered}>
        <MaterialIcons name="person-off" size={56} color={colors.textMuted} />
        <Text style={styles.emptyText}>No profile found</Text>
        <TouchableOpacity
          style={styles.createBtn}
          onPress={() => navigation.navigate('CreateProfile')}
        >
          <Text style={styles.createBtnText}>Create Profile</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const avatarSource = profile.picture && !avatarFailed
    ? { uri: profile.picture }
    : DEFAULT_AVATAR;

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Cover area */}
      <LinearGradient
        colors={['#102E50', '#0A1628']}
        style={styles.cover}
      />

      {/* Avatar + edit row */}
      <View style={styles.avatarRow}>
        <View style={styles.avatarWrapper}>
          <Image
            source={avatarSource}
            defaultSource={DEFAULT_AVATAR}
            style={styles.avatar}
            onError={() => setAvatarFailed(true)}
          />
        </View>
        <TouchableOpacity
          style={styles.editBtn}
          onPress={() => navigation.navigate('CreateProfile')}
          activeOpacity={0.8}
        >
          <Ionicons name="pencil-outline" size={15} color={colors.white} />
          <Text style={styles.editBtnText}>Edit Profile</Text>
        </TouchableOpacity>
      </View>

      {/* Name & username */}
      <View style={styles.nameBlock}>
        <Text style={styles.displayName}>
          {profile.user?.first_name && profile.user?.last_name
            ? `${profile.user.first_name} ${profile.user.last_name}`
            : profile.user?.username}
        </Text>
        <Text style={styles.username}>@{profile.user?.username}</Text>
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <StatBox value={currentUser?.followers_count ?? 0} label="Followers" />
        <View style={styles.statDivider} />
        <StatBox value={currentUser?.following_count ?? 0} label="Following" />
        <View style={styles.statDivider} />
        <StatBox value={profile.posts_count ?? 0} label="Posts" />
      </View>

      {/* Info cards */}
      <View style={styles.infoSection}>
        {profile.bio ? (
          <View style={styles.infoCard}>
            <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
            <Text style={styles.infoText}>{profile.bio}</Text>
          </View>
        ) : null}

        {profile.location ? (
          <View style={styles.infoCard}>
            <Ionicons name="location-outline" size={18} color={colors.primary} />
            <Text style={styles.infoText}>{profile.location}</Text>
          </View>
        ) : null}

        {profile.birth_date ? (
          <View style={styles.infoCard}>
            <Ionicons name="calendar-outline" size={18} color={colors.primary} />
            <Text style={styles.infoText}>
              Born {new Date(profile.birth_date).toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric',
              })}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Empty posts placeholder */}
      <View style={styles.postsSection}>
        <Text style={styles.sectionTitle}>Posts</Text>
        <View style={styles.postsEmpty}>
          <MaterialIcons name="photo-library" size={40} color={colors.textMuted} />
          <Text style={styles.postsEmptyText}>No posts yet</Text>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  createBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    ...shadows.sm,
  },
  createBtnText: {
    ...typography.button,
    color: colors.white,
  },
  cover: {
    width: '100%',
    height: 140,
  },
  avatarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    marginTop: -(AVATAR_SIZE / 2),
  },
  avatarWrapper: {
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 3,
    borderColor: colors.bg,
    ...shadows.lg,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.surface,
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    ...shadows.sm,
  },
  editBtnText: {
    ...typography.label,
    color: colors.white,
  },
  nameBlock: {
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  displayName: {
    ...typography.h2,
    color: colors.textPrimary,
  },
  username: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    ...shadows.sm,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  infoSection: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    ...shadows.sm,
  },
  infoText: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
  },
  postsSection: {
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.xxl,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  postsEmpty: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.sm,
  },
  postsEmptyText: {
    ...typography.body,
    color: colors.textMuted,
  },
});

export default Profile;

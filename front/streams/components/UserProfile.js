import React, { useCallback } from 'react';
import { Image, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/useAuth';
import { getOrCreateConversation } from '../services/api';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

const UserProfile = ({ profile, size = 56 }) => {
  const { currentUser } = useAuth();
  const navigation = useNavigation();
  const [starting, setStarting] = React.useState(false);
  const displayedProfile = profile || currentUser;

  if (!displayedProfile) return null;

  const isOwnProfile = currentUser?.id === displayedProfile.id
    || currentUser?.id === displayedProfile.user_id;

  const handleMessage = useCallback(async () => {
    if (!displayedProfile.id && !displayedProfile.user_id) return;
    const userId = displayedProfile.user_id ?? displayedProfile.id;
    setStarting(true);
    try {
      const conversation = await getOrCreateConversation(userId);
      navigation.navigate('Chat', {
        conversationId: conversation.id,
        otherUser: conversation.other_participant ?? displayedProfile,
      });
    } catch {
      Alert.alert('Error', 'Could not open conversation. Please try again.');
    } finally {
      setStarting(false);
    }
  }, [displayedProfile, navigation]);

  const avatarSource = displayedProfile.profile_picture
    ? { uri: displayedProfile.profile_picture }
    : DEFAULT_AVATAR;

  return (
    <View style={styles.container}>
      <Image
        source={avatarSource}
        defaultSource={DEFAULT_AVATAR}
        style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
        resizeMode="cover"
      />
      <View style={styles.details}>
        <Text style={styles.username} numberOfLines={1}>
          {displayedProfile.username}
        </Text>
        {displayedProfile.bio ? (
          <Text style={styles.bio} numberOfLines={2}>{displayedProfile.bio}</Text>
        ) : null}
        {displayedProfile.location ? (
          <Text style={styles.location}>{displayedProfile.location}</Text>
        ) : null}
      </View>

      {!isOwnProfile && (
        <TouchableOpacity
          style={[styles.msgBtn, starting && styles.msgBtnDisabled]}
          onPress={handleMessage}
          disabled={starting}
          activeOpacity={0.8}
        >
          {starting
            ? <ActivityIndicator size="small" color={colors.white} />
            : <>
                <Ionicons name="chatbubble-outline" size={14} color={colors.white} />
                <Text style={styles.msgBtnText}>Message</Text>
              </>
          }
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    marginVertical: spacing.xs,
    gap: spacing.sm,
    ...shadows.sm,
  },
  avatar: {
    backgroundColor: colors.surface,
  },
  details: { flex: 1 },
  username: { ...typography.label, color: colors.textPrimary, marginBottom: 2 },
  bio: { ...typography.caption, color: colors.textSecondary, lineHeight: 16 },
  location: { ...typography.caption, color: colors.textMuted, fontStyle: 'italic', marginTop: 2 },
  msgBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    ...shadows.sm,
  },
  msgBtnDisabled: { opacity: 0.6 },
  msgBtnText: { ...typography.caption, color: colors.white, fontWeight: '600' },
});

export default UserProfile;

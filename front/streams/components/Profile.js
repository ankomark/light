// Your own profile (the Profile tab). The screen itself is the shared
// ProfileView — the same fast, cache-first profile everyone else sees of you,
// plus Edit / Favorites and your private details (birth date, who can see
// each post).
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/useAuth';
import ProfileView from './ProfileView';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const Profile = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { currentUser } = useAuth();

  // No profile row yet (auth has no profile to load): offer to create one.
  if (!currentUser?.id) {
    return (
      <View style={styles.centered}>
        <MaterialIcons name="person-off" size={56} color={colors.textMuted} />
        <Text style={styles.emptyText}>{t('profile.notFound')}</Text>
        <TouchableOpacity style={styles.createBtn} onPress={() => navigation.navigate('CreateProfile')}>
          <Text style={styles.createBtnText}>{t('profile.create')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return <ProfileView userId={currentUser.id} initialUsername={currentUser.username} />;
};

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  emptyText: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm, marginBottom: spacing.md },
  createBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, ...shadows.sm,
  },
  createBtnText: { ...typography.button, color: colors.white },
});

export default Profile;

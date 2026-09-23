// Someone's profile, opened from the feed, comments, search, a notification or
// an @mention. The screen is the shared ProfileView; this wrapper resolves an
// @name to an id when that's all we have, and themes the native header.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { fetchUserByUsername } from '../services/api';
import { useI18n } from '../context/I18nContext';
import ProfileView from './ProfileView';
import { colors, typography, spacing, profileColors } from '../constants/theme';

const UserProfileScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { t } = useI18n();
  const initialUsername = route.params?.username;

  // Opened from an @mention, only the name is known — resolve it to an id.
  const [userId, setUserId] = useState(route.params?.userId ?? null);
  const [resolveFailed, setResolveFailed] = useState(false);
  const [title, setTitle] = useState(initialUsername || '');

  useEffect(() => {
    if (route.params?.userId || !initialUsername) return undefined;
    let cancelled = false;
    fetchUserByUsername(initialUsername)
      .then((res) => { if (!cancelled) { if (res?.id) setUserId(res.id); else setResolveFailed(true); } })
      .catch(() => { if (!cancelled) setResolveFailed(true); });
    return () => { cancelled = true; };
  }, [route.params?.userId, initialUsername]);

  // Keep the header title in step with the loaded username, and theme the
  // native header to match the profile's black.
  useEffect(() => {
    navigation.setOptions?.({
      title: title || t('profile.title'),
      headerStyle: { backgroundColor: profileColors.bg },
      headerTintColor: profileColors.text,
      headerShadowVisible: false,
    });
  }, [navigation, title, t]);

  const onLoaded = useCallback((user) => setTitle(user.username), []);

  const noOne = resolveFailed || (!userId && !initialUsername);

  return (
    <View style={styles.root}>
      <View style={styles.content}>
        {noOne ? (
          <View style={styles.centered}>
            <MaterialIcons name="person-off" size={56} color={colors.textMuted} />
            <Text style={styles.errorText}>{t('profile.unavailable')}</Text>
          </View>
        ) : userId ? (
          <ProfileView userId={userId} initialUsername={initialUsername} onLoaded={onLoaded} />
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: profileColors.bg },
  content: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  errorText: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm, textAlign: 'center' },
});

export default UserProfileScreen;

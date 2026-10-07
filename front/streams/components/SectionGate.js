// Covers a screen whose part of the app an admin has switched off (Admin →
// App control), however it was reached: the menu (which also hides it), a
// notification, a link, the back button. One overlay over the navigator, so
// no screen has to know about switches. The server refuses the section's
// requests as well (songs/app_sections.py), so nothing behind the cover works.
//
// Admins are not shut out: they get a slim note that members see it closed,
// and carry on — to check things before opening up again.
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { navigationRef, useCurrentRouteName } from '../services/navigationRef';
import { useAppStatus } from '../context/AppStatusContext';
import { useI18n } from '../context/I18nContext';
import { useOptionalAuth } from '../context/useAuth';
import { isAdmin } from '../utils/roles';
import { sectionOfRoute, sectionInfo } from '../utils/appSections';

export default function SectionGate() {
  const { features, messages } = useAppStatus();
  const { t } = useI18n();
  const auth = useOptionalAuth();
  const insets = useSafeAreaInsets();
  const route = useCurrentRouteName();

  const section = sectionOfRoute(route);
  if (!section || features?.[section] !== false) return null;

  const name = t(`sections.${section}`);
  const message = messages?.[section] || '';

  if (isAdmin(auth?.currentUser)) {
    return (
      <View style={[styles.adminNote, { top: insets.top + 4 }]} pointerEvents="none" testID="section-off-admin">
        <MaterialCommunityIcons name="eye-off-outline" size={14} color="#0A1628" />
        <Text style={styles.adminNoteText} numberOfLines={1}>{t('sections.offForMembers', { name })}</Text>
      </View>
    );
  }

  const leave = () => {
    try {
      if (navigationRef.canGoBack()) navigationRef.goBack();
      else navigationRef.navigate('Home');
    } catch {
      // Nowhere to go back to: the cover stays, which is still right.
    }
  };

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.cover, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
      testID="section-off"
      accessibilityViewIsModal
    >
      <View style={styles.badge}>
        <MaterialCommunityIcons name={sectionInfo(section)?.icon || 'pause-circle-outline'} size={34} color="#FFC46B" />
      </View>
      <Text style={styles.title} accessibilityRole="header">{t('sections.offTitle', { name })}</Text>
      <Text style={styles.body}>{message || t('sections.offBody')}</Text>
      <TouchableOpacity style={styles.button} onPress={leave} accessibilityRole="button" testID="section-off-back">
        <Text style={styles.buttonText}>{t('common.back')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    zIndex: 1000, elevation: 1000, backgroundColor: '#0A1628',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 14,
  },
  badge: {
    width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,196,107,0.12)',
  },
  title: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  body: { color: '#C9D3E0', fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 420 },
  button: {
    marginTop: 8, minWidth: 160, height: 48, borderRadius: 24, paddingHorizontal: 24,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFC46B',
  },
  buttonText: { color: '#0A0A0A', fontSize: 15, fontWeight: '800' },
  adminNote: {
    position: 'absolute', alignSelf: 'center', zIndex: 1000, elevation: 1000,
    flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '92%',
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, backgroundColor: '#FFC46B',
  },
  adminNoteText: { color: '#0A1628', fontSize: 12, fontWeight: '800' },
});

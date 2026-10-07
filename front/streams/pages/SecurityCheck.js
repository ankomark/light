// "Was this you?" — opened from the new-sign-in notification. "It was me"
// closes it. "It wasn't me" signs every other device out at once, tells the
// admins, and takes the owner straight to a new password (whoever signed in
// knows the old one).
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { reportNotMe } from '../services/api';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

export default function SecurityCheck({ navigation, route }) {
  const { t } = useI18n();
  const { device, at } = route?.params || {};
  const [busy, setBusy] = useState(false);

  const notMe = async () => {
    setBusy(true);
    try {
      const res = await reportNotMe();
      Alert.alert(t('securityCheck.securedTitle'), t('securityCheck.securedBody', { n: res?.revoked ?? 0 }), [
        { text: t('securityCheck.changeNow'), onPress: () => navigation.replace('Settings', { openPassword: true }) },
      ]);
    } catch {
      Alert.alert(t('common.error'), t('securityCheck.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
      <TouchableOpacity style={styles.close} onPress={() => navigation.goBack()} hitSlop={10}
        accessibilityRole="button" accessibilityLabel={t('common.close')}>
        <Ionicons name="close" size={26} color={colors.textPrimary} />
      </TouchableOpacity>
      <View style={styles.body}>
        <View style={styles.badge}><Ionicons name="shield-half-outline" size={44} color={colors.primary} /></View>
        <Text style={styles.title}>{t('securityCheck.title')}</Text>
        <Text style={styles.sub}>
          {t('securityCheck.body', {
            device: device || t('securityCheck.aDevice'),
            when: at ? new Date(at).toLocaleString() : t('securityCheck.justNow'),
          })}
        </Text>
        <TouchableOpacity style={styles.yes} onPress={() => navigation.goBack()} disabled={busy} testID="security-me">
          <Text style={styles.yesText}>{t('securityCheck.itWasMe')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.no} onPress={notMe} disabled={busy} testID="security-not-me">
          {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.noText}>{t('securityCheck.notMe')}</Text>}
        </TouchableOpacity>
        <Text style={styles.hint}>{t('securityCheck.hint')}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  close: { padding: spacing.md, alignSelf: 'flex-end' },
  body: { flex: 1, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  badge: {
    width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card,
  },
  title: { ...typography.h1, color: colors.textPrimary, textAlign: 'center' },
  sub: { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 24 },
  yes: {
    width: '100%', maxWidth: 420, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border, marginTop: spacing.md,
  },
  yesText: { ...typography.button, color: colors.textPrimary },
  no: {
    width: '100%', maxWidth: 420, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.error,
  },
  noText: { ...typography.button, color: colors.white },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: 'center', maxWidth: 420 },
});

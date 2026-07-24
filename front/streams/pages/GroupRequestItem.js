import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const DEFAULT_AVATAR = require('../assets/user-placeholder.png');

const GroupRequestItem = ({ request, onApprove, onReject, busy }) => {
  const { t } = useI18n();
  const pic = request.user?.profile_picture || request.user?.profile?.picture_url;
  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <Image
          // Backend exposes the resolved URL as `profile_picture`; `profile.picture`
          // is write-only and never present in responses.
          source={pic ? { uri: pic } : DEFAULT_AVATAR}
          placeholder={DEFAULT_AVATAR}
          contentFit="cover"
          transition={120}
          style={styles.avatar}
        />
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>{request.user?.username || 'Username'}</Text>
          <Text style={styles.message} numberOfLines={2}>{request.message || t('group.request.noMessage')}</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.btn, styles.rejectBtn]}
          onPress={onReject}
          disabled={busy}
          activeOpacity={0.85}
        >
          <Ionicons name="close" size={16} color={colors.error} />
          <Text style={[styles.btnText, styles.rejectText]}>{t('common.reject')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.approveBtn]}
          onPress={onApprove}
          disabled={busy}
          activeOpacity={0.85}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#0A1628" />
          ) : (
            <>
              <Ionicons name="checkmark" size={16} color="#0A1628" />
              <Text style={[styles.btnText, styles.approveText]}>{t('common.approve')}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(16,46,80,0.55)', borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)', ...shadows.sm,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface,
    borderWidth: 1.5, borderColor: 'rgba(244,162,97,0.35)',
  },
  info: { flex: 1 },
  name: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  message: { ...typography.caption, color: colors.textSecondary, marginTop: 2, lineHeight: 17 },

  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  btn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: spacing.sm, borderRadius: radius.full, minHeight: 40,
  },
  approveBtn: { backgroundColor: colors.accent },
  rejectBtn: { backgroundColor: 'rgba(229,57,53,0.10)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(229,57,53,0.5)' },
  btnText: { ...typography.button, fontWeight: '800', fontSize: 14 },
  approveText: { color: '#0A1628' },
  rejectText: { color: colors.error },
});

export default GroupRequestItem;

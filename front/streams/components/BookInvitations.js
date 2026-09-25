// Books you've been invited to work on — at the top of My Work, to accept or
// decline. Nothing shows when there are none.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchBookInvitations, answerBookInvitation } from '../services/api';
import { notify } from '../utils/adminConfirm';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const BookInvitations = ({ onAccepted }) => {
  const { t } = useI18n();
  const [rows, setRows] = useState([]);

  const load = useCallback(async () => {
    try { setRows((await fetchBookInvitations())?.results || []); } catch { /* offline: none shown */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const answer = async (row, accept) => {
    try {
      await answerBookInvitation(row.id, accept);
      setRows((r) => r.filter((x) => x.id !== row.id));
      if (accept) onAccepted?.();
    } catch {
      notify(t('common.error'), t('studio.inviteFailed'));
    }
  };

  if (!rows.length) return null;
  return (
    <View style={styles.wrap} testID="book-invitations">
      {rows.map((r) => (
        <View key={r.id} style={styles.card}>
          <Ionicons name="mail-open-outline" size={20} color={colors.accent} />
          <View style={styles.flex}>
            <Text style={styles.text}>
              {t('studio.invitedYou', { name: r.invited_by, title: r.title, role: t(`studio.role.${r.role}`) })}
            </Text>
            <View style={styles.actions}>
              <TouchableOpacity style={styles.accept} onPress={() => answer(r, true)} testID={`invite-accept-${r.id}`}>
                <Text style={styles.acceptText}>{t('studio.accept')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => answer(r, false)} testID={`invite-decline-${r.id}`}>
                <Text style={styles.decline}>{t('studio.decline')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginBottom: spacing.md },
  card: {
    flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.accent,
  },
  flex: { flex: 1 },
  text: { ...typography.body, color: colors.textPrimary },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  accept: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 6 },
  acceptText: { ...typography.label, color: colors.white, fontWeight: '700' },
  decline: { ...typography.label, color: colors.textSecondary, fontWeight: '700' },
});

export default BookInvitations;

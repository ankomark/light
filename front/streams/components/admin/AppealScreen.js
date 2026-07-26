import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { fetchMyAppeal, submitAppeal } from '../../services/api';
import { colors, typography, spacing, radius, shadows } from '../../constants/theme';
import { useI18n } from '../../context/I18nContext';
import { notify } from '../../utils/adminConfirm';

const STATUS_META = {
  pending: { color: colors.warning, label: 'Under review', icon: 'hourglass-outline' },
  approved: { color: colors.success, label: 'Approved', icon: 'checkmark-circle-outline' },
  rejected: { color: colors.error, label: 'Decision upheld', icon: 'close-circle-outline' },
};

const AppealScreen = ({ navigation }) => {
  const { t } = useI18n();
  const [appeal, setAppeal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAppeal(await fetchMyAppeal());
    } catch {
      setAppeal(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submit = async () => {
    const msg = message.trim();
    if (msg.length < 10) {
      notify(t('appeal.title'), t('appeal.tooShort'));
      return;
    }
    setSubmitting(true);
    try {
      const created = await submitAppeal(msg);
      setAppeal(created);
      setMessage('');
    } catch (e) {
      notify(t('appeal.title'), e?.response?.data?.error || t('appeal.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color={colors.accent} /></View>;
  }

  const pending = appeal && appeal.status === 'pending';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>{t('appeal.title')}</Text>

      {appeal ? (
        <View style={styles.card}>
          <View style={styles.statusRow}>
            <Ionicons name={STATUS_META[appeal.status]?.icon} size={20} color={STATUS_META[appeal.status]?.color} />
            <Text style={[styles.statusText, { color: STATUS_META[appeal.status]?.color }]}>
              {STATUS_META[appeal.status]?.label}
            </Text>
          </View>
          <Text style={styles.label}>{t('appeal.yourMessage')}</Text>
          <Text style={styles.body}>{appeal.message}</Text>
          {appeal.review_notes ? (
            <>
              <Text style={styles.label}>{t('appeal.moderatorNote')}</Text>
              <Text style={styles.body}>{appeal.review_notes}</Text>
            </>
          ) : null}
          {pending && <Text style={styles.hint}>A moderator will review your appeal soon.</Text>}
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.intro}>
            If you believe a moderation action on your account was a mistake, tell us why and a moderator will review it.
          </Text>
          <TextInput
            style={styles.input}
            placeholder={t('appeal.placeholder')}
            placeholderTextColor={colors.placeholder}
            value={message}
            onChangeText={setMessage}
            multiline
          />
          <TouchableOpacity
            style={[styles.btn, (submitting || message.trim().length < 10) && styles.btnDisabled]}
            onPress={submit}
            disabled={submitting || message.trim().length < 10}
            activeOpacity={0.85}
          >
            {submitting
              ? <ActivityIndicator color="#0A1628" />
              : <Text style={styles.btnText}>{t('appeal.submit')}</Text>}
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: spacing.md },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent' },
  title: {
    ...typography.h1, color: colors.textPrimary, marginBottom: spacing.md,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  card: {
    backgroundColor: 'rgba(16,28,46,0.85)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
    padding: spacing.md, ...shadows.sm,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  statusText: { ...typography.h3, fontWeight: '700' },
  label: { ...typography.caption, color: colors.accent, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: spacing.sm, marginBottom: 2 },
  body: { ...typography.body, color: colors.textPrimary },
  hint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.md, fontStyle: 'italic' },
  intro: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  input: {
    minHeight: 120, textAlignVertical: 'top', color: colors.textPrimary, fontSize: 15,
    backgroundColor: colors.inputBg, borderRadius: radius.md, padding: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  btn: {
    backgroundColor: colors.accent, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.sm + 2, marginTop: spacing.md,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { ...typography.button, color: '#0A1628', fontWeight: '800' },
});

export default AppealScreen;

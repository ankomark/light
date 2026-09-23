// Artist Studio's "Removed songs": each song a moderator took down, why, and
// where the uploader's dispute stands — with a Dispute button (a counter-
// notice: why it's theirs, confirmed in good faith). One dispute per takedown.
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Pressable, TextInput, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { fetchRemovedSongs, disputeTrack } from '../services/api';
import { colors, spacing, radius, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const MIN_CHARS = 30;
const STATUS_COLOR = { pending: '#E8C66B', approved: '#43A047', rejected: '#E57373' };

const RemovedSongs = () => {
  const { t } = useI18n();
  const [rows, setRows] = useState([]);
  const [disputing, setDisputing] = useState(null);   // the song being disputed
  const [message, setMessage] = useState('');
  const [goodFaith, setGoodFaith] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    fetchRemovedSongs().then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);
  useFocusEffect(load);

  const open = (song) => { setDisputing(song); setMessage(''); setGoodFaith(false); };

  const send = async () => {
    if (sending || message.trim().length < MIN_CHARS || !goodFaith) return;
    setSending(true);
    try {
      await disputeTrack(disputing.id, message.trim(), true);
      setDisputing(null);
      Alert.alert(t('rights.disputeSentTitle'), t('rights.disputeSentBody'));
      load();
    } catch (err) {
      Alert.alert(t('common.error'), err?.response?.data?.error || t('rights.disputeFailed'));
    } finally {
      setSending(false);
    }
  };

  if (!rows.length) return null;
  const ready = message.trim().length >= MIN_CHARS && goodFaith;

  return (
    <View>
      <Text style={styles.section}>{t('rights.removedSongs')}</Text>
      {rows.map((s) => (
        <View key={s.id} style={styles.card}>
          <View style={styles.head}>
            <View style={styles.cover}>
              {s.cover ? <Image source={{ uri: s.cover }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="musical-notes" size={16} color={colors.textMuted} />}
            </View>
            <View style={styles.body}>
              <Text style={styles.title} numberOfLines={1}>{s.title}</Text>
              <Text style={styles.reason}>{t(`rights.reason.${s.reason}`)}</Text>
            </View>
          </View>
          {s.note ? <Text style={styles.note}>{s.note}</Text> : null}
          {s.dispute ? (
            <View style={styles.statusRow}>
              <View style={[styles.dot, { backgroundColor: STATUS_COLOR[s.dispute.status] || colors.textMuted }]} />
              <Text style={styles.status}>{t(`rights.dispute.${s.dispute.status}`)}</Text>
            </View>
          ) : null}
          {s.dispute?.notes ? <Text style={styles.note}>{s.dispute.notes}</Text> : null}
          {s.can_dispute ? (
            <TouchableOpacity style={styles.disputeBtn} onPress={() => open(s)} accessibilityRole="button">
              <Feather name="flag" size={15} color={colors.primary} />
              <Text style={styles.disputeText}>{t('rights.dispute')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ))}

      <Modal visible={!!disputing} transparent animationType="slide" onRequestClose={() => setDisputing(null)}>
        <Pressable style={styles.overlay} onPress={() => setDisputing(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav}>
            <Pressable style={styles.sheet}>
              <Text style={styles.sheetTitle}>{t('rights.disputeTitle', { title: disputing?.title || '' })}</Text>
              <Text style={styles.sheetHint}>{t('rights.disputeHint')}</Text>
              <TextInput
                style={styles.input}
                value={message}
                onChangeText={setMessage}
                multiline
                maxLength={2000}
                placeholder={t('rights.disputePlaceholder')}
                placeholderTextColor={colors.placeholder}
              />
              <Text style={styles.count}>{`${message.trim().length} / ${MIN_CHARS}+`}</Text>
              <TouchableOpacity
                style={styles.confirmRow}
                onPress={() => setGoodFaith((v) => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: goodFaith }}
              >
                <Feather name={goodFaith ? 'check-square' : 'square'} size={22} color={goodFaith ? colors.primary : colors.textSecondary} />
                <Text style={styles.confirmText}>{t('rights.goodFaith')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.send, (!ready || sending) && styles.disabled]} onPress={send} disabled={!ready || sending}>
                {sending ? <ActivityIndicator color={colors.white} /> : <Text style={styles.sendText}>{t('rights.sendDispute')}</Text>}
              </TouchableOpacity>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  section: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.sm },
  card: {
    backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: 'rgba(229,115,115,0.35)',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cover: {
    width: 44, height: 44, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  body: { flex: 1 },
  title: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  reason: { ...typography.caption, color: '#E57373', marginTop: 2, fontWeight: '700' },
  note: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 17 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  status: { ...typography.caption, color: colors.textPrimary, fontWeight: '700' },
  disputeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: spacing.sm, minHeight: 40 },
  disputeText: { ...typography.label, color: colors.primary, fontWeight: '700' },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  kav: { width: '100%', alignItems: 'center' },
  sheet: {
    width: '100%', maxWidth: 560, backgroundColor: colors.card, padding: spacing.lg,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, borderColor: colors.border,
  },
  sheetTitle: { ...typography.h3, color: colors.textPrimary },
  sheetHint: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs, lineHeight: 17 },
  input: {
    minHeight: 120, marginTop: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.md, color: colors.textPrimary, backgroundColor: colors.inputBg, fontSize: 15, textAlignVertical: 'top',
  },
  count: { ...typography.caption, color: colors.textMuted, textAlign: 'right', marginTop: 4 },
  confirmRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.sm, minHeight: 44 },
  confirmText: { flex: 1, color: colors.textPrimary, fontSize: 13.5, lineHeight: 19 },
  send: {
    marginTop: spacing.md, minHeight: 48, borderRadius: radius.full, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendText: { ...typography.button, color: colors.white },
  disabled: { opacity: 0.5 },
});

export default RemovedSongs;

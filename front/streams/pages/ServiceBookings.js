// Requests: what you asked of services (bookings and quotes, and their
// answers — cancel one while it waits or once it's accepted), and, for
// providers, what's been asked of yours (accept or decline, with a word).
// Opens at once on the last copy of each tab, then fresh.
import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from '../components/BottomSheet';
import useKeyboardHeight from '../hooks/useKeyboardHeight';
import { fetchServiceBookings, respondServiceBooking, cancelServiceBooking } from '../services/api';
import useCachedData from '../utils/useCachedData';
import { userKey } from '../utils/screenCache';
import { confirmAction, notify } from '../utils/adminConfirm';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const STATUS_COLOR = { pending: colors.accent, accepted: colors.success, declined: colors.error, cancelled: colors.textMuted };
const when = (b) => {
  if (!b.date) return null;
  try {
    const d = new Date(`${b.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    return b.time ? `${d} · ${b.time}` : d;
  } catch { return b.date; }
};

const Row = ({ b, role, t, onOpen, onAnswer, onCancel }) => (
  <View style={styles.row} testID={`booking-${b.id}`}>
    <TouchableOpacity style={styles.rowHead} onPress={() => onOpen(b)}>
      <Image source={role === 'incoming' ? (b.customer?.profile_picture ? { uri: b.customer.profile_picture } : DEFAULT_AVATAR)
        : (b.service_info?.logo ? { uri: b.service_info.logo } : DEFAULT_AVATAR)} style={styles.avatar} contentFit="cover" />
      <View style={styles.flex}>
        <Text style={styles.name} numberOfLines={1}>
          {role === 'incoming' ? `${b.customer?.username} → ${b.service_info?.name}` : b.service_info?.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {[t(`bookings.kind.${b.kind}`), when(b)].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <View style={[styles.status, { borderColor: STATUS_COLOR[b.status] }]}>
        <Text style={[styles.statusText, { color: STATUS_COLOR[b.status] }]}>{t(`bookings.status.${b.status}`)}</Text>
      </View>
    </TouchableOpacity>
    {b.note ? <Text style={styles.note}>{b.note}</Text> : null}
    {b.reply_note ? (
      <View style={styles.reply}>
        <Text style={styles.replyWho}>{t('bookings.theirAnswer')}</Text>
        <Text style={styles.replyText}>{b.reply_note}</Text>
      </View>
    ) : null}
    {role === 'incoming' && b.status === 'pending' ? (
      <View style={styles.actions}>
        <TouchableOpacity style={[styles.act, styles.decline]} onPress={() => onAnswer(b, false)} testID={`booking-decline-${b.id}`}>
          <Text style={styles.declineText}>{t('bookings.decline')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.act, styles.accept]} onPress={() => onAnswer(b, true)} testID={`booking-accept-${b.id}`}>
          <Text style={styles.acceptText}>{t('bookings.accept')}</Text>
        </TouchableOpacity>
      </View>
    ) : null}
    {role === 'mine' && (b.status === 'pending' || b.status === 'accepted') ? (
      <TouchableOpacity onPress={() => onCancel(b)} style={styles.cancelLink} testID={`booking-cancel-${b.id}`}>
        <Text style={styles.cancelText}>{t('bookings.cancel')}</Text>
      </TouchableOpacity>
    ) : null}
  </View>
);

const ServiceBookings = ({ route, navigation }) => {
  const { t } = useI18n();
  const { currentUser } = useAuth();
  const kb = useKeyboardHeight();
  const [role, setRole] = useState(route.params?.role === 'incoming' ? 'incoming' : 'mine');
  const { data, setData, failed, reload } = useCachedData(userKey(currentUser?.id, `service-bookings:${role}`),
    () => fetchServiceBookings(role));
  const [answering, setAnswering] = useState(null);     // { b, accept }
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = data?.results || [];
  const replace = (b) => setData((d) => ({ ...d, results: (d?.results || []).map((x) => (x.id === b.id ? b : x)) }));

  const answer = async () => {
    setBusy(true);
    try {
      replace(await respondServiceBooking(answering.b.id, answering.accept, note.trim()));
      setAnswering(null);
    } catch (err) {
      notify(t('common.error'), err?.data?.error || t('bookings.failed'));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async (b) => {
    const ok = await confirmAction({
      title: t('bookings.cancelTitle'), confirmLabel: t('bookings.cancel'), cancelLabel: t('common.back'), destructive: true,
    });
    if (!ok) return;
    try { replace(await cancelServiceBooking(b.id)); } catch { notify(t('common.error'), t('bookings.failed')); }
  };
  const openService = (b) => navigation.navigate('ServiceDetail', { id: b.service });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}
          accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>{t('bookings.title')}</Text>
        <View style={styles.iconBtn} />
      </View>
      <View style={styles.segment}>
        {['mine', 'incoming'].map((r) => (
          <TouchableOpacity key={r} style={[styles.seg, role === r && styles.segOn]} onPress={() => setRole(r)}
            accessibilityRole="tab" accessibilityState={{ selected: role === r }} testID={`bookings-tab-${r}`}>
            <Text style={[styles.segText, role === r && styles.segTextOn]}>{t(`bookings.tab.${r}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <FlatList
        data={rows}
        keyExtractor={(b) => String(b.id)}
        contentContainerStyle={styles.list}
        onRefresh={reload}
        refreshing={false}
        renderItem={({ item }) => (
          <Row b={item} role={role} t={t} onOpen={openService} onCancel={cancel}
            onAnswer={(b, accept) => { setNote(''); setAnswering({ b, accept }); }} />
        )}
        ListEmptyComponent={!data ? (
          failed ? (
            <TouchableOpacity style={styles.retry} onPress={reload}><Text style={styles.retryText}>{t('common.retry')}</Text></TouchableOpacity>
          ) : <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : (
          <View style={styles.empty}>
            <Ionicons name="calendar-outline" size={44} color={colors.textMuted} />
            <Text style={styles.emptyText}>{t(role === 'mine' ? 'bookings.noneMine' : 'bookings.noneIncoming')}</Text>
          </View>
        )}
      />

      <BottomSheet visible={!!answering} onClose={() => setAnswering(null)} keyboardHeight={kb} heightRatio={0.45}
        header={(
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{answering?.accept ? t('bookings.acceptTitle') : t('bookings.declineTitle')}</Text>
          </View>
        )}>
        <View style={styles.sheetBody}>
          <TextInput style={styles.input} value={note} onChangeText={setNote} multiline maxLength={500} textAlignVertical="top"
            placeholder={answering?.accept ? t('bookings.acceptPlaceholder') : t('bookings.declinePlaceholder')}
            placeholderTextColor={colors.placeholder} testID="booking-answer-note" />
          <TouchableOpacity style={[styles.act, answering?.accept ? styles.accept : styles.declineSolid]} onPress={answer}
            disabled={busy} testID="booking-answer-send">
            {busy ? <ActivityIndicator color={colors.white} /> : (
              <Text style={styles.acceptText}>{answering?.accept ? t('bookings.accept') : t('bookings.decline')}</Text>
            )}
          </TouchableOpacity>
        </View>
      </BottomSheet>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topTitle: { ...typography.h3, color: colors.textPrimary, flex: 1, textAlign: 'center' },
  segment: {
    flexDirection: 'row', margin: spacing.md, marginBottom: 0, padding: 3, borderRadius: radius.md, backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, width: '100%', maxWidth: 640, alignSelf: 'center',
  },
  seg: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.sm },
  segOn: { backgroundColor: colors.primary },
  segText: { ...typography.label, color: colors.textSecondary, fontWeight: '700' },
  segTextOn: { color: colors.white },
  list: { padding: spacing.md, width: '100%', maxWidth: 720, alignSelf: 'center', paddingBottom: spacing.xxl },
  row: {
    padding: spacing.md, marginBottom: spacing.sm, borderRadius: radius.md, backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, gap: spacing.sm,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.surface },
  name: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  meta: { ...typography.caption, color: colors.textSecondary },
  status: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  statusText: { ...typography.caption, fontWeight: '800', fontSize: 11 },
  note: { ...typography.body, color: colors.textSecondary },
  reply: { paddingLeft: spacing.sm, borderLeftWidth: 2, borderLeftColor: colors.primary, gap: 2 },
  replyWho: { ...typography.caption, color: colors.primary, fontWeight: '800' },
  replyText: { ...typography.body, color: colors.textSecondary },
  actions: { flexDirection: 'row', gap: spacing.sm },
  act: { flex: 1, borderRadius: radius.md, paddingVertical: spacing.sm + 2, alignItems: 'center' },
  accept: { backgroundColor: colors.success },
  decline: { borderWidth: 1, borderColor: colors.error },
  declineSolid: { backgroundColor: colors.error },
  acceptText: { ...typography.label, color: colors.white, fontWeight: '800' },
  declineText: { ...typography.label, color: colors.error, fontWeight: '800' },
  cancelLink: { alignSelf: 'flex-start' },
  cancelText: { ...typography.caption, color: colors.error, fontWeight: '700' },
  empty: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl },
  emptyText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  retry: { alignSelf: 'center', backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, marginTop: spacing.xl },
  retryText: { ...typography.label, color: colors.white, fontWeight: '700' },
  sheetHead: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  sheetTitle: { ...typography.h3, color: colors.textPrimary },
  sheetBody: { paddingHorizontal: spacing.md, gap: spacing.md },
  input: {
    minHeight: 90, color: colors.textPrimary, fontSize: 15, backgroundColor: colors.inputBg, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
});

export default ServiceBookings;

// What every admin screen shares:
//
//  - AdminMe / useAdminMe: who this is as an admin, as the server said when
//    the admin area opened (AdminGate), not the profile kept on the phone.
//    Screens show only the tools these capabilities allow.
//  - ErrorState: a list that could not be read says so, with Try again
//    (it used to look like an empty queue: "no reports" when there were).
//  - useReasonSheet: actions that act on someone (warn, suspend, ban, take
//    down) ask why. The person is told, and the audit log keeps it. Common
//    reasons are one tap; anything else can be typed.
import React, { createContext, useContext, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../context/I18nContext';
import { useAuth } from '../../context/useAuth';
import { hasCapability, isSuperAdmin } from '../../utils/roles';

export const ADMIN = {
  card: 'rgba(16,28,46,0.88)', border: 'rgba(255,255,255,0.10)', field: '#0F1C30',
  text: '#FFFFFF', muted: '#9FB0C8', gold: '#FFC46B', onGold: '#0A1628', danger: '#FF7A6B', ok: '#5FD39A',
};

export const AdminMe = createContext(null);

/** { can(cap), superAdmin, me }: the server's word, else the phone's profile. */
export const useAdminMe = () => {
  const me = useContext(AdminMe);
  const { currentUser } = useAuth();
  if (me) {
    const caps = me.capabilities || [];
    return {
      me,
      superAdmin: !!me.is_super_admin,
      can: (cap) => !!me.is_super_admin || caps.includes(cap),
    };
  }
  return {
    me: currentUser,
    superAdmin: isSuperAdmin(currentUser),
    can: (cap) => hasCapability(currentUser, cap),
  };
};

export const ErrorState = ({ message, onRetry, testID = 'admin-error' }) => {
  const { t } = useI18n();
  return (
    <View style={styles.error} testID={testID}>
      <Ionicons name="cloud-offline-outline" size={30} color={ADMIN.muted} />
      <Text style={styles.errorText}>{message || t('adminKit.loadFailed')}</Text>
      {!!onRetry && (
        <TouchableOpacity style={styles.retry} onPress={onRetry} testID={`${testID}-retry`}>
          <Text style={styles.retryText}>{t('common.retry')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

/** Over a list kept from before when a refresh failed (offline, a slow
 *  network): the last copy stays readable, and this says it may be old. */
export const StaleNote = ({ onRetry }) => {
  const { t } = useI18n();
  return (
    <TouchableOpacity style={styles.stale} onPress={onRetry} disabled={!onRetry} testID="admin-stale"
      accessibilityRole={onRetry ? 'button' : 'text'}>
      <Ionicons name="cloud-offline-outline" size={14} color={ADMIN.muted} />
      <Text style={styles.staleText} numberOfLines={2}>{t('adminKit.stale')}</Text>
      {!!onRetry && <Text style={styles.retryText}>{t('common.retry')}</Text>}
    </TouchableOpacity>
  );
};

const REASONS = ['spam', 'harassment', 'hate', 'sexual', 'violence', 'scam', 'copyright', 'impersonation', 'other'];

/**
 * const [sheet, askReason] = useReasonSheet();
 * const reason = await askReason({ title, message, confirmLabel, destructive, extra });
 * — null when cancelled. `extra`: [{ key, label }] choices shown as a second
 * row (a track taken down for copyright or for breaking the rules); the
 * answer is then { reason, extra }.
 */
export const useReasonSheet = () => {
  const { t } = useI18n();
  const [ask, setAsk] = useState(null);
  const [preset, setPreset] = useState('');
  const [text, setText] = useState('');
  const [extra, setExtra] = useState('');
  const resolver = useRef(null);

  const close = (value) => {
    resolver.current?.(value);
    resolver.current = null;
    setAsk(null);
  };

  const askReason = (opts) => new Promise((resolve) => {
    resolver.current = resolve;
    setPreset('');
    setText('');
    setExtra(opts.extra?.[0]?.key || '');
    setAsk(opts);
  });

  const reason = [preset ? t(`adminKit.reason.${preset}`) : '', text.trim()].filter(Boolean).join(' — ');
  const ready = reason.length >= 3;

  const sheet = (
    <Modal visible={!!ask} transparent animationType="slide" onRequestClose={() => close(null)}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="reason-sheet">
          <Text style={styles.title}>{ask?.title}</Text>
          {!!ask?.message && <Text style={styles.message}>{ask.message}</Text>}
          {!!ask?.extra && (
            <View style={styles.chips}>
              {ask.extra.map((x) => (
                <TouchableOpacity key={x.key} style={[styles.chip, extra === x.key && styles.chipOn]}
                                  onPress={() => setExtra(x.key)} testID={`reason-extra-${x.key}`}>
                  <Text style={[styles.chipText, extra === x.key && styles.chipTextOn]}>{x.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <Text style={styles.label}>{t('adminKit.why')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {REASONS.map((r) => (
              <TouchableOpacity key={r} style={[styles.chip, preset === r && styles.chipOn]}
                                onPress={() => setPreset(preset === r ? '' : r)} testID={`reason-${r}`}>
                <Text style={[styles.chipText, preset === r && styles.chipTextOn]}>{t(`adminKit.reason.${r}`)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder={t('adminKit.detailsPlaceholder')}
            placeholderTextColor="#5E7290"
            multiline
            maxLength={240}
            testID="reason-text"
          />
          <Text style={styles.hint}>{t('adminKit.toldHint')}</Text>
          <TouchableOpacity
            style={[styles.confirm, ask?.destructive && styles.confirmDanger, !ready && styles.off]}
            onPress={() => ready && close(ask?.extra ? { reason, extra } : reason)}
            disabled={!ready}
            testID="reason-confirm"
          >
            <Text style={[styles.confirmText, ask?.destructive && styles.confirmTextDanger]}>
              {ask?.confirmLabel || t('adminKit.confirm')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancel} onPress={() => close(null)} testID="reason-cancel">
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
  return [sheet, askReason];
};

const styles = StyleSheet.create({
  error: { alignItems: 'center', gap: 10, paddingVertical: 48, paddingHorizontal: 24 },
  errorText: { color: ADMIN.muted, fontSize: 14, textAlign: 'center' },
  stale: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 16, marginTop: 8,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)',
  },
  staleText: { flex: 1, color: ADMIN.muted, fontSize: 12.5 },
  retry: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, backgroundColor: ADMIN.gold },
  retryText: { color: ADMIN.onGold, fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#0E2038', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  title: { color: ADMIN.text, fontSize: 18, fontWeight: '800' },
  message: { color: ADMIN.muted, fontSize: 13.5, lineHeight: 19 },
  label: { color: ADMIN.gold, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)',
  },
  chipOn: { backgroundColor: ADMIN.gold, borderColor: ADMIN.gold },
  chipText: { color: ADMIN.muted, fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: ADMIN.onGold },
  input: {
    minHeight: 70, borderRadius: 12, padding: 12, color: ADMIN.text, fontSize: 14.5, textAlignVertical: 'top',
    backgroundColor: ADMIN.field, borderWidth: 1, borderColor: '#1E3150',
  },
  hint: { color: '#7D8FA8', fontSize: 12 },
  confirm: { height: 48, borderRadius: 14, backgroundColor: ADMIN.gold, alignItems: 'center', justifyContent: 'center' },
  confirmDanger: { backgroundColor: '#C0392B' },
  confirmText: { color: ADMIN.onGold, fontSize: 15, fontWeight: '800' },
  confirmTextDanger: { color: '#FFFFFF' },
  off: { opacity: 0.5 },
  cancel: { alignItems: 'center', paddingVertical: 8 },
  cancelText: { color: ADMIN.muted, fontWeight: '700' },
});

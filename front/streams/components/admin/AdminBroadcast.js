// A notification to everyone, or to a group (admin phase 4). How many it
// reaches is shown before it goes; sending asks for a confirmation and a
// fresh authenticator code (the server's rule), at most once every half hour.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useI18n } from '../../context/I18nContext';
import { fetchAdminBroadcasts, previewBroadcast, sendBroadcast } from '../../services/api';
import { confirmAction, notify } from '../../utils/adminConfirm';
import { ADMIN } from './AdminKit';

const AUDIENCES = ['all', 'active', 'sellers', 'artists', 'admins'];

export default function AdminBroadcast() {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState('all');
  const [reach, setReach] = useState(null);
  const [history, setHistory] = useState([]);
  const [sending, setSending] = useState(false);

  const loadHistory = useCallback(async () => {
    try { setHistory(await fetchAdminBroadcasts()); } catch { /* the form still works */ }
  }, []);
  useFocusEffect(useCallback(() => { loadHistory(); }, [loadHistory]));

  useEffect(() => {
    let live = true;
    setReach(null);
    previewBroadcast(audience).then((r) => live && setReach(r?.recipients ?? null)).catch(() => {});
    return () => { live = false; };
  }, [audience]);

  const ready = title.trim().length >= 3 && message.trim().length >= 5;

  const send = async () => {
    const ok = await confirmAction({
      title: t('adminBroadcast.confirmTitle', { n: reach ?? '?' }),
      message: `${title.trim()}\n\n${message.trim()}`,
      confirmLabel: t('adminBroadcast.send'),
    });
    if (!ok) return;
    setSending(true);
    try {
      const res = await sendBroadcast(title.trim(), message.trim(), audience);
      notify(t('adminBroadcast.sentTitle'), t('adminBroadcast.sentBody', { n: res?.recipients ?? 0 }));
      setTitle('');
      setMessage('');
      loadHistory();
    } catch (e) {
      notify(t('common.error'), e?.status === 429 ? t('adminBroadcast.tooSoon') : (e?.data?.error || t('admin.actionFailedShort')));
    } finally {
      setSending(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t('adminBroadcast.title')}</Text>
      <View style={styles.card}>
        <Text style={styles.label}>{t('adminBroadcast.to')}</Text>
        <View style={styles.chips}>
          {AUDIENCES.map((a) => (
            <TouchableOpacity key={a} style={[styles.chip, audience === a && styles.chipOn]} onPress={() => setAudience(a)}
                              testID={`broadcast-to-${a}`}>
              <Text style={[styles.chipText, audience === a && styles.chipTextOn]}>{t(`adminBroadcast.audience.${a}`)}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.reach} testID="broadcast-reach">
          {reach == null ? '…' : t('adminBroadcast.reach', { n: reach })}
        </Text>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} maxLength={80}
                   placeholder={t('adminBroadcast.titlePlaceholder')} placeholderTextColor="#5E7290" testID="broadcast-title" />
        <TextInput style={[styles.input, styles.multi]} value={message} onChangeText={setMessage} maxLength={300} multiline
                   placeholder={t('adminBroadcast.messagePlaceholder')} placeholderTextColor="#5E7290" testID="broadcast-message" />
        <Text style={styles.count}>{message.length}/300</Text>
        <TouchableOpacity style={[styles.send, (!ready || sending) && { opacity: 0.5 }]} onPress={send}
                          disabled={!ready || sending} testID="broadcast-send">
          {sending ? <ActivityIndicator color={ADMIN.onGold} /> : <Text style={styles.sendText}>{t('adminBroadcast.send')}</Text>}
        </TouchableOpacity>
        <Text style={styles.note}>{t('adminBroadcast.note')}</Text>
      </View>

      {!!history.length && <Text style={styles.section}>{t('adminBroadcast.sent')}</Text>}
      {history.map((b) => (
        <View key={b.id} style={styles.past}>
          <Text style={styles.pastTitle}>{b.title}</Text>
          <Text style={styles.pastBody}>{b.message}</Text>
          <Text style={styles.pastMeta}>
            {t(`adminBroadcast.audience.${b.audience}`)} · {t('adminBroadcast.reach', { n: b.recipients })} · @{b.sent_by} · {new Date(b.created_at).toLocaleString()}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 48, gap: 12 },
  title: { color: ADMIN.text, fontSize: 26, fontWeight: '800' },
  card: { backgroundColor: ADMIN.card, borderRadius: 16, padding: 14, gap: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: ADMIN.border },
  label: { color: ADMIN.gold, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: ADMIN.border },
  chipOn: { backgroundColor: ADMIN.gold, borderColor: ADMIN.gold },
  chipText: { color: ADMIN.muted, fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: ADMIN.onGold },
  reach: { color: ADMIN.text, fontSize: 13.5, fontWeight: '700' },
  input: { minHeight: 46, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: ADMIN.text, fontSize: 15,
    backgroundColor: ADMIN.field, borderWidth: 1, borderColor: '#1E3150' },
  multi: { minHeight: 96, textAlignVertical: 'top' },
  count: { color: '#7D8FA8', fontSize: 12, alignSelf: 'flex-end' },
  send: { height: 50, borderRadius: 14, backgroundColor: ADMIN.gold, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: ADMIN.onGold, fontWeight: '800', fontSize: 15.5 },
  note: { color: '#7D8FA8', fontSize: 12.5, lineHeight: 18 },
  section: { color: ADMIN.gold, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginTop: 8 },
  past: { backgroundColor: ADMIN.card, borderRadius: 14, padding: 12, gap: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: ADMIN.border },
  pastTitle: { color: ADMIN.text, fontWeight: '800', fontSize: 14.5 },
  pastBody: { color: ADMIN.muted, fontSize: 13.5 },
  pastMeta: { color: '#7D8FA8', fontSize: 11.5 },
});

// One organiser's M-Pesa till, walked through linking with Safaricom:
//
//   1. Submit — after the request has gone to Safaricom.
//   2. Test   — a KES 1 prompt to the admin's own phone, paid into the till.
//              Paid = Safaricom has linked it; 2029 = not yet.
//   3. Activate — only after a paid test in the last 24 hours (the ticketing
//              server refuses otherwise), and with a fresh authenticator code.
//
// Or Reject, with the reason the organiser will read. While a test is out
// the screen asks about it every few seconds; the server also asks M-Pesa
// itself when the callback is late.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useI18n } from '../../context/I18nContext';
import { fetchAdminTill, adminTillAction } from '../../services/api';
import { normalizeKePhone, formatWhen } from '../../services/tickets';
import { confirmAction, notify } from '../../utils/adminConfirm';
import { ADMIN, ErrorState, useReasonSheet } from './AdminKit';
import { Badge, TILL_COLOR } from './AdminTickets';

const POLL_MS = 3000;
const POLL_LIMIT_MS = 2 * 60 * 1000;
// The tester's own number, for next time. Their phone, not the organiser's.
const PHONE_KEY = 'adminTix:testPhone';

export default function AdminTicketTill({ route }) {
  const { t } = useI18n();
  const months = t('tix.months').split(',');
  const weekdays = t('tix.weekdays').split(',');
  const { id } = route.params;
  const [till, setTill] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);           // the action under way
  const [phone, setPhone] = useState('');
  const [reasonSheet, askReason] = useReasonSheet();

  const load = useCallback(async () => {
    setError(null);
    try { setTill(await fetchAdminTill(id)); } catch (e) { setError(e); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { AsyncStorage.getItem(PHONE_KEY).then((p) => p && setPhone(p)).catch(() => {}); }, []);

  // While a test is out: ask again every few seconds, for up to 2 minutes.
  const pending = till?.last_test?.result === 'pending';
  const pollStart = useRef(0);
  useEffect(() => {
    if (!pending) return undefined;
    if (!pollStart.current) pollStart.current = Date.now();
    if (Date.now() - pollStart.current > POLL_LIMIT_MS) return undefined;
    const timer = setTimeout(load, POLL_MS);
    return () => clearTimeout(timer);
  }, [pending, till, load]);

  const run = async (action, body) => {
    setBusy(action);
    try {
      setTill(await adminTillAction(id, action, body));
      return true;
    } catch (e) {
      notify(t('adminTix.actionFailed'), e.message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const submit = () => run('submit');

  const phoneOk = !!normalizeKePhone(phone);
  const test = async () => {
    if (!phoneOk) return;
    AsyncStorage.setItem(PHONE_KEY, phone).catch(() => {});
    pollStart.current = Date.now();
    await run('test', { phone });
  };

  const activate = async () => {
    const ok = await confirmAction({
      title: t('adminTix.activateTitle'),
      message: t('adminTix.activateMessage', { n: till.events }),
      confirmLabel: t('adminTix.activate'),
      cancelLabel: t('common.cancel'),
    });
    if (ok) run('activate');
  };

  const reject = async () => {
    const note = await askReason({
      title: t('adminTix.rejectTillTitle'),
      message: till.status === 'active' ? t('adminTix.rejectActiveTill') : t('adminTix.rejectTillMessage'),
      confirmLabel: t('adminTix.reject'),
      destructive: true,
    });
    if (note) run('reject', { note });
  };

  if (!till) {
    return (
      <View style={styles.centre}>
        {error ? <ErrorState message={error.message} onRetry={load} /> : <ActivityIndicator color={ADMIN.gold} />}
      </View>
    );
  }

  const active = till.status === 'active';
  const lastTest = till.last_test;
  const testColor = { ok: ADMIN.ok, not_linked: ADMIN.danger, failed: ADMIN.danger, pending: ADMIN.gold }[lastTest?.result];

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{till.business_name}</Text>
        <View style={styles.badges}>
          <Badge color={TILL_COLOR[till.status] || ADMIN.muted} label={t(`adminTix.till.${till.status}`)} />
          <Text style={styles.number}>{t('adminTix.tillNo', { n: till.till_number })}</Text>
        </View>
        {!!till.note && <Text style={styles.note}>{till.note}</Text>}

        <View style={styles.card}>
          <Text style={styles.label}>{t('adminTix.organiser')}</Text>
          <Text style={styles.line}>{till.organiser?.display_name || '—'}</Text>
          <Text style={styles.muted}>{till.organiser?.email}{till.organiser?.phone ? ` · ${till.organiser.phone}` : ''}</Text>
          <Text style={styles.muted}>{t('adminTix.eventsCount', { n: till.events })}</Text>
          <Text style={styles.hint}>{t('adminTix.checkName')}</Text>
        </View>

        {/* 1. Submit */}
        <Step n={1} title={t('adminTix.step1')} done={till.status !== 'pending' && till.status !== 'rejected'}>
          <Text style={styles.body}>{t('adminTix.step1Body')}</Text>
          {(till.status === 'pending' || till.status === 'rejected') && (
            <Action label={t('adminTix.markSubmitted')} onPress={submit} busy={busy === 'submit'} testID="admin-till-submit" />
          )}
        </Step>

        {/* 2. Test */}
        <Step n={2} title={t('adminTix.step2')} done={lastTest?.result === 'ok'}>
          <Text style={styles.body}>{t('adminTix.step2Body')}</Text>
          {!!lastTest && (
            <View style={[styles.testResult, { borderColor: testColor || ADMIN.border }]} accessibilityLiveRegion="polite">
              {pending && <ActivityIndicator color={ADMIN.gold} size="small" />}
              <View style={{ flex: 1 }}>
                <Text style={[styles.testTitle, { color: testColor || ADMIN.text }]}>{t(`adminTix.test.${lastTest.result}`)}</Text>
                <Text style={styles.muted}>
                  {lastTest.result_desc || t('adminTix.testWaiting')}
                </Text>
                <Text style={styles.muted}>
                  {formatWhen(lastTest.created_at, { months, weekdays })} · {lastTest.requested_by}
                </Text>
              </View>
            </View>
          )}
          {!active && (
            <>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
                placeholder={t('adminTix.yourPhone')}
                placeholderTextColor="#5E7290"
                keyboardType="phone-pad"
                maxLength={20}
                testID="admin-till-phone"
              />
              <Action label={pending ? t('adminTix.testSent') : t('adminTix.sendTest')} onPress={test}
                      busy={busy === 'test'} disabled={!phoneOk || pending} testID="admin-till-test" />
            </>
          )}
        </Step>

        {/* 3. Activate */}
        <Step n={3} title={t('adminTix.step3')} done={active}>
          <Text style={styles.body}>{active
            ? t('adminTix.activeSince', { when: formatWhen(till.activated_at, { months, weekdays }) })
            : t('adminTix.step3Body')}</Text>
          {!active && (
            <Action label={t('adminTix.activate')} onPress={activate} busy={busy === 'activate'}
                    disabled={!till.can_activate} primary testID="admin-till-activate" />
          )}
        </Step>

        {till.status !== 'rejected' && (
          <TouchableOpacity style={styles.rejectBtn} onPress={reject} disabled={!!busy} testID="admin-till-reject">
            <Text style={styles.rejectText}>{t('adminTix.rejectTill')}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
      {reasonSheet}
    </>
  );
}

const Step = ({ n, title, done, children }) => (
  <View style={styles.step}>
    <View style={styles.stepHead}>
      <View style={[styles.stepNo, done && styles.stepNoDone]}>
        <Text style={[styles.stepNoText, done && styles.stepNoTextDone]}>{done ? '✓' : n}</Text>
      </View>
      <Text style={styles.stepTitle}>{title}</Text>
    </View>
    {children}
  </View>
);

const Action = ({ label, onPress, busy, disabled, primary, testID }) => (
  <TouchableOpacity
    style={[styles.action, primary && styles.actionPrimary, (disabled || busy) && styles.off]}
    onPress={onPress}
    disabled={disabled || busy}
    testID={testID}
  >
    {busy ? <ActivityIndicator color={primary ? '#06281A' : ADMIN.gold} />
      : <Text style={[styles.actionText, primary && styles.actionTextPrimary]}>{label}</Text>}
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  container: { flex: 1 },
  content: { padding: 18, paddingBottom: 48, width: '100%', maxWidth: 760, alignSelf: 'center' },
  title: { color: ADMIN.text, fontSize: 22, fontWeight: '800' },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  number: { color: ADMIN.muted, fontSize: 14, fontWeight: '600' },
  note: { color: ADMIN.danger, fontSize: 13.5, marginTop: 10 },
  card: { marginTop: 16, padding: 14, borderRadius: 14, backgroundColor: ADMIN.card, borderWidth: 1, borderColor: ADMIN.border },
  label: { color: ADMIN.gold, fontSize: 11.5, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  line: { color: ADMIN.text, fontSize: 15, fontWeight: '600' },
  muted: { color: ADMIN.muted, fontSize: 13, marginTop: 3 },
  hint: { color: ADMIN.muted, fontSize: 12, marginTop: 10, fontStyle: 'italic' },

  step: { marginTop: 14, padding: 14, borderRadius: 14, backgroundColor: ADMIN.card, borderWidth: 1, borderColor: ADMIN.border },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepNo: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: ADMIN.gold, alignItems: 'center', justifyContent: 'center' },
  stepNoDone: { backgroundColor: ADMIN.ok, borderColor: ADMIN.ok },
  stepNoText: { color: ADMIN.gold, fontWeight: '800', fontSize: 13 },
  stepNoTextDone: { color: '#06281A' },
  stepTitle: { color: ADMIN.text, fontSize: 16, fontWeight: '700' },
  body: { color: ADMIN.muted, fontSize: 13.5, lineHeight: 20, marginTop: 8 },

  testResult: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  testTitle: { fontSize: 14.5, fontWeight: '800' },
  input: {
    marginTop: 12, height: 48, borderRadius: 12, paddingHorizontal: 14, color: ADMIN.text, fontSize: 16,
    backgroundColor: ADMIN.field, borderWidth: 1, borderColor: ADMIN.border,
  },
  action: {
    marginTop: 12, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: ADMIN.gold,
  },
  actionPrimary: { backgroundColor: ADMIN.ok, borderColor: ADMIN.ok },
  actionText: { color: ADMIN.gold, fontWeight: '800', fontSize: 14.5 },
  actionTextPrimary: { color: '#06281A' },
  off: { opacity: 0.45 },
  rejectBtn: {
    marginTop: 22, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: ADMIN.danger, backgroundColor: 'rgba(255,122,107,0.08)',
  },
  rejectText: { color: ADMIN.danger, fontWeight: '800', fontSize: 14.5 },
});

// The Security Centre (admin phase 5): what the attack rules have seen in the
// last day, and the admin's hands on it — handle an event, block or unblock
// an address or range, look up sign-ins by account or address, and lockdown
// (sign-ups paused, limits halved) while an attack lasts. Every change asks
// for a fresh authenticator code (the server's rule) and is logged.
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Switch, TextInput, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../context/I18nContext';
import {
  fetchSecurityCentre, fetchLoginAttempts, blockNetwork, unblockNetwork, resolveSecurityEvent, setSecurityLockdown,
  fetchRecoveryCases, closeRecoveryCase, changeAccountEmail, sendPasswordReset, signOutUser,
} from '../../services/api';
import { confirmAction, notify } from '../../utils/adminConfirm';
import { adminMemo } from '../../utils/adminSession';
import { ADMIN, ErrorState, StaleNote, useReasonSheet } from './AdminKit';

const MEMO = 'security:centre';
const SEVERITY = { high: '#FF6B6B', medium: '#FFB547', low: '#8E99A8' };
const when = (iso) => (iso ? new Date(iso).toLocaleString() : '');

export default function AdminSecurity() {
  const { t } = useI18n();
  const [data, setData] = useState(() => adminMemo.get(MEMO) || null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [network, setNetwork] = useState('');
  const [hours, setHours] = useState('24');
  const [lookup, setLookup] = useState('');
  const [attempts, setAttempts] = useState(null);
  const [reasonSheet, askReason] = useReasonSheet();
  // People who cannot get into their account, waiting for a person.
  const [cases, setCases] = useState(() => adminMemo.get('security:recovery') || []);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      // The recovery queue is a part of the page: if it fails, the rest still shows.
      const [res, open] = await Promise.all([fetchSecurityCentre(), Promise.resolve().then(fetchRecoveryCases).catch(() => null)]);
      setData(res);
      adminMemo.set(MEMO, res);
      if (Array.isArray(open)) { setCases(open); adminMemo.set('security:recovery', open); }
    } catch {
      setFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const act = async (fn, after) => {
    setBusy(true);
    try {
      const res = await fn();
      if (after) after(res);
      await load();
    } catch (e) {
      notify(t('common.error'), e?.data?.error || e?.response?.data?.error || t('admin.actionFailedShort'));
    } finally {
      setBusy(false);
    }
  };

  const block = async (net) => {
    const target = (net || network).trim();
    if (!target) return;
    const reason = await askReason({
      title: t('adminSec.blockTitle', { network: target }),
      message: t('adminSec.blockBody'),
      confirmLabel: t('adminSec.block'),
      destructive: true,
    });
    if (!reason) return;
    const h = Math.max(0, parseInt(hours, 10) || 0);
    act(() => blockNetwork(target, reason, h), () => setNetwork(''));
  };

  const unblock = async (net) => {
    const ok = await confirmAction({ title: t('adminSec.unblockTitle', { network: net }), confirmLabel: t('adminSec.unblock') });
    if (ok) act(() => unblockNetwork(net));
  };

  const findAttempts = async () => {
    const q = lookup.trim();
    if (!q) return;
    setAttempts({ loading: true });
    try {
      const isIp = /^[0-9a-f.:]+$/i.test(q) && /[.:]/.test(q);
      setAttempts({ rows: await fetchLoginAttempts(isIp ? { ip: q } : { user: q.replace(/^@/, '') }) });
    } catch {
      setAttempts({ failed: true });
    }
  };

  // A recovery case, step by step: move the account to the email they can
  // reach, send a reset there, sign everyone else out, then close the case.
  const moveEmail = async (c) => {
    const reason = await askReason({
      title: t('adminSec.moveTitle', { name: c.user.username, email: c.contact_email }),
      message: t('adminSec.moveBody'),
      confirmLabel: t('adminSec.move'),
      destructive: true,
    });
    if (reason) act(() => changeAccountEmail(c.user.id, c.contact_email, reason));
  };
  const signOutCase = async (c) => {
    const reason = await askReason({
      title: t('adminUsers.signOutTitle', { name: c.user.username }),
      confirmLabel: t('adminUsers.signOutConfirm'),
      destructive: true,
    });
    if (reason) act(() => signOutUser(c.user.id, reason));
  };
  const closeCase = async (c, status) => {
    const ok = await confirmAction({
      title: t(status === 'resolved' ? 'adminSec.resolveCaseTitle' : 'adminSec.rejectCaseTitle'),
      message: t(status === 'resolved' ? 'adminSec.resolveCaseBody' : 'adminSec.rejectCaseBody'),
      confirmLabel: t(status === 'resolved' ? 'adminSec.resolveCase' : 'adminSec.rejectCase'),
      destructive: status !== 'resolved',
    });
    if (ok) act(() => closeRecoveryCase(c.id, status));
  };

  if (!data && failed) return <ErrorState onRetry={load} />;
  if (!data) return <ActivityIndicator color={ADMIN.gold} style={{ marginTop: 60 }} />;
  const lock = data.lockdown || {};

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}
        tintColor={ADMIN.gold} />}
      testID="admin-security"
    >
      <Text style={styles.title}>{t('adminSec.title')}</Text>
      {failed && <StaleNote onRetry={load} />}

      {/* The last day at a glance. */}
      <View style={styles.stats}>
        {[['sign_ins', 'log-in-outline'], ['failed', 'close-circle-outline'], ['locked', 'lock-closed-outline'],
          ['signups', 'person-add-outline']].map(([k, icon]) => (
          <View key={k} style={styles.stat}>
            <Ionicons name={icon} size={18} color={k === 'failed' && data.day[k] ? ADMIN.danger : ADMIN.gold} />
            <Text style={styles.statNum}>{data.day[k]}</Text>
            <Text style={styles.statLabel}>{t(`adminSec.day.${k}`)}</Text>
          </View>
        ))}
      </View>

      {/* Lockdown: for the length of an attack. */}
      <Text style={styles.section}>{t('adminSec.lockdown')}</Text>
      <View style={[styles.card, (lock.signups_paused || lock.strict) && styles.cardAlert]}>
        {[['signups_paused', 'adminSec.pauseSignups'], ['strict', 'adminSec.strict']].map(([k, label], i) => (
          <View key={k} style={[styles.row, i > 0 && styles.divider]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t(label)}</Text>
              <Text style={styles.rowSub}>{t(`${label}Sub`)}</Text>
            </View>
            <Switch value={!!lock[k]} disabled={busy} onValueChange={(v) => act(() => setSecurityLockdown({ [k]: v }))}
              trackColor={{ false: '#2A3E5E', true: ADMIN.danger }} thumbColor="#FFFFFF" testID={`sec-${k}`}
              accessibilityLabel={t(label)} />
          </View>
        ))}
      </View>

      {/* People who cannot get into their account. */}
      <Text style={styles.section}>{t('adminSec.recovery', { n: cases.length })}</Text>
      {cases.length ? cases.map((c) => (
        <View key={c.id} style={styles.card} testID={`sec-case-${c.id}`}>
          <Text style={styles.rowTitle}>{c.account}  →  {c.contact_email}</Text>
          <Text style={styles.rowSub}>{c.details}</Text>
          <Text style={styles.meta}>{when(c.created_at)}{c.ip ? ` · ${c.ip}` : ''}</Text>
          {c.user ? (
            <View style={styles.match}>
              <Text style={styles.rowSub}>
                {t('adminSec.matched', { name: c.user.username, email: c.user.email, joined: when(c.user.joined) })}
              </Text>
              {c.user.email_matches && <Text style={styles.ok}>{t('adminSec.emailMatches')}</Text>}
            </View>
          ) : <Text style={styles.rowSub}>{t('adminSec.noMatch')}</Text>}
          <View style={styles.actions}>
            {!!c.user && !c.user.email_matches && (
              <TouchableOpacity style={styles.btnDanger} onPress={() => moveEmail(c)} disabled={busy}
                testID={`sec-case-move-${c.id}`}>
                <Text style={styles.btnDangerText}>{t('adminSec.move')}</Text>
              </TouchableOpacity>
            )}
            {!!c.user && (
              <TouchableOpacity style={styles.btnQuiet} onPress={() => act(() => sendPasswordReset(c.user.id),
                (r) => notify(t('common.done'), t('adminSec.resetSent', { email: r?.sent_to || '' })))} disabled={busy}
                testID={`sec-case-reset-${c.id}`}>
                <Text style={styles.btnQuietText}>{t('adminSec.sendReset')}</Text>
              </TouchableOpacity>
            )}
            {!!c.user && (
              <TouchableOpacity style={styles.btnQuiet} onPress={() => signOutCase(c)} disabled={busy}>
                <Text style={styles.btnQuietText}>{t('adminUsers.signOut')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.btn} onPress={() => closeCase(c, 'resolved')} disabled={busy}
              testID={`sec-case-resolve-${c.id}`}>
              <Text style={styles.btnText}>{t('adminSec.resolveCase')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnQuiet} onPress={() => closeCase(c, 'rejected')} disabled={busy}>
              <Text style={styles.btnQuietText}>{t('adminSec.rejectCase')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )) : <Text style={styles.empty}>{t('adminSec.noCases')}</Text>}

      {/* What the rules saw, still open. */}
      <Text style={styles.section}>{t('adminSec.events', { n: data.events.length })}</Text>
      {data.events.length ? data.events.map((e) => (
        <View key={e.id} style={styles.card} testID={`sec-event-${e.id}`}>
          <View style={styles.row}>
            <View style={[styles.dot, { backgroundColor: SEVERITY[e.severity] || SEVERITY.medium }]} />
            <Text style={[styles.rowTitle, { flex: 1 }]}>{t(`adminSec.kind.${e.kind}`)}</Text>
            {e.count > 1 && <Text style={styles.count}>×{e.count}</Text>}
          </View>
          <Text style={styles.rowSub}>{e.detail}</Text>
          <Text style={styles.meta}>{when(e.last_seen_at)}{e.ip ? ` · ${e.ip}` : ''}{e.user ? ` · @${e.user.username}` : ''}</Text>
          <View style={styles.actions}>
            {!!e.ip && !data.blocked.some((b) => b.network.startsWith(`${e.ip}/`)) && (
              <TouchableOpacity style={styles.btnDanger} onPress={() => block(e.ip)} disabled={busy}>
                <Text style={styles.btnDangerText}>{t('adminSec.blockIp')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.btn} onPress={() => act(() => resolveSecurityEvent(e.id))} disabled={busy}
              testID={`sec-resolve-${e.id}`}>
              <Text style={styles.btnText}>{t('adminSec.resolve')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )) : <Text style={styles.empty}>{t('adminSec.noEvents')}</Text>}

      {/* Blocked addresses and ranges. */}
      <Text style={styles.section}>{t('adminSec.blocked', { n: data.blocked.length })}</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <TextInput style={[styles.input, { flex: 1 }]} value={network} onChangeText={setNetwork}
            placeholder={t('adminSec.networkPlaceholder')} placeholderTextColor="#5E7290" autoCapitalize="none"
            autoCorrect={false} keyboardType="numbers-and-punctuation" testID="sec-network" />
          <TextInput style={[styles.input, styles.hours]} value={hours} onChangeText={setHours} keyboardType="number-pad"
            accessibilityLabel={t('adminSec.hours')} testID="sec-hours" />
        </View>
        <Text style={styles.rowSub}>{t('adminSec.hoursHint')}</Text>
        <TouchableOpacity style={[styles.btnDanger, { alignSelf: 'flex-start' }]} onPress={() => block()}
          disabled={busy || !network.trim()} testID="sec-block">
          <Text style={styles.btnDangerText}>{t('adminSec.block')}</Text>
        </TouchableOpacity>
        {data.blocked.map((b, i) => (
          <View key={b.network} style={[styles.row, styles.divider, i === 0 && { marginTop: 6 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{b.network}{b.automatic ? `  ·  ${t('adminSec.auto')}` : ''}</Text>
              <Text style={styles.rowSub} numberOfLines={2}>
                {b.reason}{b.expires_at ? ` · ${t('adminSec.until', { date: when(b.expires_at) })}` : ` · ${t('adminSec.forGood')}`}
              </Text>
            </View>
            <TouchableOpacity onPress={() => unblock(b.network)} disabled={busy} hitSlop={8}
              accessibilityLabel={t('adminSec.unblock')} testID={`sec-unblock-${i}`}>
              <Ionicons name="close-circle-outline" size={22} color={ADMIN.muted} />
            </TouchableOpacity>
          </View>
        ))}
      </View>

      {/* Where the failures come from. */}
      {!!data.top_failing_ips.length && (
        <>
          <Text style={styles.section}>{t('adminSec.topIps')}</Text>
          <View style={styles.card}>
            {data.top_failing_ips.map((r, i) => (
              <View key={r.ip} style={[styles.row, i > 0 && styles.divider]}>
                <Text style={[styles.rowTitle, { flex: 1 }]}>{r.ip}</Text>
                <Text style={styles.rowSub}>{t('adminSec.failedOn', { n: r.n, accounts: r.accounts })}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {/* Sign-ins for one account or address. */}
      <Text style={styles.section}>{t('adminSec.lookup')}</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <TextInput style={[styles.input, { flex: 1 }]} value={lookup} onChangeText={setLookup}
            placeholder={t('adminSec.lookupPlaceholder')} placeholderTextColor="#5E7290" autoCapitalize="none"
            autoCorrect={false} onSubmitEditing={findAttempts} returnKeyType="search" testID="sec-lookup" />
          <TouchableOpacity style={styles.btn} onPress={findAttempts} testID="sec-lookup-go">
            <Text style={styles.btnText}>{t('adminSec.find')}</Text>
          </TouchableOpacity>
        </View>
        {attempts?.loading && <ActivityIndicator color={ADMIN.gold} />}
        {attempts?.failed && <Text style={styles.rowSub}>{t('adminKit.loadFailed')}</Text>}
        {attempts?.rows && (attempts.rows.length ? attempts.rows.slice(0, 30).map((a) => (
          <Text key={a.id} style={styles.meta} numberOfLines={1}>
            {when(a.created_at)} · @{a.username} · {t(`adminSec.outcome.${a.outcome}`)} · {a.ip || '—'}{a.device ? ` · ${a.device}` : ''}
          </Text>
        )) : <Text style={styles.rowSub}>{t('adminSec.noAttempts')}</Text>)}
      </View>
      {reasonSheet}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 48, gap: 10 },
  title: { color: ADMIN.text, fontSize: 26, fontWeight: '800' },
  section: { color: ADMIN.gold, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginTop: 10 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: {
    flexGrow: 1, flexBasis: '22%', minWidth: 120, padding: 12, borderRadius: 14, gap: 4,
    backgroundColor: ADMIN.card, borderWidth: StyleSheet.hairlineWidth, borderColor: ADMIN.border,
  },
  statNum: { color: ADMIN.text, fontSize: 22, fontWeight: '800' },
  statLabel: { color: ADMIN.muted, fontSize: 12 },
  card: { backgroundColor: ADMIN.card, borderRadius: 16, padding: 14, gap: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: ADMIN.border },
  cardAlert: { borderColor: 'rgba(255,122,107,0.6)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ADMIN.border, paddingTop: 10 },
  rowTitle: { color: ADMIN.text, fontSize: 15, fontWeight: '700' },
  rowSub: { color: ADMIN.muted, fontSize: 12.5, lineHeight: 17 },
  meta: { color: '#7D8FA8', fontSize: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  count: { color: ADMIN.gold, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  btn: { minHeight: 38, paddingHorizontal: 14, borderRadius: 12, justifyContent: 'center', backgroundColor: ADMIN.gold },
  btnText: { color: ADMIN.onGold, fontWeight: '800' },
  btnDanger: { minHeight: 38, paddingHorizontal: 14, borderRadius: 12, justifyContent: 'center', backgroundColor: 'rgba(255,122,107,0.16)' },
  btnDangerText: { color: ADMIN.danger, fontWeight: '800' },
  input: {
    minHeight: 42, borderRadius: 12, paddingHorizontal: 12, color: ADMIN.text, fontSize: 14.5,
    backgroundColor: ADMIN.field, borderWidth: 1, borderColor: '#1E3150',
  },
  hours: { width: 64, textAlign: 'center' },
  empty: { color: ADMIN.muted, fontSize: 13.5 },
  match: { padding: 10, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)', gap: 4 },
  ok: { color: ADMIN.ok, fontSize: 12.5, fontWeight: '700' },
  btnQuiet: { minHeight: 38, paddingHorizontal: 14, borderRadius: 12, justifyContent: 'center', borderWidth: 1, borderColor: ADMIN.border },
  btnQuietText: { color: ADMIN.text, fontWeight: '700' },
});

// One organiser account, for helping someone locked out of their events.
//
// Nobody here ever sees or sets a password. Three ways to help:
//   - Email a reset code to the address on the account (the code is never
//     shown here; it goes to their own inbox).
//   - Create a code to read out — ONLY once you are sure who is calling (it
//     lets whoever has it set the password). Shown once, works 15 minutes.
//     Needs a fresh authenticator code.
//   - Sign out everywhere — a stolen phone or a leaked password: every session
//     ends at once. Needs a fresh authenticator code.
// Each is logged on both servers.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useI18n } from '../../context/I18nContext';
import { fetchAdminTicketOrganiser, adminTicketOrganiserAction } from '../../services/api';
import { confirmAction, notify } from '../../utils/adminConfirm';
import { ADMIN, ErrorState } from './AdminKit';

const dateOf = (iso) => (iso ? new Date(iso).toLocaleDateString() : '–');

export default function AdminTicketOrganiser({ route }) {
  const { t } = useI18n();
  const { id } = route.params;
  const [org, setOrg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [code, setCode] = useState(null);           // { code, expires_at }, shown once

  const load = useCallback(async () => {
    setError(null);
    try { setOrg(await fetchAdminTicketOrganiser(id)); } catch (e) { setError(e); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const run = async (action, { title, message, confirmLabel, destructive }) => {
    if (busy) return;
    const ok = await confirmAction({ title, message, confirmLabel, cancelLabel: t('common.cancel'), destructive });
    if (!ok) return;
    setBusy(action);
    try {
      const res = await adminTicketOrganiserAction(id, action);
      if (action === 'reset-code') setCode(res);
      else notify(t('adminTix.org.done'), res?.detail || '');
    } catch (e) {
      notify(t('adminTix.actionFailed'), e.message);
    } finally {
      setBusy(null);
    }
  };

  if (!org) {
    return error ? <ErrorState message={error.message} onRetry={load} />
      : <ActivityIndicator color={ADMIN.gold} style={styles.loading} />;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{org.display_name || org.email}</Text>
      <Text style={styles.sub}>{org.email}{org.phone ? `  ·  ${org.phone}` : ''}</Text>

      <View style={styles.facts}>
        <Fact label={t('adminTix.org.joined')} value={dateOf(org.date_joined)} />
        <Fact label={t('adminTix.org.lastLogin')} value={dateOf(org.last_login)} />
        <Fact label={t('adminTix.org.events')} value={String(org.events ?? 0)} />
        <Fact label={t('adminTix.org.tills')} value={String(org.tills ?? 0)} />
      </View>

      <Text style={styles.section}>{t('adminTix.org.help')}</Text>
      <Text style={styles.note}>{t('adminTix.org.helpNote')}</Text>

      <Action
        label={t('adminTix.org.sendReset')} hint={t('adminTix.org.sendResetHint', { email: org.email })}
        busy={busy === 'send-reset'} testID="admin-org-send-reset"
        onPress={() => run('send-reset', {
          title: t('adminTix.org.sendReset'), message: t('adminTix.org.sendResetHint', { email: org.email }),
          confirmLabel: t('adminTix.org.send'),
        })}
      />
      <Action
        label={t('adminTix.org.readCode')} hint={t('adminTix.org.readCodeHint')}
        busy={busy === 'reset-code'} testID="admin-org-reset-code"
        onPress={() => run('reset-code', {
          title: t('adminTix.org.readCode'), message: t('adminTix.org.readCodeConfirm'),
          confirmLabel: t('adminTix.org.create'), destructive: true,
        })}
      />
      {!!code && (
        <View style={styles.code} testID="admin-org-code">
          <Text style={styles.codeLabel}>{t('adminTix.org.codeLabel')}</Text>
          <Text style={styles.codeValue} selectable>{code.code}</Text>
          <Text style={styles.codeHint}>{t('adminTix.org.codeHint', { email: org.email })}</Text>
        </View>
      )}
      <Action
        label={t('adminTix.org.signOut')} hint={t('adminTix.org.signOutHint')} danger
        busy={busy === 'sign-out'} testID="admin-org-sign-out"
        onPress={() => run('sign-out', {
          title: t('adminTix.org.signOut'), message: t('adminTix.org.signOutHint'),
          confirmLabel: t('adminTix.org.signOut'), destructive: true,
        })}
      />
    </ScrollView>
  );
}

const Fact = ({ label, value }) => (
  <View style={styles.fact}>
    <Text style={styles.factValue} numberOfLines={1}>{value}</Text>
    <Text style={styles.factLabel}>{label}</Text>
  </View>
);

const Action = ({ label, hint, onPress, busy, danger, testID }) => (
  <TouchableOpacity style={[styles.action, danger && styles.actionDanger]} onPress={onPress} disabled={busy}
                    accessibilityRole="button" testID={testID}>
    <View style={styles.flex}>
      <Text style={[styles.actionLabel, danger && { color: ADMIN.danger }]}>{label}</Text>
      <Text style={styles.actionHint}>{hint}</Text>
    </View>
    {busy && <ActivityIndicator color={ADMIN.gold} />}
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 18, paddingBottom: 48, width: '100%', maxWidth: 760, alignSelf: 'center' },
  loading: { marginTop: 60 },
  flex: { flex: 1 },
  title: { color: ADMIN.text, fontSize: 22, fontWeight: '700' },
  sub: { color: ADMIN.muted, fontSize: 13.5, marginTop: 4 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  fact: {
    flexGrow: 1, flexBasis: '45%', padding: 12, borderRadius: 14,
    backgroundColor: ADMIN.card, borderWidth: 1, borderColor: ADMIN.border,
  },
  factValue: { color: ADMIN.text, fontSize: 16, fontWeight: '800' },
  factLabel: { color: ADMIN.muted, fontSize: 11.5, marginTop: 2 },
  section: { color: ADMIN.text, fontSize: 16, fontWeight: '700', marginTop: 24 },
  note: { color: ADMIN.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  action: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginTop: 12, borderRadius: 16,
    backgroundColor: ADMIN.card, borderWidth: 1, borderColor: ADMIN.border,
  },
  actionDanger: { borderColor: 'rgba(255,122,107,0.45)' },
  actionLabel: { color: ADMIN.gold, fontSize: 15, fontWeight: '700' },
  actionHint: { color: ADMIN.muted, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  code: {
    marginTop: 12, padding: 16, borderRadius: 16, alignItems: 'center',
    backgroundColor: 'rgba(255,196,107,0.10)', borderWidth: 1, borderColor: ADMIN.gold,
  },
  codeLabel: { color: ADMIN.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  codeValue: { color: ADMIN.gold, fontSize: 34, fontWeight: '800', letterSpacing: 8, marginTop: 6 },
  codeHint: { color: ADMIN.muted, fontSize: 12.5, lineHeight: 18, marginTop: 8, textAlign: 'center' },
});

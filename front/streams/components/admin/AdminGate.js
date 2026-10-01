// The door to the admin area. It asks the server, every time, who this is as
// an admin (never the profile kept on the phone): not an admin (or no longer
// one) is sent away; an admin without two-step sign-in sets it up here (an
// authenticator app, a first code, ten backup codes); an admin with it enters
// a code to open a short admin session. While inside, when the server wants a
// code (the session ended, or a dangerous action wants a fresh one), the same
// code box opens over the screen, and the action goes on once it is given.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Linking, Modal, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../context/I18nContext';
import {
  fetchAdminSecurity, startAdminTwoFactor, confirmAdminTwoFactor, verifyAdminCode,
} from '../../services/api';
import {
  restoreAdminSession, setAdminSession, clearAdminSession, setCodeAsker,
} from '../../utils/adminSession';
import { clipboard } from '../../utils/optionalNative';

const C = {
  card: '#13233B', border: '#1E3150', field: '#0F1C30', text: '#FFFFFF', muted: '#9FB0C8',
  gold: '#FFC46B', onGold: '#0A1628', danger: '#FF7A6B', ok: '#5FD39A',
};

const errorOf = (e, fallback) => e?.data?.error || e?.response?.data?.error || fallback;

/** Six digits, or a backup code (xxxx-xxxx); gives back { code } or { backupCode }. */
const CodeBox = ({ t, onSubmit, busy, error, testID = 'admin-code' }) => {
  const [value, setValue] = useState('');
  const [backup, setBackup] = useState(false);
  const submit = () => onSubmit(backup ? { backupCode: value.trim() } : { code: value.replace(/\D/g, '') });
  return (
    <View style={styles.codeWrap}>
      <TextInput
        style={styles.codeInput}
        value={value}
        onChangeText={(v) => setValue(backup ? v : v.replace(/\D/g, '').slice(0, 6))}
        placeholder={backup ? 'xxxx-xxxx' : '000000'}
        placeholderTextColor="#4E607A"
        keyboardType={backup ? 'default' : 'number-pad'}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        maxLength={backup ? 9 : 6}
        onSubmitEditing={submit}
        textContentType="oneTimeCode"
        accessibilityLabel={backup ? t('admin.gate.backupLabel') : t('admin.gate.codeLabel')}
        testID={testID}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
      <TouchableOpacity
        style={[styles.primary, (busy || !value) && styles.primaryOff]}
        onPress={submit}
        disabled={busy || !value}
        testID={`${testID}-submit`}
      >
        {busy ? <ActivityIndicator color={C.onGold} /> : <Text style={styles.primaryText}>{t('admin.gate.continue')}</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => { setBackup((b) => !b); setValue(''); }} style={styles.linkBtn}
                        testID={`${testID}-switch`}>
        <Text style={styles.link}>{backup ? t('admin.gate.useApp') : t('admin.gate.useBackup')}</Text>
      </TouchableOpacity>
    </View>
  );
};

export default function AdminGate({ navigation, children }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState('checking');   // checking | setup | code | open | error
  const [setup, setSetup] = useState(null);         // { secret, otpauth_url }
  const [backupCodes, setBackupCodes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ask, setAsk] = useState(null);             // { reason, resolve } while the code box is over a screen
  const live = useRef(true);

  const check = useCallback(async () => {
    setPhase('checking');
    setError('');
    await restoreAdminSession();
    try {
      const me = await fetchAdminSecurity();
      if (!live.current) return;
      if (!me.two_factor_required) setPhase('open');
      else if (!me.two_factor_enabled) setPhase('setup');
      else setPhase(me.session_valid ? 'open' : 'code');
    } catch (e) {
      if (!live.current) return;
      if (e?.status === 403 || e?.status === 401) {
        // Not an admin, or no longer one: nothing in here is theirs.
        await clearAdminSession();
        navigation.replace('Home');
        return;
      }
      setPhase('error');
    }
  }, [navigation]);

  useEffect(() => {
    live.current = true;
    check();
    // While inside, the server can ask for a code: the code box opens.
    setCodeAsker((reason) => new Promise((resolve) => setAsk({ reason, resolve })));
    return () => { live.current = false; setCodeAsker(null); };
  }, [check]);

  const verify = async (entry, after) => {
    setBusy(true);
    setError('');
    try {
      const res = await verifyAdminCode(entry);
      if (res?.admin_session) await setAdminSession(res.admin_session, res.expires_at);
      after?.(true);
      return true;
    } catch (e) {
      setError(e?.status === 429 ? t('admin.gate.tooMany') : errorOf(e, t('admin.gate.wrong')));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const begin = async () => {
    setBusy(true);
    setError('');
    try {
      setSetup(await startAdminTwoFactor());
    } catch (e) {
      setError(errorOf(e, t('admin.gate.failed')));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async ({ code }) => {
    setBusy(true);
    setError('');
    try {
      const res = await confirmAdminTwoFactor(code);
      await setAdminSession(res.admin_session, res.expires_at);
      setBackupCodes(res.backup_codes || []);
    } catch (e) {
      setError(errorOf(e, t('admin.gate.wrong')));
    } finally {
      setBusy(false);
    }
  };

  const copy = (text) => clipboard()?.setStringAsync?.(text).catch(() => {});

  // The code box over a screen, when the server wants a code.
  const askBox = (
    <Modal visible={!!ask} transparent animationType="fade" onRequestClose={() => { ask?.resolve(false); setAsk(null); }}>
      <View style={styles.backdrop}>
        <View style={styles.card} testID="admin-reauth">
          <Ionicons name="shield-checkmark-outline" size={30} color={C.gold} />
          <Text style={styles.title}>
            {ask?.reason === 'reauth_required' ? t('admin.gate.confirmTitle') : t('admin.gate.codeTitle')}
          </Text>
          <Text style={styles.body}>
            {ask?.reason === 'reauth_required' ? t('admin.gate.confirmBody') : t('admin.gate.codeBody')}
          </Text>
          <CodeBox t={t} busy={busy} error={error} testID="admin-reauth-code"
                   onSubmit={(entry) => verify(entry, (ok) => { ask?.resolve(ok); setAsk(null); })} />
          <TouchableOpacity onPress={() => { ask?.resolve(false); setAsk(null); setError(''); }} style={styles.linkBtn}>
            <Text style={styles.muted}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  if (phase === 'open') {
    return <>{children}{askBox}</>;
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" testID={`admin-gate-${phase}`}>
      {phase === 'checking' && <ActivityIndicator size="large" color={C.gold} style={{ marginTop: 80 }} />}

      {phase === 'error' && (
        <View style={styles.card}>
          <Ionicons name="cloud-offline-outline" size={30} color={C.muted} />
          <Text style={styles.body}>{t('admin.gate.offline')}</Text>
          <TouchableOpacity style={styles.primary} onPress={check}><Text style={styles.primaryText}>{t('common.retry')}</Text></TouchableOpacity>
        </View>
      )}

      {phase === 'code' && (
        <View style={styles.card}>
          <Ionicons name="shield-checkmark-outline" size={34} color={C.gold} />
          <Text style={styles.title}>{t('admin.gate.codeTitle')}</Text>
          <Text style={styles.body}>{t('admin.gate.codeBody')}</Text>
          <CodeBox t={t} busy={busy} error={error} onSubmit={(entry) => verify(entry, () => setPhase('open'))} />
        </View>
      )}

      {phase === 'setup' && !backupCodes && (
        <View style={styles.card}>
          <Ionicons name="lock-closed-outline" size={34} color={C.gold} />
          <Text style={styles.title}>{t('admin.gate.setupTitle')}</Text>
          <Text style={styles.body}>{t('admin.gate.setupBody')}</Text>
          {!setup ? (
            <>
              {!!error && <Text style={styles.error}>{error}</Text>}
              <TouchableOpacity style={styles.primary} onPress={begin} disabled={busy} testID="admin-setup-start">
                {busy ? <ActivityIndicator color={C.onGold} /> : <Text style={styles.primaryText}>{t('admin.gate.setupStart')}</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.step}>{t('admin.gate.step1')}</Text>
              <TouchableOpacity style={styles.secondary} onPress={() => Linking.openURL(setup.otpauth_url).catch(() => {})}
                                testID="admin-setup-open">
                <Ionicons name="open-outline" size={16} color={C.gold} />
                <Text style={styles.secondaryText}>{t('admin.gate.openApp')}</Text>
              </TouchableOpacity>
              <Text style={styles.muted}>{t('admin.gate.orKey')}</Text>
              <TouchableOpacity style={styles.keyBox} onPress={() => copy(setup.secret)} testID="admin-setup-key">
                <Text style={styles.key} selectable>{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</Text>
                <Ionicons name="copy-outline" size={16} color={C.muted} />
              </TouchableOpacity>
              <Text style={styles.step}>{t('admin.gate.step2')}</Text>
              <CodeBox t={t} busy={busy} error={error} onSubmit={confirm} testID="admin-setup-code" />
            </>
          )}
        </View>
      )}

      {phase === 'setup' && !!backupCodes && (
        <View style={styles.card} testID="admin-backup-codes">
          <Ionicons name="key-outline" size={34} color={C.gold} />
          <Text style={styles.title}>{t('admin.gate.backupTitle')}</Text>
          <Text style={styles.body}>{t('admin.gate.backupBody')}</Text>
          <View style={styles.codes}>
            {backupCodes.map((c) => <Text key={c} style={styles.codeItem} selectable>{c}</Text>)}
          </View>
          <TouchableOpacity style={styles.secondary} onPress={() => copy(backupCodes.join('\n'))}>
            <Ionicons name="copy-outline" size={16} color={C.gold} />
            <Text style={styles.secondaryText}>{t('admin.gate.copyCodes')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primary} onPress={() => { setBackupCodes(null); setPhase('open'); }}
                            testID="admin-backup-done">
            <Text style={styles.primaryText}>{t('admin.gate.saved')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingTop: 28, alignItems: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 20 },
  card: {
    width: '100%', maxWidth: 440, alignSelf: 'center', alignItems: 'center', gap: 12,
    backgroundColor: C.card, borderRadius: 20, padding: 22, borderWidth: 1, borderColor: C.border,
  },
  title: { color: C.text, fontSize: 19, fontWeight: '800', textAlign: 'center' },
  body: { color: C.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  step: { color: C.text, fontSize: 14, fontWeight: '700', alignSelf: 'flex-start', marginTop: 4 },
  muted: { color: C.muted, fontSize: 13 },
  error: { color: C.danger, fontSize: 13, textAlign: 'center' },
  codeWrap: { width: '100%', gap: 10, alignItems: 'stretch' },
  codeInput: {
    height: 56, borderRadius: 14, backgroundColor: C.field, borderWidth: 1, borderColor: C.border,
    color: C.text, fontSize: 24, fontWeight: '800', letterSpacing: 8, textAlign: 'center',
  },
  primary: {
    width: '100%', height: 50, borderRadius: 14, backgroundColor: C.gold, alignItems: 'center', justifyContent: 'center',
  },
  primaryOff: { opacity: 0.6 },
  primaryText: { color: C.onGold, fontSize: 15.5, fontWeight: '800' },
  secondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: 46,
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,196,107,0.45)',
  },
  secondaryText: { color: C.gold, fontSize: 14.5, fontWeight: '700' },
  linkBtn: { paddingVertical: 8, alignSelf: 'center' },
  link: { color: C.gold, fontSize: 13.5, fontWeight: '700' },
  keyBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%', padding: 12, borderRadius: 12,
    backgroundColor: C.field, borderWidth: 1, borderColor: C.border,
  },
  key: { flex: 1, color: C.text, fontSize: 15, fontWeight: '700', letterSpacing: 1 },
  codes: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  codeItem: {
    color: C.text, fontSize: 15, fontWeight: '700', letterSpacing: 1, paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 8, backgroundColor: C.field, overflow: 'hidden',
  },
});

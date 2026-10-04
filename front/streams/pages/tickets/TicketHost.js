/**
 * The door to opening an event: is there an organiser account on this phone?
 *
 * - A session the server still accepts → straight on to creating the event.
 * - None, or one that has ended → create an account, or log in to one.
 * - The server can't be reached → say so, with Retry (creating an event needs
 *   the server anyway).
 *
 * Organiser accounts are the ticketing server's own, apart from Streams; the
 * form is prefilled from the Streams account so it is mostly a password.
 * A sign-up with an email that already has an account turns into a log in.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView, KeyboardAvoidingView, Platform, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../../context/I18nContext';
import { useAuth } from '../../context/useAuth';
import { fetchMe, signUp, logIn, isEmailTaken } from '../../services/ticketsOrganiser';
import { normalizeKePhone } from '../../services/tickets';
import { T, F, tap, Kicker, GoldButton, Notice } from '../../components/tickets/TicketKit';
import { ticketErrorText } from './ticketText';

const PASSWORD_MIN = 8;

const Field = ({ label, error, children }) => (
  <View>
    <Text style={styles.label}>{label}</Text>
    <View style={[styles.field, !!error && styles.fieldBad]}>{children}</View>
    {!!error && <Text style={styles.bad}>{error}</Text>}
  </View>
);

const TicketHost = ({ navigation, route }) => {
  const { t } = useI18n();
  const { currentUser } = useAuth() || {};

  const [phase, setPhase] = useState('checking');   // checking | form | offline
  const [checkError, setCheckError] = useState(null);
  // Where they were going: making an event (Open event), or My events.
  const next = route?.params?.next || 'TicketCreateEvent';
  const proceed = useCallback(() => navigation.replace(next), [navigation, next]);

  const check = useCallback(async () => {
    setPhase('checking');
    try {
      const me = await fetchMe();
      if (me) proceed();
      else setPhase('form');
    } catch (err) {
      setCheckError(err);
      setPhase('offline');
    }
  }, [proceed]);
  useEffect(() => { check(); }, [check]);

  const [mode, setMode] = useState('signup');        // signup | login
  const [name, setName] = useState(currentUser?.username || '');
  const [email, setEmail] = useState(currentUser?.email || '');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const [tried, setTried] = useState(false);

  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());
  const phoneOk = !phone.trim() || !!normalizeKePhone(phone);
  const passwordOk = mode === 'login' ? password.length > 0 : password.length >= PASSWORD_MIN;
  const local = tried ? {
    email: !emailOk ? t('tix.host.err.email') : null,
    phone: !phoneOk ? t('tix.phoneInvalid') : null,
    password: !passwordOk ? (mode === 'login' ? t('tix.host.err.passwordEmpty') : t('tix.host.err.passwordShort', { n: PASSWORD_MIN })) : null,
  } : {};
  const errOf = (k) => fields[k] || local[k] || '';

  const switchMode = (next) => {
    tap();
    setMode(next);
    setFields({});
    setError('');
    setNotice('');
    setTried(false);
  };

  const submit = async () => {
    setTried(true);
    if (!emailOk || !phoneOk || !passwordOk || busy) return;
    setBusy(true);
    setError('');
    setFields({});
    try {
      if (mode === 'signup') await signUp({ email, password, displayName: name, phone });
      else if (!(await logIn({ email, password }))) throw new Error('');
      proceed();
    } catch (err) {
      setBusy(false);
      if (mode === 'signup' && isEmailTaken(err)) {
        // Already an organiser: the same details, as a log in.
        setMode('login');
        setNotice(t('tix.host.emailTaken'));
        return;
      }
      const f = err?.fields || {};
      setFields(f);
      const shownBelow = !!err?.message && Object.values(f).includes(err.message);
      setError(shownBelow ? '' : mode === 'login' && err?.status === 401
        ? t('tix.host.wrongPassword')
        : ticketErrorText(err, t));
    }
  };

  if (phase === 'checking') {
    return (
      <View style={[styles.root, styles.centre]}>
        <ActivityIndicator color={T.gold} size="large" />
        <Text style={styles.checking}>{t('tix.host.checking')}</Text>
      </View>
    );
  }
  if (phase === 'offline') {
    return (
      <View style={[styles.root, styles.centre]}>
        <Notice title={ticketErrorText(checkError, t)} action={t('common.retry')} onAction={check} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Kicker>{t('tix.host.kicker')}</Kicker>
          <Text style={styles.heading} accessibilityRole="header">
            {mode === 'signup' ? t('tix.host.signupTitle') : t('tix.host.loginTitle')}
          </Text>
          <Text style={styles.body}>{t('tix.host.why')}</Text>

          {/* Two doors, side by side: the one in use filled. */}
          <View style={styles.tabs} accessibilityRole="tablist">
            {['signup', 'login'].map((m) => (
              <TouchableOpacity
                key={m}
                onPress={() => mode !== m && switchMode(m)}
                style={[styles.tab, mode === m && styles.tabOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === m }}
                testID={`host-mode-${m}`}
              >
                <Text style={[styles.tabText, mode === m && styles.tabTextOn]}>
                  {m === 'signup' ? t('tix.host.signup') : t('tix.host.login')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {!!notice && (
            <View style={styles.notice} accessibilityLiveRegion="polite">
              <Ionicons name="information-circle" size={18} color={T.champagne} />
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          )}

          {mode === 'signup' && (
            <Field label={t('tix.host.name')} error={errOf('display_name')}>
              <TextInput value={name} onChangeText={setName} style={styles.input} autoCapitalize="words"
                         placeholder={t('tix.host.namePlaceholder')} placeholderTextColor={T.faint}
                         maxLength={120} accessibilityLabel={t('tix.host.name')} testID="host-name" />
            </Field>
          )}
          <Field label={t('tix.host.email')} error={errOf('email')}>
            <TextInput value={email} onChangeText={(v) => { setEmail(v); setFields((f) => ({ ...f, email: undefined })); }}
                       style={styles.input} autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
                       autoComplete="email" textContentType="emailAddress" maxLength={254}
                       placeholder="you@example.com" placeholderTextColor={T.faint}
                       accessibilityLabel={t('tix.host.email')} testID="host-email" />
          </Field>
          {mode === 'signup' && (
            <Field label={t('tix.host.phone')} error={errOf('phone')}>
              <TextInput value={phone} onChangeText={setPhone} style={styles.input} keyboardType="phone-pad"
                         autoComplete="tel" maxLength={15} placeholder="0712 345 678" placeholderTextColor={T.faint}
                         accessibilityLabel={t('tix.host.phone')} testID="host-phone" />
            </Field>
          )}
          <Field label={t('tix.host.password')} error={errOf('password')}>
            <TextInput value={password} onChangeText={setPassword} style={styles.input} secureTextEntry={!reveal}
                       autoCapitalize="none" autoCorrect={false}
                       textContentType={mode === 'signup' ? 'newPassword' : 'password'}
                       autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                       accessibilityLabel={t('tix.host.password')} testID="host-password" />
            <TouchableOpacity onPress={() => setReveal((r) => !r)} hitSlop={10} accessibilityRole="button"
                              accessibilityLabel={reveal ? t('tix.host.hide') : t('tix.host.show')}>
              <Ionicons name={reveal ? 'eye-off-outline' : 'eye-outline'} size={19} color={T.faint} />
            </TouchableOpacity>
          </Field>
          {mode === 'signup' && !errOf('password') && (
            <Text style={styles.hint}>{t('tix.host.passwordHint', { n: PASSWORD_MIN })}</Text>
          )}

          {!!error && (
            <View style={styles.error} accessibilityLiveRegion="polite">
              <Ionicons name="alert-circle" size={18} color={T.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </ScrollView>
        <View style={styles.bar}>
          <GoldButton
            label={mode === 'signup' ? t('tix.host.createAccount') : t('tix.host.login')}
            onPress={submit}
            busy={busy}
            testID="host-submit"
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  centre: { alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  checking: { fontFamily: F.uiSemi, fontSize: 14, color: T.muted, marginTop: 16 },
  scroll: { padding: 20, paddingTop: 22, width: '100%', maxWidth: 620, alignSelf: 'center' },
  heading: { fontFamily: F.display, fontSize: 32, lineHeight: 36, color: T.ivory, marginTop: 6 },
  body: { fontFamily: F.ui, fontSize: 14.5, lineHeight: 22, color: T.muted, marginTop: 10 },

  tabs: {
    flexDirection: 'row', marginTop: 22, padding: 4, borderRadius: 18,
    backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.line,
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 14, alignItems: 'center' },
  tabOn: { backgroundColor: T.champagne },
  tabText: { fontFamily: F.uiBold, fontSize: 14, color: T.muted },
  tabTextOn: { color: T.paperInk },

  notice: {
    flexDirection: 'row', gap: 10, marginTop: 18, padding: 14, borderRadius: 14,
    backgroundColor: 'rgba(232,212,170,0.08)', borderWidth: StyleSheet.hairlineWidth, borderColor: T.lineStrong,
  },
  noticeText: { flex: 1, fontFamily: F.uiSemi, fontSize: 14, lineHeight: 20, color: T.ivory },

  label: { fontFamily: F.uiBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: T.muted, marginTop: 22, marginBottom: 8 },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10, height: 54, borderRadius: 16, paddingHorizontal: 16,
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.line,
  },
  fieldBad: { borderColor: T.danger },
  input: { flex: 1, fontFamily: F.uiSemi, fontSize: 16, color: T.ivory, paddingVertical: 0 },
  bad: { fontFamily: F.ui, fontSize: 13, color: T.danger, marginTop: 8, marginLeft: 4 },
  hint: { fontFamily: F.ui, fontSize: 13, color: T.faint, marginTop: 8, marginLeft: 4 },

  error: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 22, padding: 14, borderRadius: 14,
    backgroundColor: 'rgba(240,144,127,0.10)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(240,144,127,0.4)',
  },
  errorText: { flex: 1, fontFamily: F.uiSemi, fontSize: 14, lineHeight: 20, color: T.ivory },
  bar: {
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10,
    backgroundColor: T.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.lineStrong,
  },
});

export default TicketHost;

/**
 * Forgot the organiser password: a six-digit code, then a new password.
 *
 * 1. Their email → the server mails a code (15 minutes, five tries). It says
 *    the same whether or not the email has an account, and so does this.
 * 2. The code and a new password → signed in, and on to where they were
 *    going (My events, or making an event).
 *
 * No email reaching them? A Streams admin can send one, or read them a code
 * over the phone once they know who is calling; it goes in the same box.
 */
import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import KeyboardLift from '../../components/tickets/KeyboardLift';
import { useI18n } from '../../context/I18nContext';
import { requestPasswordReset, confirmPasswordReset } from '../../services/ticketsOrganiser';
import { T, F, tap, Kicker, GoldButton } from '../../components/tickets/TicketKit';
import { ticketErrorText } from './ticketText';
import { PASSWORD_MIN } from './TicketHost';

export const isResetCode = (s) => /^\d{6}$/.test(String(s || '').trim());

const Field = ({ label, error, children }) => (
  <View>
    <Text style={styles.label}>{label}</Text>
    <View style={[styles.field, !!error && styles.fieldBad]}>{children}</View>
    {!!error && <Text style={styles.bad}>{error}</Text>}
  </View>
);

const TicketPasswordReset = ({ navigation, route }) => {
  const kbScroll = useRef(null);
  const { t } = useI18n();
  const next = route?.params?.next || 'TicketMyEvents';

  const [step, setStep] = useState('email');          // email | code
  const [email, setEmail] = useState(route?.params?.email || '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());
  const codeOk = isResetCode(code);
  const passwordOk = password.length >= PASSWORD_MIN;

  const send = async () => {
    setTried(true);
    if (!emailOk || busy) return;
    setBusy(true);
    setError('');
    try {
      await requestPasswordReset(email);
      setSent(true);
      setTried(false);
      setStep('code');
    } catch (err) {
      setError(ticketErrorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setTried(true);
    if (!emailOk || !codeOk || !passwordOk || busy) return;
    setBusy(true);
    setError('');
    try {
      await confirmPasswordReset({ email, code, newPassword: password });
      navigation.replace(next);
    } catch (err) {
      setBusy(false);
      // The server's own words for a weak password; one answer for any bad code.
      setError(err?.fields?.new_password || (err?.status === 400 ? (err?.message || t('tix.reset.badCode')) : ticketErrorText(err, t)));
    }
  };

  const goTo = (s) => { tap(); setStep(s); setTried(false); setError(''); };

  return (
    <SafeAreaView style={styles.root} edges={['bottom', 'left', 'right']}>
      <KeyboardLift scrollRef={kbScroll}>
        <ScrollView ref={kbScroll} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Kicker>{t('tix.host.kicker')}</Kicker>
          <Text style={styles.heading} accessibilityRole="header">{t('tix.reset.title')}</Text>
          <Text style={styles.body}>{step === 'email' ? t('tix.reset.emailBody') : t('tix.reset.codeBody')}</Text>

          <Field label={t('tix.host.email')} error={tried && !emailOk ? t('tix.host.err.email') : ''}>
            <TextInput value={email} onChangeText={setEmail} style={styles.input} autoCapitalize="none"
                       autoCorrect={false} keyboardType="email-address" autoComplete="email"
                       textContentType="emailAddress" maxLength={254} editable={step === 'email'}
                       placeholder="you@example.com" placeholderTextColor={T.faint}
                       accessibilityLabel={t('tix.host.email')} testID="reset-email" />
          </Field>

          {step === 'code' && (
            <>
              {sent && (
                <View style={styles.notice} accessibilityLiveRegion="polite">
                  <Ionicons name="mail-outline" size={18} color={T.champagne} />
                  <Text style={styles.noticeText}>{t('tix.reset.sent')}</Text>
                </View>
              )}
              <Field label={t('tix.reset.code')} error={tried && !codeOk ? t('tix.reset.codeInvalid') : ''}>
                <TextInput value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                           style={[styles.input, styles.mono]} keyboardType="number-pad" autoComplete="one-time-code"
                           textContentType="oneTimeCode" maxLength={6} placeholder="123456"
                           placeholderTextColor={T.faint} accessibilityLabel={t('tix.reset.code')} testID="reset-code" />
              </Field>
              <Field label={t('tix.reset.newPassword')}
                     error={tried && !passwordOk ? t('tix.host.err.passwordShort', { n: PASSWORD_MIN }) : ''}>
                <TextInput value={password} onChangeText={setPassword} style={styles.input} secureTextEntry={!reveal}
                           autoCapitalize="none" autoCorrect={false} textContentType="newPassword"
                           autoComplete="new-password" accessibilityLabel={t('tix.reset.newPassword')}
                           testID="reset-password" />
                <TouchableOpacity onPress={() => setReveal((r) => !r)} hitSlop={10} accessibilityRole="button"
                                  accessibilityLabel={reveal ? t('tix.host.hide') : t('tix.host.show')}>
                  <Ionicons name={reveal ? 'eye-off-outline' : 'eye-outline'} size={19} color={T.faint} />
                </TouchableOpacity>
              </Field>
              <TouchableOpacity onPress={() => goTo('email')} style={styles.link} accessibilityRole="button"
                                testID="reset-again">
                <Text style={styles.linkText}>{t('tix.reset.again')}</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'email' && (
            <TouchableOpacity onPress={() => goTo('code')} style={styles.link} accessibilityRole="button"
                              testID="reset-have-code">
              <Text style={styles.linkText}>{t('tix.reset.haveCode')}</Text>
            </TouchableOpacity>
          )}

          {!!error && (
            <View style={styles.error} accessibilityLiveRegion="polite">
              <Ionicons name="alert-circle" size={18} color={T.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.help}>
            <Ionicons name="shield-checkmark-outline" size={18} color={T.muted} />
            <Text style={styles.helpText}>{t('tix.reset.admin')}</Text>
          </View>
        </ScrollView>
        <View style={styles.bar}>
          <GoldButton
            label={step === 'email' ? t('tix.reset.send') : t('tix.reset.save')}
            onPress={step === 'email' ? send : confirm}
            busy={busy}
            testID="reset-submit"
          />
        </View>
      </KeyboardLift>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  scroll: { padding: 20, paddingTop: 22, width: '100%', maxWidth: 620, alignSelf: 'center' },
  heading: { fontFamily: F.display, fontSize: 32, lineHeight: 36, color: T.ivory, marginTop: 6 },
  body: { fontFamily: F.ui, fontSize: 14.5, lineHeight: 22, color: T.muted, marginTop: 10 },
  label: { fontFamily: F.uiBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: T.muted, marginTop: 22, marginBottom: 8 },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10, height: 54, borderRadius: 16, paddingHorizontal: 16,
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.line,
  },
  fieldBad: { borderColor: T.danger },
  input: { flex: 1, fontFamily: F.uiSemi, fontSize: 16, color: T.ivory, paddingVertical: 0 },
  mono: { letterSpacing: 6, fontSize: 20 },
  bad: { fontFamily: F.ui, fontSize: 13, color: T.danger, marginTop: 8, marginLeft: 4 },
  notice: {
    flexDirection: 'row', gap: 10, marginTop: 18, padding: 14, borderRadius: 14,
    backgroundColor: 'rgba(232,212,170,0.08)', borderWidth: StyleSheet.hairlineWidth, borderColor: T.lineStrong,
  },
  noticeText: { flex: 1, fontFamily: F.uiSemi, fontSize: 14, lineHeight: 20, color: T.ivory },
  link: { alignSelf: 'flex-start', paddingVertical: 12, paddingHorizontal: 4, marginTop: 4 },
  linkText: { fontFamily: F.uiBold, fontSize: 13.5, color: T.champagne },
  error: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 18, padding: 14, borderRadius: 14,
    backgroundColor: 'rgba(240,144,127,0.10)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(240,144,127,0.4)',
  },
  errorText: { flex: 1, fontFamily: F.uiSemi, fontSize: 14, lineHeight: 20, color: T.ivory },
  help: { flexDirection: 'row', gap: 10, marginTop: 28, paddingHorizontal: 4 },
  helpText: { flex: 1, fontFamily: F.ui, fontSize: 13, lineHeight: 19, color: T.muted },
  bar: {
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10,
    backgroundColor: T.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.lineStrong,
  },
});

export default TicketPasswordReset;

// "I can't get into my account at all": for someone whose password — and
// perhaps email — someone else changed, so "Forgot password" cannot reach
// them. They tell us which account and how to reach them now; an admin checks
// it is theirs and moves the account back (Admin → Security centre). The
// answer never says whether an account matched.
import React, { useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { requestAccountRecovery } from '../services/api';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import KeyboardLift from '../components/tickets/KeyboardLift';

const DETAILS_MIN = 20;

export default function RecoveryRequest({ navigation, route }) {
  const { t } = useI18n();
  const [account, setAccount] = useState(route?.params?.account || '');
  const [contact, setContact] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const scroll = useRef(null);

  const ready = account.trim() && contact.includes('@') && details.trim().length >= DETAILS_MIN;

  const send = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      await requestAccountRecovery(account.trim(), contact.trim(), details.trim());
      setSent(true);
    } catch (e) {
      const code = (e?.response?.data || e?.data || {}).code;
      setError(t(code === 'bad_email' ? 'recovery.badEmail' : code === 'too_short' ? 'recovery.tooShort'
        : e?.response?.status === 429 ? 'recovery.tooMany' : 'recovery.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.flex} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardLift scrollRef={scroll} style={styles.flex}>
        <ScrollView ref={scroll} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()} hitSlop={10}
            accessibilityRole="button" accessibilityLabel={t('common.back')}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.iconWrap}>
            <Ionicons name="shield-checkmark-outline" size={48} color={colors.primary} />
          </View>
          <Text style={styles.title}>{t('recovery.title')}</Text>

          {sent ? (
            <>
              <Text style={styles.subtitle} testID="recovery-sent">{t('recovery.sent')}</Text>
              <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('Login')}>
                <Text style={styles.buttonText}>{t('forgot.backToLogin')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.subtitle}>{t('recovery.intro')}</Text>
              <Text style={styles.label}>{t('recovery.account')}</Text>
              <TextInput style={styles.input} value={account} onChangeText={setAccount} autoCapitalize="none"
                autoCorrect={false} placeholder={t('recovery.accountPlaceholder')} placeholderTextColor={colors.placeholder}
                testID="recovery-account" />
              <Text style={styles.label}>{t('recovery.contact')}</Text>
              <TextInput style={styles.input} value={contact} onChangeText={setContact} autoCapitalize="none"
                autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" autoComplete="email"
                placeholder={t('forgot.emailPlaceholder')} placeholderTextColor={colors.placeholder}
                testID="recovery-contact" />
              <Text style={styles.label}>{t('recovery.details')}</Text>
              <TextInput style={[styles.input, styles.multi]} value={details} onChangeText={setDetails} multiline
                maxLength={2000} textAlignVertical="top" placeholder={t('recovery.detailsPlaceholder')}
                placeholderTextColor={colors.placeholder} testID="recovery-details" />
              {!!error && <Text style={styles.error}>{error}</Text>}
              <TouchableOpacity style={[styles.button, (!ready || busy) && styles.disabled]} onPress={send}
                disabled={!ready || busy} testID="recovery-send">
                {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>{t('recovery.send')}</Text>}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardLift>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, alignItems: 'stretch' },
  back: { alignSelf: 'flex-start', marginBottom: spacing.lg },
  iconWrap: {
    width: 84, height: 84, borderRadius: 42, alignSelf: 'center', alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card, marginBottom: spacing.md,
  },
  title: { ...typography.h1, color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.sm },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 24, marginBottom: spacing.lg },
  label: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.xs, marginTop: spacing.sm },
  input: {
    minHeight: 50, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.textPrimary, fontSize: 16,
    backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border,
  },
  multi: { minHeight: 120, paddingTop: spacing.sm },
  error: { color: colors.error, fontSize: 14, marginTop: spacing.sm, textAlign: 'center' },
  button: {
    marginTop: spacing.lg, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  disabled: { opacity: 0.5 },
  buttonText: { ...typography.button, color: colors.white },
});

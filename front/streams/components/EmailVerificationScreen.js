import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { apiRequest } from '../services/api';
import { useAuth } from '../context/useAuth';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const CODE_LENGTH = 6;

const verifyEmail = (code) => apiRequest('post', '/auth/verify-email/', { code });
const resendCode = () => apiRequest('post', '/auth/resend-verification/');

const EmailVerificationScreen = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const route = useRoute();
  const { updateUser, logout } = useAuth();
  const email = route.params?.email ?? '';

  const handleExit = async () => {
    await logout();
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  };

  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputs = useRef([]);
  const cooldownRef = useRef(null);

  const startCooldown = useCallback(() => {
    setResendCooldown(60);
    cooldownRef.current = setInterval(() => {
      setResendCooldown(prev => {
        if (prev <= 1) { clearInterval(cooldownRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const handleCodeChange = (text, index) => {
    const digit = text.replace(/\D/g, '').slice(-1);
    const next = [...code];
    next[index] = digit;
    setCode(next);
    if (digit && index < CODE_LENGTH - 1) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (e, index) => {
    if (e.nativeEvent.key === 'Backspace' && !code[index] && index > 0) {
      inputs.current[index - 1]?.focus();
      const next = [...code];
      next[index - 1] = '';
      setCode(next);
    }
  };

  const handleVerify = async () => {
    const fullCode = code.join('');
    if (fullCode.length < CODE_LENGTH) {
      Alert.alert(t('verify.incompleteTitle'), t('verify.incompleteBody'));
      return;
    }
    setLoading(true);
    try {
      await verifyEmail(fullCode);
      // Refresh shared auth state, then route forward based on profile presence.
      const status = await updateUser();
      const target = status?.hasProfile ? 'Home' : 'CreateProfile';
      navigation.reset({ index: 0, routes: [{ name: target }] });
    } catch (err) {
      const msg = err.response?.data?.error ?? t('verify.invalidCode');
      Alert.alert(t('verify.failedTitle'), msg);
      setCode(['', '', '', '', '', '']);
      inputs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || resending) return;
    setResending(true);
    try {
      await resendCode();
      Alert.alert(t('verify.sentTitle'), t('verify.sentBody'));
      startCooldown();
    } catch {
      Alert.alert(t('common.error'), t('verify.resendFailed'));
    } finally {
      setResending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.backBtn} onPress={handleExit}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>

        <View style={styles.iconWrap}>
          <Ionicons name="mail-open-outline" size={56} color={colors.primary} />
        </View>

        <Text style={styles.title}>{t('verify.checkEmail')}</Text>
        <Text style={styles.subtitle}>
          We sent a 6-digit code to{'\n'}
          <Text style={styles.email}>{email || 'your email address'}</Text>
        </Text>

        {/* OTP input boxes */}
        <View style={styles.codeRow}>
          {code.map((digit, i) => (
            <TextInput
              key={i}
              ref={r => (inputs.current[i] = r)}
              style={[styles.codeBox, digit && styles.codeBoxFilled]}
              value={digit}
              onChangeText={t => handleCodeChange(t, i)}
              onKeyPress={e => handleKeyPress(e, i)}
              keyboardType="number-pad"
              maxLength={1}
              selectTextOnFocus
              caretHidden
            />
          ))}
        </View>

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleVerify}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading
            ? <ActivityIndicator color={colors.white} />
            : <Text style={styles.buttonText}>{t('verify.title')}</Text>
          }
        </TouchableOpacity>

        <View style={styles.resendRow}>
          <Text style={styles.resendLabel}>{t('verify.noCode')}</Text>
          <TouchableOpacity onPress={handleResend} disabled={resendCooldown > 0 || resending}>
            {resending
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Text style={[styles.resendLink, resendCooldown > 0 && styles.resendDisabled]}>
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend'}
                </Text>
            }
          </TouchableOpacity>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    backgroundColor: colors.bg,
  },
  backBtn: { alignSelf: 'flex-start', marginBottom: spacing.xl },
  iconWrap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.card,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
    ...shadows.md,
  },
  title: { ...typography.h1, color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.sm },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 24 },
  email: { color: colors.primary, fontWeight: '600' },
  codeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginVertical: spacing.xl,
  },
  codeBox: {
    width: 46,
    height: 56,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  codeBoxFilled: { borderColor: colors.primary },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    height: 52,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.md,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { ...typography.button, color: colors.white },
  resendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  resendLabel: { ...typography.body, color: colors.textSecondary },
  resendLink: { ...typography.body, color: colors.primary, fontWeight: '600' },
  resendDisabled: { color: colors.textMuted },
  skipBtn: { marginTop: spacing.xl },
  skipText: { ...typography.label, color: colors.textMuted },
});

export default EmailVerificationScreen;

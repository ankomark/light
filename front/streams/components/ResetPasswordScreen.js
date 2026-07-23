import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { resetPassword, forgotPassword } from '../services/api';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const ResetPasswordScreen = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const route = useRoute();
  const initialEmail = route.params?.email || '';

  const [email] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');

  const handleReset = async () => {
    if (!code.trim() || !password || !confirm) {
      setError(t('reset.fillAll'));
      return;
    }
    if (password.length < 8) {
      setError(t('reset.tooShort'));
      return;
    }
    if (password !== confirm) {
      setError(t('reset.mismatch'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      await resetPassword(email, code.trim(), password);
      Alert.alert(t('market.success'), t('reset.doneBody'), [
        { text: 'Log In', onPress: () => navigation.reset({ index: 0, routes: [{ name: 'Login' }] }) },
      ]);
    } catch (err) {
      setError(err.response?.data?.error || t('verify.invalidCode'));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email) return;
    setResending(true);
    try {
      await forgotPassword(email);
      Alert.alert(t('reset.codeSentTitle'), t('reset.codeSentBody', { email }));
    } catch {
      Alert.alert(t('common.error'), t('reset.resendFailed'));
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
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>

        <View style={styles.iconWrap}>
          <Ionicons name="key-outline" size={52} color={colors.primary} />
        </View>

        <Text style={styles.title}>{t('reset.enterCode')}</Text>
        <Text style={styles.subtitle}>
          Enter the 6-digit code sent to{'\n'}
          <Text style={styles.highlight}>{email || 'your email'}</Text> and choose a new password.
        </Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('reset.code')}</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.placeholder} style={styles.icon} />
            <TextInput
              style={styles.input}
              placeholder={t('reset.codePlaceholder')}
              placeholderTextColor={colors.placeholder}
              value={code}
              onChangeText={v => { setCode(v.replace(/[^0-9]/g, '')); setError(''); }}
              keyboardType="number-pad"
              maxLength={6}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('reset.newPassword')}</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.placeholder} style={styles.icon} />
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder={t('reset.newPasswordPlaceholder')}
              placeholderTextColor={colors.placeholder}
              value={password}
              onChangeText={v => { setPassword(v); setError(''); }}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity onPress={() => setShowPassword(p => !p)} style={styles.eyeBtn}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.placeholder} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('reset.confirmPassword')}</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.placeholder} style={styles.icon} />
            <TextInput
              style={styles.input}
              placeholder={t('reset.confirmPlaceholder')}
              placeholderTextColor={colors.placeholder}
              value={confirm}
              onChangeText={v => { setConfirm(v); setError(''); }}
              secureTextEntry={!showPassword}
            />
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleReset}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading
            ? <ActivityIndicator color={colors.white} />
            : <Text style={styles.buttonText}>{t('reset.title')}</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity style={styles.resendRow} onPress={handleResend} disabled={resending}>
          <Text style={styles.resendText}>
            {resending ? 'Sending…' : "Didn't get a code? Resend"}
          </Text>
        </TouchableOpacity>
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
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: colors.card,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  title: { ...typography.h1, color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.sm },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 24, marginBottom: spacing.xl },
  highlight: { color: colors.primary, fontWeight: '600' },
  inputGroup: { width: '100%', marginBottom: spacing.md },
  label: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.xs },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
  },
  icon: { marginRight: spacing.xs },
  input: { flex: 1, height: 50, color: colors.textPrimary, fontSize: 16 },
  eyeBtn: { padding: spacing.xs },
  error: { color: colors.error, fontSize: 14, marginBottom: spacing.sm, textAlign: 'center' },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    height: 52,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.sm,
    ...shadows.md,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { ...typography.button, color: colors.white },
  resendRow: { marginTop: spacing.lg },
  resendText: { ...typography.body, color: colors.primary, fontWeight: '600' },
});

export default ResetPasswordScreen;

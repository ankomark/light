import React, { useState, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/useAuth';
import { useTheme } from '../context/ThemeContext';
import { useI18n } from '../context/I18nContext';
import { typography, spacing, radius, shadows } from '../constants/theme';

const LoginPage = () => {
  const [formData, setFormData] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigation = useNavigation();
  const { login } = useAuth();
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const handleChange = (name, value) => {
    setFormData(prev => ({ ...prev, [name]: value }));
    if (error) setError('');
  };

  const handleSubmit = async () => {
    if (!formData.username.trim() || !formData.password) {
      setError(t('auth.fillAllFields'));
      return;
    }
    setLoading(true);
    try {
      // Route through the shared auth provider so isAuthenticated/currentUser
      // update app-wide (otherwise Home bounces back here).
      const { isVerified, hasProfile } = await login(formData.username.trim(), formData.password);
      const target = !isVerified ? 'EmailVerification' : (hasProfile ? 'Home' : 'CreateProfile');
      navigation.reset({ index: 0, routes: [{ name: target }] });
    } catch {
      setError(t('auth.invalidCredentials'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Image source={require('../assets/logo.png')} style={styles.logo} resizeMode="contain" />

        <Text style={styles.title}>{t('auth.welcomeBack')}</Text>
        <Text style={styles.subtitle}>{t('auth.loginSubtitle')}</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('auth.username')}</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="person-outline" size={18} color={colors.placeholder} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder={t('auth.usernamePlaceholder')}
              placeholderTextColor={colors.placeholder}
              value={formData.username}
              onChangeText={v => handleChange('username', v)}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('auth.password')}</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.placeholder} style={styles.inputIcon} />
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder={t('auth.passwordPlaceholder')}
              placeholderTextColor={colors.placeholder}
              value={formData.password}
              onChangeText={v => handleChange('password', v)}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity onPress={() => setShowPassword(p => !p)} style={styles.eyeBtn}>
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color={colors.placeholder}
              />
            </TouchableOpacity>
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading
            ? <ActivityIndicator color={colors.white} />
            : <Text style={styles.buttonText}>{t('auth.login')}</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.forgotRow}
          onPress={() => navigation.navigate('ForgotPassword')}
        >
          <Text style={styles.forgotText}>{t('auth.forgot')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.signupRow} onPress={() => navigation.navigate('SignUp')}>
          <Text style={styles.signupText}>{t('auth.noAccount')}</Text>
          <Text style={styles.signupLink}>{t('auth.signUp')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const makeStyles = (colors) => StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxl,
    backgroundColor: colors.bg,
  },
  logo: {
    width: 120,
    height: 60,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  title: {
    ...typography.h1,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  inputGroup: { marginBottom: spacing.md },
  label: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
  },
  inputIcon: { marginRight: spacing.xs },
  input: {
    flex: 1,
    height: 50,
    color: colors.textPrimary,
    fontSize: 16,
  },
  eyeBtn: { padding: spacing.xs },
  error: {
    color: colors.error,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.sm,
    ...shadows.md,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: {
    ...typography.button,
    color: colors.white,
  },
  forgotRow: {
    alignSelf: 'center',
    marginTop: spacing.md,
  },
  forgotText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  signupRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  signupText: { color: colors.textSecondary, fontSize: 15 },
  signupLink: { color: colors.primary, fontSize: 15, fontWeight: '600' },
});

export default LoginPage;

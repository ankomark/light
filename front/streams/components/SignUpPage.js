import React, { useRef, useState, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView, Image,
} from 'react-native';
import KeyboardLift from './tickets/KeyboardLift';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { useNavigation } from '@react-navigation/native';
import { API_URL } from '../services/api';
import { useAuth } from '../context/useAuth';
import { useTheme } from '../context/ThemeContext';
import { useI18n } from '../context/I18nContext';
import { typography, spacing, radius, shadows } from '../constants/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SignUpPage = () => {
  const insets = useSafeAreaInsets();
  const [formData, setFormData] = useState({ username: '', email: '', password: '' });
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

  const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleSubmit = async () => {
    if (!formData.username.trim() || !formData.email.trim() || !formData.password) {
      setError(t('auth.fillAllFields'));
      return;
    }
    // The server's rule, said here first and in the reader's language:
    // names go into links and @mentions.
    if (!/^[A-Za-z0-9._]{3,30}$/.test(formData.username.trim())) {
      setError(t('auth.usernameRule'));
      return;
    }
    if (!isValidEmail(formData.email.trim())) {
      setError(t('auth.invalidEmail'));
      return;
    }
    if (formData.password.length < 8) {
      setError(t('auth.passwordTooShort'));
      return;
    }
    setLoading(true);
    try {
      const email = formData.email.trim();
      await axios.post(`${API_URL}/auth/signup/`, { ...formData, email });
      // Sign the new user in (so the authenticated verify endpoint works), then
      // route based on status: verify email if required, else create profile.
      const { isVerified } = await login(formData.username.trim(), formData.password);
      navigation.reset(
        isVerified
          ? { index: 0, routes: [{ name: 'CreateProfile' }] }
          : { index: 0, routes: [{ name: 'EmailVerification', params: { email } }] }
      );
    } catch (err) {
      if (__DEV__) console.log('[signup] POST', `${API_URL}/auth/signup/`, '->', err.message, err.response?.status);
      const data = err.response?.data;
      let msg;
      if (err.response) {
        // Server responded — surface the real validation/server message.
        // New accounts paused (an attack, or many from this network): said plainly.
        const code = data?.code;
        msg = code === 'signups_paused' || code === 'signups_burst' ? t('auth.signupsPaused')
          : code === 'blocked' ? t('auth.networkBlocked')
            : data?.message || data?.username?.[0] || data?.email?.[0]
              || data?.password?.[0] || data?.error || data?.detail || t('auth.serverDown');
        if (err.response.status >= 500) msg = t('auth.serverDown');
      } else {
        // No response — couldn't reach the backend at all.
        msg = t('auth.cantReach');
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const kbScroll = useRef(null);

  return (
    // KeyboardLift, not KeyboardAvoidingView: with edge-to-edge Android the
    // window no longer resizes for the keyboard, which then covered the
    // password field and the button.
    <KeyboardLift scrollRef={kbScroll} style={styles.flex}>
      <ScrollView ref={kbScroll} contentContainerStyle={[styles.container, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xxl }]} keyboardShouldPersistTaps="handled">
        <Image source={require('../assets/logo-mark.png')} style={styles.logo} resizeMode="contain" />

        <Text style={styles.title}>{t('auth.createTitle')}</Text>
        <Text style={styles.subtitle}>{t('auth.signupSubtitle')}</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('auth.username')}</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="person-outline" size={18} color={colors.placeholder} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder={t('auth.chooseUsername')}
              placeholderTextColor={colors.placeholder}
              value={formData.username}
              onChangeText={v => handleChange('username', v)}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('auth.email')}</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="mail-outline" size={18} color={colors.placeholder} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder={t('auth.emailPlaceholder')}
              placeholderTextColor={colors.placeholder}
              value={formData.email}
              onChangeText={v => handleChange('email', v)}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('auth.password')}</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.placeholder} style={styles.inputIcon} />
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder={t('auth.createPassword')}
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
            : <Text style={styles.buttonText}>{t('auth.createTitle')}</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity style={styles.loginRow} onPress={() => navigation.navigate('Login')}>
          <Text style={styles.loginText}>{t('auth.haveAccount')}</Text>
          <Text style={styles.loginLink}>{t('auth.login')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardLift>
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
    width: 96,
    height: 96,
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
  loginRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  loginText: { color: colors.textSecondary, fontSize: 15 },
  loginLink: { color: colors.primary, fontSize: 15, fontWeight: '600' },
});

export default SignUpPage;

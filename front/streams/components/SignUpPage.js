import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { useNavigation } from '@react-navigation/native';
import { API_URL, API_BASE } from '../services/api';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const SignUpPage = () => {
  const [formData, setFormData] = useState({ username: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigation = useNavigation();

  const handleChange = (name, value) => {
    setFormData(prev => ({ ...prev, [name]: value }));
    if (error) setError('');
  };

  const handleSubmit = async () => {
    if (!formData.username.trim() || !formData.email.trim() || !formData.password) {
      setError('Please fill in all fields');
      return;
    }
    setLoading(true);
    try {
      await axios.post(`${API_URL}/auth/signup/`, formData);
      navigation.navigate('EmailVerification', { email: formData.email });
    } catch (err) {
      console.log('[signup] POST', `${API_URL}/auth/signup/`, '->', err.message, err.response?.status, err.response?.data);
      const data = err.response?.data;
      let msg;
      if (err.response) {
        // Server responded — surface the real validation/server message.
        msg = data?.message || data?.username?.[0] || data?.email?.[0]
          || data?.password?.[0] || data?.detail || `Server error (${err.response.status})`;
      } else {
        // No response — couldn't reach the backend at all.
        msg = `Can't reach the server at ${API_BASE}. Is the backend running and on the same network?`;
      }
      setError(msg);
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

        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>Join the Advent Light community</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Username</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="person-outline" size={18} color={colors.placeholder} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Choose a username"
              placeholderTextColor={colors.placeholder}
              value={formData.username}
              onChangeText={v => handleChange('username', v)}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Email</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="mail-outline" size={18} color={colors.placeholder} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Enter your email"
              placeholderTextColor={colors.placeholder}
              value={formData.email}
              onChangeText={v => handleChange('email', v)}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Password</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.placeholder} style={styles.inputIcon} />
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Create a password"
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
            : <Text style={styles.buttonText}>Create Account</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity style={styles.loginRow} onPress={() => navigation.navigate('Login')}>
          <Text style={styles.loginText}>Already have an account? </Text>
          <Text style={styles.loginLink}>Log In</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
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
  loginRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  loginText: { color: colors.textSecondary, fontSize: 15 },
  loginLink: { color: colors.primary, fontSize: 15, fontWeight: '600' },
});

export default SignUpPage;

// The app down for maintenance (set by an admin): members see the admins'
// message and a way to check again; admins go on in (to check things before
// opening up). Someone signed out can still reach the sign-in, for admins.
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppStatus } from '../context/AppStatusContext';
import { useAuth } from '../context/useAuth';
import { useI18n } from '../context/I18nContext';
import { isAdmin } from '../utils/roles';

export default function MaintenanceGate({ children }) {
  const { maintenance, refresh } = useAppStatus();
  const { currentUser, isAuthenticated } = useAuth();
  const { t } = useI18n();
  const [staffSignIn, setStaffSignIn] = useState(false);

  if (!maintenance?.on || isAdmin(currentUser) || (staffSignIn && !isAuthenticated)) return children;

  return (
    <View style={styles.page} testID="maintenance">
      <Image source={require('../assets/logo-mark.png')} style={styles.logo} resizeMode="contain" />
      <Ionicons name="construct-outline" size={34} color="#FFC46B" />
      <Text style={styles.title}>{t('maintenance.title')}</Text>
      <Text style={styles.body}>{maintenance.message || t('maintenance.body')}</Text>
      <TouchableOpacity style={styles.btn} onPress={refresh} testID="maintenance-retry">
        <Text style={styles.btnText}>{t('maintenance.check')}</Text>
      </TouchableOpacity>
      {!isAuthenticated && (
        <TouchableOpacity onPress={() => setStaffSignIn(true)} style={styles.link} testID="maintenance-staff">
          <Text style={styles.linkText}>{t('maintenance.staff')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#0A1628', alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 },
  logo: { width: 72, height: 72, marginBottom: 6 },
  title: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  body: { color: '#C9D6E8', fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 420 },
  btn: { marginTop: 8, height: 48, paddingHorizontal: 28, borderRadius: 24, backgroundColor: '#FFC46B', justifyContent: 'center' },
  btnText: { color: '#0A1628', fontWeight: '800', fontSize: 15 },
  link: { padding: 10 },
  linkText: { color: '#8FA3BF', fontWeight: '700' },
});

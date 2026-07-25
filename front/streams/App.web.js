/**
 * Web entry — a browser admin console for monitoring.
 *
 * Metro resolves `.web.js` before `.js`, so on web THIS is the app root (the
 * native App.js — which pulls in LiveKit/WebRTC, camera, video-trim, etc. — is
 * never imported, keeping the web bundle clean). It reuses the existing admin
 * screens and API layer as-is via react-native-web.
 *
 * Run locally:  npx expo start --web
 * Build static: npx expo export -p web   (serve the `dist/` folder anywhere)
 */
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AuthProvider, useAuth } from './context/useAuth';
import { PreferencesProvider } from './context/PreferencesContext';
import { ThemeProvider } from './context/ThemeContext';
import { I18nProvider } from './context/I18nContext';
import { WallpaperProvider } from './context/WallpaperContext';
import axios from 'axios';
import { isAdmin } from './utils/roles';
import { API_BASE, API_URL, getAccessToken } from './services/api';
import { colors } from './constants/theme';

import AdminDashboard from './components/admin/AdminDashboard';
import AdminReports from './components/admin/AdminReports';
import AdminUsers from './components/admin/AdminUsers';
import AdminContent from './components/admin/AdminContent';
import AdminLogs from './components/admin/AdminLogs';
import AdminAnalytics from './components/admin/AdminAnalytics';
import AdminAppeals from './components/admin/AdminAppeals';
import AdminRoles from './components/admin/AdminRoles';
import AdminWallpapers from './components/admin/AdminWallpapers';
import AppealScreen from './components/admin/AppealScreen';

const Stack = createNativeStackNavigator();

// ── Admin login (self-contained; drives useAuth directly, no navigation) ──────
function AdminLogin() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!username.trim() || !password) { setError('Enter your username and password.'); return; }
    setError('');
    setBusy(true);
    try {
      await login(username.trim(), password);
      // On success the auth state updates and the console renders itself.
    } catch (e) {
      if (e?.response) {
        // Server answered → a real auth/validation error.
        setError(e.response.data?.detail || 'Login failed. Check your username and password.');
      } else {
        // No HTTP response: either the API was unreachable (wrong host / CORS) or
        // a client-side step (e.g. token storage) failed. Show the real message.
        const msg = e?.message && e.message !== 'Network Error'
          ? e.message
          : `Can't reach the server at ${API_BASE}. Is the backend running and CORS allowing this origin?`;
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.centered}>
      <View style={styles.loginCard}>
        <Text style={styles.brand}>Adventist Life</Text>
        <Text style={styles.loginTitle}>Admin Console</Text>
        <TextInput
          style={styles.input}
          placeholder="Username"
          placeholderTextColor={colors.placeholder}
          autoCapitalize="none"
          value={username}
          onChangeText={setUsername}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.placeholder}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={submit}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity style={styles.primaryBtn} onPress={submit} disabled={busy} activeOpacity={0.85}>
          {busy ? <ActivityIndicator color="#0A1628" /> : <Text style={styles.primaryBtnText}>Sign in</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function NotAuthorized() {
  const { logout, currentUser } = useAuth();
  const [diag, setDiag] = useState('');
  const [running, setRunning] = useState(false);

  const runDiag = async () => {
    setRunning(true);
    setDiag('Running…');
    try {
      const token = await getAccessToken();
      const check = async (path) => {
        try {
          const r = await fetch(`${API_BASE}/api${path}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          let extra = '';
          if (path.includes('status')) {
            try { const j = await r.json(); extra = ` has_profile=${JSON.stringify(j.has_profile)}`; } catch {}
          }
          return `${path} → ${r.status}${extra}`;
        } catch (e) {
          return `${path} → FAILED (${e.message})`; // e.g. CORS / network
        }
      };
      const s = await check('/auth/status/');
      const m = await check('/profiles/me/');
      // The exact path login uses (axios + global interceptors) — this is what
      // actually fails while the raw fetch above succeeds.
      let ax;
      try {
        const r = await axios.get(`${API_URL}/profiles/me/`);
        ax = `axios /profiles/me/ → ${r.status}`;
      } catch (e) {
        ax = `axios /profiles/me/ → ERROR ${e?.response?.status ?? ''} ${e?.message ?? ''}`.trim();
      }
      setDiag(`token: ${token ? 'present' : 'MISSING'}\n${s}\n${m}\n${ax}`);
    } catch (e) {
      setDiag(`error: ${e.message}`);
    } finally {
      setRunning(false);
    }
  };

  const debug = currentUser
    ? `is_staff=${JSON.stringify(currentUser.is_staff)} · admin_role=${JSON.stringify(currentUser.admin_role)} · is_super_admin=${JSON.stringify(currentUser.is_super_admin)} · capabilities=${JSON.stringify(currentUser.capabilities)}`
    : 'currentUser is null — your profile could not be loaded.';

  return (
    <View style={styles.centered}>
      <View style={styles.loginCard}>
        <Text style={styles.loginTitle}>Not authorized</Text>
        <Text style={styles.muted}>
          {currentUser
            ? `Signed in as @${currentUser.username || ''}, but this account isn't recognised as an admin.`
            : 'Signed in, but your admin profile could not be loaded.'}
        </Text>
        <Text style={styles.debug}>{debug}</Text>
        {diag ? <Text style={styles.debug}>{diag}</Text> : null}
        <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: '#0D2340' }]} onPress={runDiag} disabled={running} activeOpacity={0.85}>
          <Text style={[styles.primaryBtnText, { color: '#fff' }]}>{running ? 'Checking…' : 'Run diagnostics'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primaryBtn} onPress={logout} activeOpacity={0.85}>
          <Text style={styles.primaryBtnText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// The admin screens navigate to each other by these route names.
const SCREENS = [
  ['AdminDashboard', AdminDashboard, 'Dashboard', false],
  ['AdminAnalytics', AdminAnalytics, 'Analytics', true],
  ['AdminReports', AdminReports, 'Reports', true],
  ['AdminAppeals', AdminAppeals, 'Appeals', true],
  ['AdminUsers', AdminUsers, 'Users', true],
  ['AdminContent', AdminContent, 'Content', true],
  ['AdminLogs', AdminLogs, 'Audit log', true],
  ['AdminRoles', AdminRoles, 'Roles', true],
  ['AdminWallpapers', AdminWallpapers, 'Wallpapers', true],
  ['AppealScreen', AppealScreen, 'Appeal', true],
];

function AdminConsole() {
  const { logout } = useAuth();
  return (
    <NavigationContainer
      documentTitle={{ formatter: (opts) => `Admin · ${opts?.title ?? 'Adventist Life'}` }}
    >
      <View style={styles.consoleWrap}>
        <View style={styles.topbar}>
          <Text style={styles.topbarBrand}>Adventist Life — Admin</Text>
          <TouchableOpacity onPress={logout}><Text style={styles.signout}>Sign out</Text></TouchableOpacity>
        </View>
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: '#102E50' },
            headerTintColor: '#fff',
            headerTitleStyle: { color: '#fff' },
            contentStyle: { backgroundColor: '#0A1628' },
          }}
        >
          {SCREENS.map(([name, Component, title, showHeader]) => (
            <Stack.Screen
              key={name}
              name={name}
              component={Component}
              options={{ title, headerShown: showHeader }}
            />
          ))}
        </Stack.Navigator>
      </View>
    </NavigationContainer>
  );
}

function Root() {
  const { isAuthenticated, isLoading, currentUser } = useAuth();
  if (isLoading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color={colors.accent} /></View>;
  }
  if (!isAuthenticated) return <AdminLogin />;
  if (!isAdmin(currentUser)) return <NotAuthorized />;
  return <AdminConsole />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <PreferencesProvider>
          <ThemeProvider>
            <I18nProvider>
              <WallpaperProvider>
                <View style={styles.page}><Root /></View>
              </WallpaperProvider>
            </I18nProvider>
          </ThemeProvider>
        </PreferencesProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#0A1628' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#0A1628' },
  loginCard: {
    width: '100%', maxWidth: 380, backgroundColor: '#102E50', borderRadius: 18, padding: 28,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', gap: 12,
  },
  brand: { color: colors.accent, fontWeight: '800', letterSpacing: 1, fontSize: 12 },
  loginTitle: { color: '#fff', fontSize: 24, fontWeight: '800', marginBottom: 6 },
  muted: { color: 'rgba(255,255,255,0.7)', lineHeight: 20 },
  debug: { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontFamily: 'monospace', marginTop: 4 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    color: '#fff', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  error: { color: '#FF6B6B', fontSize: 13 },
  primaryBtn: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  primaryBtnText: { color: '#0A1628', fontWeight: '800', fontSize: 16 },

  consoleWrap: { flex: 1, backgroundColor: '#0A1628' },
  topbar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12, backgroundColor: '#0D2340',
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  topbarBrand: { color: '#fff', fontWeight: '800', letterSpacing: 0.5 },
  signout: { color: colors.accent, fontWeight: '700' },
});

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Linking,
  Platform,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  ActivityIndicator,
  Share,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useAuth } from '../context/useAuth';
import {
  updateProfileFields,
  createAdminNote,
  changePassword,
  deactivateAccount,
  deleteAccount,
  fetchNotificationPreferences,
  updateNotificationPreferences,
  fetchSessions,
  revokeOtherSessions,
  exportMyData,
} from '../services/api';
import {
  registerForPushNotifications,
  unregisterPushToken,
} from '../services/pushNotifications';
import { PREF_KEYS } from '../utils/preferences';
import { usePreferences } from '../context/PreferencesContext';
import { useTheme } from '../context/ThemeContext';
import { useI18n } from '../context/I18nContext';
import { typography, spacing, radius, shadows } from '../constants/theme';

const APP_NAME = Constants.expoConfig?.name || 'Adventist Life';
const APP_VERSION = Constants.expoConfig?.version || '1.0.0';
const PACKAGE_ID =
  Constants.expoConfig?.android?.package ||
  Constants.expoConfig?.ios?.bundleIdentifier ||
  'com.ankom.streams';
const STORE_URL =
  Platform.OS === 'ios'
    ? `itms-apps://itunes.apple.com/app/${PACKAGE_ID}`
    : `https://play.google.com/store/apps/details?id=${PACKAGE_ID}`;

const AUDIO_QUALITY_LABELS = {
  auto: 'Automatic',
  high: 'High',
  data_saver: 'Data saver',
};
const AUDIO_QUALITY_CYCLE = ['auto', 'high', 'data_saver'];

const VIDEO_QUALITY_LABELS = {
  auto: 'Automatic',
  hd: 'HD',
  data_saver: 'Data saver',
};
const VIDEO_QUALITY_CYCLE = ['auto', 'hd', 'data_saver'];

// User-facing notification categories (key must match the serializer fields).
const NOTIFICATION_CATEGORIES = [
  { key: 'likes', label: 'Likes', icon: 'heart-outline' },
  { key: 'comments', label: 'Comments', icon: 'comment-outline' },
  { key: 'follows', label: 'New followers', icon: 'account-plus-outline' },
  { key: 'messages', label: 'Messages', icon: 'message-text-outline' },
  { key: 'groups', label: 'Group activity', icon: 'account-group-outline' },
  { key: 'communities', label: 'Churches & choirs', icon: 'church' },
  { key: 'live', label: 'Live events', icon: 'broadcast' },
];

const openLink = async (url, fallbackMsg) => {
  try {
    const ok = await Linking.canOpenURL(url);
    if (ok) await Linking.openURL(url);
    else Alert.alert('Unavailable', fallbackMsg || 'Could not open this link.');
  } catch {
    Alert.alert('Unavailable', fallbackMsg || 'Could not open this link.');
  }
};

// ── Reusable building blocks ────────────────────────────────────────────────
const Section = ({ title, children }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      <View style={styles.group}>{children}</View>
    </View>
  );
};

const Row = ({ icon, iconColor, label, sub, right, onPress, last, danger }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const content = (
    <View style={[styles.row, !last && styles.rowDivider]}>
      <View style={[styles.rowIcon, danger && styles.rowIconDanger]}>
        <MaterialCommunityIcons
          name={icon}
          size={20}
          color={danger ? colors.error : iconColor || colors.primary}
        />
      </View>
      <View style={styles.rowTextWrap}>
        <Text style={[styles.rowLabel, danger && { color: colors.error }]} numberOfLines={1}>
          {label}
        </Text>
        {sub ? <Text style={styles.rowSub} numberOfLines={2}>{sub}</Text> : null}
      </View>
      {right !== undefined
        ? right
        : onPress
        ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
      {content}
    </TouchableOpacity>
  );
};

const THEME_CYCLE = ['system', 'light', 'dark'];

const Settings = () => {
  const navigation = useNavigation();
  const { currentUser, isEmailVerified, logout, updateUser } = useAuth();
  const { preferences: prefs, setPreference: updatePref } = usePreferences();
  const { colors, mode: themeMode, setMode: setThemeMode } = useTheme();
  const { t, language, setLanguage, languages } = useI18n();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [isPrivate, setIsPrivate] = useState(!currentUser?.is_public);
  const [savingPrivacy, setSavingPrivacy] = useState(false);

  const [contactVisible, setContactVisible] = useState(false);
  const [contactText, setContactText] = useState('');
  const [sendingContact, setSendingContact] = useState(false);

  // Change password
  const [pwVisible, setPwVisible] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [changingPw, setChangingPw] = useState(false);

  // Delete account
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deletePw, setDeletePw] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Deactivate account (reversible)
  const [deactivateVisible, setDeactivateVisible] = useState(false);
  const [deactivatePw, setDeactivatePw] = useState('');
  const [deactivating, setDeactivating] = useState(false);

  // Notification preferences (per-category). null until loaded.
  const [notifPrefs, setNotifPrefs] = useState(null);

  // Security & sessions
  const [sessionCount, setSessionCount] = useState(null);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setIsPrivate(!currentUser?.is_public);
  }, [currentUser?.is_public]);

  const loadSessions = () => {
    fetchSessions()
      .then((d) => setSessionCount(typeof d?.count === 'number' ? d.count : null))
      .catch(() => setSessionCount(null));
  };
  useEffect(() => { loadSessions(); }, []);

  const handleLogoutOthers = () => {
    Alert.alert(
      t('settings.security.logoutOthers'),
      'Sign out of all other devices? This device stays signed in.',
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: 'Log out others',
          style: 'destructive',
          onPress: async () => {
            setRevokingOthers(true);
            try {
              const res = await revokeOtherSessions();
              loadSessions();
              Alert.alert('Done', `Signed out of ${res?.revoked ?? 0} other session(s).`);
            } catch {
              Alert.alert(t('common.error'), 'Could not revoke other sessions.');
            } finally {
              setRevokingOthers(false);
            }
          },
        },
      ]
    );
  };

  const handleExportData = async () => {
    setExporting(true);
    try {
      const data = await exportMyData();
      await Share.share({
        title: 'My Adventist Life data',
        message: JSON.stringify(data, null, 2),
      });
    } catch {
      Alert.alert(t('common.error'), 'Could not export your data.');
    } finally {
      setExporting(false);
    }
  };

  // Load per-category notification preferences once.
  useEffect(() => {
    let alive = true;
    fetchNotificationPreferences()
      .then((data) => { if (alive) setNotifPrefs(data); })
      .catch(() => { if (alive) setNotifPrefs(null); });
    return () => { alive = false; };
  }, []);

  const toggleNotifCategory = async (key, value) => {
    setNotifPrefs((prev) => ({ ...(prev || {}), [key]: value }));
    try {
      await updateNotificationPreferences({ [key]: value });
    } catch {
      setNotifPrefs((prev) => ({ ...(prev || {}), [key]: !value })); // revert
      Alert.alert('Error', 'Could not update this notification setting.');
    }
  };

  // Privacy: persisted server-side on the profile (is_public is the inverse).
  const handleTogglePrivate = async (next) => {
    setIsPrivate(next);
    setSavingPrivacy(true);
    try {
      await updateProfileFields({ is_public: !next });
      await updateUser();
    } catch {
      setIsPrivate(!next); // revert on failure
      Alert.alert('Error', 'Could not update your privacy setting. Please try again.');
    } finally {
      setSavingPrivacy(false);
    }
  };

  // Push master switch: ask the OS + (un)register the device token, and cache
  // the choice locally so the UI is correct on next launch.
  const handleTogglePush = async (next) => {
    await updatePref(PREF_KEYS.pushEnabled, next);
    try {
      if (next) {
        const token = await registerForPushNotifications();
        if (!token) {
          await updatePref(PREF_KEYS.pushEnabled, false);
          Alert.alert(
            'Notifications blocked',
            'Enable notifications for ' + APP_NAME + ' in your device settings to receive alerts.'
          );
        }
      } else {
        await unregisterPushToken();
      }
    } catch {
      // Best-effort — the cached preference still reflects the user's intent.
    }
  };

  const cycleAudioQuality = () => {
    const idx = AUDIO_QUALITY_CYCLE.indexOf(prefs[PREF_KEYS.audioQuality]);
    const next = AUDIO_QUALITY_CYCLE[(idx + 1) % AUDIO_QUALITY_CYCLE.length];
    updatePref(PREF_KEYS.audioQuality, next);
  };

  const cycleVideoQuality = () => {
    const idx = VIDEO_QUALITY_CYCLE.indexOf(prefs[PREF_KEYS.videoQuality]);
    const next = VIDEO_QUALITY_CYCLE[(idx + 1) % VIDEO_QUALITY_CYCLE.length];
    updatePref(PREF_KEYS.videoQuality, next);
  };

  const cycleTheme = () => {
    const idx = THEME_CYCLE.indexOf(themeMode);
    setThemeMode(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
  };

  const cycleLanguage = () => {
    const codes = languages.map((l) => l.code);
    const idx = codes.indexOf(language);
    setLanguage(codes[(idx + 1) % codes.length]);
  };

  const themeLabel = t(`settings.theme.${themeMode}`);
  const languageLabel = languages.find((l) => l.code === language)?.label || 'System default';

  const resetPwForm = () => { setCurrentPw(''); setNewPw(''); setConfirmPw(''); };

  const handleChangePassword = async () => {
    if (!currentPw || !newPw) {
      Alert.alert('Missing info', 'Enter your current and new password.');
      return;
    }
    if (newPw.length < 8) {
      Alert.alert('Weak password', 'New password must be at least 8 characters.');
      return;
    }
    if (newPw !== confirmPw) {
      Alert.alert('Mismatch', 'New password and confirmation do not match.');
      return;
    }
    try {
      setChangingPw(true);
      await changePassword(currentPw, newPw);
      setPwVisible(false);
      resetPwForm();
      Alert.alert('Done', 'Your password has been changed.');
    } catch (error) {
      Alert.alert('Error', error.response?.data?.error || 'Could not change your password.');
    } finally {
      setChangingPw(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletePw) {
      Alert.alert('Password required', 'Enter your password to confirm deletion.');
      return;
    }
    try {
      setDeleting(true);
      await deleteAccount(deletePw);
      setDeleteVisible(false);
      setDeletePw('');
      // Account is gone — clear the session and return to login.
      try { await logout(); } catch {}
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
    } catch (error) {
      Alert.alert('Error', error.response?.data?.error || 'Could not delete your account.');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivatePw) {
      Alert.alert('Password required', 'Enter your password to confirm.');
      return;
    }
    try {
      setDeactivating(true);
      await deactivateAccount(deactivatePw);
      setDeactivateVisible(false);
      setDeactivatePw('');
      try { await logout(); } catch {}
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
    } catch (error) {
      Alert.alert(t('common.error'), error.response?.data?.error || 'Could not deactivate your account.');
    } finally {
      setDeactivating(false);
    }
  };

  const confirmDeactivate = () => {
    Alert.alert(
      t('settings.session.deactivate'),
      'Your profile and content will be hidden until you sign in again. You can reactivate anytime by logging back in.',
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: 'Continue', onPress: () => setDeactivateVisible(true) },
      ]
    );
  };

  const confirmDeleteAccount = () => {
    Alert.alert(
      'Delete account',
      'This permanently deletes your account and all your content. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', style: 'destructive', onPress: () => setDeleteVisible(true) },
      ]
    );
  };

  const handleSendContact = async () => {
    if (!contactText.trim()) {
      Alert.alert('Empty message', 'Please write a message for the admins.');
      return;
    }
    try {
      setSendingContact(true);
      await createAdminNote(contactText.trim());
      setContactVisible(false);
      setContactText('');
      Alert.alert('Sent', 'Your message has been delivered to the admins. Only they can read it.');
    } catch (error) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to send your message.');
    } finally {
      setSendingContact(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          try { await logout(); }
          finally { navigation.reset({ index: 0, routes: [{ name: 'Login' }] }); }
        },
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('settings.title')}</Text>
        <View style={styles.backBtn} />
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Account ───────────────────────────────────────────── */}
        <Section title={t('settings.section.account')}>
          <Row
            icon="account-circle-outline"
            label={currentUser?.username || 'Your profile'}
            sub={currentUser?.email || 'Tap to edit your profile'}
            onPress={() => navigation.navigate('Profile')}
          />
          <Row
            icon={isEmailVerified ? 'email-check-outline' : 'email-alert-outline'}
            iconColor={isEmailVerified ? colors.success : colors.warning}
            label="Email"
            sub={isEmailVerified ? 'Verified' : 'Not verified — tap to verify'}
            onPress={isEmailVerified ? undefined : () => navigation.navigate('EmailVerification')}
            right={isEmailVerified ? (
              <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            ) : undefined}
          />
          <Row
            icon="lock-reset"
            label={t('settings.account.changePassword')}
            onPress={() => setPwVisible(true)}
            last
          />
        </Section>

        {/* ── Privacy ───────────────────────────────────────────── */}
        <Section title={t('settings.section.privacy')}>
          <Row
            icon="lock-outline"
            label={t('settings.privacy.privateAccount')}
            sub={t('settings.privacy.privateAccountSub')}
            right={
              <View style={styles.switchWrap}>
                {savingPrivacy && <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 6 }} />}
                <Switch
                  value={isPrivate}
                  onValueChange={handleTogglePrivate}
                  disabled={savingPrivacy}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.white}
                />
              </View>
            }
          />
          <Row
            icon="account-cancel-outline"
            label={t('settings.privacy.blocked')}
            sub={t('settings.privacy.blockedSub')}
            onPress={() => navigation.navigate('BlockedUsers')}
            last
          />
        </Section>

        {/* ── Appearance ────────────────────────────────────────── */}
        <Section title={t('settings.section.appearance')}>
          <Row
            icon="theme-light-dark"
            label={t('settings.appearance.theme')}
            sub={themeLabel}
            onPress={cycleTheme}
            right={
              <View style={styles.valuePill}>
                <Text style={styles.valuePillText}>{themeLabel}</Text>
              </View>
            }
          />
          <Row
            icon="translate"
            label={t('settings.appearance.language')}
            sub={languageLabel}
            onPress={cycleLanguage}
            last
            right={
              <View style={styles.valuePill}>
                <Text style={styles.valuePillText}>{languageLabel}</Text>
              </View>
            }
          />
        </Section>

        {/* ── Security ──────────────────────────────────────────── */}
        <Section title={t('settings.section.security')}>
          <Row
            icon="cellphone-lock"
            label={t('settings.security.logoutOthers')}
            sub={sessionCount != null ? `${sessionCount} active session${sessionCount === 1 ? '' : 's'}` : undefined}
            onPress={handleLogoutOthers}
            right={revokingOthers ? <ActivityIndicator size="small" color={colors.primary} /> : undefined}
          />
          <Row
            icon="download-outline"
            label={t('settings.security.export')}
            onPress={handleExportData}
            last
            right={exporting ? <ActivityIndicator size="small" color={colors.primary} /> : undefined}
          />
        </Section>

        {/* ── Notifications ─────────────────────────────────────── */}
        <Section title={t('settings.section.notifications')}>
          <Row
            icon="bell-outline"
            label="Push notifications"
            sub="Master switch for all push alerts on this device"
            last={!prefs[PREF_KEYS.pushEnabled]}
            right={
              <Switch
                value={!!prefs[PREF_KEYS.pushEnabled]}
                onValueChange={handleTogglePush}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.white}
              />
            }
          />
          {/* Per-category opt-outs, only meaningful while push is enabled. */}
          {!!prefs[PREF_KEYS.pushEnabled] && NOTIFICATION_CATEGORIES.map((cat, i) => (
            <Row
              key={cat.key}
              icon={cat.icon}
              label={cat.label}
              last={i === NOTIFICATION_CATEGORIES.length - 1}
              right={
                <Switch
                  value={notifPrefs ? notifPrefs[cat.key] !== false : true}
                  onValueChange={(v) => toggleNotifCategory(cat.key, v)}
                  disabled={notifPrefs === null}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.white}
                />
              }
            />
          ))}
        </Section>

        {/* ── Playback & Data ───────────────────────────────────── */}
        <Section title={t('settings.section.playback')}>
          <Row
            icon="play-circle-outline"
            label={t('settings.playback.autoplay')}
            sub="Play videos automatically in the feed"
            right={
              <Switch
                value={!!prefs[PREF_KEYS.autoplayVideo]}
                onValueChange={(v) => updatePref(PREF_KEYS.autoplayVideo, v)}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.white}
              />
            }
          />
          <Row
            icon="cellphone-arrow-down"
            label={t('settings.playback.dataSaver')}
            sub="Reduce data usage on mobile networks"
            right={
              <Switch
                value={!!prefs[PREF_KEYS.dataSaver]}
                onValueChange={(v) => updatePref(PREF_KEYS.dataSaver, v)}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.white}
              />
            }
          />
          <Row
            icon="video-outline"
            label={t('settings.playback.videoQuality')}
            sub={VIDEO_QUALITY_LABELS[prefs[PREF_KEYS.videoQuality]] || 'Automatic'}
            onPress={cycleVideoQuality}
            right={
              <View style={styles.valuePill}>
                <Text style={styles.valuePillText}>
                  {VIDEO_QUALITY_LABELS[prefs[PREF_KEYS.videoQuality]] || 'Automatic'}
                </Text>
              </View>
            }
          />
          <Row
            icon="music-note-outline"
            label={t('settings.playback.audioQuality')}
            sub={AUDIO_QUALITY_LABELS[prefs[PREF_KEYS.audioQuality]] || 'Automatic'}
            onPress={cycleAudioQuality}
            right={
              <View style={styles.valuePill}>
                <Text style={styles.valuePillText}>
                  {AUDIO_QUALITY_LABELS[prefs[PREF_KEYS.audioQuality]] || 'Automatic'}
                </Text>
              </View>
            }
            last
          />
        </Section>

        {/* ── Support ───────────────────────────────────────────── */}
        <Section title={t('settings.section.support')}>
          <Row
            icon="email-edit-outline"
            label={t('settings.support.contact')}
            sub="Send a private message to the team"
            onPress={() => setContactVisible(true)}
          />
          <Row
            icon="star-outline"
            label={`Rate ${APP_NAME}`}
            onPress={() => openLink(STORE_URL, 'The app store is unavailable on this device.')}
          />
          <Row
            icon="information-outline"
            label={t('settings.support.about')}
            onPress={() => navigation.navigate('About')}
            last
          />
        </Section>

        {/* ── Session ───────────────────────────────────────────── */}
        <Section title={t('settings.section.session')}>
          <Row icon="logout" label={t('settings.session.logout')} danger onPress={handleLogout} right={null} />
          <Row icon="account-off-outline" label={t('settings.session.deactivate')} onPress={confirmDeactivate} right={null} />
          <Row icon="trash-can-outline" label={t('settings.session.delete')} danger onPress={confirmDeleteAccount} last right={null} />
        </Section>

        <Text style={styles.version}>{APP_NAME} v{APP_VERSION}</Text>
        <View style={{ height: spacing.xl }} />
      </ScrollView>

      {/* Contact-admins modal (reuses the AdminNote channel) */}
      <Modal
        visible={contactVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setContactVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Contact admins</Text>
              <TouchableOpacity onPress={() => { setContactVisible(false); setContactText(''); }}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.privacyHint}>
              <MaterialCommunityIcons name="lock-outline" size={16} color={colors.textMuted} />
              <Text style={styles.privacyHintText}>This message is private — only admins can read it.</Text>
            </View>

            <TextInput
              style={styles.input}
              placeholder="How can we help?"
              placeholderTextColor={colors.placeholder}
              value={contactText}
              onChangeText={setContactText}
              multiline
              textAlignVertical="top"
            />

            <TouchableOpacity
              style={[styles.sendBtn, sendingContact && { opacity: 0.6 }]}
              onPress={handleSendContact}
              disabled={sendingContact}
              activeOpacity={0.85}
            >
              {sendingContact
                ? <ActivityIndicator color={colors.white} />
                : <>
                    <Ionicons name="send-outline" size={18} color={colors.white} />
                    <Text style={styles.sendBtnText}>Send to admins</Text>
                  </>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Change-password modal */}
      <Modal
        visible={pwVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setPwVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Change password</Text>
              <TouchableOpacity onPress={() => { setPwVisible(false); resetPwForm(); }}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.pwInput}
              placeholder="Current password"
              placeholderTextColor={colors.placeholder}
              value={currentPw}
              onChangeText={setCurrentPw}
              secureTextEntry
              autoCapitalize="none"
            />
            <TextInput
              style={styles.pwInput}
              placeholder="New password (min 8 chars)"
              placeholderTextColor={colors.placeholder}
              value={newPw}
              onChangeText={setNewPw}
              secureTextEntry
              autoCapitalize="none"
            />
            <TextInput
              style={styles.pwInput}
              placeholder="Confirm new password"
              placeholderTextColor={colors.placeholder}
              value={confirmPw}
              onChangeText={setConfirmPw}
              secureTextEntry
              autoCapitalize="none"
            />

            <TouchableOpacity
              style={[styles.sendBtn, changingPw && { opacity: 0.6 }]}
              onPress={handleChangePassword}
              disabled={changingPw}
              activeOpacity={0.85}
            >
              {changingPw
                ? <ActivityIndicator color={colors.white} />
                : <>
                    <Ionicons name="lock-closed-outline" size={18} color={colors.white} />
                    <Text style={styles.sendBtnText}>Update password</Text>
                  </>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Delete-account modal (password confirmation) */}
      <Modal
        visible={deleteVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setDeleteVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Delete account</Text>
              <TouchableOpacity onPress={() => { setDeleteVisible(false); setDeletePw(''); }}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.privacyHint}>
              <MaterialCommunityIcons name="alert-outline" size={16} color={colors.error} />
              <Text style={[styles.privacyHintText, { color: colors.error }]}>
                This permanently deletes your account and content. It cannot be undone.
              </Text>
            </View>

            <TextInput
              style={styles.pwInput}
              placeholder="Enter your password to confirm"
              placeholderTextColor={colors.placeholder}
              value={deletePw}
              onChangeText={setDeletePw}
              secureTextEntry
              autoCapitalize="none"
            />

            <TouchableOpacity
              style={[styles.deleteBtn, deleting && { opacity: 0.6 }]}
              onPress={handleDeleteAccount}
              disabled={deleting}
              activeOpacity={0.85}
            >
              {deleting
                ? <ActivityIndicator color={colors.white} />
                : <>
                    <Ionicons name="trash-outline" size={18} color={colors.white} />
                    <Text style={styles.sendBtnText}>Delete my account</Text>
                  </>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Deactivate-account modal (reversible; password confirmation) */}
      <Modal
        visible={deactivateVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setDeactivateVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('settings.session.deactivate')}</Text>
              <TouchableOpacity onPress={() => { setDeactivateVisible(false); setDeactivatePw(''); }}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.privacyHint}>
              <MaterialCommunityIcons name="information-outline" size={16} color={colors.textMuted} />
              <Text style={styles.privacyHintText}>
                Your profile and posts are hidden until you sign in again. Reactivate anytime by logging back in.
              </Text>
            </View>

            <TextInput
              style={styles.pwInput}
              placeholder="Enter your password to confirm"
              placeholderTextColor={colors.placeholder}
              value={deactivatePw}
              onChangeText={setDeactivatePw}
              secureTextEntry
              autoCapitalize="none"
            />

            <TouchableOpacity
              style={[styles.sendBtn, deactivating && { opacity: 0.6 }]}
              onPress={handleDeactivate}
              disabled={deactivating}
              activeOpacity={0.85}
            >
              {deactivating
                ? <ActivityIndicator color={colors.white} />
                : <>
                    <MaterialCommunityIcons name="account-off-outline" size={18} color={colors.white} />
                    <Text style={styles.sendBtnText}>Deactivate</Text>
                  </>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

const makeStyles = (colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { ...typography.h2, color: colors.textPrimary },

  scroll: { paddingTop: spacing.sm },

  section: { marginTop: spacing.md },
  sectionTitle: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 1.2,
    fontWeight: '700',
    marginLeft: spacing.lg,
    marginBottom: spacing.xs,
  },
  group: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: spacing.md,
    overflow: 'hidden',
    ...shadows.sm,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 60,
  },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowIcon: {
    width: 36, height: 36, borderRadius: radius.md,
    backgroundColor: colors.inputBg,
    justifyContent: 'center', alignItems: 'center',
    marginRight: spacing.md,
  },
  rowIconDanger: { backgroundColor: 'rgba(229,57,53,0.12)' },
  rowTextWrap: { flex: 1, marginRight: spacing.sm },
  rowLabel: { ...typography.body, color: colors.textPrimary, fontWeight: '500' },
  rowSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  switchWrap: { flexDirection: 'row', alignItems: 'center' },
  valuePill: {
    backgroundColor: colors.inputBg,
    borderRadius: radius.full,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  valuePillText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },

  version: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
    opacity: 0.7,
  },

  // Contact modal
  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border,
    alignSelf: 'center', marginBottom: spacing.md,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  modalTitle: { ...typography.h2, color: colors.textPrimary },
  privacyHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.md },
  privacyHintText: { ...typography.caption, color: colors.textMuted, flex: 1 },
  input: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.textPrimary,
    fontSize: 15,
    minHeight: 130,
    marginBottom: spacing.md,
  },
  pwInput: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.textPrimary,
    fontSize: 15,
    marginBottom: spacing.md,
  },
  sendBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    height: 52,
    borderRadius: radius.md,
    ...shadows.md,
  },
  sendBtnText: { ...typography.button, color: colors.white, fontSize: 16 },
  deleteBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.error,
    height: 52,
    borderRadius: radius.md,
    ...shadows.md,
  },
});

export default Settings;

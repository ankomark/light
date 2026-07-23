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
import { PREF_KEYS, MEDIA_QUALITY_TIERS_AVAILABLE } from '../utils/preferences';
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
// Module scope can't call t(), so each row carries a key the render resolves.
const NOTIFICATION_CATEGORIES = [
  { key: 'likes', labelKey: 'settings.notif.likes', icon: 'heart-outline' },
  { key: 'comments', labelKey: 'settings.notif.comments', icon: 'comment-outline' },
  { key: 'follows', labelKey: 'settings.notif.follows', icon: 'account-plus-outline' },
  { key: 'messages', labelKey: 'settings.notif.messages', icon: 'message-text-outline' },
  { key: 'groups', labelKey: 'settings.notif.groups', icon: 'account-group-outline' },
  { key: 'communities', labelKey: 'settings.notif.communities', icon: 'church' },
  { key: 'live', labelKey: 'settings.notif.live', icon: 'broadcast' },
];

// Module scope: no hook here, so the caller passes t in.
const openLink = async (url, fallbackMsg, t) => {
  try {
    const ok = await Linking.canOpenURL(url);
    if (ok) await Linking.openURL(url);
    else Alert.alert(t('common.unavailable'), fallbackMsg || t('common.openLinkFailed'));
  } catch {
    Alert.alert(t('common.unavailable'), fallbackMsg || t('common.openLinkFailed'));
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
      t('settings.logoutOthersBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.logoutOthersAction'),
          style: 'destructive',
          onPress: async () => {
            setRevokingOthers(true);
            try {
              const res = await revokeOtherSessions();
              loadSessions();
              Alert.alert(t('common.done'), t('settings.sessionsRevoked', { count: res?.revoked ?? 0 }));
            } catch {
              Alert.alert(t('common.error'), t('settings.revokeFailed'));
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
        title: t('settings.exportTitle'),
        message: JSON.stringify(data, null, 2),
      });
    } catch {
      Alert.alert(t('common.error'), t('settings.exportFailed'));
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
      Alert.alert(t('common.error'), t('settings.notifPrefFailed'));
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
      Alert.alert(t('common.error'), t('settings.privacyFailed'));
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
            t('settings.notif.blockedTitle'),
            t('settings.notif.blockedBody', { app: APP_NAME })
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
      Alert.alert(t('settings.pw.missingTitle'), t('settings.pw.missingBody'));
      return;
    }
    if (newPw.length < 8) {
      Alert.alert(t('settings.pw.weakTitle'), t('settings.pw.weakBody'));
      return;
    }
    if (newPw !== confirmPw) {
      Alert.alert(t('settings.pw.mismatchTitle'), t('settings.pw.mismatchBody'));
      return;
    }
    try {
      setChangingPw(true);
      await changePassword(currentPw, newPw);
      setPwVisible(false);
      resetPwForm();
      Alert.alert(t('common.done'), t('settings.pw.changed'));
    } catch (error) {
      Alert.alert(t('common.error'), error.response?.data?.error || t('settings.pw.changeFailed'));
    } finally {
      setChangingPw(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletePw) {
      Alert.alert(t('settings.pwRequiredTitle'), t('settings.pwRequiredDelete'));
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
      Alert.alert(t('common.error'), error.response?.data?.error || t('settings.deleteAccountFailed'));
    } finally {
      setDeleting(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivatePw) {
      Alert.alert(t('settings.pwRequiredTitle'), t('settings.pwRequiredConfirm'));
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
      t('settings.deactivateBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.continue'), onPress: () => setDeactivateVisible(true) },
      ]
    );
  };

  const confirmDeleteAccount = () => {
    Alert.alert(
      t('settings.deleteTitle'),
      t('settings.deleteBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.continue'), style: 'destructive', onPress: () => setDeleteVisible(true) },
      ]
    );
  };

  const handleSendContact = async () => {
    if (!contactText.trim()) {
      Alert.alert(t('settings.contact.emptyTitle'), t('settings.contact.emptyBody'));
      return;
    }
    try {
      setSendingContact(true);
      await createAdminNote(contactText.trim());
      setContactVisible(false);
      setContactText('');
      Alert.alert(t('settings.contact.sentTitle'), t('settings.contact.sentBody'));
    } catch (error) {
      Alert.alert(t('common.error'), error.response?.data?.detail || t('settings.contact.sendFailed'));
    } finally {
      setSendingContact(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(t('settings.logoutTitle'), t('settings.logoutConfirm'), [
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
            sub={currentUser?.email || t('settings.tapToEdit')}
            onPress={() => navigation.navigate('Profile')}
          />
          <Row
            icon={isEmailVerified ? 'email-check-outline' : 'email-alert-outline'}
            iconColor={isEmailVerified ? colors.success : colors.warning}
            label={t('settings.emailLabel')}
            sub={isEmailVerified ? t('settings.account.emailVerified') : t('settings.account.emailUnverified')}
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
          {/* Only meaningful while the account is private — public accounts are
              followed instantly, so no request is ever raised. */}
          {isPrivate && (
            <Row
              icon="account-clock-outline"
              label={t('settings.followRequests')}
              sub={t('settings.followRequestsSub')}
              onPress={() => navigation.navigate('FollowRequests')}
            />
          )}
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
            label={t('settings.notif.push')}
            sub={t('settings.notif.pushSub')}
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
              label={t(cat.labelKey)}
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
            sub={t('settings.autoplaySub')}
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
            sub={t('settings.dataSaverSub')}
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
            sub={t('settings.videoQualitySub')}
            onPress={cycleVideoQuality}
            last={!MEDIA_QUALITY_TIERS_AVAILABLE}
            right={
              <View style={styles.valuePill}>
                <Text style={styles.valuePillText}>
                  {VIDEO_QUALITY_LABELS[prefs[PREF_KEYS.videoQuality]] || 'Automatic'}
                </Text>
              </View>
            }
          />
          {/* Audio has no per-quality renditions to choose between while media is
              served straight from R2, so offering a picker here would be a
              control that does nothing. Data saver still governs whether a track
              streams or is pulled down in full. Returns automatically once
              MEDIA_QUALITY_TIERS_AVAILABLE flips. */}
          {MEDIA_QUALITY_TIERS_AVAILABLE && (
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
          )}
        </Section>

        {/* ── Support ───────────────────────────────────────────── */}
        <Section title={t('settings.section.support')}>
          <Row
            icon="email-edit-outline"
            label={t('settings.support.contact')}
            sub={t('settings.contactSub')}
            onPress={() => setContactVisible(true)}
          />
          <Row
            icon="star-outline"
            label={t('settings.rateApp', { app: APP_NAME })}
            onPress={() => openLink(STORE_URL, t('settings.storeUnavailable'), t)}
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
              <Text style={styles.modalTitle}>{t('settings.contact.title')}</Text>
              <TouchableOpacity onPress={() => { setContactVisible(false); setContactText(''); }}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.privacyHint}>
              <MaterialCommunityIcons name="lock-outline" size={16} color={colors.textMuted} />
              <Text style={styles.privacyHintText}>{t('settings.contact.hint')}</Text>
            </View>

            <TextInput
              style={styles.input}
              placeholder={t('settings.contact.placeholder')}
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
                    <Text style={styles.sendBtnText}>{t('settings.contact.send')}</Text>
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
              <Text style={styles.modalTitle}>{t('settings.pw.title')}</Text>
              <TouchableOpacity onPress={() => { setPwVisible(false); resetPwForm(); }}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.pwInput}
              placeholder={t('settings.pw.currentPlaceholder')}
              placeholderTextColor={colors.placeholder}
              value={currentPw}
              onChangeText={setCurrentPw}
              secureTextEntry
              autoCapitalize="none"
            />
            <TextInput
              style={styles.pwInput}
              placeholder={t('settings.pw.newPlaceholder')}
              placeholderTextColor={colors.placeholder}
              value={newPw}
              onChangeText={setNewPw}
              secureTextEntry
              autoCapitalize="none"
            />
            <TextInput
              style={styles.pwInput}
              placeholder={t('settings.pw.confirmPlaceholder')}
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
                    <Text style={styles.sendBtnText}>{t('settings.pw.update')}</Text>
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
              <Text style={styles.modalTitle}>{t('settings.deleteTitle')}</Text>
              <TouchableOpacity onPress={() => { setDeleteVisible(false); setDeletePw(''); }}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.privacyHint}>
              <MaterialCommunityIcons name="alert-outline" size={16} color={colors.error} />
              <Text style={[styles.privacyHintText, { color: colors.error }]}>
                {t('settings.deleteWarning')}
              </Text>
            </View>

            <TextInput
              style={styles.pwInput}
              placeholder={t('settings.deleteConfirmPlaceholder')}
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
                    <Text style={styles.sendBtnText}>{t('settings.deleteButton')}</Text>
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
                {t('settings.deactivateHint')}
              </Text>
            </View>

            <TextInput
              style={styles.pwInput}
              placeholder={t('settings.deleteConfirmPlaceholder')}
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
                    <Text style={styles.sendBtnText}>{t('settings.deactivateButton')}</Text>
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

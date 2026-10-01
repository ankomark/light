import React, { useState, useEffect, useMemo, useContext, useCallback } from 'react';
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
  revokeSession,
  revokeOtherSessions,
  exportMyData,
  sendTestPush,
} from '../services/api';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import ChoiceSheet from '../components/ChoiceSheet';
import { peekCache, writeCache, userKey, clearAllCaches } from '../utils/screenCache';
import { useDownloadsSummary, removeAllDownloads } from '../utils/downloads';
import {
  registerForPushNotifications,
  unregisterPushToken,
} from '../services/pushNotifications';
import { PREF_KEYS, AUDIO_QUALITY_TIERS_AVAILABLE } from '../utils/preferences';
import { usePreferences } from '../context/PreferencesContext';
import { useTheme } from '../context/ThemeContext';
import { useI18n } from '../context/I18nContext';
import { typography, spacing, radius, shadows } from '../constants/theme';

const APP_NAME = Constants.expoConfig?.name || 'Adventist Life';

// Settings has one look, whatever the theme (as the Weather page does): black
// ground, the Weather page's faint glass panels and hairlines, and the app's
// gold for headings, icons, values and what is switched on.
const SETTINGS_COLORS = {
  bg: '#000000',
  card: 'rgba(255,255,255,0.055)',
  border: 'rgba(255,255,255,0.11)',
  inputBg: 'rgba(255,255,255,0.08)',
  sheet: '#111316',
  overlay: 'rgba(0,0,0,0.72)',
  textPrimary: '#FFFFFF',
  textSecondary: '#C9D3E0',
  textMuted: '#8E99A8',
  placeholder: '#6B7686',
  primary: '#FFC46B',          // gold
  onPrimary: '#0A0A0A',
  iconTile: 'rgba(255,196,107,0.12)',
  switchOff: 'rgba(255,255,255,0.18)',
  error: '#FF7A6B',
  success: '#5FD39A',
  warning: '#FFB547',
  white: '#FFFFFF',
};
const APP_VERSION = Constants.expoConfig?.version || '1.0.0';
const PACKAGE_ID =
  Constants.expoConfig?.android?.package ||
  Constants.expoConfig?.ios?.bundleIdentifier ||
  'com.ankom.streams';
const STORE_URL =
  Platform.OS === 'ios'
    ? `itms-apps://itunes.apple.com/app/${PACKAGE_ID}`
    : `https://play.google.com/store/apps/details?id=${PACKAGE_ID}`;

// Songs come in 64 / 128 / 256 kbps versions (utils/audioQuality.js).
// Each choice is named through t('settings.quality.<key>').
const AUDIO_QUALITY_CYCLE = ['auto', 'high', 'standard', 'data_saver'];
const DOWNLOAD_QUALITY_CYCLE = ['standard', 'high'];

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
  // Covers the puzzle too: the two games share one streak, so one reminder
  // serves both and a second switch would gate nothing.
  { key: 'quiz', labelKey: 'settings.notif.quiz', icon: 'head-question-outline' },
  { key: 'weather', labelKey: 'settings.notif.weather', icon: 'weather-partly-cloudy' },
  { key: 'verse', labelKey: 'settings.notif.verse', icon: 'book-open-variant' },
  { key: 'books', labelKey: 'settings.notif.books', icon: 'bookshelf' },
  { key: 'notices', labelKey: 'settings.notif.notices', icon: 'bulletin-board' },
  // Orders to sellers, their progress to buyers, wishlist price drops.
  { key: 'marketplace', labelKey: 'settings.notif.marketplace', icon: 'storefront-outline' },
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
// What is typed in the search box at the top: rows that do not match hide,
// and a section with nothing left in it hides too.
const SettingsSearch = React.createContext('');
const matches = (q, ...texts) => !q || texts.some((x) => typeof x === 'string'
  && x.toLowerCase().includes(q.toLowerCase()));
const rowsOf = (children) => React.Children.toArray(children).flatMap((el) => (
  el?.type === React.Fragment ? rowsOf(el.props.children) : [el]
));

const Section = ({ title, children }) => {
  const colors = SETTINGS_COLORS;
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const q = useContext(SettingsSearch);
  if (q && !rowsOf(children).some((el) => matches(q, el?.props?.label, el?.props?.sub, title))) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      <View style={styles.group}>{children}</View>
    </View>
  );
};

const Row = ({ icon, iconColor, label, sub, right, onPress, last, danger, testID }) => {
  const colors = SETTINGS_COLORS;
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const q = useContext(SettingsSearch);
  if (!matches(q, label, sub)) return null;
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
    <TouchableOpacity activeOpacity={0.7} onPress={onPress} testID={testID} accessibilityRole="button">
      {content}
    </TouchableOpacity>
  );
};

/** "12.4 MB" */
const formatBytes = (n) => {
  if (!n) return '0 MB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

/** "22:00" from minutes after midnight. */
const hhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const QUIET_FROM_CHOICES = [20, 21, 22, 23].map((h) => h * 60);
const QUIET_TO_CHOICES = [5, 6, 7, 8].map((h) => h * 60);

const THEME_CYCLE = ['system', 'light', 'dark'];

/** "mark" → "MA", "Mary Atieno" → "MA": the avatar's letters. */
const initialsOf = (name = '') => {
  const words = String(name).trim().split(/[\s._-]+/).filter(Boolean);
  if (!words.length) return '?';
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
};
// The most an export may be as a plain shared message, when no file can be
// shared: Android refuses (and crashes on) much more.
const SHARE_TEXT_MAX = 200 * 1024;

const Settings = () => {
  const navigation = useNavigation();
  const { currentUser, isEmailVerified, logout, updateUser } = useAuth();
  const { preferences: prefs, setPreference: updatePref } = usePreferences();
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const colors = SETTINGS_COLORS;
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

  // Notification preferences (per-category): the last copy at once, the
  // server's behind it — the switches used to sit disabled until it came.
  const notifKey = userKey(currentUser?.id, 'settings:notif');
  const [notifPrefs, setNotifPrefs] = useState(() => peekCache(notifKey));

  // What the search box holds, and which list of choices is open.
  const [query, setQuery] = useState('');
  const [picker, setPicker] = useState(null);
  const downloads = useDownloadsSummary();

  // Security & sessions (devices signed in), kept like the switches.
  const sessionsKey = userKey(currentUser?.id, 'settings:sessions');
  const [sessions, setSessions] = useState(() => peekCache(sessionsKey));
  const sessionCount = sessions ? sessions.length : null;
  const [devicesVisible, setDevicesVisible] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setIsPrivate(!currentUser?.is_public);
  }, [currentUser?.is_public]);

  const loadSessions = () => {
    fetchSessions()
      .then((d) => {
        const list = Array.isArray(d?.sessions) ? d.sessions : null;
        setSessions(list);
        if (list) writeCache(sessionsKey, list);
      })
      .catch(() => {});
  };

  const signOutDevice = (session) => {
    Alert.alert(t('settings.devices.signOutTitle'), t('settings.devices.signOutBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.devices.signOut'),
        style: 'destructive',
        onPress: async () => {
          try {
            await revokeSession(session.id);
            setSessions((list) => (list || []).filter((x) => x.id !== session.id));
            loadSessions();
          } catch {
            Alert.alert(t('common.error'), t('settings.revokeFailed'));
          }
        },
      },
    ]);
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

  // A file, not a message: a few years of posts and orders is far too long
  // for a chat, and a file can be kept or opened on a computer.
  const handleExportData = async () => {
    setExporting(true);
    try {
      const data = await exportMyData();
      const text = JSON.stringify(data, null, 2);
      const day = new Date().toISOString().slice(0, 10);
      const uri = `${FileSystem.cacheDirectory}${APP_NAME.replace(/\s+/g, '-')}-my-data-${day}.json`;
      let shared = false;
      try {
        if (await Sharing.isAvailableAsync()) {
          await FileSystem.writeAsStringAsync(uri, text);
          await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: t('settings.exportTitle') });
          shared = true;
        }
      } catch {
        shared = false;
      }
      if (!shared) {
        if (text.length > SHARE_TEXT_MAX) throw new Error('too big to share as text');
        await Share.share({ title: t('settings.exportTitle'), message: text });
      }
    } catch {
      Alert.alert(t('common.error'), t('settings.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const handleTestPush = async () => {
    try {
      const res = await sendTestPush();
      Alert.alert(
        t('settings.testPush.title'),
        res?.devices ? t('settings.testPush.sent', { n: res.devices }) : t('settings.testPush.noDevices'),
      );
    } catch (e) {
      Alert.alert(t('common.error'), e?.response?.status === 429
        ? t('settings.testPush.tooSoon') : t('settings.testPush.failed'));
    }
  };

  // Load per-category notification preferences once.
  useEffect(() => {
    let alive = true;
    fetchNotificationPreferences()
      .then((data) => {
        if (!alive || !data) return;
        setNotifPrefs(data);
        writeCache(notifKey, data);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [notifKey]);

  // One change (or several) to the notification choices: shown at once,
  // taken back if the server refuses.
  // Each change stands on its own: two switches flipped quickly are two
  // changes, and a refusal takes back only its own fields (and only while
  // nothing newer has changed them), never the other switch.
  const saveNotif = useCallback(async (fields) => {
    let before = {};
    setNotifPrefs((prev) => {
      before = Object.fromEntries(Object.keys(fields).map((k) => [k, prev?.[k]]));
      const next = { ...(prev || {}), ...fields };
      writeCache(notifKey, next);
      return next;
    });
    try {
      await updateNotificationPreferences(fields);
    } catch {
      setNotifPrefs((prev) => {
        const next = { ...(prev || {}) };
        Object.keys(fields).forEach((k) => { if (next[k] === fields[k]) next[k] = before[k]; });
        writeCache(notifKey, next);
        return next;
      });
      Alert.alert(t('common.error'), t('settings.notifPrefFailed'));
    }
  }, [notifKey, t]);

  const toggleNotifCategory = (key, value) => saveNotif({ [key]: value });

  // Quiet hours, on this phone's clock.
  const quietOn = notifPrefs?.quiet_from != null && notifPrefs?.quiet_to != null;
  const utcOffset = () => -new Date().getTimezoneOffset();
  // Moved to another time zone since quiet hours were set: keep them on this
  // phone's clock, quietly.
  const savedOffset = notifPrefs?.utc_offset;
  useEffect(() => {
    if (!quietOn || savedOffset == null || savedOffset === utcOffset()) return;
    const next = { ...(notifPrefs || {}), utc_offset: utcOffset() };
    setNotifPrefs(next);
    writeCache(notifKey, next);
    updateNotificationPreferences({ utc_offset: utcOffset() }).catch(() => {});
  }, [quietOn, savedOffset]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleQuiet = (on) => saveNotif(on
    ? { quiet_from: 22 * 60, quiet_to: 7 * 60, utc_offset: utcOffset() }
    : { quiet_from: null, quiet_to: null });
  const chooseQuiet = (field, choices) => setPicker({
    title: t(`settings.quiet.${field === 'quiet_from' ? 'from' : 'to'}`),
    options: choices.map((m) => ({
      key: String(m),
      label: hhmm(m),
      icon: notifPrefs?.[field] === m ? 'check' : 'schedule',
      onPress: () => saveNotif({ [field]: m, utc_offset: utcOffset() }),
    })),
  });

  // A list to pick from, the current one ticked (instead of tapping through).
  const choose = (title, keys, current, labelOf, onPick) => setPicker({
    title,
    options: keys.map((k) => ({
      key: k,
      label: labelOf(k),
      icon: k === current ? 'radio-button-checked' : 'radio-button-unchecked',
      onPress: () => onPick(k),
    })),
  });

  const clearSavedPages = () => {
    Alert.alert(t('settings.storage.clearTitle'), t('settings.storage.clearBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.storage.clear'),
        onPress: async () => {
          await clearAllCaches();
          Alert.alert(t('common.done'), t('settings.storage.cleared'));
        },
      },
    ]);
  };

  const removeDownloads = () => {
    Alert.alert(t('settings.storage.removeTitle'), t('settings.storage.removeBody', { n: downloads.count }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.storage.remove'),
        style: 'destructive',
        onPress: async () => { await removeAllDownloads(); },
      },
    ]);
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
  // A failure is said and the switch goes back: "off" while the server still
  // sends to this phone, or "on" with no way to reach it, would both lie.
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
      await updatePref(PREF_KEYS.pushEnabled, !next);
      Alert.alert(t('common.error'), next ? t('settings.notif.onFailed') : t('settings.notif.offFailed'));
    }
  };

  const qualityLabel = (k) => t(`settings.quality.${k}`);
  const cycleAudioQuality = () => choose(t('settings.playback.audioQuality'), AUDIO_QUALITY_CYCLE,
    prefs[PREF_KEYS.audioQuality] || 'auto', qualityLabel, (k) => updatePref(PREF_KEYS.audioQuality, k));
  const cycleDownloadQuality = () => choose(t('settings.playback.downloadQuality'), DOWNLOAD_QUALITY_CYCLE,
    prefs[PREF_KEYS.downloadQuality] || 'standard', qualityLabel, (k) => updatePref(PREF_KEYS.downloadQuality, k));
  const cycleVideoQuality = () => choose(t('settings.playback.videoQuality'), VIDEO_QUALITY_CYCLE,
    prefs[PREF_KEYS.videoQuality] || 'auto', qualityLabel, (k) => updatePref(PREF_KEYS.videoQuality, k));
  const cycleTheme = () => choose(t('settings.appearance.theme'), THEME_CYCLE, themeMode,
    (k) => t(`settings.theme.${k}`), setThemeMode);
  const cycleLanguage = () => choose(t('settings.appearance.language'), languages.map((l) => l.code), language,
    (k) => languages.find((l) => l.code === k)?.label || k, setLanguage);

  const themeLabel = t(`settings.theme.${themeMode}`);
  const languageLabel = languages.find((l) => l.code === language)?.label || t('settings.systemDefault');

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
      const res = await changePassword(currentPw, newPw);
      setPwVisible(false);
      resetPwForm();
      loadSessions();
      Alert.alert(t('common.done'), res?.sessions_revoked
        ? t('settings.pw.changedSignedOut', { n: res.sessions_revoked })
        : t('settings.pw.changed'));
    } catch (error) {
      Alert.alert(t('common.error'), error.response?.data?.error || t('settings.pw.changeFailed'));
    } finally {
      setChangingPw(false);
    }
  };

  // The server will not let an account go while a marketplace order is under
  // way (a buyer who paid would be left with no seller, or the reverse).
  const refusedForOrders = (error) => {
    if (error?.response?.data?.code !== 'open_orders') return false;
    setDeleteVisible(false);
    setDeactivateVisible(false);
    Alert.alert(t('settings.openOrders.title'), t('settings.openOrders.body', { n: error.response.data.open_orders }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.openOrders.see'), onPress: () => navigation.navigate('OrderHistory') },
    ]);
    return true;
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
      if (refusedForOrders(error)) return;
      Alert.alert(t('common.error'), error.response?.status === 429
        ? t('settings.tooManyTries') : error.response?.data?.error || t('settings.deleteAccountFailed'));
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
      if (refusedForOrders(error)) return;
      Alert.alert(t('common.error'), error.response?.status === 429
        ? t('settings.tooManyTries') : error.response?.data?.error || t('settings.deactivateFailed'));
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
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.session.logout'),
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
          style={[styles.backBtn, styles.backRound]}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel={t('common.back')}
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('settings.title')}</Text>
        <View style={styles.backBtn} />
      </SafeAreaView>

      <SettingsSearch.Provider value={query.trim()}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled">
        <View style={[styles.searchBox, { marginHorizontal: spacing.md }]}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('settings.search')}
            placeholderTextColor={colors.placeholder}
            value={query}
            onChangeText={setQuery}
            testID="settings-search"
          />
          {!!query && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={8} accessibilityLabel={t('common.close')}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        {/* ── Who is signed in ──────────────────────────────────── */}
        {!query.trim() && (
          <TouchableOpacity style={styles.profileCard} onPress={() => navigation.navigate('Profile')}
                            activeOpacity={0.85} accessibilityRole="button" testID="settings-profile">
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initialsOf(currentUser?.username)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.profileName} numberOfLines={1}>{currentUser?.username || t('settings.yourProfile')}</Text>
              <Text style={styles.profileEmail} numberOfLines={1}>{currentUser?.email || t('settings.tapToEdit')}</Text>
            </View>
            {isEmailVerified ? (
              <View style={styles.verifiedChip}>
                <Text style={styles.verifiedText}>{t('settings.verified')}</Text>
              </View>
            ) : (
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            )}
          </TouchableOpacity>
        )}

        {/* ── Account ───────────────────────────────────────────── */}
        <Section title={t('settings.section.account')}>
          {/* Found by search too: the profile card hides while searching. */}
          {!!query.trim() && (
            <Row
              icon="account-circle-outline"
              label={currentUser?.username || t('settings.yourProfile')}
              sub={currentUser?.email || t('settings.tapToEdit')}
              onPress={() => navigation.navigate('Profile')}
            />
          )}
          {!isEmailVerified && (
            <Row
              icon="email-alert-outline"
              iconColor={colors.warning}
              label={t('settings.emailLabel')}
              sub={t('settings.account.emailUnverified')}
              onPress={() => navigation.navigate('EmailVerification')}
            />
          )}
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
                  trackColor={{ false: colors.switchOff, true: colors.primary }}
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
            label={t('settings.devices.label')}
            sub={sessionCount != null ? t('settings.devices.count', { n: sessionCount }) : undefined}
            onPress={() => { loadSessions(); setDevicesVisible(true); }}
            testID="devices"
          />
          <Row
            icon="logout-variant"
            label={t('settings.security.logoutOthers')}
            sub={sessionCount != null ? t('settings.devices.count', { n: sessionCount }) : undefined}
            onPress={handleLogoutOthers}
            right={revokingOthers ? <ActivityIndicator size="small" color={colors.primary} /> : undefined}
          />
          <Row
            icon="download-outline"
            label={t('settings.security.export')}
            onPress={handleExportData}
            testID="export-data"
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
                testID="push-switch"
                trackColor={{ false: colors.switchOff, true: colors.primary }}
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
              last={false}
              right={
                <Switch
                  value={notifPrefs ? notifPrefs[cat.key] !== false : true}
                  onValueChange={(v) => toggleNotifCategory(cat.key, v)}
                  disabled={!notifPrefs}
                  testID={`notif-${cat.key}`}
                  trackColor={{ false: colors.switchOff, true: colors.primary }}
                  thumbColor={colors.white}
                />
              }
            />
          ))}

          {!!prefs[PREF_KEYS.pushEnabled] && (
            <>
              <Row
                icon="moon-waning-crescent"
                label={t('settings.quiet.label')}
                sub={quietOn
                  ? t('settings.quiet.on', { from: hhmm(notifPrefs.quiet_from), to: hhmm(notifPrefs.quiet_to) })
                  : t('settings.quiet.sub')}
                right={
                  <Switch
                    value={quietOn}
                    onValueChange={toggleQuiet}
                    disabled={!notifPrefs}
                    trackColor={{ false: colors.switchOff, true: colors.primary }}
                    thumbColor={colors.white}
                    testID="quiet-switch"
                  />
                }
              />
              {quietOn && (
                <>
                  <Row icon="clock-start" label={t('settings.quiet.from')} onPress={() => chooseQuiet('quiet_from', QUIET_FROM_CHOICES)}
                       right={<View style={styles.valuePill}><Text style={styles.valuePillText}>{hhmm(notifPrefs.quiet_from)}</Text></View>} />
                  <Row icon="clock-end" label={t('settings.quiet.to')} onPress={() => chooseQuiet('quiet_to', QUIET_TO_CHOICES)}
                       right={<View style={styles.valuePill}><Text style={styles.valuePillText}>{hhmm(notifPrefs.quiet_to)}</Text></View>} />
                </>
              )}
              <Row
                icon="bell-ring-outline"
                label={t('settings.testPush.label')}
                sub={t('settings.testPush.sub')}
                onPress={handleTestPush}
                testID="test-push"
              />
            </>
          )}

          {/* Calendar reminders are scheduled by this phone rather than sent
              from the server, so they survive having no signal — and they are
              not gated by the push master switch above, which is why this row
              sits outside that condition. */}
          <Row
            icon="calendar-clock"
            label={t('settings.notif.calendar')}
            sub={t('settings.notif.calendarSub')}
            last
            right={
              <Switch
                value={prefs[PREF_KEYS.calendarReminders] !== false}
                onValueChange={(v) => updatePref(PREF_KEYS.calendarReminders, v)}
                trackColor={{ false: colors.switchOff, true: colors.primary }}
                thumbColor={colors.white}
              />
            }
          />
        </Section>

        {/* ── Playback & Data ───────────────────────────────────── */}
        <Section title={t('settings.section.playback')}>
          {/* Also on the Videos screen (the phone icon in its top bar). */}
          <Row
            icon="cellphone-play"
            label={t('video.mode.label')}
            sub={t('settings.videoModeSub')}
            right={
              <Switch
                value={!!prefs[PREF_KEYS.videoMode]}
                onValueChange={(v) => updatePref(PREF_KEYS.videoMode, v)}
                trackColor={{ false: colors.switchOff, true: colors.primary }}
                thumbColor={colors.white}
                accessibilityLabel={t('video.mode.label')}
              />
            }
          />
          <Row
            icon="play-circle-outline"
            label={t('settings.playback.autoplay')}
            sub={t('settings.autoplaySub')}
            right={
              <Switch
                value={!!prefs[PREF_KEYS.autoplayVideo]}
                onValueChange={(v) => updatePref(PREF_KEYS.autoplayVideo, v)}
                trackColor={{ false: colors.switchOff, true: colors.primary }}
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
                trackColor={{ false: colors.switchOff, true: colors.primary }}
                thumbColor={colors.white}
              />
            }
          />
          {/* The games' little correct/wrong sounds. The mute button inside a
              game is for its music; this is the switch for the rest. */}
          <Row
            icon="gamepad-variant-outline"
            label={t('settings.playback.gameSounds')}
            sub={t('settings.gameSoundsSub')}
            right={
              <Switch
                value={!!prefs[PREF_KEYS.quizSound]}
                onValueChange={(v) => updatePref(PREF_KEYS.quizSound, v)}
                trackColor={{ false: colors.switchOff, true: colors.primary }}
                thumbColor={colors.white}
              />
            }
          />
          <Row
            icon="video-outline"
            label={t('settings.playback.videoQuality')}
            sub={t('settings.videoQualitySub')}
            onPress={cycleVideoQuality}
            last={!AUDIO_QUALITY_TIERS_AVAILABLE}
            right={
              <View style={styles.valuePill}>
                <Text style={styles.valuePillText}>
                  {qualityLabel(prefs[PREF_KEYS.videoQuality] || 'auto')}
                </Text>
              </View>
            }
          />
          {/* Songs are processed into 64 / 128 / 256 kbps versions, so these
              choices are real: streaming quality, and what offline downloads
              save (and whether they wait for Wi-Fi). */}
          {AUDIO_QUALITY_TIERS_AVAILABLE && (
            <>
              <Row
                icon="music-note-outline"
                label={t('settings.playback.audioQuality')}
                sub={t('settings.audioQualitySub')}
                onPress={cycleAudioQuality}
                right={
                  <View style={styles.valuePill}>
                    <Text style={styles.valuePillText}>
                      {qualityLabel(prefs[PREF_KEYS.audioQuality] || 'auto')}
                    </Text>
                  </View>
                }
              />
              <Row
                icon="download-outline"
                label={t('settings.playback.downloadQuality')}
                sub={t('settings.downloadQualitySub')}
                onPress={cycleDownloadQuality}
                right={
                  <View style={styles.valuePill}>
                    <Text style={styles.valuePillText}>
                      {qualityLabel(prefs[PREF_KEYS.downloadQuality] || 'standard')}
                    </Text>
                  </View>
                }
              />
              <Row
                icon="wifi"
                label={t('settings.playback.downloadWifiOnly')}
                sub={t('settings.downloadWifiOnlySub')}
                last
                right={
                  <Switch
                    value={!!prefs[PREF_KEYS.downloadWifiOnly]}
                    onValueChange={(v) => updatePref(PREF_KEYS.downloadWifiOnly, v)}
                    trackColor={{ false: colors.switchOff, true: colors.primary }}
                    thumbColor={colors.white}
                  />
                }
              />
            </>
          )}
        </Section>

        {/* ── Storage ───────────────────────────────────────────── */}
        <Section title={t('settings.section.storage')}>
          <Row
            icon="download-circle-outline"
            label={t('settings.storage.downloads')}
            sub={t('settings.storage.downloadsSub', { n: downloads.count, size: formatBytes(downloads.bytes) })}
            onPress={downloads.count ? removeDownloads : undefined}
            right={downloads.count ? undefined : null}
            testID="storage-downloads"
          />
          <Row
            icon="broom"
            label={t('settings.storage.saved')}
            sub={t('settings.storage.savedSub')}
            onPress={clearSavedPages}
            last
            testID="storage-clear"
          />
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
          <Row icon="account-off-outline" label={t('settings.session.deactivate')} onPress={confirmDeactivate} right={null} />
          <Row icon="trash-can-outline" label={t('settings.session.delete')} danger onPress={confirmDeleteAccount} last right={null}
               testID="delete-account" />
        </Section>

        {!query.trim() && (
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} accessibilityRole="button" testID="settings-logout">
            <MaterialCommunityIcons name="logout" size={18} color={colors.error} />
            <Text style={styles.logoutText}>{t('settings.session.logout')}</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.version}>{APP_NAME} v{APP_VERSION}</Text>
        <View style={{ height: spacing.xl }} />
      </ScrollView>
      </SettingsSearch.Provider>

      <ChoiceSheet
        visible={!!picker}
        title={picker?.title}
        options={picker?.options || []}
        onClose={() => setPicker(null)}
        cancelLabel={t('common.cancel')}
      />

      {/* Devices signed in to this account */}
      <Modal visible={devicesVisible} animationType="slide" transparent onRequestClose={() => setDevicesVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('settings.devices.label')}</Text>
              <TouchableOpacity onPress={() => setDevicesVisible(false)} accessibilityLabel={t('common.close')}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.privacyHintText}>{t('settings.devices.note')}</Text>
            <ScrollView style={{ maxHeight: 380 }}>
              {(sessions || []).map((sess) => (
                <View key={sess.id} style={styles.deviceRow} testID={`device-${sess.id}`}>
                  <MaterialCommunityIcons name={sess.current ? 'cellphone-check' : 'cellphone'} size={20} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabel}>
                      {sess.current ? t('settings.devices.this') : t('settings.devices.other')}
                    </Text>
                    <Text style={styles.rowSub}>
                      {t('settings.devices.since', { date: new Date(sess.created_at).toLocaleDateString() })}
                    </Text>
                  </View>
                  {!sess.current && (
                    <TouchableOpacity onPress={() => signOutDevice(sess)} testID={`device-out-${sess.id}`}>
                      <Text style={styles.deviceOut}>{t('settings.devices.signOut')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              {sessions && !sessions.length && <Text style={styles.rowSub}>{t('settings.devices.none')}</Text>}
            </ScrollView>
          </View>
        </View>
      </Modal>

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
                ? <ActivityIndicator color={colors.onPrimary} />
                : <>
                    <Ionicons name="send-outline" size={18} color={colors.onPrimary} />
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
              secureTextEntry={!showPw}
              autoCapitalize="none"
            />
            <TextInput
              style={styles.pwInput}
              placeholder={t('settings.pw.newPlaceholder')}
              placeholderTextColor={colors.placeholder}
              value={newPw}
              onChangeText={setNewPw}
              secureTextEntry={!showPw}
              autoCapitalize="none"
              testID="pw-new"
            />
            {!!newPw && (
              <Text style={[styles.rowSub, { marginBottom: spacing.sm }]} testID="pw-strength">
                {t(`settings.pw.strength.${newPw.length < 8 ? 'short' : (/[0-9]/.test(newPw) && /[^A-Za-z0-9]/.test(newPw) && newPw.length >= 12) ? 'strong' : 'fair'}`)}
              </Text>
            )}
            <TextInput
              style={styles.pwInput}
              placeholder={t('settings.pw.confirmPlaceholder')}
              placeholderTextColor={colors.placeholder}
              value={confirmPw}
              onChangeText={setConfirmPw}
              secureTextEntry={!showPw}
              autoCapitalize="none"
            />
            <TouchableOpacity onPress={() => setShowPw((v) => !v)} style={styles.showPw} testID="pw-show">
              <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textSecondary} />
              <Text style={styles.rowSub}>{showPw ? t('settings.pw.hide') : t('settings.pw.show')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sendBtn, changingPw && { opacity: 0.6 }]}
              onPress={handleChangePassword}
              disabled={changingPw}
              activeOpacity={0.85}
            >
              {changingPw
                ? <ActivityIndicator color={colors.onPrimary} />
                : <>
                    <Ionicons name="lock-closed-outline" size={18} color={colors.onPrimary} />
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
              testID="delete-password"
              secureTextEntry
              autoCapitalize="none"
            />

            <TouchableOpacity
              style={[styles.deleteBtn, deleting && { opacity: 0.6 }]}
              onPress={handleDeleteAccount}
              disabled={deleting}
              testID="delete-confirm"
              activeOpacity={0.85}
            >
              {deleting
                ? <ActivityIndicator color={colors.white} />
                : <>
                    <Ionicons name="trash-outline" size={18} color={colors.white} />
                    <Text style={[styles.sendBtnText, { color: colors.white }]}>{t('settings.deleteButton')}</Text>
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
                ? <ActivityIndicator color={colors.onPrimary} />
                : <>
                    <MaterialCommunityIcons name="account-off-outline" size={18} color={colors.onPrimary} />
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
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.card, borderRadius: 20, paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    height: 40, marginBottom: spacing.md,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.textPrimary },
  deviceRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  deviceOut: { color: colors.error, fontWeight: '700', fontSize: 13 },
  showPw: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginBottom: spacing.md },
  root: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.bg,
  },
  backBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  backRound: { borderRadius: 22, backgroundColor: colors.card },
  headerTitle: { fontSize: 18, fontWeight: '800', letterSpacing: 0.3, color: colors.textPrimary },

  scroll: { paddingTop: spacing.sm, paddingBottom: spacing.lg },
  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: spacing.md, padding: 14,
    borderRadius: 18, backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,196,107,0.28)',
  },
  avatar: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: colors.onPrimary, fontSize: 18, fontWeight: '800' },
  profileName: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  profileEmail: { color: colors.textSecondary, fontSize: 13, marginTop: 3 },
  verifiedChip: {
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10, backgroundColor: 'rgba(95,211,154,0.16)',
  },
  verifiedText: { color: colors.success, fontSize: 11, fontWeight: '800' },
  logoutBtn: {
    height: 50, borderRadius: 16, marginHorizontal: spacing.md, marginTop: spacing.lg,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
    borderWidth: 1, borderColor: 'rgba(255,122,107,0.45)', backgroundColor: 'rgba(255,122,107,0.08)',
  },
  logoutText: { color: colors.error, fontSize: 15, fontWeight: '800' },

  section: { marginTop: spacing.md },
  sectionTitle: {
    fontSize: 11.5,
    color: colors.primary,
    letterSpacing: 1.4,
    fontWeight: '800',
    marginLeft: spacing.lg + 2,
    marginBottom: spacing.sm,
  },
  group: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginHorizontal: spacing.md,
    overflow: 'hidden',
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
    width: 34, height: 34, borderRadius: 11,
    backgroundColor: colors.iconTile,
    justifyContent: 'center', alignItems: 'center',
    marginRight: spacing.md,
  },
  rowIconDanger: { backgroundColor: 'rgba(255,122,107,0.14)' },
  rowTextWrap: { flex: 1, marginRight: spacing.sm },
  rowLabel: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  rowSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  switchWrap: { flexDirection: 'row', alignItems: 'center' },
  valuePill: {
    backgroundColor: colors.inputBg,
    borderRadius: radius.full,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  valuePillText: { ...typography.caption, color: colors.primary, fontWeight: '800' },

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
    backgroundColor: colors.sheet,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
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
  sendBtnText: { ...typography.button, color: colors.onPrimary, fontSize: 16 },
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

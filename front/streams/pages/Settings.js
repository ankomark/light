import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useAuth } from '../context/useAuth';
import { updateProfileFields, createAdminNote } from '../services/api';
import {
  registerForPushNotifications,
  unregisterPushToken,
} from '../services/pushNotifications';
import { PREF_KEYS } from '../utils/preferences';
import { usePreferences } from '../context/PreferencesContext';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const APP_NAME = Constants.expoConfig?.name || 'Advent Light';
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
const Section = ({ title, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
    <View style={styles.group}>{children}</View>
  </View>
);

const Row = ({ icon, iconColor, label, sub, right, onPress, last, danger }) => {
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

const Settings = () => {
  const navigation = useNavigation();
  const { currentUser, isEmailVerified, logout, updateUser } = useAuth();
  const { preferences: prefs, setPreference: updatePref } = usePreferences();

  const [isPrivate, setIsPrivate] = useState(!currentUser?.is_public);
  const [savingPrivacy, setSavingPrivacy] = useState(false);

  const [contactVisible, setContactVisible] = useState(false);
  const [contactText, setContactText] = useState('');
  const [sendingContact, setSendingContact] = useState(false);

  useEffect(() => {
    setIsPrivate(!currentUser?.is_public);
  }, [currentUser?.is_public]);

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
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.backBtn} />
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Account ───────────────────────────────────────────── */}
        <Section title="Account">
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
            label="Change password"
            onPress={() => navigation.navigate('ForgotPassword')}
            last
          />
        </Section>

        {/* ── Privacy ───────────────────────────────────────────── */}
        <Section title="Privacy">
          <Row
            icon="lock-outline"
            label="Private account"
            sub="Only approved followers can see your profile"
            last
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
        </Section>

        {/* ── Notifications ─────────────────────────────────────── */}
        <Section title="Notifications">
          <Row
            icon="bell-outline"
            label="Push notifications"
            sub="Likes, comments, messages and notices"
            last
            right={
              <Switch
                value={!!prefs[PREF_KEYS.pushEnabled]}
                onValueChange={handleTogglePush}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.white}
              />
            }
          />
        </Section>

        {/* ── Playback & Data ───────────────────────────────────── */}
        <Section title="Playback & Data">
          <Row
            icon="play-circle-outline"
            label="Autoplay videos"
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
            label="Data saver"
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
            icon="music-note-outline"
            label="Audio quality"
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
        <Section title="Support">
          <Row
            icon="email-edit-outline"
            label="Contact admins"
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
            label="About"
            onPress={() => navigation.navigate('About')}
            last
          />
        </Section>

        {/* ── Session ───────────────────────────────────────────── */}
        <Section title="Session">
          <Row icon="logout" label="Log out" danger onPress={handleLogout} last right={null} />
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
    </View>
  );
};

const styles = StyleSheet.create({
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
});

export default Settings;

import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Linking,
  Share,
  Alert,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { typography, spacing, radius, shadows } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useI18n } from '../context/I18nContext';

// ── Easily-editable brand/contact constants ──────────────────────────────────
const APP_NAME = Constants.expoConfig?.name || 'Adventist Life';
const APP_VERSION = Constants.expoConfig?.version || '1.0.0';
const TAGLINE = 'Faith, music & community — in one place';
const SUPPORT_EMAIL = 'ankomark76@gmail.com';
const WEBSITE_URL = '';        // set when available
const PRIVACY_URL = '';        // set when available
const TERMS_URL = '';          // set when available
const LOGO = require('../assets/logo.png');

const FEATURES = [
  { icon: 'book-music-outline', label: 'Hymnals', desc: 'Sing in 4 languages' },
  { icon: 'headphones', label: 'Music & Audio', desc: 'Stream & playlists' },
  { icon: 'heart-multiple-outline', label: 'Social Feed', desc: 'Share & connect' },
  { icon: 'account-group-outline', label: 'Groups & Chat', desc: 'Fellowship together' },
  { icon: 'storefront-outline', label: 'Marketplace', desc: 'Buy & sell' },
  { icon: 'broadcast', label: 'Live Events', desc: 'Worship in real time' },
  { icon: 'book-open-variant', label: 'Bible & Studies', desc: 'Read & reflect' },
  { icon: 'church', label: 'Churches', desc: 'Find a community' },
];

const openLink = async (url, fallbackMsg) => {
  if (!url) {
    Alert.alert('Coming soon', fallbackMsg || 'This will be available shortly.');
    return;
  }
  try {
    const ok = await Linking.canOpenURL(url);
    if (ok) await Linking.openURL(url);
    else Alert.alert('Unavailable', 'Could not open this link on your device.');
  } catch {
    Alert.alert('Unavailable', 'Could not open this link on your device.');
  }
};

const About = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const year = new Date().getFullYear();

  const handleShare = async () => {
    try {
      await Share.share({
        message: `${APP_NAME} — ${TAGLINE}. Join me on the app!`,
      });
    } catch {
      /* user dismissed */
    }
  };

  const handleEmail = () =>
    openLink(
      `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`${APP_NAME} feedback`)}`,
      'Email is not set up on this device.'
    );

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* ── Hero ─────────────────────────────────────────────── */}
        <LinearGradient
          colors={[colors.primary, colors.primaryDark, colors.surface]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <SafeAreaView edges={['top']} style={styles.heroSafe}>
            <TouchableOpacity
              style={styles.backBtn}
              onPress={() => navigation.goBack()}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="chevron-back" size={26} color={colors.white} />
            </TouchableOpacity>

            <View style={styles.logoWrap}>
              <Image source={LOGO} style={styles.logo} resizeMode="contain" />
            </View>
            <Text style={styles.appName}>{APP_NAME}</Text>
            <Text style={styles.tagline}>{TAGLINE}</Text>

            <View style={styles.versionPill}>
              <MaterialCommunityIcons name="shield-check" size={13} color={colors.white} />
              <Text style={styles.versionText}>{t('about.version')} {APP_VERSION}</Text>
            </View>
          </SafeAreaView>
        </LinearGradient>

        <View style={styles.body}>
          {/* ── Mission ────────────────────────────────────────── */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('about.mission')}</Text>
            <Text style={styles.paragraph}>
              {APP_NAME} brings the worldwide Seventh-day Adventist community together —
              a home for worship, music, fellowship and sharing the good news. From bundled
              hymnals and audio to live events, groups and an open marketplace, everything
              you need to stay connected lives in one beautifully simple app.
            </Text>
          </View>

          {/* ── Feature grid ───────────────────────────────────── */}
          <Text style={[styles.sectionTitle, styles.gridTitle]}>{t('about.whatsInside')}</Text>
          <View style={styles.grid}>
            {FEATURES.map((f) => (
              <View key={f.label} style={styles.featureCard}>
                <View style={styles.featureIcon}>
                  <MaterialCommunityIcons name={f.icon} size={22} color={colors.primary} />
                </View>
                <Text style={styles.featureLabel}>{f.label}</Text>
                <Text style={styles.featureDesc}>{f.desc}</Text>
              </View>
            ))}
          </View>

          {/* ── Get in touch ───────────────────────────────────── */}
          <Text style={[styles.sectionTitle, styles.gridTitle]}>{t('about.getInTouch')}</Text>
          <View style={styles.card}>
            <ActionRow icon="share-social-outline" label={t('about.share')} onPress={handleShare} />
            <Divider />
            <ActionRow icon="mail-outline" label={t('about.contact')} sub={SUPPORT_EMAIL} onPress={handleEmail} />
            <Divider />
            <ActionRow
              icon="globe-outline"
              label={t('about.website')}
              onPress={() => openLink(WEBSITE_URL, 'Our website is coming soon.')}
            />
          </View>

          {/* ── Legal ──────────────────────────────────────────── */}
          <View style={styles.card}>
            <ActionRow
              icon="shield-checkmark-outline"
              label={t('about.privacy')}
              onPress={() => openLink(PRIVACY_URL, 'Our privacy policy is coming soon.')}
            />
            <Divider />
            <ActionRow
              icon="document-text-outline"
              label={t('about.terms')}
              onPress={() => openLink(TERMS_URL, 'Our terms of service are coming soon.')}
            />
          </View>

          {/* ── Footer ─────────────────────────────────────────── */}
          <View style={styles.footer}>
            <View style={styles.madeWith}>
              <Text style={styles.footerText}>Made with </Text>
              <Ionicons name="heart" size={13} color={colors.accent} />
              <Text style={styles.footerText}> for the Adventist community</Text>
            </View>
            <Text style={styles.copyright}>© {year} {APP_NAME}. All rights reserved.</Text>
            <Text style={styles.buildText}>v{APP_VERSION}</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

const ActionRow = ({ icon, label, sub, onPress }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <View style={styles.rowTextWrap}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );
};

const Divider = () => {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View style={styles.divider} />;
};

const GAP = spacing.md;

const makeStyles = (colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingBottom: spacing.xxl },

  hero: {
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    paddingBottom: spacing.xl,
  },
  heroSafe: { alignItems: 'center', paddingHorizontal: spacing.lg },
  backBtn: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoWrap: {
    width: 96,
    height: 96,
    borderRadius: 28,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.sm,
    ...shadows.lg,
  },
  logo: { width: 64, height: 64 },
  appName: { ...typography.h1, color: colors.white, marginTop: spacing.md, letterSpacing: 0.3 },
  tagline: { ...typography.body, color: 'rgba(255,255,255,0.85)', marginTop: spacing.xs, textAlign: 'center' },
  versionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: spacing.md,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  versionText: { color: colors.white, fontSize: 12, fontWeight: '600' },

  body: { padding: spacing.md },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  sectionTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm },
  gridTitle: { marginTop: spacing.xs },
  paragraph: { ...typography.body, color: colors.textSecondary },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  featureCard: {
    width: '48.5%',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: GAP * 0.75,
    ...shadows.sm,
  },
  featureIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: colors.inputBg,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  featureLabel: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  featureDesc: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.inputBg,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  rowTextWrap: { flex: 1 },
  rowLabel: { ...typography.body, color: colors.textPrimary, fontWeight: '500' },
  rowSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: 54 },

  footer: { alignItems: 'center', marginTop: spacing.lg },
  madeWith: { flexDirection: 'row', alignItems: 'center' },
  footerText: { ...typography.caption, color: colors.textSecondary },
  copyright: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
  buildText: { ...typography.caption, color: colors.textMuted, marginTop: 2, opacity: 0.7 },
});

export default About;

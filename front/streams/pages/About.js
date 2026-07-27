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
// Resolved at render — module scope can't call t().
const TAGLINE_KEY = 'about.tagline';
const SUPPORT_EMAIL = 'adventistlight145@gmail.com';
const WEBSITE_URL = '';        // set when available
// Privacy / Terms / Guidelines now open in-app screens (see LegalPage) instead
// of external URLs.
const LOGO = require('../assets/logo-mark.png');

const FEATURES = [
  { icon: 'book-music-outline', labelKey: 'about.feature.hymnals', descKey: 'about.feature.hymnalsDesc' },
  { icon: 'headphones', labelKey: 'about.feature.music', descKey: 'about.feature.musicDesc' },
  { icon: 'heart-multiple-outline', labelKey: 'about.feature.social', descKey: 'about.feature.socialDesc' },
  { icon: 'account-group-outline', labelKey: 'about.feature.groups', descKey: 'about.feature.groupsDesc' },
  { icon: 'storefront-outline', labelKey: 'about.feature.market', descKey: 'about.feature.marketDesc' },
  { icon: 'broadcast', labelKey: 'about.feature.live', descKey: 'about.feature.liveDesc' },
  { icon: 'book-open-variant', labelKey: 'about.feature.bible', descKey: 'about.feature.bibleDesc' },
  { icon: 'church', labelKey: 'about.feature.churches', descKey: 'about.feature.churchesDesc' },
];

// Module scope: no hook here, so the caller passes t in.
const openLink = async (url, fallbackMsg, t) => {
  if (!url) {
    Alert.alert(t('common.comingSoon'), fallbackMsg || t('common.comingSoonBody'));
    return;
  }
  try {
    const ok = await Linking.canOpenURL(url);
    if (ok) await Linking.openURL(url);
    else Alert.alert(t('common.unavailable'), t('common.openLinkDeviceFailed'));
  } catch {
    Alert.alert(t('common.unavailable'), t('common.openLinkDeviceFailed'));
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
        message: `${APP_NAME} — ${t(TAGLINE_KEY)}. Join me on the app!`,
      });
    } catch {
      /* user dismissed */
    }
  };

  const emailWith = (subject) =>
    openLink(
      `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`${APP_NAME} — ${subject}`)}`,
      t('about.emailUnavailable'), t
    );
  const handleEmail = () => emailWith('Feedback');
  const handleDonate = () => emailWith('Support & Donation');
  const handlePartner = () => emailWith('Collaboration & Partnership');

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
            <Text style={styles.tagline}>{t(TAGLINE_KEY)}</Text>

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

          {/* ── Vision ─────────────────────────────────────────── */}
          <View style={styles.card}>
            <View style={styles.visionIcon}>
              <MaterialCommunityIcons name="white-balance-sunny" size={22} color={colors.white} />
            </View>
            <Text style={styles.sectionTitle}>Built for the glory of God</Text>
            <Text style={styles.paragraph}>
              {APP_NAME} was created to honour the great Kingdom of God — a digital home where
              believers everywhere can worship, learn and grow together. Everything we build is
              offered as a small act of service to that greater purpose.
            </Text>
          </View>

          {/* ── Feature grid ───────────────────────────────────── */}
          <Text style={[styles.sectionTitle, styles.gridTitle]}>{t('about.whatsInside')}</Text>
          <View style={styles.grid}>
            {FEATURES.map((f) => (
              <View key={f.labelKey} style={styles.featureCard}>
                <View style={styles.featureIcon}>
                  <MaterialCommunityIcons name={f.icon} size={22} color={colors.primary} />
                </View>
                <Text style={styles.featureLabel}>{t(f.labelKey)}</Text>
                <Text style={styles.featureDesc}>{t(f.descKey)}</Text>
              </View>
            ))}
          </View>

          {/* ── Founder ────────────────────────────────────────── */}
          <Text style={[styles.sectionTitle, styles.gridTitle]}>The Founder</Text>
          <View style={styles.card}>
            <View style={styles.founderHead}>
              <View style={styles.founderAvatar}>
                <MaterialCommunityIcons name="account-tie" size={30} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.founderName}>Eng. Anko Mark</Text>
                <Text style={styles.founderRole}>Founder · Full-stack Software Engineer</Text>
              </View>
            </View>
            <Text style={[styles.paragraph, { marginTop: spacing.sm }]}>
              {APP_NAME} was founded by Eng. Anko Mark, a full-stack software engineer with years
              of experience. Development began in 2023, and Version 1 was released in 2026 — the
              fruit of a long labour of love and faith.
            </Text>
          </View>

          {/* ── Support / donations ────────────────────────────── */}
          <Text style={[styles.sectionTitle, styles.gridTitle]}>Support the mission</Text>
          <View style={styles.card}>
            <Text style={styles.paragraph}>
              Keeping {APP_NAME} online — its servers, storage and live streaming — carries real,
              ongoing costs. If the app has blessed you, we prayerfully invite you to help keep it
              running. Every gift, however small, is deeply appreciated and goes toward serving the
              community for the glory of God.
            </Text>
            <TouchableOpacity style={styles.ctaBtn} onPress={handleDonate} activeOpacity={0.85}>
              <Ionicons name="heart" size={18} color={colors.white} />
              <Text style={styles.ctaBtnText}>Support with a donation</Text>
            </TouchableOpacity>
          </View>

          {/* ── Partner & serve ────────────────────────────────── */}
          <Text style={[styles.sectionTitle, styles.gridTitle]}>Partner &amp; serve with us</Text>
          <View style={styles.card}>
            <Text style={styles.paragraph}>
              We warmly welcome partners — developers, sponsors and volunteers — who would like to
              help make {APP_NAME} even better and take it premium. We are also forming a board of
              management with members from across borders. If you feel called to collaborate or
              serve, please reach out through the contact email below.
            </Text>
            <TouchableOpacity style={styles.ctaBtnOutline} onPress={handlePartner} activeOpacity={0.85}>
              <Ionicons name="people" size={18} color={colors.primary} />
              <Text style={styles.ctaBtnOutlineText}>Get involved</Text>
            </TouchableOpacity>
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
              onPress={() => openLink(WEBSITE_URL, t('about.websiteSoon'), t)}
            />
          </View>

          {/* ── Legal ──────────────────────────────────────────── */}
          <View style={styles.card}>
            <ActionRow
              icon="shield-checkmark-outline"
              label={t('about.privacy')}
              onPress={() => navigation.navigate('LegalPage', { docKey: 'privacy' })}
            />
            <Divider />
            <ActionRow
              icon="document-text-outline"
              label={t('about.terms')}
              onPress={() => navigation.navigate('LegalPage', { docKey: 'terms' })}
            />
            <Divider />
            <ActionRow
              icon="people-outline"
              label={t('about.guidelines')}
              onPress={() => navigation.navigate('LegalPage', { docKey: 'guidelines' })}
            />
          </View>

          {/* ── Footer ─────────────────────────────────────────── */}
          <View style={styles.footer}>
            <View style={styles.madeWith}>
              <Text style={styles.footerText}>{t('about.madeWith')}</Text>
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

  // Vision
  visionIcon: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm, ...shadows.sm,
  },

  // Founder
  founderHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  founderAvatar: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.inputBg,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  founderName: { ...typography.h3, color: colors.textPrimary },
  founderRole: { ...typography.caption, color: colors.primary, fontWeight: '700', marginTop: 2 },

  // Call-to-action buttons
  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.sm + 2,
    marginTop: spacing.md, ...shadows.sm,
  },
  ctaBtnText: { color: colors.white, fontWeight: '800', fontSize: 15 },
  ctaBtnOutline: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.primary,
    borderRadius: radius.full, paddingVertical: spacing.sm + 2, marginTop: spacing.md,
  },
  ctaBtnOutlineText: { color: colors.primary, fontWeight: '800', fontSize: 15 },

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

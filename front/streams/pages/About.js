// About: who we are and what the app holds, the founder, how to support and
// serve, and every way to reach us or read the policies.
import React from 'react';
import {
  View, Text, StyleSheet, Image, Linking, Share, Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useI18n } from '../context/I18nContext';
import { notify } from '../utils/adminConfirm';
import { FONT_SCALE } from '../utils/layout';
import {
  INFO, FONT, InfoScreen, Section, Card, Tiles, Para, InfoButton, useGrid,
} from '../components/info/InfoKit';

// ── Easily-editable brand/contact constants ──────────────────────────────────
const APP_NAME = Constants.expoConfig?.name || 'Adventist Life';
const APP_VERSION = Constants.expoConfig?.version || '1.0.0';
const TAGLINE_KEY = 'about.tagline';
const SUPPORT_EMAIL = 'adventistlight145@gmail.com';
const WEBSITE_URL = '';        // set when available
const PACKAGE_ID = Constants.expoConfig?.android?.package || Constants.expoConfig?.ios?.bundleIdentifier || 'com.ankom.streams';
const STORE_URL = Platform.OS === 'ios'
  ? `itms-apps://itunes.apple.com/app/${PACKAGE_ID}`
  : `https://play.google.com/store/apps/details?id=${PACKAGE_ID}`;
const LOGO = require('../assets/logo-mark.png');

const FEATURES = [
  { icon: 'book-music-outline', labelKey: 'about.feature.hymnals', descKey: 'about.feature.hymnalsDesc' },
  { icon: 'headphones', labelKey: 'about.feature.music', descKey: 'about.feature.musicDesc' },
  { icon: 'heart-multiple-outline', labelKey: 'about.feature.social', descKey: 'about.feature.socialDesc' },
  { icon: 'account-group-outline', labelKey: 'about.feature.groups', descKey: 'about.feature.groupsDesc' },
  { icon: 'storefront-outline', labelKey: 'about.feature.market', descKey: 'about.feature.marketDesc' },
  { icon: 'broadcast', labelKey: 'about.feature.live', descKey: 'about.feature.liveDesc' },
  { icon: 'book-open-variant', labelKey: 'about.feature.bible', descKey: 'about.feature.bibleDesc' },
  { icon: 'home-group', labelKey: 'about.feature.communities', descKey: 'about.feature.communitiesDesc' },
];

const About = () => {
  const navigation = useNavigation();
  const { t } = useI18n();
  const year = new Date().getFullYear();
  // Two features a row on a phone, four on a wide screen, one at a large
  // text size on a narrow one.
  const tile = useGrid().quarter;

  const open = (url, failKey = 'common.openLinkDeviceFailed') => {
    if (!url) { notify(t('common.comingSoon'), t('about.websiteSoon')); return; }
    Linking.openURL(url).catch(() => notify(t('common.unavailable'), t(failKey)));
  };
  const emailWith = (subject) => open(
    `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`${APP_NAME} — ${subject}`)}`, 'about.emailUnavailable');
  const share = () => Share.share({ message: `${APP_NAME} — ${t(TAGLINE_KEY)}. ${t('about.shareInvite')}` }).catch(() => {});
  const legal = (docKey) => () => navigation.navigate('LegalPage', { docKey });

  return (
    <InfoScreen
      title={APP_NAME}
      testID="about-screen"
      hero={(
        // The hero: the mark, the name, what it is, the version.
        <View style={styles.hero}>
          <View style={styles.logoRing}>
            <Image source={LOGO} style={styles.logo} resizeMode="contain" />
          </View>
          <Text style={styles.name} accessibilityRole="header">{APP_NAME}</Text>
          <Text style={styles.tagline}>{t(TAGLINE_KEY)}</Text>
          <View style={styles.versionPill}>
            <MaterialCommunityIcons name="shield-check" size={13} color={INFO.accent} />
            <Text style={styles.versionText} maxFontSizeMultiplier={FONT_SCALE.chrome}>{t('about.version')} {APP_VERSION}</Text>
          </View>
        </View>
      )}
      footer={(
        <View style={styles.footer}>
          <View style={styles.madeWith}>
            <Text style={styles.footerText}>{t('about.madeWith')}</Text>
            <Ionicons name="heart" size={13} color={INFO.accent} />
            <Text style={styles.footerText}> {t('about.forCommunity')}</Text>
          </View>
          <Text style={styles.copyright}>© {year} {APP_NAME}. {t('about.rights')}</Text>
        </View>
      )}
    >
      <Section label={t('about.mission')} plain>
        <Card>
          <Para>
            {APP_NAME} brings the worldwide Seventh-day Adventist community together —
            a home for worship, music, fellowship and sharing the good news. From bundled
            hymnals and audio to live events, groups and an open marketplace where you can buy and sell goods & services for free, everything
            you need to stay connected lives in one beautifully simple app.
          </Para>
        </Card>
      </Section>

      <Card style={styles.vision}>
        <View style={styles.visionIcon}><MaterialCommunityIcons name="white-balance-sunny" size={22} color={INFO.onAccent} /></View>
        <Text style={styles.cardTitle}>Built for the glory of God</Text>
        <Para>
          {APP_NAME} was created to honour the great Kingdom of God — a digital home where
          believers everywhere can worship, learn and grow together. Everything we build is
          offered as a small act of service to that greater purpose.
        </Para>
      </Card>

      <Section label={t('about.whatsInside')} plain>
        <View style={styles.grid}>
          {FEATURES.map((f, i) => {
            // The first tile is lit, as the bento's lead.
            const lead = i === 0;
            return (
              <View key={f.labelKey} style={[styles.feature, lead && styles.featureLead, { width: tile }]}>
                <View style={[styles.featureIcon, lead && styles.featureIconLead]}>
                  <MaterialCommunityIcons name={f.icon} size={21} color={lead ? INFO.onAccent : INFO.accent} />
                </View>
                <Text style={[styles.featureLabel, lead && { color: INFO.onAccent }]}>{t(f.labelKey)}</Text>
                <Text style={[styles.featureDesc, lead && { color: INFO.onAccent }]}>{t(f.descKey)}</Text>
              </View>
            );
          })}
        </View>
      </Section>

      <Section label="The Founder" plain>
        <Card>
          <View style={styles.founderHead}>
            <View style={styles.founderRing}><Text style={styles.founderInitials} maxFontSizeMultiplier={FONT_SCALE.tight}>ENG.</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>T16 Engineers</Text>
              <Text style={styles.founderRole}>FOUNDER · LEAD ENGINEER</Text>
            </View>
          </View>
          <Text style={styles.quote}>“Built for the glory of the kingdom of God.”</Text>
          <View style={styles.chips}>
            {['Full-stack', 'Since 2023', 'v1 · 2026'].map((c) => (
              <View key={c} style={styles.chip}><Text style={styles.chipText} maxFontSizeMultiplier={FONT_SCALE.chrome}>{c}</Text></View>
            ))}
          </View>
        </Card>
      </Section>

      <Section label="Support the mission" plain>
        <Card>
          <Para>
            Keeping {APP_NAME} online — its servers, storage and live streaming — carries real,
            ongoing costs. If the app has blessed you, we prayerfully invite you to help keep it
            running. Every gift, however small, is deeply appreciated and goes toward serving the
            community for the glory of God.
          </Para>
          <InfoButton icon="heart" label="Support with a donation" onPress={() => emailWith(t('about.subject.donation'))} />
        </Card>
      </Section>

      <Section label="Partner & serve with us" plain>
        <Card>
          <Para>
            We warmly welcome partners — developers, sponsors and volunteers — who would like to
            help make {APP_NAME} even better. Please reach out through the contact email below.
          </Para>
          <InfoButton outline icon="people" label="Get involved" onPress={() => emailWith(t('about.subject.partnership'))} />
        </Card>
      </Section>

      <Section label={t('about.getInTouch')} plain>
        <Tiles items={[
          // The address can't break, so it has the whole row.
          { icon: 'email-outline', title: t('about.contact'), sub: SUPPORT_EMAIL, wide: true,
            onPress: () => emailWith(t('about.subject.feedback')) },
          { icon: 'share-variant-outline', title: t('about.share'), onPress: share },
          { icon: 'star-outline', title: t('about.rate'), sub: t('about.rateSub'), onPress: () => open(STORE_URL) },
          { icon: 'web', title: t('about.website'), onPress: () => open(WEBSITE_URL) },
        ]} />
      </Section>

      <Section label={t('about.helpAndPolicies')} plain>
        <Tiles items={[
          { icon: 'lifebuoy', title: t('help.title'), onPress: () => navigation.navigate('Help') },
          { icon: 'compass-outline', title: t('guide.title'), onPress: () => navigation.navigate('UserGuide') },
          { icon: 'shield-check-outline', title: t('about.privacy'), onPress: legal('privacy') },
          { icon: 'file-document-outline', title: t('about.terms'), onPress: legal('terms') },
          { icon: 'account-group-outline', title: t('about.guidelines'), onPress: legal('guidelines') },
        ]} />
      </Section>
    </InfoScreen>
  );
};

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 10, paddingTop: 14, paddingBottom: 8 },
  logoRing: {
    padding: 4, borderRadius: 30, borderWidth: 2, borderColor: INFO.accent, marginBottom: 4,
  },
  logo: { width: 92, height: 92, borderRadius: 26 },
  name: { color: INFO.text, fontSize: 30, fontFamily: FONT.title, letterSpacing: -0.4, textAlign: 'center' },
  tagline: { color: INFO.sub, fontSize: 15, fontFamily: FONT.body, textAlign: 'center', lineHeight: 22 },
  versionPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 999, backgroundColor: INFO.accentSoft,
  },
  versionText: { color: INFO.accent, fontSize: 12, fontFamily: FONT.bold },
  cardTitle: { color: INFO.text, fontSize: 18, fontFamily: FONT.title },
  vision: { marginTop: 14 },
  visionIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: INFO.accent, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  feature: {
    backgroundColor: INFO.card, borderRadius: 20, borderWidth: 1, borderColor: INFO.border, padding: 14, gap: 4,
  },
  featureLead: { backgroundColor: INFO.accent, borderColor: INFO.accent },
  featureIcon: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: INFO.accentSoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  featureIconLead: { backgroundColor: 'rgba(4,32,28,0.14)' },
  featureLabel: { color: INFO.text, fontSize: 14, fontFamily: FONT.bold },
  featureDesc: { color: INFO.muted, fontSize: 12, fontFamily: FONT.body, lineHeight: 17 },
  founderHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  founderRing: {
    width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: INFO.accent,
    alignItems: 'center', justifyContent: 'center', backgroundColor: INFO.cardDeep,
  },
  founderInitials: { color: INFO.text, fontSize: 15, fontFamily: FONT.titleBold, letterSpacing: 0.5 },
  founderRole: { color: INFO.accent, fontSize: 11, fontFamily: FONT.heavy, letterSpacing: 1, marginTop: 3 },
  quote: { color: INFO.text, fontSize: 16, fontFamily: FONT.semi, lineHeight: 24, fontStyle: 'italic' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999,
    backgroundColor: INFO.cardDeep, borderWidth: 1, borderColor: INFO.border,
  },
  chipText: { color: INFO.sub, fontSize: 11, fontFamily: FONT.bold },
  footer: { alignItems: 'center', marginTop: 30, gap: 6 },
  madeWith: { flexDirection: 'row', alignItems: 'center' },
  footerText: { color: INFO.sub, fontSize: 12, fontFamily: FONT.body },
  copyright: { color: INFO.muted, fontSize: 12, fontFamily: FONT.body },
});

export default About;

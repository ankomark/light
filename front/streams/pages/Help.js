// Help: search the common questions (or browse them by topic), quick ways to
// the guide and the policies, and how to reach the team — a problem report
// carries the app version and phone details so it can be looked into.
import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Linking, Platform, LayoutAnimation, UIManager,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';
import { useI18n } from '../context/I18nContext';
import { useAppStatus } from '../context/AppStatusContext';
import { notify } from '../utils/adminConfirm';
import { FONT_SCALE } from '../utils/layout';
import {
  INFO, FONT, InfoScreen, Section, Tiles, Fold, SearchField, Para,
} from '../components/info/InfoKit';

const APP_NAME = Constants.expoConfig?.name || 'Adventist Life';
const APP_VERSION = Constants.expoConfig?.version || '1.0.0';
const SUPPORT_EMAIL = 'adventistlight145@gmail.com';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Each question: its topic, and keys the render resolves. A question with
// `feature` leaves the list while an admin has switched that part off.
const FAQS = [
  { topic: 'account', q: 'help.faq.passwordQ', a: 'help.faq.passwordA' },
  { topic: 'account', q: 'help.faq.forgotQ', a: 'help.faq.forgotA' },
  { topic: 'account', q: 'help.faq.languageQ', a: 'help.faq.languageA' },
  { topic: 'account', q: 'help.faq.wallpaperQ', a: 'help.faq.wallpaperA' },
  { topic: 'account', q: 'help.faq.devicesQ', a: 'help.faq.devicesA' },
  { topic: 'account', q: 'help.faq.deleteQ', a: 'help.faq.deleteA' },
  { topic: 'safety', q: 'help.faq.privateQ', a: 'help.faq.privateA' },
  { topic: 'safety', q: 'help.faq.reportQ', a: 'help.faq.reportA' },
  { topic: 'safety', q: 'help.faq.appealQ', a: 'help.faq.appealA' },
  { topic: 'app', q: 'help.faq.notifQ', a: 'help.faq.notifA', appendAppName: true },
  { topic: 'app', q: 'help.faq.quietQ', a: 'help.faq.quietA' },
  { topic: 'app', q: 'help.faq.offlineQ', a: 'help.faq.offlineA' },
  { topic: 'app', q: 'help.faq.dataQ', a: 'help.faq.dataA' },
  { topic: 'app', q: 'help.faq.storageQ', a: 'help.faq.storageA' },
  { topic: 'app', q: 'help.faq.publishQ', a: 'help.faq.publishA' },
  { topic: 'app', q: 'help.faq.serviceQ', a: 'help.faq.serviceA' },
  { topic: 'bible', q: 'help.faq.versionQ', a: 'help.faq.versionA' },
  { topic: 'bible', q: 'help.faq.notesQ', a: 'help.faq.notesA' },
  { topic: 'bible', q: 'help.faq.widgetQ', a: 'help.faq.widgetA' },
  { topic: 'bible', q: 'help.faq.dailyQuizQ', a: 'help.faq.dailyQuizA', feature: 'quiz' },
  { topic: 'bible', q: 'help.faq.battleQ', a: 'help.faq.battleA', feature: 'quiz' },
  { topic: 'bible', q: 'help.faq.coinsQ', a: 'help.faq.coinsA', feature: 'puzzle' },
  { topic: 'market', q: 'help.faq.sellQ', a: 'help.faq.sellA', feature: 'marketplace' },
  { topic: 'market', q: 'help.faq.payQ', a: 'help.faq.payA', feature: 'marketplace' },
  { topic: 'market', q: 'help.faq.ordersQ', a: 'help.faq.ordersA', feature: 'marketplace' },
  { topic: 'app', q: 'help.faq.contactQ', a: 'help.faq.contactA' },
];
const TOPICS = ['all', 'account', 'safety', 'app', 'bible', 'market'];

const openMail = (subject, body, t) => {
  const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ''}`;
  Linking.openURL(url).catch(() => notify(t('common.unavailable'), t('help.emailUnavailable')));
};

const Help = () => {
  const navigation = useNavigation();
  const { t } = useI18n();
  const [open, setOpen] = useState(null);
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('all');
  const { features } = useAppStatus();

  const answer = (f) => `${t(f.a)}${f.appendAppName ? `${APP_NAME}.` : ''}`;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FAQS.filter((f) => (!f.feature || features?.[f.feature] !== false)
      && (topic === 'all' || f.topic === topic)
      && (!q || `${t(f.q)} ${answer(f)}`.toLowerCase().includes(q)));
  }, [query, topic, t, features]);   // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (k) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((cur) => (cur === k ? null : k));
  };

  // What the team needs to look into a problem, filled in for the person.
  const reportProblem = () => openMail(
    `${APP_NAME} — ${t('help.problemSubject')}`,
    `${t('help.problemPrompt')}\n\n\n— \n${APP_NAME} ${APP_VERSION} · ${Platform.OS} ${Platform.Version}`,
    t,
  );

  return (
    <InfoScreen title={t('help.title')} eyebrow={t('help.eyebrow')} subtitle={t('help.subtitle')} icon="lifebuoy"
      testID="help-screen">
      <SearchField value={query} onChangeText={setQuery} placeholder={t('help.searchPlaceholder')} testID="help-search" />

      <View style={styles.topics}>
        {TOPICS.map((tp) => (
          <TouchableOpacity key={tp} onPress={() => setTopic(tp)} testID={`help-topic-${tp}`}
            accessibilityRole="button" accessibilityState={{ selected: topic === tp }}
            style={[styles.topic, topic === tp && styles.topicOn]}>
            <Text style={[styles.topicText, topic === tp && styles.topicTextOn]} maxFontSizeMultiplier={FONT_SCALE.chrome}>{t(`help.topic.${tp}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Section label={t('help.faq')} plain>
        <View style={styles.faqs}>
          {shown.length ? shown.map((f) => (
            <Fold key={f.q} title={t(f.q)} open={open === f.q} onToggle={() => toggle(f.q)} testID={`help-q-${f.q}`}>
              <Para style={styles.answer}>{answer(f)}</Para>
            </Fold>
          )) : (
            <Text style={styles.none}>{t('help.noMatch')}</Text>
          )}
        </View>
      </Section>

      <Section label={t('help.learnMore')} plain>
        <Tiles items={[
          { icon: 'compass-outline', title: t('guide.title'), sub: t('guide.subtitle'),
            onPress: () => navigation.navigate('UserGuide') },
          { icon: 'account-group-outline', title: t('legal.guidelinesTitle'), sub: t('privacyCentre.guidelinesSub'),
            onPress: () => navigation.navigate('LegalPage', { docKey: 'guidelines' }) },
          { icon: 'shield-account-outline', title: t('privacyCentre.title'), sub: t('privacyCentre.subtitle'),
            onPress: () => navigation.navigate('PrivacyCentre') },
        ]} />
      </Section>

      <Section label={t('help.stillNeedHelp')} plain>
        <Tiles items={[
          { icon: 'bug-outline', title: t('help.reportProblem'), sub: t('help.reportProblemSub'),
            onPress: reportProblem, testID: 'help-report-problem' },
          { icon: 'email-edit-outline', title: t('help.contactInSettings'), sub: t('settings.contactSub'),
            onPress: () => navigation.navigate('Settings') },
          { icon: 'email-outline', title: t('help.emailSupport'), sub: SUPPORT_EMAIL, wide: true,
            onPress: () => openMail(`${APP_NAME} support`, '', t) },
        ]} />
      </Section>
    </InfoScreen>
  );
};

const styles = StyleSheet.create({
  topics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  topic: {
    paddingHorizontal: 14, minHeight: 36, justifyContent: 'center', borderRadius: 999,
    borderWidth: 1, borderColor: INFO.border, backgroundColor: INFO.card,
  },
  topicOn: { backgroundColor: INFO.accent, borderColor: INFO.accent },
  topicText: { color: INFO.sub, fontSize: 13, fontFamily: FONT.bold },
  topicTextOn: { color: INFO.onAccent },
  faqs: { gap: 8 },
  answer: { fontSize: 14, lineHeight: 21 },
  none: { color: INFO.muted, fontSize: 14, fontFamily: FONT.body, padding: 4 },
});

export default Help;

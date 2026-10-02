// The user guide: each part of the app as a tile; the one you open moves to
// the top and says how it works, with a button that takes you there. A
// search narrows the tiles. The words live in i18n/strings.js
// (guide.<key>.title / .body, en + sw).
import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, LayoutAnimation, Platform, UIManager,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useI18n } from '../context/I18nContext';
import { useAppStatus } from '../context/AppStatusContext';
import {
  INFO, FONT, RADIUS, InfoScreen, Section, SearchField, InfoButton, Para, useGrid,
} from '../components/info/InfoKit';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Feed and music first, then everything else; `to` is where "Open" goes.
// A part with `feature` leaves the guide while an admin has switched it off,
// as it leaves the menu.
const PARTS = [
  { key: 'feed', icon: 'heart-multiple-outline', to: 'Home' },
  { key: 'music', icon: 'headphones', to: 'Music' },
  { key: 'hymns', icon: 'book-music-outline', to: 'Hymns' },
  { key: 'bible', icon: 'book-cross', to: 'bible' },
  { key: 'verse', icon: 'format-quote-open', to: 'DailyVerse' },
  { key: 'publishing', icon: 'feather', to: 'Publishing' },
  { key: 'quiz', icon: 'head-question-outline', to: 'QuizHome', feature: 'quiz' },
  { key: 'puzzle', icon: 'puzzle-outline', to: 'PuzzlePlay', feature: 'puzzle' },
  { key: 'communities', icon: 'account-group-outline', to: 'Communities' },
  { key: 'groups', icon: 'account-multiple-outline', to: 'Groups' },
  { key: 'singles', icon: 'ring', to: 'Singles', feature: 'singles' },
  { key: 'messages', icon: 'chat-outline', to: 'Inbox' },
  { key: 'live', icon: 'broadcast', to: 'LiveHub', feature: 'live' },
  { key: 'services', icon: 'briefcase-outline', to: 'Studios' },
  { key: 'market', icon: 'storefront-outline', to: 'MarketplaceHome', feature: 'marketplace' },
  { key: 'notices', icon: 'bulletin-board', to: 'NoticeBoard' },
  { key: 'tools', icon: 'calendar-month-outline', to: 'Calendar' },
  { key: 'account', icon: 'account-cog-outline', to: 'Settings' },
];

const UserGuide = () => {
  const navigation = useNavigation();
  const { t } = useI18n();
  const [open, setOpen] = useState(null);
  const [query, setQuery] = useState('');
  const { features } = useAppStatus();

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const on = PARTS.filter((p) => !p.feature || features?.[p.feature] !== false);
    return q
      ? on.filter((p) => `${t(`guide.${p.key}.title`)} ${t(`guide.${p.key}.body`)}`.toLowerCase().includes(q))
      : on;
  }, [query, t, features]);

  const toggle = (k) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((cur) => (cur === k ? null : k));
  };

  const { half } = useGrid();
  const opened = shown.find((p) => p.key === open);
  const rest = shown.filter((p) => p !== opened);

  return (
    <InfoScreen title={t('guide.title')} eyebrow={t('guide.eyebrow')} subtitle={t('guide.subtitle')}
      icon="compass-outline" testID="guide-screen">
      <Para style={{ marginTop: 10, textAlign: 'center' }}>{t('guide.intro')}</Para>

      <SearchField value={query} onChangeText={setQuery} placeholder={t('guide.searchPlaceholder')} testID="guide-search" />

      <Section label={t('guide.parts')} plain>
        {!!opened && (
          <View style={styles.open}>
            <TouchableOpacity style={styles.openHead} onPress={() => toggle(opened.key)} accessibilityRole="button"
              accessibilityState={{ expanded: true }} testID={`guide-${opened.key}`}>
              <View style={styles.openIcon}><MaterialCommunityIcons name={opened.icon} size={22} color={INFO.onAccent} /></View>
              <Text style={styles.openTitle}>{t(`guide.${opened.key}.title`)}</Text>
              <Ionicons name="chevron-up" size={18} color={INFO.muted} />
            </TouchableOpacity>
            <Para style={{ fontSize: 14.5, lineHeight: 22 }}>{t(`guide.${opened.key}.body`)}</Para>
            <InfoButton icon="arrow-forward" label={t('guide.open', { name: t(`guide.${opened.key}.title`) })}
              onPress={() => navigation.navigate(opened.to)} testID={`guide-open-${opened.key}`} />
          </View>
        )}
        <View style={styles.grid}>
          {rest.map((p, i) => (
            <TouchableOpacity key={p.key} onPress={() => toggle(p.key)} activeOpacity={0.8}
              accessibilityRole="button" accessibilityState={{ expanded: false }} testID={`guide-${p.key}`}
              style={[styles.tile, { width: rest.length % 2 === 1 && i === rest.length - 1 ? '100%' : half }]}>
              <View style={styles.tileIcon}><MaterialCommunityIcons name={p.icon} size={20} color={INFO.accent} /></View>
              <Text style={styles.tileTitle}>{t(`guide.${p.key}.title`)}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {!shown.length && <Text style={styles.none}>{t('help.noMatch')}</Text>}
      </Section>

      <View style={styles.tip}>
        <Ionicons name="bulb-outline" size={20} color={INFO.accent} />
        <Text style={styles.tipText}>{t('guide.footerTip')}</Text>
      </View>
    </InfoScreen>
  );
};

const styles = StyleSheet.create({
  open: {
    backgroundColor: INFO.cardDeep, borderRadius: RADIUS, borderWidth: 1, borderColor: INFO.accent,
    padding: 18, gap: 12, marginBottom: 10,
  },
  openHead: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  openIcon: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: INFO.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  openTitle: { flex: 1, color: INFO.text, fontSize: 17, fontFamily: FONT.title },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  tile: {
    backgroundColor: INFO.card, borderRadius: 20, borderWidth: 1, borderColor: INFO.border,
    padding: 14, gap: 12, minHeight: 104,
  },
  tileIcon: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: INFO.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  tileTitle: { color: INFO.text, fontSize: 14, fontFamily: FONT.bold, lineHeight: 19 },
  none: { color: INFO.muted, fontSize: 14, fontFamily: FONT.body, paddingHorizontal: 4 },
  tip: {
    flexDirection: 'row', gap: 12, marginTop: 24, padding: 16, borderRadius: 20,
    backgroundColor: INFO.cardDeep, borderWidth: 1, borderColor: INFO.border,
  },
  tipText: { flex: 1, color: INFO.sub, fontSize: 13.5, fontFamily: FONT.body, lineHeight: 20 },
});

export default UserGuide;

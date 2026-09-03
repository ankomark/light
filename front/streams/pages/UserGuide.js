import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { typography, spacing, radius, shadows } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useI18n } from '../context/I18nContext';

// Each section pairs an icon with an i18n key; the prose (title + body) lives in
// i18n/strings.js under guide.<key>.title / guide.<key>.body (en + sw). Ordered
// as requested: social feed and music first, then everything else.
const SECTIONS = [
  { icon: 'heart-multiple-outline', key: 'feed' },
  { icon: 'headphones', key: 'music' },
  { icon: 'account-group-outline', key: 'communities' },
  { icon: 'chat-outline', key: 'messages' },
  { icon: 'broadcast', key: 'live' },
  { icon: 'book-open-variant', key: 'bible' },
  { icon: 'storefront-outline', key: 'market' },
  { icon: 'bulletin-board', key: 'notices' },
  { icon: 'account-cog-outline', key: 'account' },
];

const UserGuide = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Hero */}
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
            <View style={styles.heroIcon}>
              <MaterialCommunityIcons name="compass-outline" size={34} color={colors.white} />
            </View>
            <Text style={styles.heroTitle}>{t('guide.title')}</Text>
            <Text style={styles.heroSub}>{t('guide.subtitle')}</Text>
          </SafeAreaView>
        </LinearGradient>

        <View style={styles.body}>
          <Text style={styles.intro}>{t('guide.intro')}</Text>

          {SECTIONS.map((s, i) => (
            <View key={s.key} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={styles.stepBadge}>
                  <Text style={styles.stepNum}>{i + 1}</Text>
                </View>
                <View style={styles.cardIcon}>
                  <MaterialCommunityIcons name={s.icon} size={22} color={colors.primary} />
                </View>
                <Text style={styles.cardTitle}>{t(`guide.${s.key}.title`)}</Text>
              </View>
              <Text style={styles.cardBody}>{t(`guide.${s.key}.body`)}</Text>
            </View>
          ))}

          <View style={styles.tip}>
            <Ionicons name="bulb-outline" size={18} color={colors.accent} />
            <Text style={styles.tipText}>{t('guide.footerTip')}</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

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
    alignSelf: 'flex-start', marginTop: spacing.sm, marginBottom: spacing.sm,
    width: 40, height: 40, borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center',
  },
  heroIcon: {
    width: 72, height: 72, borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.18)', justifyContent: 'center', alignItems: 'center',
    marginTop: spacing.sm,
  },
  heroTitle: { ...typography.h1, color: colors.white, marginTop: spacing.md, textAlign: 'center' },
  heroSub: { ...typography.body, color: 'rgba(255,255,255,0.85)', marginTop: spacing.xs, textAlign: 'center' },

  body: { padding: spacing.md },
  intro: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md, lineHeight: 22 },

  card: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md, ...shadows.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  stepBadge: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: colors.accent,
    justifyContent: 'center', alignItems: 'center', marginRight: spacing.sm,
  },
  stepNum: { color: '#0A1628', fontSize: 12, fontWeight: '800' },
  cardIcon: {
    width: 38, height: 38, borderRadius: radius.md, backgroundColor: colors.inputBg,
    justifyContent: 'center', alignItems: 'center', marginRight: spacing.sm,
  },
  cardTitle: { ...typography.h3, color: colors.textPrimary, flex: 1 },
  cardBody: { ...typography.body, color: colors.textSecondary, lineHeight: 22 },

  tip: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: colors.inputBg, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  tipText: { ...typography.caption, color: colors.textSecondary, flex: 1, lineHeight: 18 },
});

export default UserGuide;

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius, shadows } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useI18n } from '../context/I18nContext';
import { LEGAL_DOCS } from '../content/legal';

// One screen renders any legal document. The route passes { docKey } — one of
// 'privacy' | 'terms' | 'guidelines' (see content/legal.js). Legal prose is
// English (authoritative); the screen chrome is localized.
const LegalPage = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const entry = LEGAL_DOCS[route.params?.docKey] || LEGAL_DOCS.privacy;
  const { titleKey, doc } = entry;
  const title = t(titleKey);

  const paras = (p) => (Array.isArray(p) ? p : [p]);

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
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
            <Text style={styles.heroTitle}>{title}</Text>
            <Text style={styles.heroSub}>{doc.updated}</Text>
          </SafeAreaView>
        </LinearGradient>

        <View style={styles.body}>
          <Text style={styles.intro}>{doc.intro}</Text>

          {doc.sections.map((s) => (
            <View key={s.h} style={styles.section}>
              <Text style={styles.heading}>{s.h}</Text>
              {paras(s.p).map((para, i) => (
                <Text key={i} style={styles.para}>{para}</Text>
              ))}
            </View>
          ))}

          <Text style={styles.footer}>{t('legal.disclaimer')}</Text>
        </View>
      </ScrollView>
    </View>
  );
};

const makeStyles = (colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingBottom: spacing.xxl },
  hero: {
    borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, paddingBottom: spacing.xl,
  },
  heroSafe: { alignItems: 'flex-start', paddingHorizontal: spacing.lg },
  backBtn: {
    marginTop: spacing.sm, marginBottom: spacing.sm, width: 40, height: 40, borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center',
  },
  heroTitle: { ...typography.h1, color: colors.white, marginTop: spacing.sm },
  heroSub: { ...typography.caption, color: 'rgba(255,255,255,0.85)', marginTop: spacing.xs },

  body: { padding: spacing.md },
  intro: { ...typography.body, color: colors.textSecondary, lineHeight: 22, marginBottom: spacing.md },
  section: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md, ...shadows.sm,
  },
  heading: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm },
  para: { ...typography.body, color: colors.textSecondary, lineHeight: 22, marginBottom: spacing.sm },
  footer: {
    ...typography.caption, color: colors.textMuted, fontStyle: 'italic',
    textAlign: 'center', marginTop: spacing.sm, lineHeight: 18,
  },
});

export default LegalPage;

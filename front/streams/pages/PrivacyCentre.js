import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { typography, spacing, radius, shadows } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useI18n } from '../context/I18nContext';

// A hub that explains the app's privacy features and routes to the real controls
// (which live in Settings) and the policy pages — so it complements Settings
// rather than duplicating the toggles.
const PrivacyCentre = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const controls = [
    { icon: 'lock-outline', key: 'privateAccount', to: () => navigation.navigate('Settings') },
    { icon: 'account-cancel-outline', key: 'blocked', to: () => navigation.navigate('Settings') },
    { icon: 'bell-outline', key: 'notifications', to: () => navigation.navigate('Settings') },
    { icon: 'account-remove-outline', key: 'account', to: () => navigation.navigate('Settings') },
  ];
  const policies = [
    { icon: 'shield-check-outline', key: 'privacyPolicy', to: () => navigation.navigate('LegalPage', { docKey: 'privacy' }) },
    { icon: 'account-group-outline', key: 'guidelines', to: () => navigation.navigate('LegalPage', { docKey: 'guidelines' }) },
    { icon: 'file-document-outline', key: 'terms', to: () => navigation.navigate('LegalPage', { docKey: 'terms' }) },
  ];

  const Row = ({ icon, k, onPress }) => (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowIcon}>
        <MaterialCommunityIcons name={icon} size={22} color={colors.primary} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{t(`privacyCentre.${k}`)}</Text>
        <Text style={styles.rowSub}>{t(`privacyCentre.${k}Sub`)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );

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
            <View style={styles.heroIcon}>
              <MaterialCommunityIcons name="shield-account-outline" size={34} color={colors.white} />
            </View>
            <Text style={styles.heroTitle}>{t('privacyCentre.title')}</Text>
            <Text style={styles.heroSub}>{t('privacyCentre.subtitle')}</Text>
          </SafeAreaView>
        </LinearGradient>

        <View style={styles.body}>
          <Text style={styles.intro}>{t('privacyCentre.intro')}</Text>

          <Text style={styles.groupLabel}>{t('privacyCentre.controlsLabel')}</Text>
          <View style={styles.card}>
            {controls.map((c, i) => (
              <React.Fragment key={c.key}>
                {i > 0 && <View style={styles.divider} />}
                <Row icon={c.icon} k={c.key} onPress={c.to} />
              </React.Fragment>
            ))}
          </View>

          <Text style={styles.groupLabel}>{t('privacyCentre.policiesLabel')}</Text>
          <View style={styles.card}>
            {policies.map((c, i) => (
              <React.Fragment key={c.key}>
                {i > 0 && <View style={styles.divider} />}
                <Row icon={c.icon} k={c.key} onPress={c.to} />
              </React.Fragment>
            ))}
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
    borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, paddingBottom: spacing.xl,
  },
  heroSafe: { alignItems: 'center', paddingHorizontal: spacing.lg },
  backBtn: {
    alignSelf: 'flex-start', marginTop: spacing.sm, marginBottom: spacing.sm, width: 40, height: 40,
    borderRadius: radius.full, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center',
  },
  heroIcon: {
    width: 72, height: 72, borderRadius: radius.full, backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center', alignItems: 'center', marginTop: spacing.sm,
  },
  heroTitle: { ...typography.h1, color: colors.white, marginTop: spacing.md, textAlign: 'center' },
  heroSub: { ...typography.body, color: 'rgba(255,255,255,0.85)', marginTop: spacing.xs, textAlign: 'center' },

  body: { padding: spacing.md },
  intro: { ...typography.body, color: colors.textSecondary, lineHeight: 22, marginBottom: spacing.md },
  groupLabel: { ...typography.caption, color: colors.textMuted, textTransform: 'uppercase',
    letterSpacing: 1, marginBottom: spacing.sm, marginLeft: spacing.xs },
  card: {
    backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.lg, overflow: 'hidden', ...shadows.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  rowIcon: {
    width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.inputBg,
    justifyContent: 'center', alignItems: 'center', marginRight: spacing.md,
  },
  rowText: { flex: 1 },
  rowTitle: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  rowSub: { ...typography.caption, color: colors.textMuted, marginTop: 2, lineHeight: 16 },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: 56 },
});

export default PrivacyCentre;

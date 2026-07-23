import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Alert,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { typography, spacing, radius, shadows } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useI18n } from '../context/I18nContext';

const APP_NAME = Constants.expoConfig?.name || 'Adventist Life';
const SUPPORT_EMAIL = 'ankomark76@gmail.com';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Module scope can't call t(); each entry carries keys the render resolves.
const FAQS = [
  { qKey: 'help.faq.privateQ', aKey: 'help.faq.privateA' },
  { qKey: 'help.faq.notifQ', aKey: 'help.faq.notifA', appendAppName: true },
  { qKey: 'help.faq.passwordQ', aKey: 'help.faq.passwordA' },
  { qKey: 'help.faq.sellQ', aKey: 'help.faq.sellA' },
  { qKey: 'help.faq.dataQ', aKey: 'help.faq.dataA' },
  { qKey: 'help.faq.contactQ', aKey: 'help.faq.contactA' },
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

const Help = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(null);

  const toggle = (i) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((cur) => (cur === i ? null : i));
  };

  const emailUs = () =>
    openLink(
      `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`${APP_NAME} support`)}`,
      t('help.emailUnavailable'), t
    );

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
        <Text style={styles.headerTitle}>{t('help.title')}</Text>
        <View style={styles.backBtn} />
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>{t('help.faq')}</Text>

        <View style={styles.group}>
          {FAQS.map((item, i) => {
            const expanded = open === i;
            return (
              <View key={item.qKey} style={[i < FAQS.length - 1 && styles.divider]}>
                <TouchableOpacity style={styles.qRow} onPress={() => toggle(i)} activeOpacity={0.7}>
                  <Text style={styles.qText}>{t(item.qKey)}</Text>
                  <Ionicons
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>
                {expanded && (
                  <Text style={styles.aText}>
                    {t(item.aKey)}{item.appendAppName ? `${APP_NAME}.` : ''}
                  </Text>
                )}
              </View>
            );
          })}
        </View>

        <Text style={styles.intro}>{t('help.stillNeedHelp')}</Text>
        <View style={styles.group}>
          <TouchableOpacity style={styles.actionRow} onPress={() => navigation.navigate('Settings')} activeOpacity={0.7}>
            <View style={styles.actionIcon}>
              <MaterialCommunityIcons name="email-edit-outline" size={20} color={colors.primary} />
            </View>
            <Text style={styles.actionLabel}>{t('help.contactInSettings')}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.actionRow} onPress={emailUs} activeOpacity={0.7}>
            <View style={styles.actionIcon}>
              <MaterialCommunityIcons name="email-outline" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionLabel}>{t('help.emailSupport')}</Text>
              <Text style={styles.actionSub}>{SUPPORT_EMAIL}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </View>
  );
};

const makeStyles = (colors) => StyleSheet.create({
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

  scroll: { padding: spacing.md },
  intro: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 1.2,
    fontWeight: '700',
    marginLeft: spacing.xs,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
    textTransform: 'uppercase',
  },

  group: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadows.sm,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },

  qRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    gap: spacing.sm,
  },
  qText: { ...typography.body, color: colors.textPrimary, fontWeight: '600', flex: 1 },
  aText: {
    ...typography.body,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    marginTop: -spacing.xs,
  },

  actionRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.md },
  actionIcon: {
    width: 36, height: 36, borderRadius: radius.md,
    backgroundColor: colors.inputBg,
    justifyContent: 'center', alignItems: 'center',
  },
  actionLabel: { ...typography.body, color: colors.textPrimary, fontWeight: '500', flex: 1 },
  actionSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
});

export default Help;

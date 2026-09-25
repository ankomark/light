// The reader's "Aa" sheet: theme, font, size, line spacing, margins and
// listening speed — applied as they're tapped, over the page, and kept for
// every book.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from './BottomSheet';
import {
  useReaderSettings, setReaderSetting, resetReaderSettings, READER_THEMES, READER_FONTS,
  TEXT_SIZES, LINE_HEIGHTS, MARGINS, SPEECH_RATES,
} from '../utils/readerSettings';
import { colors, spacing, radius, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const THEME_ORDER = ['author', 'day', 'sepia', 'night', 'oled'];
const FONT_ORDER = ['author', 'lora', 'serif', 'sans', 'atkinson'];

const Row = ({ label, children }) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <View style={styles.rowBody}>{children}</View>
  </View>
);

const Choice = ({ on, onPress, label, children, testID, style }) => (
  <TouchableOpacity onPress={onPress} style={[styles.choice, on && styles.choiceOn, style]}
    accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={label} testID={testID}>
    {children || <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{label}</Text>}
  </TouchableOpacity>
);

const ReaderSettingsSheet = ({ visible, onClose, authorLook, showSpeech = true }) => {
  const { t } = useI18n();
  const s = useReaderSettings();

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      heightRatio={0.62}
      header={(
        <View style={styles.head}>
          <Text style={styles.title}>{t('reader.settings')}</Text>
          <TouchableOpacity onPress={resetReaderSettings} hitSlop={8} accessibilityRole="button" testID="reader-settings-reset">
            <Text style={styles.reset}>{t('reader.resetLook')}</Text>
          </TouchableOpacity>
        </View>
      )}
    >
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Row label={t('reader.theme')}>
          {THEME_ORDER.map((k) => {
            const look = READER_THEMES[k] || { bg: authorLook?.bg || colors.bg, text: authorLook?.text || colors.textPrimary };
            return (
              <Choice key={k} on={s.theme === k} onPress={() => setReaderSetting('theme', k)}
                label={t(`reader.theme.${k}`)} testID={`reader-theme-${k}`} style={styles.swatchWrap}>
                <View style={[styles.swatch, { backgroundColor: look.bg }]}>
                  <Text style={[styles.swatchAa, { color: look.text }]}>Aa</Text>
                </View>
                <Text style={[styles.swatchLabel, s.theme === k && styles.choiceTextOn]} numberOfLines={1}>
                  {t(`reader.theme.${k}`)}
                </Text>
              </Choice>
            );
          })}
        </Row>

        <Row label={t('reader.font')}>
          {FONT_ORDER.map((k) => (
            <Choice key={k} on={s.font === k} onPress={() => setReaderSetting('font', k)}
              label={t(`reader.font.${k}`)} testID={`reader-font-${k}`}>
              <Text style={[styles.choiceText, s.font === k && styles.choiceTextOn,
                READER_FONTS[k] ? { fontFamily: READER_FONTS[k] } : null]}>
                {t(`reader.font.${k}`)}
              </Text>
            </Choice>
          ))}
        </Row>

        <Row label={t('reader.textSize')}>
          <View style={styles.stepper}>
            <TouchableOpacity style={styles.stepBtn} disabled={s.size === 0}
              onPress={() => setReaderSetting('size', s.size - 1)} accessibilityRole="button"
              accessibilityLabel={t('bible.textSmaller')} testID="reader-size-down">
              <Text style={[styles.stepA, { fontSize: 14 }, s.size === 0 && styles.disabled]}>A</Text>
            </TouchableOpacity>
            <Text style={styles.stepValue}>{TEXT_SIZES[s.size]}</Text>
            <TouchableOpacity style={styles.stepBtn} disabled={s.size === TEXT_SIZES.length - 1}
              onPress={() => setReaderSetting('size', s.size + 1)} accessibilityRole="button"
              accessibilityLabel={t('bible.textLarger')} testID="reader-size-up">
              <Text style={[styles.stepA, { fontSize: 22 }, s.size === TEXT_SIZES.length - 1 && styles.disabled]}>A</Text>
            </TouchableOpacity>
          </View>
        </Row>

        <Row label={t('reader.spacing')}>
          {LINE_HEIGHTS.map((_, i) => (
            <Choice key={i} on={s.lineHeight === i} onPress={() => setReaderSetting('lineHeight', i)}
              label={t(`reader.spacing.${i}`)} testID={`reader-spacing-${i}`}>
              <View style={[styles.lines, { gap: 2 + i * 2 }]}>
                {[0, 1, 2].map((n) => <View key={n} style={[styles.lineBar, s.lineHeight === i && styles.lineBarOn]} />)}
              </View>
            </Choice>
          ))}
        </Row>

        <Row label={t('reader.margins')}>
          {MARGINS.map((_, i) => (
            <Choice key={i} on={s.margin === i} onPress={() => setReaderSetting('margin', i)}
              label={t(`reader.margins.${i}`)} testID={`reader-margin-${i}`}>
              <View style={[styles.marginBox, { paddingHorizontal: 2 + i * 3 }]}>
                <View style={[styles.marginText, s.margin === i && styles.lineBarOn]} />
              </View>
            </Choice>
          ))}
        </Row>

        {showSpeech ? (
          <Row label={t('reader.listenSpeed')}>
            {SPEECH_RATES.map((r, i) => (
              <Choice key={r} on={s.speechRate === i} onPress={() => setReaderSetting('speechRate', i)}
                label={`${r}×`} testID={`reader-rate-${i}`} />
            ))}
          </Row>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
  },
  title: { ...typography.h3, color: colors.textPrimary },
  reset: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  body: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
  row: { gap: spacing.xs },
  rowLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  rowBody: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: {
    minHeight: 40, minWidth: 48, paddingHorizontal: spacing.sm, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
  },
  choiceOn: { borderColor: colors.accent, borderWidth: 2 },
  choiceText: { ...typography.label, color: colors.textSecondary, fontWeight: '600' },
  choiceTextOn: { color: colors.textPrimary },
  swatchWrap: { paddingVertical: spacing.xs, gap: 3, width: 60 },
  swatch: { width: 40, height: 30, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(127,127,127,0.4)' },
  swatchAa: { fontSize: 13, fontWeight: '700' },
  swatchLabel: { ...typography.caption, color: colors.textSecondary, fontSize: 10.5 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepBtn: {
    width: 52, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
  },
  stepA: { color: colors.textPrimary, fontWeight: '800' },
  stepValue: { ...typography.label, color: colors.textSecondary, minWidth: 28, textAlign: 'center' },
  disabled: { opacity: 0.35 },
  lines: { width: 26 },
  lineBar: { height: 2, borderRadius: 1, backgroundColor: colors.textMuted },
  lineBarOn: { backgroundColor: colors.textPrimary },
  marginBox: { width: 30, height: 22, borderWidth: 1, borderColor: colors.textMuted, borderRadius: 3, justifyContent: 'center' },
  marginText: { height: 12, backgroundColor: colors.textMuted, borderRadius: 1 },
});

export default ReaderSettingsSheet;

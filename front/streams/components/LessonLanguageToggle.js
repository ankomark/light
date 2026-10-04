/**
 * EN | SW, for the Sabbath School screens: the lessons' language, switched
 * where they are read rather than three screens away in Settings.
 *
 * It changes only the lessons, not the app (services/sabbathSchool.js,
 * useLessonLanguage).
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useI18n } from '../context/I18nContext';
import { LANGUAGES } from '../i18n/strings';
import { LESSON_LANGUAGES } from '../services/sabbathSchool';

const GOLD_SOFT = '#E3C46A';
const DISPLAY = 'Cinzel_700Bold';

const nameOf = (code) => LANGUAGES.find((l) => l.code === code)?.label || code;

const LessonLanguageToggle = ({ value, onChange, ink = '#26324A', style }) => {
  const { t } = useI18n();
  return (
    <View style={[styles.wrap, style]} accessibilityRole="radiogroup" accessibilityLabel={t('ss.language')}>
      {LESSON_LANGUAGES.map((code) => {
        const on = code === value;
        return (
          <TouchableOpacity
            key={code}
            onPress={() => {
              if (on) return;
              Haptics.selectionAsync().catch(() => {});
              onChange(code);
            }}
            style={[styles.option, on && styles.optionOn]}
            hitSlop={6}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={nameOf(code)}
            testID={`lesson-lang-${code}`}
          >
            <Text style={[styles.text, on && { color: ink }]} maxFontSizeMultiplier={1.3}>
              {code.toUpperCase()}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row', padding: 2, borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(227,196,106,0.45)',
  },
  option: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, minWidth: 36, alignItems: 'center' },
  optionOn: { backgroundColor: GOLD_SOFT },
  text: { fontFamily: DISPLAY, fontSize: 11, letterSpacing: 0.8, color: GOLD_SOFT },
});

export default React.memo(LessonLanguageToggle);

// When a draft chapter goes out on its own (serial publishing): quick picks —
// tomorrow morning, Friday evening, Sabbath morning, a week from now — or a
// date and time of the author's choosing. The worker publishes it then and
// readers are told.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from './BottomSheet';
import { colors, spacing, radius, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

let Picker = null;
let PickerAndroid = null;
try {
  // eslint-disable-next-line global-require
  const mod = require('@react-native-community/datetimepicker');
  Picker = mod.default;
  PickerAndroid = mod.DateTimePickerAndroid;
} catch {
  Picker = null;
}

const at = (days, hour, from = new Date()) => {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
};
const nextWeekday = (weekday, hour, from = new Date()) => {
  let days = (weekday - from.getDay() + 7) % 7;
  const candidate = at(days, hour, from);
  if (candidate <= from) days += 7;
  return at(days, hour, from);
};

/** The quick picks, from `now`. */
export const schedulePresets = (now = new Date()) => [
  { key: 'tomorrow', date: at(1, 7, now) },
  { key: 'friday', date: nextWeekday(5, 18, now) },
  { key: 'sabbath', date: nextWeekday(6, 6, now) },
  { key: 'week', date: at(7, 7, now) },
];

export const formatWhen = (iso) => {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '';
  }
};

const ScheduleSheet = ({ visible, value, onPick, onClear, onClose }) => {
  const { t } = useI18n();
  const [custom, setCustom] = useState(null);       // iOS: the inline picker's value

  const pickCustom = () => {
    const start = value ? new Date(value) : at(1, 7);
    if (Platform.OS === 'android' && PickerAndroid) {
      PickerAndroid.open({
        value: start, mode: 'date', minimumDate: new Date(),
        onChange: (e, date) => {
          if (e.type !== 'set' || !date) return;
          PickerAndroid.open({
            value: date, mode: 'time',
            onChange: (e2, time) => {
              if (e2.type !== 'set' || !time) return;
              const d = new Date(date);
              d.setHours(time.getHours(), time.getMinutes(), 0, 0);
              if (d > new Date()) onPick(d.toISOString());
            },
          });
        },
      });
    } else {
      setCustom(start);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      heightRatio={custom ? 0.72 : 0.5}
      header={(
        <View style={styles.head}>
          <Text style={styles.title}>{t('schedule.title')}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8}><Ionicons name="close" size={22} color={colors.textSecondary} /></TouchableOpacity>
        </View>
      )}
    >
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.hint}>{t('schedule.hint')}</Text>
        {schedulePresets().map((p) => (
          <TouchableOpacity key={p.key} style={styles.row} onPress={() => onPick(p.date.toISOString())}
            accessibilityRole="button" testID={`schedule-${p.key}`}>
            <Ionicons name="time-outline" size={18} color={colors.accent} />
            <Text style={styles.rowLabel}>{t(`schedule.preset.${p.key}`)}</Text>
            <Text style={styles.rowWhen}>{formatWhen(p.date)}</Text>
          </TouchableOpacity>
        ))}
        {Picker ? (
          <TouchableOpacity style={styles.row} onPress={pickCustom} accessibilityRole="button" testID="schedule-custom">
            <Ionicons name="calendar-outline" size={18} color={colors.accent} />
            <Text style={styles.rowLabel}>{t('schedule.custom')}</Text>
          </TouchableOpacity>
        ) : null}
        {custom && Picker ? (
          <View>
            <Picker value={custom} mode="datetime" display="inline" minimumDate={new Date()}
              onChange={(e, d) => d && setCustom(d)} themeVariant="dark" />
            <TouchableOpacity style={styles.setBtn} onPress={() => { if (custom > new Date()) onPick(custom.toISOString()); setCustom(null); }}>
              <Text style={styles.setText}>{t('schedule.set')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {value ? (
          <TouchableOpacity style={styles.clear} onPress={onClear} testID="schedule-clear">
            <Text style={styles.clearText}>{t('schedule.clear')}</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  title: { ...typography.h3, color: colors.textPrimary },
  body: { paddingHorizontal: spacing.md, gap: spacing.xs },
  hint: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  rowLabel: { ...typography.label, color: colors.textPrimary, fontWeight: '700', flex: 1 },
  rowWhen: { ...typography.caption, color: colors.textSecondary },
  setBtn: { backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' },
  setText: { ...typography.label, color: colors.white, fontWeight: '700' },
  clear: { alignItems: 'center', padding: spacing.sm },
  clearText: { ...typography.label, color: colors.error, fontWeight: '700' },
});

export default ScheduleSheet;

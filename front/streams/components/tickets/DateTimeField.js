/**
 * A date-and-time field in the tickets' style.
 *
 * Android opens the system date picker, then the time picker (the pattern
 * components/ScheduleSheet.js uses); iOS shows the inline picker in a sheet
 * with Done. The picker is already in the build, but it is required inside a
 * try, as ScheduleSheet does, so a build without it shows the field disabled
 * rather than crashing.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T, F, tap } from './TicketKit';

let Picker = null;
let PickerAndroid = null;
try {
  const mod = require('@react-native-community/datetimepicker');
  Picker = mod.default;
  PickerAndroid = mod.DateTimePickerAndroid;
} catch {
  Picker = null;
}

const DateTimeField = ({
  label, value, onChange, placeholder, display, minimumDate, clearable, clearLabel, doneLabel, error, testID,
}) => {
  const [draft, setDraft] = useState(null);       // iOS: the inline picker's value
  const start = () => (value ? new Date(value) : (() => {
    const d = new Date(minimumDate || Date.now());
    d.setDate(d.getDate() + 7);
    d.setHours(18, 0, 0, 0);
    return d;
  })());

  const open = () => {
    tap();
    if (Platform.OS === 'android' && PickerAndroid) {
      PickerAndroid.open({
        value: start(), mode: 'date', minimumDate,
        onChange: (e, date) => {
          if (e.type !== 'set' || !date) return;
          PickerAndroid.open({
            value: date, mode: 'time', is24Hour: true,
            onChange: (e2, at) => {
              if (e2.type !== 'set' || !at) return;
              const d = new Date(date);
              d.setHours(at.getHours(), at.getMinutes(), 0, 0);
              onChange(d.toISOString());
            },
          });
        },
      });
    } else {
      setDraft(start());
    }
  };

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        onPress={open}
        disabled={!Picker}
        style={[styles.field, !!error && styles.fieldBad]}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ? display : placeholder}`}
        testID={testID}
      >
        <Ionicons name="calendar-outline" size={18} color={value ? T.champagne : T.faint} />
        <Text style={[styles.value, !value && styles.placeholder]} numberOfLines={1}>{value ? display : placeholder}</Text>
        {clearable && !!value && (
          <TouchableOpacity onPress={() => { tap(); onChange(null); }} hitSlop={10}
                            accessibilityRole="button" accessibilityLabel={clearLabel}>
            <Ionicons name="close-circle" size={18} color={T.faint} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
      {!!error && <Text style={styles.error}>{error}</Text>}

      {Platform.OS !== 'android' && Picker && (
        <Modal visible={!!draft} transparent animationType="fade" onRequestClose={() => setDraft(null)}>
          <Pressable style={styles.backdrop} onPress={() => setDraft(null)} />
          <View style={styles.sheet}>
            {!!draft && (
              <Picker
                value={draft}
                mode="datetime"
                display="inline"
                minimumDate={minimumDate}
                onChange={(e, d) => d && setDraft(d)}
                themeVariant="dark"
                accentColor={T.gold}
              />
            )}
            <TouchableOpacity
              style={styles.done}
              onPress={() => { onChange(draft.toISOString()); setDraft(null); }}
              accessibilityRole="button"
            >
              <Text style={styles.doneText}>{doneLabel}</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  label: { fontFamily: F.uiBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: T.muted, marginTop: 22, marginBottom: 8 },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 12, height: 54, borderRadius: 16, paddingHorizontal: 16,
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.line,
  },
  fieldBad: { borderColor: T.danger },
  value: { flex: 1, fontFamily: F.uiSemi, fontSize: 16, color: T.ivory },
  placeholder: { color: T.faint },
  error: { fontFamily: F.ui, fontSize: 13, color: T.danger, marginTop: 8, marginLeft: 4 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: T.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, paddingBottom: 34,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: T.lineStrong,
  },
  done: { alignSelf: 'center', marginTop: 10, paddingVertical: 11, paddingHorizontal: 34, borderRadius: 22, backgroundColor: T.gold },
  doneText: { fontFamily: F.uiHeavy, fontSize: 14, color: T.paperInk },
});

export default DateTimeField;

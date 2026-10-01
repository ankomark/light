// The pieces the product forms are built of, in the dark form theme
// (formTheme.js): a section card with its heading, a labelled field, an input
// that lights up gold while typed in, and a row of choices.
import React, { forwardRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { formTheme as F } from './formTheme';

/** A card with an icon, a heading and an optional line under it. */
export const FormSection = ({ icon, title, hint, children, testID }) => (
  <View style={styles.section} testID={testID}>
    <View style={styles.sectionHead}>
      {!!icon && (
        <View style={styles.sectionIcon}>
          <Icon name={icon} size={13} color={F.accent} />
        </View>
      )}
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
    {!!hint && <Text style={styles.sectionHint}>{hint}</Text>}
    {children}
  </View>
);

/** A label above what is typed or chosen; "optional" or the error beside it. */
export const Field = ({ label, note, error, children, style }) => (
  <View style={[styles.field, style]}>
    <View style={styles.labelRow}>
      <Text style={styles.label}>{label}</Text>
      {!!note && <Text style={styles.note}>{note}</Text>}
    </View>
    {children}
    {!!error && <Text style={styles.error}>{error}</Text>}
  </View>
);

/** A dark input; its border turns gold while in use, red when wrong. */
export const FormInput = forwardRef(({ style, invalid, multiline, onFocus, onBlur, ...rest }, ref) => {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={F.placeholder}
      selectionColor={F.accent}
      multiline={multiline}
      onFocus={(e) => { setFocused(true); onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); onBlur?.(e); }}
      style={[
        styles.input, multiline && styles.multiline,
        focused && styles.inputFocused, invalid && styles.inputInvalid, style,
      ]}
      {...rest}
    />
  );
});

/** One of a few, side by side (the condition). */
export const Choices = ({ options, value, onChange, testIDPrefix = 'choice' }) => (
  <View style={styles.choices} accessibilityRole="radiogroup">
    {options.map((o) => {
      const on = o.value === value;
      return (
        <TouchableOpacity
          key={o.value}
          style={[styles.choice, on && styles.choiceOn]}
          onPress={() => onChange(o.value)}
          accessibilityRole="radio"
          accessibilityState={{ selected: on }}
          testID={`${testIDPrefix}-${o.value}`}
        >
          <Text style={[styles.choiceText, on && styles.choiceTextOn]} numberOfLines={1}>{o.label}</Text>
        </TouchableOpacity>
      );
    })}
  </View>
);

export const formStyles = StyleSheet.create({
  // The one button that matters, at the foot of the form.
  submit: {
    height: 54, borderRadius: 14, backgroundColor: F.accent,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    marginTop: 8,
  },
  submitBusy: { opacity: 0.75 },
  submitText: { color: F.onAccent, fontSize: 16, fontWeight: '800' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: F.field, marginTop: 12, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: F.accent },
});

const styles = StyleSheet.create({
  section: {
    backgroundColor: F.card, borderRadius: 18, padding: 16, marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: F.cardBorder,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionIcon: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,196,107,0.12)',
  },
  sectionTitle: { color: F.text, fontSize: 17, fontWeight: '800' },
  sectionHint: { color: F.muted, fontSize: 13, lineHeight: 18, marginTop: 6 },
  field: { marginTop: 14 },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 7 },
  label: { color: F.label, fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  note: { color: F.muted, fontSize: 12 },
  error: { color: F.danger, fontSize: 12, marginTop: 6 },
  input: {
    backgroundColor: F.field, borderWidth: 1, borderColor: F.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: F.text, minHeight: 48,
  },
  multiline: { minHeight: 104, textAlignVertical: 'top' },
  inputFocused: { borderColor: F.focus },
  inputInvalid: { borderColor: F.danger },
  choices: { flexDirection: 'row', gap: 8 },
  choice: {
    flex: 1, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: F.field, borderWidth: 1, borderColor: F.border,
  },
  choiceOn: { backgroundColor: F.accent, borderColor: F.accent },
  choiceText: { color: F.text, fontSize: 13.5, fontWeight: '700' },
  choiceTextOn: { color: F.onAccent },
});

// A song's licence and optional credits (composer, producer, copyright
// owner, ISRC), for the upload and edit forms. `value` is
// { license, composer, producer, rights_holder, isrc }; `onChange` gets the
// whole object back.
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

export const LICENSES = ['all_rights_reserved', 'public_domain', 'creative_commons'];
export const EMPTY_RIGHTS = { license: 'all_rights_reserved', composer: '', producer: '', rights_holder: '', isrc: '' };

// The server stores ISRC as 12 characters; it accepts dashes and lower case.
export const isrcLooksValid = (v) => {
  const code = String(v || '').replace(/[\s-]/g, '').toUpperCase();
  return !code || /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(code);
};

const RightsFields = ({ value = EMPTY_RIGHTS, onChange, inputStyle, labelStyle }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(!!(value.composer || value.producer || value.rights_holder || value.isrc));
  const set = (k) => (v) => onChange({ ...value, [k]: v });

  return (
    <View>
      <Text style={labelStyle}>{t('rights.license')}</Text>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {LICENSES.map((l) => {
          const on = value.license === l;
          return (
            <TouchableOpacity
              key={l}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => onChange({ ...value, license: l })}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(`rights.license.${l}`)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <TouchableOpacity style={styles.toggle} onPress={() => setOpen((o) => !o)} accessibilityRole="button">
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={16} color={colors.primary} />
        <Text style={styles.toggleText}>{t('rights.creditsOptional')}</Text>
      </TouchableOpacity>
      {open ? (
        <View>
          {[
            ['composer', 'rights.composer'],
            ['producer', 'rights.producer'],
            ['rights_holder', 'rights.owner'],
          ].map(([k, label]) => (
            <View key={k}>
              <Text style={labelStyle}>{t(label)}</Text>
              <TextInput style={inputStyle} value={value[k]} onChangeText={set(k)} maxLength={150} placeholderTextColor={colors.placeholder} />
            </View>
          ))}
          <Text style={labelStyle}>{t('rights.isrc')}</Text>
          <TextInput
            style={[inputStyle, !isrcLooksValid(value.isrc) && styles.bad]}
            value={value.isrc}
            onChangeText={set('isrc')}
            autoCapitalize="characters"
            maxLength={20}
            placeholder="KE-A1B-26-00001"
            placeholderTextColor={colors.placeholder}
          />
          {!isrcLooksValid(value.isrc) ? <Text style={styles.badText}>{t('rights.isrcFormat')}</Text> : null}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.full, justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(255,255,255,0.06)',
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 13.5, fontWeight: '600' },
  chipTextOn: { color: colors.white },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, marginTop: spacing.sm },
  toggleText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  bad: { borderColor: colors.error },
  badText: { color: colors.error, fontSize: 12, marginTop: 4 },
});

export default RightsFields;

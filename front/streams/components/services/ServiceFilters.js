// Services' filters and sort, as a sheet: sort (recommended, nearest, top
// rated, newest), open now, verified only, a minimum rating, a price range.
// Plus the helpers that turn them into what the server takes.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from '../BottomSheet';
import useKeyboardHeight from '../../hooks/useKeyboardHeight';
import { DAYS } from '../../services/servicesCatalog';
import { pointParam } from '../../services/serviceLocation';
import { colors, typography, spacing, radius } from '../../constants/theme';

export const NO_FILTERS = { sort: '', openNow: false, verified: false, minRating: 0, minPrice: '', maxPrice: '', saved: false };
export const SORTS = ['', 'near', 'rating', 'new'];
const RATINGS = [0, 3, 4, 4.5];

/** How many filters are on (sort and "near" not counted). */
export const activeCount = (f) => [f.openNow, f.verified, f.minRating > 0, !!f.minPrice, !!f.maxPrice, f.saved]
  .filter(Boolean).length;

/** The viewer's own day and time, as the server's ?open_at= takes it. */
export const openAtNow = (now = new Date()) => {
  const day = DAYS[(now.getDay() + 6) % 7];
  return `${day},${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

/** Filters (+ the place, for near) → the list's query params. */
export const filterParams = (f, place) => {
  const p = {};
  if (place) p.near = pointParam(place);
  if (f.sort && (f.sort !== 'near' || place)) p.sort = f.sort;
  if (f.openNow) p.open_at = openAtNow();
  if (f.verified) p.verified = 1;
  if (f.minRating) p.min_rating = f.minRating;
  if (f.minPrice) p.min_price = f.minPrice;
  if (f.maxPrice) p.max_price = f.maxPrice;
  if (f.saved) p.saved = 1;
  return p;
};

const Switch = ({ on, label, onPress, testID }) => (
  <TouchableOpacity style={styles.switchRow} onPress={onPress} accessibilityRole="switch" accessibilityState={{ checked: on }} testID={testID}>
    <Text style={styles.switchLabel}>{label}</Text>
    <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.primary : colors.textSecondary} />
  </TouchableOpacity>
);

const ServiceFilters = ({ visible, onClose, value, onApply, hasPlace, t }) => {
  const kb = useKeyboardHeight();
  const [f, setF] = useState(value);
  useEffect(() => { if (visible) setF(value); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  return (
    <BottomSheet visible={visible} onClose={onClose} keyboardHeight={kb} heightRatio={0.78}
      header={(
        <View style={styles.head}>
          <TouchableOpacity onPress={() => setF(NO_FILTERS)} hitSlop={8} testID="filters-reset">
            <Text style={styles.reset}>{t('services.filters.reset')}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{t('services.filters.title')}</Text>
          <TouchableOpacity onPress={() => { onApply(f); onClose(); }} hitSlop={8} testID="filters-apply">
            <Text style={styles.apply}>{t('services.filters.apply')}</Text>
          </TouchableOpacity>
        </View>
      )}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" testID="service-filters">
        <Text style={styles.label}>{t('services.filters.sort')}</Text>
        <View style={styles.chips}>
          {SORTS.map((s) => {
            const on = f.sort === s;
            const off = s === 'near' && !hasPlace;
            return (
              <TouchableOpacity key={s || 'default'} style={[styles.chip, on && styles.chipOn, off && styles.chipOff]}
                onPress={() => set('sort', s)} accessibilityRole="radio" accessibilityState={{ checked: on }} testID={`filters-sort-${s || 'default'}`}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(`services.sort.${s || 'default'}`)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {f.sort === 'near' && !hasPlace ? <Text style={styles.hint}>{t('services.filters.nearNeedsPlace')}</Text> : null}

        <Switch on={f.openNow} label={t('services.filters.openNow')} onPress={() => set('openNow', !f.openNow)} testID="filters-open" />
        <Switch on={f.verified} label={t('services.filters.verified')} onPress={() => set('verified', !f.verified)} testID="filters-verified" />
        <Switch on={f.saved} label={t('services.filters.saved')} onPress={() => set('saved', !f.saved)} testID="filters-saved" />

        <Text style={styles.label}>{t('services.filters.rating')}</Text>
        <View style={styles.chips}>
          {RATINGS.map((r) => {
            const on = f.minRating === r;
            return (
              <TouchableOpacity key={r} style={[styles.chip, on && styles.chipOn]} onPress={() => set('minRating', r)}
                accessibilityRole="radio" accessibilityState={{ checked: on }} testID={`filters-rating-${r}`}>
                {r ? <Ionicons name="star" size={12} color={on ? colors.white : colors.accent} /> : null}
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{r ? `${r}+` : t('services.filters.any')}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.label}>{t('services.filters.price')}</Text>
        <View style={styles.prices}>
          <TextInput style={styles.price} value={f.minPrice} onChangeText={(v) => set('minPrice', v.replace(/[^\d.]/g, ''))}
            keyboardType="numeric" placeholder={t('services.filters.min')} placeholderTextColor={colors.placeholder} testID="filters-min" />
          <Text style={styles.dash}>–</Text>
          <TextInput style={styles.price} value={f.maxPrice} onChangeText={(v) => set('maxPrice', v.replace(/[^\d.]/g, ''))}
            keyboardType="numeric" placeholder={t('services.filters.max')} placeholderTextColor={colors.placeholder} testID="filters-max" />
        </View>
      </ScrollView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  title: { ...typography.h3, color: colors.textPrimary },
  reset: { ...typography.label, color: colors.textSecondary },
  apply: { ...typography.label, color: colors.primary, fontWeight: '800' },
  body: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, gap: spacing.xs },
  label: { ...typography.caption, color: colors.textSecondary, fontWeight: '800', textTransform: 'uppercase', marginTop: spacing.md },
  hint: { ...typography.caption, color: colors.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipOff: { opacity: 0.55 },
  chipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  chipTextOn: { color: colors.white },
  switchRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  switchLabel: { ...typography.body, color: colors.textPrimary },
  prices: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  price: {
    flex: 1, color: colors.textPrimary, fontSize: 15, backgroundColor: colors.inputBg, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  dash: { ...typography.body, color: colors.textMuted },
});

export default ServiceFilters;

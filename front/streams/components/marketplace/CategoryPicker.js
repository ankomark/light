// Choosing a product's category: the marketplace's fixed list as chips to tap
// (utils/categoryIcons.js MARKET_CATEGORIES). Nothing to type, so no new
// category can be made by a seller; a category staff add later is shown too.
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { fetchProductCategories } from '../../services/api';
import { useI18n } from '../../context/I18nContext';
import { MARKET_CATEGORIES, categoryLabel } from '../../utils/categoryIcons';
import { formTheme as F } from './formTheme';

const listOf = (data) => (Array.isArray(data) ? data : (data?.results || []));

export default function CategoryPicker({ value, onChange }) {
  const { t } = useI18n();
  const [names, setNames] = useState(MARKET_CATEGORIES);

  // The list is here at once; the server's adds any staff have added.
  useEffect(() => {
    let live = true;
    fetchProductCategories()
      .then((data) => {
        const extra = listOf(data).map((c) => c.name).filter((n) => n && !MARKET_CATEGORIES.includes(n));
        if (live && extra.length) {
          setNames([...MARKET_CATEGORIES.filter((n) => n !== 'Other'), ...extra, 'Other']);
        }
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  return (
    <View style={styles.wrap} accessibilityRole="radiogroup">
      {names.map((name) => {
        const on = value === name;
        return (
          <TouchableOpacity
            key={name}
            style={[styles.chip, on && styles.chipOn]}
            onPress={() => onChange(name)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            testID={`category-${name}`}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
              {categoryLabel(name, t)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    height: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: 'center',
    backgroundColor: F.field, borderWidth: 1, borderColor: F.border,
  },
  chipOn: { backgroundColor: F.accent, borderColor: F.accent },
  chipText: { fontSize: 13, fontWeight: '600', color: F.text },
  chipTextOn: { color: F.onAccent },
});

// Pick a song's genre: one tappable chip per genre (tap the chosen one again
// to clear it). The list comes from GET /categories/, cached for the session.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { fetchGenres } from '../services/api';
import { peekCache, readCache, writeCache } from '../utils/screenCache';
import { genreName } from '../utils/genres';
import { colors, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const KEY = 'music:genres';

const GenrePicker = ({ value, onChange }) => {
  const { t } = useI18n();
  const [genres, setGenres] = useState(() => peekCache(KEY) || []);

  useEffect(() => {
    let cancelled = false;
    if (!genres.length) readCache(KEY).then((c) => { if (!cancelled && Array.isArray(c)) setGenres((g) => (g.length ? g : c)); });
    fetchGenres()
      .then((rows) => { if (!cancelled && rows.length) { setGenres(rows); writeCache(KEY, rows); } })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!genres.length) return null;
  return (
    <View style={styles.wrap} accessibilityRole="radiogroup">
      {genres.map((g) => {
        const on = value === g.slug;
        return (
          <TouchableOpacity
            key={g.slug}
            style={[styles.chip, on && styles.chipOn]}
            onPress={() => onChange(on ? null : g.slug)}
            activeOpacity={0.85}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
          >
            <Text style={[styles.text, on && styles.textOn]}>{genreName(t, g)}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.full, justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(255,255,255,0.06)',
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  text: { color: colors.textSecondary, fontSize: 13.5, fontWeight: '600' },
  textOn: { color: colors.white },
});

export default GenrePicker;

// Which of your albums a new upload goes on: none, one you have, or a new
// one (made when the upload is shared). `value` is
//   null                      no album
//   { id, title, count }      an album you have (count: songs on it now)
//   { newTitle }              a new album by that name
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { fetchAlbums } from '../services/api';
import { colors, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const AlbumPicker = ({ value, onChange, preselectId = null, inputStyle }) => {
  const { t } = useI18n();
  const [albums, setAlbums] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchAlbums()
      .then((rows) => {
        if (!alive) return;
        const list = Array.isArray(rows) ? rows : [];
        setAlbums(list);
        // Opened from an album's page: that album, already chosen.
        const pre = preselectId != null && list.find((a) => String(a.id) === String(preselectId));
        if (pre) onChange({ id: pre.id, title: pre.title, count: pre.track_count || 0 });
      })
      .catch(() => alive && setAlbums([]));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectId]);

  const isNew = !!value && value.newTitle !== undefined;
  const chip = (key, label, on, onPress, icon) => (
    <TouchableOpacity
      key={key}
      style={[styles.chip, on && styles.chipOn]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
    >
      {icon ? <Feather name={icon} size={13} color={on ? colors.white : colors.primary} /> : null}
      <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {chip('none', t('upload.album.none'), !value, () => onChange(null))}
        {(albums || []).map((a) => chip(
          `a_${a.id}`, a.title, value?.id === a.id,
          () => onChange({ id: a.id, title: a.title, count: a.track_count || 0 }),
        ))}
        {chip('new', t('upload.album.new'), isNew, () => onChange({ newTitle: isNew ? value.newTitle : '' }), 'plus')}
      </View>
      {albums === null ? <Text style={styles.hint}>{t('upload.album.loading')}</Text> : null}
      {isNew ? (
        <TextInput
          style={[inputStyle, styles.newInput]}
          value={value.newTitle}
          onChangeText={(newTitle) => onChange({ newTitle })}
          placeholder={t('upload.album.newPlaceholder')}
          placeholderTextColor={colors.placeholder}
          maxLength={100}
          autoFocus
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%',
    paddingHorizontal: 12, minHeight: 36, borderRadius: radius.full,
    borderWidth: 1, borderColor: 'rgba(29,161,242,0.45)', backgroundColor: 'rgba(6,16,32,0.6)',
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  chipTextOn: { color: colors.white },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: spacing.xs },
  newInput: { marginTop: spacing.sm },
});

export default AlbumPicker;

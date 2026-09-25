// Choose a place: the phone's location, or a town found by name. Used for
// "near me" in Services and for pinning a service on the map.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from '../BottomSheet';
import useKeyboardHeight from '../../hooks/useKeyboardHeight';
import { hereNow, findPlaces } from '../../services/serviceLocation';
import { colors, typography, spacing, radius } from '../../constants/theme';

const PlaceSheet = ({ visible, onClose, onPick, title, t, lang = 'en', initialQuery = '' }) => {
  const kb = useKeyboardHeight();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState('');
  const request = useRef(0);

  useEffect(() => { if (visible) { setQ(initialQuery); setNote(''); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const mine = ++request.current;
    if (q.trim().length < 2) { setRows([]); return undefined; }
    const h = setTimeout(async () => {
      setBusy(true);
      try {
        const found = await findPlaces(q, lang);
        if (mine === request.current) setRows(found);
      } catch {
        if (mine === request.current) setNote(t('places.searchFailed'));
      } finally {
        if (mine === request.current) setBusy(false);
      }
    }, 350);
    return () => clearTimeout(h);
  }, [q, lang, t]);

  const useMine = async () => {
    setLocating(true);
    setNote('');
    try {
      const here = await hereNow();
      onPick({ ...here, label: t('places.myLocation') });
    } catch (e) {
      setNote(e.message === 'denied' ? t('places.denied') : t('places.unavailable'));
    } finally {
      setLocating(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} keyboardHeight={kb} heightRatio={0.7}
      header={(
        <View style={styles.head}>
          <Text style={styles.title}>{title}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={colors.textSecondary} /></TouchableOpacity>
        </View>
      )}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" testID="place-sheet">
        <TouchableOpacity style={styles.mine} onPress={useMine} disabled={locating} testID="place-mine">
          {locating ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="locate" size={18} color={colors.primary} />}
          <Text style={styles.mineText}>{t('places.useMine')}</Text>
        </TouchableOpacity>
        {note ? <Text style={styles.note} testID="place-note">{note}</Text> : null}
        <View style={styles.search}>
          <Ionicons name="search" size={17} color={colors.placeholder} />
          <TextInput style={styles.input} value={q} onChangeText={setQ} placeholder={t('places.searchPlaceholder')}
            placeholderTextColor={colors.placeholder} autoCorrect={false} testID="place-search" />
          {busy ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        </View>
        {rows.map((p, i) => (
          <TouchableOpacity key={`${p.label}_${i}`} style={styles.row} onPress={() => onPick(p)} testID={`place-${i}`}>
            <Ionicons name="location-outline" size={17} color={colors.textSecondary} />
            <Text style={styles.rowText} numberOfLines={2}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  title: { ...typography.h3, color: colors.textPrimary },
  body: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingBottom: spacing.lg },
  mine: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.primary,
  },
  mineText: { ...typography.label, color: colors.primary, fontWeight: '800' },
  note: { ...typography.caption, color: colors.warning },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.full,
    backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border, marginTop: spacing.xs,
  },
  input: { flex: 1, color: colors.textPrimary, fontSize: 15, paddingVertical: spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  rowText: { ...typography.body, color: colors.textPrimary, flex: 1 },
});

export default PlaceSheet;

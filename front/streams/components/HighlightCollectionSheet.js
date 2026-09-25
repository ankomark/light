// Put a highlight in one of the reader's collections ("Prayer", "Sermon
// ideas"), or start a new one. The names come from the account (kept on the
// phone for offline) and from the collections used this session.
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from './BottomSheet';
import useKeyboardHeight from '../hooks/useKeyboardHeight';
import { fetchHighlightCollections } from '../services/api';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import { colors, spacing, radius, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';

export const cleanName = (s) => String(s || '').split(/\s+/).filter(Boolean).join(' ').slice(0, 60);

const HighlightCollectionSheet = ({ visible, onClose, current = '', onPick }) => {
  const { t } = useI18n();
  const kbHeight = useKeyboardHeight();       // the sheet rises with the keyboard
  const { currentUser } = useAuth();
  const key = userKey(currentUser?.id, 'hl:collections');
  const [names, setNames] = useState(() => peekCache(key) || []);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!visible) return undefined;
    let live = true;
    setDraft('');
    (async () => {
      const kept = peekCache(key) || await readCache(key, 30 * 24 * 3600e3);
      if (live && kept) setNames(kept);
      try {
        const rows = (await fetchHighlightCollections())?.results || [];
        const next = rows.map((r) => r.name);
        writeCache(key, next);
        if (live) setNames(next);
      } catch { /* offline: the kept names */ }
    })();
    return () => { live = false; };
  }, [visible, key]);

  const pick = (name) => {
    const n = cleanName(name);
    if (n && !names.includes(n)) writeCache(key, [n, ...names]);
    onPick(n);
  };

  const all = current && !names.includes(current) ? [current, ...names] : names;
  return (
    <BottomSheet
      keyboardHeight={kbHeight}
      visible={visible}
      onClose={onClose}
      heightRatio={0.55}
      header={(
        <View style={styles.head}>
          <Text style={styles.title}>{t('collections.title')}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={colors.textSecondary} /></TouchableOpacity>
        </View>
      )}
    >
      <ScrollView contentContainerStyle={styles.body} testID="collection-sheet" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.newRow}>
          <TextInput style={styles.input} value={draft} onChangeText={setDraft} maxLength={60}
            placeholder={t('collections.new')} placeholderTextColor={colors.placeholder} testID="collection-new"
            onSubmitEditing={() => cleanName(draft) && pick(draft)} returnKeyType="done" />
          <TouchableOpacity style={[styles.add, !cleanName(draft) && styles.addOff]} disabled={!cleanName(draft)}
            onPress={() => pick(draft)} testID="collection-add" accessibilityRole="button" accessibilityLabel={t('collections.add')}>
            <Ionicons name="add" size={22} color={colors.white} />
          </TouchableOpacity>
        </View>
        <View style={styles.chips}>
          {all.map((n) => (
            <TouchableOpacity key={n} style={[styles.chip, n === current && styles.chipOn]} onPress={() => pick(n)}
              accessibilityRole="radio" accessibilityState={{ checked: n === current }} testID={`collection-${n}`}>
              <Ionicons name={n === current ? 'folder' : 'folder-outline'} size={14}
                color={n === current ? colors.white : colors.textSecondary} />
              <Text style={[styles.chipText, n === current && styles.chipTextOn]} numberOfLines={1}>{n}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {current ? (
          <TouchableOpacity style={styles.none} onPress={() => onPick('')} testID="collection-none">
            <Ionicons name="close-circle-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.noneText}>{t('collections.remove')}</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  title: { ...typography.h3, color: colors.textPrimary },
  body: { paddingHorizontal: spacing.md, gap: spacing.md },
  newRow: { flexDirection: 'row', gap: spacing.sm },
  input: {
    flex: 1, color: colors.textPrimary, fontSize: 15, backgroundColor: colors.inputBg, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  add: { width: 44, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  addOff: { opacity: 0.4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.label, color: colors.textPrimary, flexShrink: 1 },
  chipTextOn: { color: colors.white, fontWeight: '700' },
  none: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs },
  noneText: { ...typography.label, color: colors.textSecondary },
});

export default HighlightCollectionSheet;

// My Bible: everything the reader has kept — favourite passages, highlights,
// notes, bookmarked chapters, reading history. Search across a tab, open an
// entry at its verse, share it, or remove it (with Undo).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  useBibleLibrary, formatRef, verseRef, removeFavorite, removeNote, removeBookmark, setHighlight,
  clearHistory, restoreEntry,
} from '../services/bibleLibrary';
import { getBibleVersion } from '../utils/bibleVersions';
import { confirmAction } from '../utils/adminConfirm';
import { HIGHLIGHT_SWATCH } from './BibleVerseActions';
import { colors, spacing, radius, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

export const LIBRARY_TABS = [
  { key: 'favorites', icon: 'heart' },
  { key: 'highlights', icon: 'color-fill' },
  { key: 'notes', icon: 'document-text' },
  { key: 'bookmarks', icon: 'bookmark' },
  { key: 'history', icon: 'time' },
];
const UNDO_MS = 5000;

const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const dateOf = (ms) => {
  try {
    return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
};

// Each tab's entries as rows: { key, kind, entry, ref, text, note, color, at, verse, index }.
const rowsFor = (lib, tab) => {
  if (tab === 'highlights') {
    return Object.values(lib.highlights)
      .sort((a, b) => b.at - a.at)
      .map((h) => ({
        key: verseRef(h.bookId, h.chapter, h.verse), kind: 'highlights', entry: h,
        ref: formatRef(h.bookName, h.chapter, [h.verse]), text: h.text, color: h.color, at: h.at, verse: h.verse,
      }));
  }
  const list = lib[tab] || [];
  return list.map((e, index) => ({
    key: e.id || `${e.bookId}.${e.chapter}.${index}`, kind: tab, entry: e, index,
    ref: formatRef(e.bookName, e.chapter, e.verses || []),
    text: e.text || '', note: e.note || '', at: e.updatedAt || e.at, verse: e.verses?.[0] || null,
  }));
};

const BibleLibraryScreen = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { params = {} } = useRoute();
  const lib = useBibleLibrary();
  const [tab, setTab] = useState(LIBRARY_TABS.some((x) => x.key === params.tab) ? params.tab : 'favorites');
  const [query, setQuery] = useState('');
  const [undo, setUndo] = useState(null);              // { kind, entry, index, label }
  const undoTimer = useRef(null);
  useEffect(() => () => clearTimeout(undoTimer.current), []);

  const counts = {
    favorites: lib.favorites.length, highlights: Object.keys(lib.highlights).length,
    notes: lib.notes.length, bookmarks: lib.bookmarks.length, history: lib.history.length,
  };

  const rows = useMemo(() => {
    const all = rowsFor(lib, tab);
    const q = fold(query.trim());
    if (!q) return all;
    return all.filter((r) => fold(`${r.ref} ${r.text} ${r.note}`).includes(q));
  }, [lib, tab, query]);

  const open = (row) => {
    const { entry } = row;
    navigation.push('bible', { bookId: entry.bookId, chapter: entry.chapter, ...(row.verse ? { verse: row.verse } : {}) });
  };

  const share = (row) => {
    const abbr = getBibleVersion(row.entry.versionId).abbr;
    const body = row.text ? `“${row.text}”\n— ${row.ref} (${abbr})` : `${row.ref} (${abbr})`;
    Share.share({ message: row.note ? `${body}\n\n${row.note}` : body }).catch(() => {});
  };

  const remove = (row) => {
    const { kind, entry, index } = row;
    if (kind === 'favorites') removeFavorite(entry.id);
    else if (kind === 'notes') removeNote(entry.id);
    else if (kind === 'bookmarks') removeBookmark(entry.id);
    else if (kind === 'highlights') setHighlight([entry], null);
    else return;
    clearTimeout(undoTimer.current);
    setUndo({ kind, entry, index, label: t('bible.removed', { ref: row.ref }) });
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
  };

  const undoRemove = () => {
    if (!undo) return;
    restoreEntry(undo.kind, undo.entry, undo.index);
    clearTimeout(undoTimer.current);
    setUndo(null);
  };

  // confirmAction, not Alert: on web Alert.alert shows nothing and never fires.
  const confirmClearHistory = async () => {
    const ok = await confirmAction({
      title: t('bible.clearHistory'), message: t('bible.clearHistoryConfirm'),
      confirmLabel: t('bible.clear'), cancelLabel: t('common.cancel'), destructive: true,
    });
    if (ok) clearHistory();
  };

  const renderRow = ({ item: row }) => {
    const version = getBibleVersion(row.entry.versionId);
    return (
      <TouchableOpacity style={styles.row} onPress={() => open(row)} activeOpacity={0.85}
        accessibilityRole="button" accessibilityHint={t('bible.openHint')} testID={`bible-lib-row-${row.key}`}>
        {row.color ? <View style={[styles.colorBar, { backgroundColor: HIGHLIGHT_SWATCH[row.color] }]} /> : null}
        <View style={styles.rowBody}>
          <View style={styles.rowHead}>
            <Text style={styles.rowRef} numberOfLines={1}>{row.ref}</Text>
            <Text style={styles.rowMeta} numberOfLines={1}>{`${version.abbr} · ${dateOf(row.at)}`}</Text>
          </View>
          {row.note ? <Text style={styles.rowNote} numberOfLines={3}>{row.note}</Text> : null}
          {row.text ? <Text style={[styles.rowText, row.note && styles.rowTextQuoted]} numberOfLines={row.note ? 2 : 4}>{row.text}</Text> : null}
        </View>
        <View style={styles.rowActions}>
          {row.kind !== 'history' && row.kind !== 'bookmarks' ? (
            <TouchableOpacity onPress={() => share(row)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('bible.shareCopy')}>
              <Ionicons name="share-social-outline" size={19} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
          {row.kind !== 'history' ? (
            <TouchableOpacity onPress={() => remove(row)} hitSlop={8} accessibilityRole="button"
              accessibilityLabel={t('bible.remove')} testID={`bible-lib-remove-${row.key}`}>
              <Ionicons name="trash-outline" size={19} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  const current = LIBRARY_TABS.find((x) => x.key === tab);

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()} hitSlop={10}
          accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>{t('bible.myBible')}</Text>
        {tab === 'history' && lib.history.length ? (
          <TouchableOpacity style={styles.iconBtn} onPress={confirmClearHistory} hitSlop={10}
            accessibilityRole="button" accessibilityLabel={t('bible.clearHistory')}>
            <Ionicons name="trash-outline" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : <View style={styles.iconBtn} />}
      </View>

      <FlatList
        horizontal
        data={LIBRARY_TABS}
        keyExtractor={(x) => x.key}
        showsHorizontalScrollIndicator={false}
        style={styles.tabsList}
        contentContainerStyle={styles.tabs}
        renderItem={({ item: x }) => {
          const on = x.key === tab;
          return (
            <TouchableOpacity style={[styles.tab, on && styles.tabOn]} onPress={() => { setTab(x.key); setQuery(''); }}
              accessibilityRole="tab" accessibilityState={{ selected: on }} testID={`bible-lib-tab-${x.key}`}>
              <Ionicons name={x.icon} size={15} color={on ? colors.white : colors.textSecondary} />
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{t(`bible.tab.${x.key}`)}</Text>
              {counts[x.key] ? <Text style={[styles.tabCount, on && styles.tabTextOn]}>{counts[x.key]}</Text> : null}
            </TouchableOpacity>
          );
        }}
      />

      {counts[tab] > 3 ? (
        <View style={styles.searchBar}>
          <Ionicons name="search" size={17} color={colors.placeholder} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder={t('bible.librarySearch')}
            placeholderTextColor={colors.placeholder}
            autoCorrect={false}
          />
          {query ? (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={17} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={renderRow}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Ionicons name={`${current.icon}-outline`} size={44} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>{query ? t('bible.libraryNoMatch') : t(`bible.empty.${tab}`)}</Text>
            {!query ? <Text style={styles.emptySub}>{t(`bible.emptyHow.${tab}`)}</Text> : null}
          </View>
        )}
      />

      {undo ? (
        <View style={styles.undo} testID="bible-lib-undo">
          <Text style={styles.undoText} numberOfLines={1}>{undo.label}</Text>
          <TouchableOpacity onPress={undoRemove} hitSlop={8} accessibilityRole="button">
            <Text style={styles.undoBtn}>{t('bible.undo')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  topBar: {
    flexDirection: 'row', alignItems: 'center', marginHorizontal: spacing.md, marginTop: spacing.sm,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)', backgroundColor: 'rgba(13,35,64,0.78)',
  },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, ...typography.h3, color: colors.textPrimary, textAlign: 'center' },
  tabsList: { flexGrow: 0, marginTop: spacing.sm },
  tabs: { paddingHorizontal: spacing.md, gap: spacing.sm },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, minHeight: 36, borderRadius: radius.full,
    backgroundColor: 'rgba(16,28,46,0.82)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  tabTextOn: { color: colors.white },
  tabCount: { color: colors.textSecondary, fontSize: 12, fontWeight: '800' },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginHorizontal: spacing.md, marginTop: spacing.sm,
    paddingHorizontal: spacing.md, height: 42, borderRadius: radius.full,
    backgroundColor: 'rgba(13,35,64,0.78)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 15 },
  list: { padding: spacing.md, paddingBottom: 120 },
  row: {
    flexDirection: 'row', gap: spacing.sm, padding: spacing.sm + 2, marginBottom: spacing.sm, borderRadius: radius.md,
    backgroundColor: 'rgba(16,28,46,0.86)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
  },
  colorBar: { width: 4, borderRadius: 2 },
  rowBody: { flex: 1, minWidth: 0 },
  rowHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  rowRef: { flexShrink: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  rowMeta: { marginLeft: 'auto', color: colors.textMuted, fontSize: 11.5 },
  rowNote: { color: colors.textPrimary, fontSize: 14.5, lineHeight: 21, marginTop: 4 },
  rowText: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, marginTop: 4 },
  rowTextQuoted: { fontStyle: 'italic', borderLeftWidth: 2, borderLeftColor: colors.accent, paddingLeft: spacing.xs },
  rowActions: { justifyContent: 'space-between', alignItems: 'center', gap: spacing.md, paddingVertical: 2 },
  empty: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyTitle: { ...typography.body, color: colors.textPrimary, fontWeight: '700', textAlign: 'center' },
  emptySub: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', lineHeight: 19 },
  undo: {
    position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.lg,
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md,
    backgroundColor: '#13233B', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)',
  },
  undoText: { flex: 1, color: colors.textPrimary, fontSize: 14 },
  undoBtn: { color: colors.primary, fontSize: 14, fontWeight: '800' },
});

export default BibleLibraryScreen;

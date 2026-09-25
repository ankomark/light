// A chapter's history — the versions its saves replaced — or, opened with no
// chapter, the book's deleted chapters. Pick one to see what's changed since
// (or its full text), and bring it back: it goes into the editor, and nothing
// changes for readers until the author saves.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fetchChapterRevisions, fetchChapterRevision } from '../services/api';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

// Unchanged stretches longer than this fold to their first and last lines.
const FOLD_LINES = 4;

const when = (iso) => {
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '';
  }
};

/** The server's changes → rows to draw: long unchanged runs folded. */
export const foldChanges = (changes = []) => {
  const rows = [];
  changes.forEach((c, i) => {
    if (c.op !== 'equal') { rows.push({ key: `c${i}`, op: c.op, text: c.text }); return; }
    const lines = c.text.split('\n');
    if (lines.length <= FOLD_LINES) { rows.push({ key: `c${i}`, op: 'equal', text: c.text }); return; }
    rows.push({ key: `c${i}a`, op: 'equal', text: lines[0] });
    rows.push({ key: `c${i}f`, op: 'fold', count: lines.length - 2 });
    rows.push({ key: `c${i}b`, op: 'equal', text: lines[lines.length - 1] });
  });
  return rows;
};

const ChapterHistory = ({ route, navigation }) => {
  const { t } = useI18n();
  const { pubId, chapterId = null, chapterTitle = '' } = route.params || {};
  const deletedMode = chapterId == null;
  const [list, setList] = useState(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(null);        // the revision being looked at (with its text)
  const [openingId, setOpeningId] = useState(null);
  const [mode, setMode] = useState('changes');   // 'changes' | 'text'

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetchChapterRevisions(pubId, chapterId);
      setList(res?.results || []);
    } catch {
      setFailed(true);
    }
  }, [pubId, chapterId]);
  useEffect(() => { load(); }, [load]);

  const view = async (row) => {
    setOpeningId(row.id);
    try {
      const rev = await fetchChapterRevision(pubId, row.id);
      setOpen(rev);
      setMode(rev.changes ? 'changes' : 'text');
    } catch {
      setFailed(true);
    } finally {
      setOpeningId(null);
    }
  };

  const bringBack = () => {
    navigation.popTo('PublicationEditor', {
      restore: {
        chapterId: open.chapter_exists ? open.chapter_ref : null,
        title: open.title, body: open.body, at: Date.now(),
      },
    }, { merge: true });
  };

  const title = deletedMode ? t('pub.deletedChapters') : t('history.title');

  // ── One version ──
  if (open) {
    const rows = foldChanges(open.changes || []);
    const unchanged = open.changes && open.changes.every((c) => c.op === 'equal');
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => setOpen(null)} style={styles.iconBtn} hitSlop={10}
            accessibilityRole="button" accessibilityLabel={t('common.back')}>
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.titleWrap}>
            <Text style={styles.topTitle} numberOfLines={1}>{open.title || chapterTitle || title}</Text>
            <Text style={styles.topSub}>{`${t('history.version', { n: open.version })} · ${when(open.created_at)}`}</Text>
          </View>
          <View style={styles.iconBtn} />
        </View>

        {open.changes ? (
          <View style={styles.segment}>
            {['changes', 'text'].map((m) => (
              <TouchableOpacity key={m} style={[styles.segmentItem, mode === m && styles.segmentOn]} onPress={() => setMode(m)}
                accessibilityRole="tab" accessibilityState={{ selected: mode === m }} testID={`history-mode-${m}`}>
                <Text style={[styles.segmentText, mode === m && styles.segmentTextOn]}>
                  {t(m === 'changes' ? 'history.changes' : 'history.fullText')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <ScrollView contentContainerStyle={styles.body}>
          {mode === 'changes' && open.changes ? (
            unchanged ? <Text style={styles.muted}>{t('history.noChanges')}</Text> : (
              <>
                <View style={styles.legend}>
                  <View style={[styles.legendDot, styles.insertBg]} /><Text style={styles.legendText}>{t('history.added')}</Text>
                  <View style={[styles.legendDot, styles.deleteBg]} /><Text style={styles.legendText}>{t('history.removed')}</Text>
                </View>
                {rows.map((r) => (r.op === 'fold' ? (
                  <Text key={r.key} style={styles.fold}>{t('history.unchangedLines', { n: r.count })}</Text>
                ) : (
                  <Text key={r.key} style={[styles.line, r.op === 'insert' && styles.insertBg, r.op === 'delete' && styles.deleteBg]}
                    testID={`history-${r.op}`}>
                    {r.op === 'insert' ? '+ ' : r.op === 'delete' ? '− ' : ''}{r.text || ' '}
                  </Text>
                )))}
              </>
            )
          ) : (
            <Text style={styles.fullText} selectable>{open.body || ''}</Text>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Text style={styles.hint}>{t('history.restoreHint')}</Text>
          <TouchableOpacity style={styles.restoreBtn} onPress={bringBack} accessibilityRole="button" testID="history-restore">
            <Ionicons name="arrow-undo" size={18} color={colors.white} />
            <Text style={styles.restoreText}>{t(open.chapter_exists ? 'history.restore' : 'history.restoreDeleted')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── The list ──
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}
          accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={styles.topTitle} numberOfLines={1}>{title}</Text>
          {chapterTitle ? <Text style={styles.topSub} numberOfLines={1}>{chapterTitle}</Text> : null}
        </View>
        <View style={styles.iconBtn} />
      </View>

      {failed && !list ? (
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={44} color={colors.textMuted} />
          <Text style={styles.muted}>{t('history.loadFailed')}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load} testID="history-retry">
            <Text style={styles.restoreText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : !list ? (
        <View style={styles.centered}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(r) => String(r.id)}
          contentContainerStyle={styles.listBody}
          ListEmptyComponent={(
            <View style={styles.centered}>
              <Ionicons name={deletedMode ? 'trash-bin-outline' : 'time-outline'} size={44} color={colors.textMuted} />
              <Text style={styles.muted}>{t(deletedMode ? 'history.emptyDeleted' : 'history.empty')}</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => view(item)} disabled={!!openingId}
              accessibilityRole="button" testID={`history-row-${item.id}`}>
              <View style={styles.rowIcon}>
                <Ionicons name={item.reason === 'delete' ? 'trash-outline' : 'document-text-outline'} size={18} color={colors.primary} />
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {deletedMode ? (item.title || t('history.untitled')) : t('history.version', { n: item.version })}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {`${when(item.created_at)} · ${t(`history.reason.${item.reason}`)} · ${t('history.words', { n: item.word_count })}`}
                </Text>
              </View>
              {openingId === item.id ? <ActivityIndicator size="small" color={colors.primary} />
                : <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1, alignItems: 'center' },
  topTitle: { ...typography.h3, color: colors.textPrimary },
  topSub: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  muted: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  retryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },

  listBody: { padding: spacing.md, flexGrow: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.sm,
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  rowIcon: { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  rowBody: { flex: 1 },
  rowTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  rowSub: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },

  segment: {
    flexDirection: 'row', margin: spacing.md, marginBottom: 0, padding: 4,
    backgroundColor: colors.surface, borderRadius: radius.full,
  },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.full },
  segmentOn: { backgroundColor: colors.primary },
  segmentText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  segmentTextOn: { color: colors.white },

  body: { padding: spacing.md, width: '100%', maxWidth: 760, alignSelf: 'center' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm, flexWrap: 'wrap' },
  legendDot: { width: 12, height: 12, borderRadius: 3 },
  legendText: { ...typography.caption, color: colors.textSecondary, marginRight: spacing.sm },
  line: { ...typography.body, color: colors.textPrimary, lineHeight: 22, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  insertBg: { backgroundColor: 'rgba(52,199,89,0.18)' },
  deleteBg: { backgroundColor: 'rgba(229,57,53,0.18)' },
  fold: { ...typography.caption, color: colors.textMuted, fontStyle: 'italic', paddingVertical: 4, paddingHorizontal: 6 },
  fullText: { ...typography.body, color: colors.textPrimary, lineHeight: 24 },

  footer: {
    padding: spacing.md, gap: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.surface,
  },
  hint: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
  restoreBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm + 2,
  },
  restoreText: { ...typography.button, color: colors.white },
});

export default ChapterHistory;

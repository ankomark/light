// The reader's library in Publishing: their numbers (streak, this week, this
// month, the last seven days) over shelves — Reading, Saved, Finished,
// Downloaded, Highlights. Each shelf paints its last copy at once and
// refreshes behind it; Downloaded is the phone's own and works offline.
import React, { useCallback, useEffect, useRef, useState, memo } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { fetchPublications, fetchReadingStats, fetchBookHighlights, fetchHighlightCollections } from '../services/api';
import { keptBookIds, readBook } from '../services/publicationStore';
import { localDay } from '../services/readingTracker';
import { HIGHLIGHT_SWATCH } from './BibleVerseActions';
import { PublicationListSkeleton } from './SkeletonLoader';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import { categoryLabel } from '../utils/publications';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';

export const SHELVES = [
  { key: 'reading', icon: 'book-outline' },
  { key: 'saved', icon: 'bookmark-outline' },
  { key: 'finished', icon: 'checkmark-done-outline' },
  { key: 'downloaded', icon: 'download-outline' },
  { key: 'highlights', icon: 'color-fill-outline' },
];

/** Seconds → "3 h 42 min" / "42 min". */
export const formatDuration = (s, t) => {
  const m = Math.round((s || 0) / 60);
  return m < 60 ? t('time.minutes', { n: m }) : t('time.hoursMinutes', { h: Math.floor(m / 60), m: m % 60 });
};

const BookRow = memo(({ item, onOpen, t }) => {
  const pct = item.my_finished ? 1 : item.my_percent || 0;
  return (
    <TouchableOpacity style={styles.row} onPress={() => onOpen(item)} activeOpacity={0.85}
      accessibilityRole="button" accessibilityLabel={item.title} testID={`library-book-${item.id}`}>
      {item.cover ? (
        <Image source={{ uri: item.cover }} style={styles.cover} contentFit="cover" transition={150} />
      ) : (
        <View style={[styles.cover, styles.coverFallback]}><MaterialIcons name="menu-book" size={24} color={colors.textMuted} /></View>
      )}
      <View style={styles.rowBody}>
        <Text style={styles.cat} numberOfLines={1}>{categoryLabel(item.category, t)}</Text>
        <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.author} numberOfLines={1}>{item.author?.username || t('articles.unknownAuthor')}</Text>
        {pct > 0 ? (
          <View style={styles.progress}>
            <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(pct * 100)}%` }]} /></View>
            <Text style={styles.pct}>{item.my_finished ? t('pubDetail.finished') : `${Math.max(1, Math.round(pct * 100))}%`}</Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
});

const HighlightRow = memo(({ item, onOpen, t }) => (
  <TouchableOpacity style={styles.hl} onPress={() => onOpen(item)} activeOpacity={0.85}
    accessibilityRole="button" testID={`library-highlight-${item.client_id}`}>
    <View style={[styles.hlBar, { backgroundColor: HIGHLIGHT_SWATCH[item.color] || colors.accent }]} />
    <View style={styles.rowBody}>
      <Text style={styles.hlQuote} numberOfLines={4}>{`“${item.quote}”`}</Text>
      {item.note ? (
        <View style={styles.hlNoteRow}>
          <Ionicons name="document-text" size={13} color={colors.accent} />
          <Text style={styles.hlNote} numberOfLines={3}>{item.note}</Text>
        </View>
      ) : null}
      <View style={styles.hlFoot}>
        <Text style={[styles.hlWhere, styles.flex]} numberOfLines={1}>
          {[item.publication_title, item.chapter_title].filter(Boolean).join(' · ') || t('articles.unknownAuthor')}
        </Text>
        {item.collection ? (
          <View style={styles.hlTag}>
            <Ionicons name="folder-outline" size={11} color={colors.textSecondary} />
            <Text style={styles.hlTagText} numberOfLines={1}>{item.collection}</Text>
          </View>
        ) : null}
      </View>
    </View>
  </TouchableOpacity>
));

const Stats = ({ stats, t }) => {
  if (!stats) return null;
  const narrow = (iso) => {
    try { return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' }); } catch { return ''; }
  };
  return (
    <View style={styles.stats} testID="library-stats">
      <View style={styles.statsTop}>
        <View style={styles.streak}>
          <Text style={styles.streakN}>{stats.streak}</Text>
          <Text style={styles.streakLabel}>
            {stats.streak ? t('library.streak', { n: stats.streak }) : t('library.noStreak')}
          </Text>
        </View>
        <View style={styles.week}>
          {(stats.last7 || []).map((d) => (
            <View key={d.day} style={styles.day}>
              <View style={[styles.dot, d.seconds >= 60 && styles.dotOn]} />
              <Text style={styles.dayLabel}>{narrow(d.day)}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statN}>{formatDuration(stats.week_seconds, t)}</Text>
          <Text style={styles.statLabel}>{t('library.thisWeek')}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statN}>{formatDuration(stats.month_seconds, t)}</Text>
          <Text style={styles.statLabel}>{t('library.thisMonth')}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statN}>{stats.finished_this_year}</Text>
          <Text style={styles.statLabel}>{t('library.finishedYear')}</Text>
        </View>
      </View>
    </View>
  );
};

const BookLibrary = ({ navigation }) => {
  const { t } = useI18n();
  const { currentUser, isAuthenticated } = useAuth();
  const uid = currentUser?.id;
  const [shelf, setShelf] = useState('reading');
  // Highlights: all, or one of the reader's collections.
  const [collection, setCollection] = useState('');
  const [collections, setCollections] = useState(() => peekCache(userKey(uid, 'library:collections')) || []);
  const key = (s) => userKey(uid, `library:${s}${s === 'highlights' && collection ? `:${collection}` : ''}`);
  const [rows, setRows] = useState(() => peekCache(key('reading')) || null);
  const [failed, setFailed] = useState(false);
  const [stats, setStats] = useState(() => peekCache(userKey(uid, 'library:stats')));
  const request = useRef(0);
  const needsAccount = !isAuthenticated && shelf !== 'downloaded';

  const load = useCallback(async (s = shelf) => {
    const mine = ++request.current;
    setFailed(false);
    if (!isAuthenticated && s !== 'downloaded') { setRows([]); return; }
    const kept = peekCache(key(s)) ?? await readCache(key(s));
    if (mine !== request.current) return;
    setRows(Array.isArray(kept) ? kept : null);
    try {
      let next;
      if (s === 'downloaded') {
        const ids = await keptBookIds();
        next = (await Promise.all(ids.map((id) => readBook(uid, id)))).filter(Boolean);
      } else if (s === 'highlights') {
        next = (await fetchBookHighlights(collection ? { collection } : {}))?.results || [];
      } else {
        const res = await fetchPublications(s === 'saved' ? { saved: 1 } : { shelf: s });
        next = res?.results ?? (Array.isArray(res) ? res : []);
      }
      if (mine !== request.current) return;
      setRows(next);
      writeCache(key(s), next);
    } catch {
      if (mine !== request.current) return;
      if (!Array.isArray(kept)) { setRows([]); setFailed(true); }
    }
  }, [shelf, collection, isAuthenticated, uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadCollections = useCallback(async () => {
    try {
      const names = ((await fetchHighlightCollections())?.results || []).map((r) => r.name);
      setCollections(names);
      writeCache(userKey(uid, 'library:collections'), names);
      setCollection((c) => (c && !names.includes(c) ? '' : c));
    } catch { /* the kept names stand */ }
  }, [uid]);

  const loadStats = useCallback(async () => {
    if (!isAuthenticated) { setStats(null); return; }
    try {
      const s = await fetchReadingStats(localDay());
      setStats(s);
      writeCache(userKey(uid, 'library:stats'), s);
    } catch {
      // the kept numbers stand
    }
  }, [isAuthenticated, uid]);

  useEffect(() => { load(shelf); }, [shelf, collection, uid, isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (shelf === 'highlights' && isAuthenticated) loadCollections(); }, [shelf, isAuthenticated, loadCollections]);
  useEffect(() => { loadStats(); }, [loadStats]);
  // Back from a book: progress and highlights moved on. (Not on the first
  // focus — the loads above already ran.)
  const returned = useRef(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  useFocusEffect(useCallback(() => {
    if (!returned.current) { returned.current = true; return; }
    loadStats();
    loadRef.current();
  }, [loadStats]));

  const openBook = useCallback((b) => navigation.navigate('PublicationDetail', { id: b.id, preview: b }), [navigation]);
  const openHighlight = useCallback((h) => navigation.navigate('ChapterReader', {
    id: h.publication, chapterId: h.chapter_id, block: h.block,
  }), [navigation]);

  const header = (
    <View>
      {isAuthenticated ? <Stats stats={stats} t={t} /> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelves}>
        {SHELVES.map((s) => {
          const on = s.key === shelf;
          return (
            <TouchableOpacity key={s.key} style={[styles.shelf, on && styles.shelfOn]} onPress={() => setShelf(s.key)}
              accessibilityRole="tab" accessibilityState={{ selected: on }} testID={`library-shelf-${s.key}`}>
              <Ionicons name={s.icon} size={15} color={on ? colors.white : colors.textSecondary} />
              <Text style={[styles.shelfText, on && styles.shelfTextOn]}>{t(`library.shelf.${s.key}`)}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      {shelf === 'highlights' && isAuthenticated && collections.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.colls} testID="library-collections">
          {['', ...collections].map((c) => {
            const on = c === collection;
            return (
              <TouchableOpacity key={c || '_all'} style={[styles.coll, on && styles.collOn]} onPress={() => setCollection(c)}
                accessibilityRole="tab" accessibilityState={{ selected: on }} testID={`library-collection-${c || 'all'}`}>
                {c ? <Ionicons name={on ? 'folder' : 'folder-outline'} size={13} color={on ? colors.textPrimary : colors.textSecondary} /> : null}
                <Text style={[styles.collText, on && styles.collTextOn]} numberOfLines={1}>{c || t('collections.all')}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );

  const empty = () => {
    if (needsAccount) {
      return (
        <View style={styles.empty}>
          <Ionicons name="person-circle-outline" size={44} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('library.signIn')}</Text>
          <TouchableOpacity style={styles.btn} onPress={() => navigation.navigate('Login')}>
            <Text style={styles.btnText}>{t('auth.login')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (rows == null) return <PublicationListSkeleton count={4} />;
    if (failed) {
      return (
        <View style={styles.empty}>
          <Ionicons name="cloud-offline-outline" size={44} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('articles.loadFailed')}</Text>
          <TouchableOpacity style={styles.btn} onPress={() => load()} testID="library-retry">
            <Text style={styles.btnText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    const icon = SHELVES.find((s) => s.key === shelf)?.icon || 'book-outline';
    return (
      <View style={styles.empty}>
        <Ionicons name={icon} size={44} color={colors.textMuted} />
        <Text style={styles.emptyText}>{t(`library.empty.${shelf}`)}</Text>
      </View>
    );
  };

  return (
    <FlatList
      data={needsAccount ? [] : rows || []}
      keyExtractor={(item) => (shelf === 'highlights' ? `h_${item.client_id}` : `b_${item.id}`)}
      renderItem={({ item }) => (shelf === 'highlights'
        ? <HighlightRow item={item} onOpen={openHighlight} t={t} />
        : <BookRow item={item} onOpen={openBook} t={t} />)}
      ListHeaderComponent={header}
      ListEmptyComponent={empty()}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
    />
  );
};

const styles = StyleSheet.create({
  list: { padding: spacing.md, paddingBottom: 96, width: '100%', maxWidth: 820, alignSelf: 'center' },

  stats: {
    backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm, gap: spacing.md,
  },
  statsTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  streak: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexShrink: 1 },
  streakN: { fontSize: 30, fontWeight: '800', color: colors.accent },
  streakLabel: { ...typography.label, color: colors.textSecondary, flexShrink: 1 },
  week: { flexDirection: 'row', gap: 6 },
  day: { alignItems: 'center', gap: 3 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: colors.textMuted },
  dotOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  dayLabel: { fontSize: 10, color: colors.textMuted },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { flex: 1 },
  statN: { ...typography.label, color: colors.textPrimary, fontWeight: '800' },
  statLabel: { ...typography.caption, color: colors.textMuted, marginTop: 1 },

  shelves: { gap: spacing.sm, paddingVertical: spacing.sm },
  shelf: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 3, borderRadius: radius.full,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  shelfOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  shelfText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  shelfTextOn: { color: colors.white },
  colls: { gap: spacing.xs, paddingBottom: spacing.md },
  coll: {
    flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 200, paddingHorizontal: spacing.sm, paddingVertical: 5,
    borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  collOn: { backgroundColor: colors.surface, borderColor: colors.textSecondary },
  collText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', flexShrink: 1 },
  collTextOn: { color: colors.textPrimary },

  row: {
    flexDirection: 'row', gap: spacing.md, padding: spacing.sm, marginBottom: spacing.sm,
    backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
  },
  cover: { width: 64, height: 88, borderRadius: radius.sm, backgroundColor: colors.surface },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, justifyContent: 'center' },
  cat: { ...typography.caption, color: colors.accent, fontWeight: '800', fontSize: 10.5, textTransform: 'uppercase' },
  title: { ...typography.label, color: colors.textPrimary, fontWeight: '700', marginTop: 2 },
  author: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.surface, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent },
  pct: { ...typography.caption, color: colors.textSecondary, minWidth: 34, textAlign: 'right' },

  hl: {
    flexDirection: 'row', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.sm,
    backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
  },
  hlBar: { width: 4, borderRadius: 2 },
  hlQuote: { ...typography.body, color: colors.textPrimary, fontStyle: 'italic', lineHeight: 21 },
  hlNoteRow: { flexDirection: 'row', gap: 6, marginTop: spacing.xs },
  hlNote: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  hlWhere: { ...typography.caption, color: colors.textMuted },
  hlFoot: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  flex: { flex: 1 },
  hlTag: {
    flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: '45%', paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: radius.full, backgroundColor: colors.surface,
  },
  hlTagText: { ...typography.caption, color: colors.textSecondary, flexShrink: 1 },

  empty: { alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, marginTop: spacing.xs },
  btnText: { ...typography.label, color: colors.white, fontWeight: '600' },
});

export default BookLibrary;

// The Author Studio: how an author's books are read, and each book's own
// insights. Totals only — how many, how long, how far — never who.
//
// One date range above everything it scopes (7 / 30 / 90 days). A refresh
// keeps the last numbers on screen, faded, instead of flashing a skeleton.
// With very few readers the numbers are shown as "early days" — trends from
// a handful of people aren't trends.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { fetchAuthorAnalytics, fetchBookAnalytics } from '../services/api';
import { StatTile, DailyColumns, ReaderFunnel, compact } from '../components/BookCharts';
import { formatDuration } from '../components/BookLibrary';
import { peekCache, writeCache, userKey } from '../utils/screenCache';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';

const RANGES = [7, 30, 90];
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

export const RangeRow = ({ days, onChange, t }) => (
  <View style={styles.range} accessibilityRole="radiogroup">
    {RANGES.map((d) => (
      <TouchableOpacity key={d} style={[styles.rangeChip, d === days && styles.rangeOn]} onPress={() => onChange(d)}
        accessibilityRole="radio" accessibilityState={{ checked: d === days }} testID={`range-${d}`}>
        <Text style={[styles.rangeText, d === days && styles.rangeTextOn]}>{t('studioStats.lastDays', { n: d })}</Text>
      </TouchableOpacity>
    ))}
  </View>
);

const useStats = (key, fetcher, days) => {
  const [data, setData] = useState(() => peekCache(`${key}:${days}`));
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    const kept = peekCache(`${key}:${days}`);
    if (kept) setData(kept);
    try {
      const fresh = await fetchRef.current(days);
      setData(fresh);
      writeCache(`${key}:${days}`, fresh, { persist: false });
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [key, days]);
  useEffect(() => { load(); }, [load]);
  return { data, loading, failed, load };
};

const Shell = ({ title, navigation, children, t }) => (
  <SafeAreaView style={styles.container} edges={['top']}>
    <View style={styles.topBar}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}
        accessibilityRole="button" accessibilityLabel={t('common.back')}>
        <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.topTitle} numberOfLines={1}>{title}</Text>
      <View style={styles.iconBtn} />
    </View>
    {children}
  </SafeAreaView>
);

const Body = ({ data, loading, failed, load, t, children }) => {
  if (!data) {
    return (
      <View style={styles.centered}>
        {failed ? (
          <>
            <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
            <Text style={styles.muted}>{t('studioStats.loadFailed')}</Text>
            <TouchableOpacity style={styles.btn} onPress={load} testID="stats-retry"><Text style={styles.btnText}>{t('common.retry')}</Text></TouchableOpacity>
          </>
        ) : <ActivityIndicator color={colors.primary} />}
      </View>
    );
  }
  return <View style={loading && styles.refetching}>{children}</View>;
};

/** All the author's books. */
export const AuthorStudio = ({ navigation }) => {
  const { t } = useI18n();
  const { currentUser } = useAuth();
  const [days, setDays] = useState(30);
  const stats = useStats(userKey(currentUser?.id, 'studio'), fetchAuthorAnalytics, days);
  const d = stats.data;
  return (
    <Shell title={t('studioStats.title')} navigation={navigation} t={t}>
      <ScrollView contentContainerStyle={styles.body}>
        <RangeRow days={days} onChange={setDays} t={t} />
        <Body {...stats} t={t}>
          {d ? (
            <>
              {d.few_readers ? <Text style={styles.early} testID="stats-early">{t('studioStats.earlyDays')}</Text> : null}
              <View style={styles.kpis}>
                <StatTile label={t('studioStats.readers')} value={compact(d.readers)} testID="kpi-readers" />
                <StatTile label={t('studioStats.readingTime')} value={formatDuration(d.reading_seconds, t)} />
                <StatTile label={t('studioStats.finished')} value={compact(d.finished)} note={t('studioStats.allTime')} />
                <StatTile label={t('studioStats.followers')} value={compact(d.followers)} />
              </View>
              <DailyColumns data={d.daily} title={t('studioStats.readersPerDay')} t={t} />
              <Text style={styles.section}>{t('studioStats.yourBooks')}</Text>
              {d.books.length ? d.books.map((b) => (
                <TouchableOpacity key={b.id} style={styles.bookRow} testID={`studio-book-${b.id}`}
                  onPress={() => navigation.navigate('BookInsights', { id: b.id, title: b.title })}>
                  {b.cover ? <Image source={{ uri: b.cover }} style={styles.cover} contentFit="cover" />
                    : <View style={[styles.cover, styles.coverFallback]}><MaterialIcons name="menu-book" size={18} color={colors.textMuted} /></View>}
                  <View style={styles.flex}>
                    <Text style={styles.bookTitle} numberOfLines={1}>{b.title}</Text>
                    <Text style={styles.bookMeta}>
                      {t('studioStats.bookLine', { r: compact(b.readers), f: compact(b.finished), c: pct(b.completion) })}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              )) : <Text style={styles.muted}>{t('studioStats.noBooks')}</Text>}
            </>
          ) : null}
        </Body>
      </ScrollView>
    </Shell>
  );
};

/** One book's insights. */
export const BookInsights = ({ route, navigation }) => {
  const { t } = useI18n();
  const { id, title = '' } = route.params || {};
  const [days, setDays] = useState(30);
  const fetcher = useCallback((dd) => fetchBookAnalytics(id, dd), [id]);
  const stats = useStats(`insights:${id}`, fetcher, days);
  const d = stats.data;
  return (
    <Shell title={title || t('studioStats.insights')} navigation={navigation} t={t}>
      <ScrollView contentContainerStyle={styles.body}>
        <RangeRow days={days} onChange={setDays} t={t} />
        <Body {...stats} t={t}>
          {d ? (
            <>
              {d.few_readers ? <Text style={styles.early} testID="stats-early">{t('studioStats.earlyDays')}</Text> : null}
              <View style={styles.kpis}>
                <StatTile label={t('studioStats.readers')} value={compact(d.readers)}
                  note={t('studioStats.allTimeN', { n: compact(d.readers_all_time) })} testID="kpi-readers" />
                <StatTile label={t('studioStats.completion')} value={pct(d.completion)}
                  note={t('studioStats.finishedOf', { f: d.finished, s: d.started })} testID="kpi-completion" />
                <StatTile label={t('studioStats.readingTime')} value={formatDuration(d.reading_seconds, t)}
                  note={d.avg_seconds_per_reader ? t('studioStats.perReader', { time: formatDuration(d.avg_seconds_per_reader, t) }) : null} />
                <StatTile label={t('studioStats.rating')} value={d.rating_avg != null ? `${d.rating_avg}★` : '—'}
                  note={t('reviews.count', { n: d.rating_count })} />
              </View>
              <DailyColumns data={d.daily} title={t('studioStats.readersPerDay')} t={t} />
              {d.funnel.length ? (
                <ReaderFunnel rows={d.funnel} title={t('studioStats.howFar')} t={t} mostLeft={d.most_left_after} />
              ) : null}
              <View style={[styles.kpis, { marginTop: spacing.md }]}>
                <StatTile label={t('studioStats.likes')} value={compact(d.likes)} />
                <StatTile label={t('studioStats.saves')} value={compact(d.saves)} />
                <StatTile label={t('studioStats.highlights')} value={compact(d.highlights)} />
                <StatTile label={t('studioStats.comments')} value={compact(d.comments)} />
              </View>
              <Text style={styles.privacy}>{t('studioStats.privacy')}</Text>
            </>
          ) : null}
        </Body>
      </ScrollView>
    </Shell>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  topTitle: { ...typography.h3, color: colors.textPrimary, flex: 1, textAlign: 'center' },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  body: { padding: spacing.md, paddingBottom: spacing.xxl, width: '100%', maxWidth: 820, alignSelf: 'center' },
  centered: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  muted: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  btnText: { ...typography.label, color: colors.white, fontWeight: '700' },
  refetching: { opacity: 0.55 },
  range: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  rangeChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 3, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border },
  rangeOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  rangeText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  rangeTextOn: { color: colors.white },
  early: {
    ...typography.caption, color: colors.textSecondary, padding: spacing.sm, marginBottom: spacing.sm,
    borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.05)',
  },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  section: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.sm },
  bookRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, marginBottom: spacing.sm,
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  cover: { width: 40, height: 56, borderRadius: radius.sm, backgroundColor: colors.surface },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  bookTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  bookMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  privacy: { ...typography.caption, color: colors.textMuted, marginTop: spacing.lg, textAlign: 'center' },
});

export default AuthorStudio;

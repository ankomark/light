import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchAdminInsights, fetchAdminInsightsCsv } from '../../services/api';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { notify } from '../../utils/adminConfirm';
import { colors, typography, spacing, radius, shadows } from '../../constants/theme';
import { useI18n } from '../../context/I18nContext';

const RANGES = [
  { key: 14, label: '14d' },
  { key: 30, label: '30d' },
  { key: 90, label: '90d' },
];

// Dependency-free bar chart — plain Views, heights proportional to the series
// max. The most recent bar is highlighted in accent gold.
const BarChart = ({ data = [], tint }) => {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((s, d) => s + d.count, 0);
  const peak = Math.max(0, ...data.map((d) => d.count));
  const first = data[0]?.date?.slice(5);
  const last = data[data.length - 1]?.date?.slice(5);
  return (
    <View>
      <View style={styles.chartMetaRow}>
        <Text style={styles.chartTotal}>{total}<Text style={styles.chartTotalSub}> total</Text></Text>
        <Text style={styles.chartPeak}>peak {peak}/day</Text>
      </View>
      <View style={styles.bars}>
        {data.map((d, i) => {
          const isLast = i === data.length - 1;
          const h = `${Math.max(2, Math.round((d.count / max) * 100))}%`;
          return (
            <View key={d.date} style={styles.barSlot}>
              <View style={[styles.bar, { height: h, backgroundColor: isLast ? colors.accent : tint }]} />
            </View>
          );
        })}
      </View>
      <View style={styles.axisRow}>
        <Text style={styles.axisLabel}>{first}</Text>
        <Text style={styles.axisLabel}>{last}</Text>
      </View>
    </View>
  );
};

const ChartCard = ({ title, data, tint }) => (
  <View style={styles.card}>
    <Text style={styles.cardTitle}>{title}</Text>
    <BarChart data={data} tint={tint} />
  </View>
);

// The insights' parallel lists ({dates, series: {name: [n, ...]}}) as the
// [{date, count}] each chart draws.
const seriesOf = (data, name) => (data?.dates || []).map((date, i) => ({ date, count: data.series?.[name]?.[i] || 0 }));

const Active = ({ label, value }) => (
  <View style={styles.active}>
    <Text style={styles.activeValue}>{value ?? 0}</Text>
    <Text style={styles.activeLabel}>{label}</Text>
  </View>
);

const AdminAnalytics = () => {
  const { t } = useI18n();
  const [days, setDays] = useState(14);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async (d) => {
    setLoading(true);
    try {
      setData(await fetchAdminInsights(d));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // The numbers as a spreadsheet file, through the phone's share sheet.
  const exportCsv = async () => {
    setExporting(true);
    try {
      const text = await fetchAdminInsightsCsv(days);
      const uri = `${FileSystem.cacheDirectory}insights-${days}d-${new Date().toISOString().slice(0, 10)}.csv`;
      await FileSystem.writeAsStringAsync(uri, typeof text === 'string' ? text : String(text));
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'text/csv' });
    } catch {
      notify(t('common.error'), t('adminInsights.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  useFocusEffect(useCallback(() => { load(days); }, [load, days]));

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(days)} tintColor={colors.accent} />}
    >
      <Text style={styles.title}>{t('admin.analytics')}</Text>

      <View style={styles.rangeRow}>
        {RANGES.map((r) => {
          const active = days === r.key;
          return (
            <TouchableOpacity key={r.key} style={[styles.pill, active && styles.pillActive]}
              onPress={() => setDays(r.key)} activeOpacity={0.85}>
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{r.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading && !data ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : data ? (
        <>
          <View style={styles.activeRow} testID="insights-active">
            <Active label={t('adminInsights.today')} value={data.active?.today} />
            <Active label={t('adminInsights.week')} value={data.active?.week} />
            <Active label={t('adminInsights.month')} value={data.active?.month} />
          </View>
          <ChartCard title={t('adminInsights.signups')} data={seriesOf(data, 'signups')} tint="rgba(46,204,113,0.55)" />
          <ChartCard title={t('adminInsights.posts')} data={seriesOf(data, 'posts')} tint="rgba(29,161,242,0.55)" />
          <ChartCard title={t('adminInsights.orders')} data={seriesOf(data, 'orders')} tint="rgba(255,196,107,0.55)" />
          <ChartCard title={t('adminInsights.quiz')} data={seriesOf(data, 'quiz_games')} tint="rgba(155,89,182,0.55)" />
          <ChartCard title={t('adminInsights.puzzles')} data={seriesOf(data, 'puzzles_done')} tint="rgba(26,188,156,0.55)" />
          <ChartCard title={t('adminInsights.reports')} data={seriesOf(data, 'reports')} tint="rgba(224,36,94,0.55)" />
          <TouchableOpacity style={styles.exportBtn} onPress={exportCsv} disabled={exporting} testID="insights-export">
            {exporting ? <ActivityIndicator color="#0A1628" />
              : <Text style={styles.exportText}>{t('adminInsights.export')}</Text>}
          </TouchableOpacity>
          <View style={{ height: spacing.xxl }} />
        </>
      ) : (
        <View style={styles.centered}><Text style={styles.empty}>{t('admin.analyticsFailed')}</Text></View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: spacing.md },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl },
  empty: { ...typography.body, color: colors.textSecondary },
  title: {
    ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  rangeRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  pill: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.full,
    backgroundColor: 'rgba(16,28,46,0.82)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  pillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  pillText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  pillTextActive: { color: '#0A1628' },
  card: {
    backgroundColor: 'rgba(16,28,46,0.82)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
    padding: spacing.md, marginBottom: spacing.md, ...shadows.sm,
  },
  cardTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.xs },
  chartMetaRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: spacing.sm },
  chartTotal: { ...typography.h2, color: colors.textPrimary, fontWeight: '800' },
  chartTotalSub: { ...typography.caption, color: colors.textSecondary, fontWeight: '400' },
  chartPeak: { ...typography.caption, color: colors.textMuted },
  bars: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 2,
    height: 110, paddingTop: spacing.xs,
  },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 3, minHeight: 2 },
  axisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  axisLabel: { ...typography.caption, color: colors.textMuted, fontSize: 10 },
  activeRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  active: {
    flex: 1, alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.lg,
    backgroundColor: 'rgba(16,28,46,0.82)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
  },
  activeValue: { ...typography.h2, color: colors.textPrimary, fontWeight: '800' },
  activeLabel: { ...typography.caption, color: colors.textSecondary, marginTop: 2, textAlign: 'center' },
  exportBtn: { height: 48, borderRadius: radius.lg, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  exportText: { color: '#0A1628', fontWeight: '800', fontSize: 15 },
});

export default AdminAnalytics;

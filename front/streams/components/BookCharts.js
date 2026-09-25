// The Author Studio's charts, drawn with plain Views (no chart library).
//
// One series each, so one colour — a blue checked against the dark card
// (lightness, chroma, ≥3:1 contrast) — and no legend (the title names what's
// plotted). Text wears the text colours, never the series colour. Columns are
// thin (≤24px), rounded 4px at the data end, square on a hairline baseline,
// 2px apart. Pressing and dragging over the columns moves a crosshair and a
// readout (value first); every value is also in the table view.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, typography, spacing, radius } from '../constants/theme';

export const SERIES = '#3987e5';        // validated: dark card #121E2E, all checks pass
const SERIES_LIFT = '#5598e7';          // the pressed column, one step lighter
const GRID = 'rgba(255,255,255,0.08)';
const BASELINE = 'rgba(255,255,255,0.18)';

/** 1234 → "1,234"; 12900 → "12.9K". */
export const compact = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e4) return `${(v / 1e3).toFixed(v >= 1e5 ? 0 : 1)}K`;
  return v.toLocaleString();
};

/** A clean top for an axis: 7 → 8, 23 → 25, 140 → 150. */
export const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
};

/** A headline number: label, value, optional note. */
export const StatTile = ({ label, value, note, testID }) => (
  <View style={styles.tile} testID={testID} accessible accessibilityLabel={`${label}: ${value}${note ? `, ${note}` : ''}`}>
    <Text style={styles.tileLabel} numberOfLines={1}>{label}</Text>
    <Text style={styles.tileValue} numberOfLines={1}>{value}</Text>
    {note ? <Text style={styles.tileNote} numberOfLines={1}>{note}</Text> : null}
  </View>
);

const TableToggle = ({ open, onToggle, t }) => (
  <TouchableOpacity onPress={onToggle} hitSlop={8} accessibilityRole="button" style={styles.toggle}>
    <Text style={styles.toggleText}>{t(open ? 'studioStats.showChart' : 'studioStats.showTable')}</Text>
  </TouchableOpacity>
);

const dayLabel = (iso, opts = { day: 'numeric', month: 'short' }) => {
  try { return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, opts); } catch { return iso; }
};

/** Readers per day, as columns. data: [{ day, readers }]. */
export const DailyColumns = ({ data = [], title, t, height = 140 }) => {
  const [width, setWidth] = useState(0);
  const [at, setAt] = useState(null);
  const [table, setTable] = useState(false);
  const top = useMemo(() => niceMax(Math.max(0, ...data.map((d) => d.readers))), [data]);
  const n = data.length || 1;
  const slot = width / n;
  const bar = Math.max(2, Math.min(24, slot - 2));          // ≤24px, 2px apart
  const pick = (x) => setAt(Math.max(0, Math.min(n - 1, Math.floor(x / (slot || 1)))));
  const shown = at != null ? data[at] : data[n - 1];
  const total = data.reduce((s, d) => s + d.readers, 0);

  return (
    <View style={styles.card} testID="chart-daily">
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{title}</Text>
        <TableToggle open={table} onToggle={() => setTable((v) => !v)} t={t} />
      </View>
      {table ? (
        <View testID="chart-daily-table">
          {data.slice().reverse().map((d) => (
            <View key={d.day} style={styles.tableRow}>
              <Text style={styles.tableKey}>{dayLabel(d.day, { weekday: 'short', day: 'numeric', month: 'short' })}</Text>
              <Text style={styles.tableVal}>{d.readers}</Text>
            </View>
          ))}
        </View>
      ) : (
        <>
          {/* The readout: value first, the day after. */}
          <View style={styles.readout}>
            <Text style={styles.readoutValue}>{shown ? compact(shown.readers) : '0'}</Text>
            <Text style={styles.readoutLabel}>
              {shown ? `${t('studioStats.readersOn')} ${dayLabel(shown.day, { weekday: 'short', day: 'numeric', month: 'short' })}` : ''}
            </Text>
          </View>
          <View style={styles.plotRow}>
            <View
              style={[styles.plot, { height }]}
              onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={(e) => pick(e.nativeEvent.locationX)}
              onResponderMove={(e) => pick(e.nativeEvent.locationX)}
              onResponderRelease={() => setAt(null)}
              accessible
              accessibilityLabel={`${title}: ${t('studioStats.totalReaderDays', { n: total })}`}
              testID="chart-daily-plot"
            >
              {[0.5, 1].map((f) => (
                <View key={f} style={[styles.grid, { bottom: height * f }]} />
              ))}
              <View style={styles.baseline} />
              {width > 0 && data.map((d, i) => {
                const h = top ? (d.readers / top) * (height - 4) : 0;
                return (
                  <View key={d.day} style={[styles.col, {
                    left: i * slot + (slot - bar) / 2, width: bar, height: Math.max(d.readers ? 2 : 0, h),
                    backgroundColor: i === at ? SERIES_LIFT : SERIES,
                  }]} />
                );
              })}
              {at != null && width > 0 ? (
                <View style={[styles.crosshair, { left: at * slot + slot / 2 }]} />
              ) : null}
            </View>
            <View style={[styles.yAxis, { height }]}>
              <Text style={styles.axisText}>{compact(top)}</Text>
              <Text style={styles.axisText}>{compact(top / 2)}</Text>
              <Text style={styles.axisText}>0</Text>
            </View>
          </View>
          <View style={styles.xAxis}>
            <Text style={styles.axisText}>{data[0] ? dayLabel(data[0].day) : ''}</Text>
            <Text style={styles.axisText}>{data[n - 1] ? dayLabel(data[n - 1].day) : ''}</Text>
          </View>
        </>
      )}
    </View>
  );
};

/** How far readers get: readers who reached each chapter. rows: [{ index, title, readers }]. */
export const ReaderFunnel = ({ rows = [], title, t, mostLeft }) => {
  const [table, setTable] = useState(false);
  const top = Math.max(1, ...rows.map((r) => r.readers));
  return (
    <View style={styles.card} testID="chart-funnel">
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{title}</Text>
        <TableToggle open={table} onToggle={() => setTable((v) => !v)} t={t} />
      </View>
      {rows.map((r) => {
        const name = r.title || t('pubDetail.chapterN', { n: r.index + 1 });
        const stops = mostLeft && mostLeft.index === r.index;
        return table ? (
          <View key={r.index} style={styles.tableRow}>
            <Text style={styles.tableKey} numberOfLines={1}>{`${r.index + 1}. ${name}`}</Text>
            <Text style={styles.tableVal}>{r.readers}</Text>
          </View>
        ) : (
          <View key={r.index} style={styles.funnelRow} accessible accessibilityLabel={`${name}: ${r.readers}`}>
            <Text style={styles.funnelName} numberOfLines={1}>{`${r.index + 1}. ${name}`}</Text>
            <View style={styles.funnelTrack}>
              {/* ≤85% of the row, so the value at the tip always fits beside it. */}
              <View style={[styles.funnelBar, { width: `${(r.readers / top) * 85}%` }]} />
              <Text style={styles.funnelValue}>{r.readers}</Text>
            </View>
            {stops ? <Text style={styles.stopNote}>{t('studioStats.mostStopHere', { n: mostLeft.readers })}</Text> : null}
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  tile: {
    flexGrow: 1, flexBasis: 140, padding: spacing.md, borderRadius: radius.lg,
    backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  tileLabel: { ...typography.caption, color: colors.textSecondary },
  tileValue: { fontSize: 26, fontWeight: '700', color: colors.textPrimary, marginTop: 2 },
  tileNote: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  card: {
    padding: spacing.md, borderRadius: radius.lg, marginTop: spacing.md,
    backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  cardTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '700', flex: 1 },
  toggle: { paddingVertical: 2 },
  toggleText: { ...typography.caption, color: colors.primary, fontWeight: '700' },

  readout: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: spacing.xs },
  readoutValue: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  readoutLabel: { ...typography.caption, color: colors.textSecondary },
  plotRow: { flexDirection: 'row', gap: 6 },
  plot: { flex: 1, position: 'relative' },
  grid: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: GRID },
  baseline: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, backgroundColor: BASELINE },
  col: { position: 'absolute', bottom: 0, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  crosshair: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.45)' },
  yAxis: { justifyContent: 'space-between', alignItems: 'flex-end', width: 34 },
  xAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, marginRight: 40 },
  axisText: { fontSize: 10.5, color: colors.textMuted, fontVariant: ['tabular-nums'] },

  funnelRow: { marginBottom: spacing.sm },
  funnelName: { ...typography.caption, color: colors.textSecondary, marginBottom: 3 },
  funnelTrack: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  funnelBar: { height: 14, borderTopRightRadius: 4, borderBottomRightRadius: 4, backgroundColor: SERIES, minWidth: 2 },
  funnelValue: { ...typography.caption, color: colors.textPrimary, fontWeight: '700', fontVariant: ['tabular-nums'] },
  stopNote: { ...typography.caption, color: colors.textMuted, fontSize: 11, marginTop: 2 },

  tableRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  tableKey: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  tableVal: { ...typography.caption, color: colors.textPrimary, fontWeight: '700', fontVariant: ['tabular-nums'] },
});

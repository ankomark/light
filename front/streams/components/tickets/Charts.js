/**
 * The organiser's charts, drawn with plain views: no chart library, so no
 * native module the phone's build might not have yet.
 *
 * - DailyBars: money in per day over the last two weeks, missing days as
 *   zero; tap a bar for that day's amount and tickets.
 * - LevelShare: how the takings split across ticket levels, one band each.
 * - Ring: a share of a whole (sold of capacity, admitted of sold), as a dial.
 * - Spark: a small trend line of bars, for the totals on My events.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { formatKes } from '../../services/tickets';
import { T, F, tap } from './TicketKit';

// Gold to ivory, for the levels: told apart without leaving the palette.
export const LEVEL_COLORS = ['#C9A45C', '#E8D4AA', '#8E6D33', '#F6F1E7', '#A88A4E', '#6E5528', '#D9C08A'];

const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * `n` days ending today, oldest first, each `{ date, collected, tickets }` —
 * days the server sent nothing for are zero, so the bars keep their spacing.
 */
export const fillDays = (byDay, n = 14, now = new Date()) => {
  const seen = new Map((byDay || []).map((d) => [String(d.date).slice(0, 10), d]));
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = dayKey(d);
    const row = seen.get(key);
    out.push({ date: key, collected: row?.collected || 0, tickets: row?.tickets || 0 });
  }
  return out;
};

const shortDate = (key, months) => {
  const [, m, d] = key.split('-').map(Number);
  return `${d} ${months[m - 1] || ''}`.trim();
};

/** Money per day; tap a bar to read it. */
export const DailyBars = ({ byDay, t, months, days = 14, height = 96, now }) => {
  const rows = useMemo(() => fillDays(byDay, days, now), [byDay, days, now]);
  const max = Math.max(1, ...rows.map((r) => r.collected));
  const total = rows.reduce((s, r) => s + r.collected, 0);
  const [picked, setPicked] = useState(null);
  const shown = picked != null ? rows[picked] : null;

  return (
    <View style={styles.card} testID="chart-days">
      <View style={styles.headRow}>
        <Text style={styles.label}>{t('tix.chart.days', { n: days })}</Text>
        <Text style={styles.headValue}>{formatKes(total)}</Text>
      </View>
      <Text style={styles.readout} accessibilityLiveRegion="polite" testID="chart-days-readout">
        {shown
          ? `${shortDate(shown.date, months)} · ${formatKes(shown.collected)} · ${t('tix.chart.tickets', { n: shown.tickets })}`
          : t('tix.chart.tapDay')}
      </Text>
      <View style={[styles.bars, { height }]}>
        {/* The best day, as a faint rule: the scale the rest are read against. */}
        <View style={[styles.rule, { bottom: height - 1 }]} />
        {rows.map((r, i) => {
          const h = r.collected ? Math.max(4, (r.collected / max) * (height - 6)) : 2;
          const on = picked === i;
          return (
            <TouchableOpacity
              key={r.date}
              style={styles.barCol}
              onPress={() => { tap(); setPicked(on ? null : i); }}
              accessibilityRole="button"
              accessibilityLabel={`${shortDate(r.date, months)}, ${formatKes(r.collected)}`}
              testID={`chart-day-${r.date}`}
            >
              <View style={[styles.bar, { height: h }, !r.collected && styles.barEmpty, on && styles.barOn]} />
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={styles.axis}>
        <Text style={styles.axisText}>{shortDate(rows[0].date, months)}</Text>
        <Text style={styles.axisText}>{t('tix.chart.today')}</Text>
      </View>
    </View>
  );
};

/** The takings split by level: one band, then a line per level. */
export const LevelShare = ({ levels, t }) => {
  const rows = (levels || []).filter((l) => l.quantity > 0 || l.sold > 0);
  const total = rows.reduce((s, l) => s + (l.collected || 0), 0);
  if (!rows.length) return null;
  return (
    <View style={styles.card} testID="chart-levels">
      <Text style={styles.label}>{t('tix.chart.levels')}</Text>
      <View style={styles.band}>
        {total > 0 ? rows.map((l, i) => (l.collected > 0 ? (
          <View key={l.id ?? l.name} style={{ flex: l.collected, backgroundColor: LEVEL_COLORS[i % LEVEL_COLORS.length] }} />
        ) : null)) : <View style={[styles.flex, styles.bandEmpty]} />}
      </View>
      {rows.map((l, i) => {
        const pct = total > 0 ? Math.round(((l.collected || 0) / total) * 100) : 0;
        const fill = l.quantity > 0 ? Math.min(100, ((l.sold || 0) / l.quantity) * 100) : 0;
        return (
          <View key={l.id ?? l.name} style={styles.level} testID={`chart-level-${l.id ?? i}`}>
            <View style={[styles.swatch, { backgroundColor: LEVEL_COLORS[i % LEVEL_COLORS.length] }]} />
            <View style={styles.flex}>
              <View style={styles.levelTop}>
                <Text style={styles.levelName} numberOfLines={1}>{l.name}</Text>
                <Text style={styles.levelMoney}>{formatKes(l.collected || 0)}</Text>
              </View>
              <View style={styles.levelTrack}><View style={[styles.levelFill, { width: `${fill}%` }]} /></View>
              <Text style={styles.levelMeta}>
                {t('tix.chart.soldOf', { sold: l.sold || 0, total: l.quantity })}{total > 0 ? `  ·  ${pct}%` : ''}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
};

/**
 * A dial of `value` out of `total`: dots round a circle, lit up to the share.
 * Dots rather than an arc: plain views draw them on every phone.
 */
export const Ring = ({ value, total, label, sub, size = 112, dots = 40, color = T.gold, testID }) => {
  const share = total > 0 ? Math.min(1, Math.max(0, value / total)) : 0;
  const lit = Math.round(share * dots);
  const r = size / 2 - 5;
  return (
    <View style={styles.ringBox} testID={testID} accessible
          accessibilityLabel={`${label}: ${Math.round(share * 100)}%`}>
      <View style={{ width: size, height: size }}>
        {Array.from({ length: dots }, (_, i) => {
          const a = (i / dots) * 2 * Math.PI - Math.PI / 2;
          return (
            <View key={i} style={[styles.dot, {
              left: size / 2 + r * Math.cos(a) - 3, top: size / 2 + r * Math.sin(a) - 3,
              backgroundColor: i < lit ? color : T.raised,
            }]} />
          );
        })}
        <View style={styles.ringCentre}>
          <Text style={styles.ringPct}>{`${Math.round(share * 100)}%`}</Text>
        </View>
      </View>
      <Text style={styles.ringLabel} numberOfLines={1}>{label}</Text>
      {!!sub && <Text style={styles.ringSub} numberOfLines={1}>{sub}</Text>}
    </View>
  );
};

/** A small trend of bars: the shape, not the numbers. */
export const Spark = ({ byDay, days = 14, height = 28, now }) => {
  const rows = useMemo(() => fillDays(byDay, days, now), [byDay, days, now]);
  const max = Math.max(1, ...rows.map((r) => r.collected));
  return (
    <View style={[styles.spark, { height }]} testID="chart-spark" importantForAccessibility="no-hide-descendants">
      {rows.map((r) => (
        <View key={r.date} style={[styles.sparkBar, {
          height: r.collected ? Math.max(3, (r.collected / max) * height) : 2,
          opacity: r.collected ? 1 : 0.35,
        }]} />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    padding: 16, marginTop: 12, borderRadius: 20, backgroundColor: T.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.line,
  },
  headRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  label: { fontFamily: F.uiBold, fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase', color: T.faint },
  headValue: { fontFamily: F.uiHeavy, fontSize: 15, color: T.ivory },
  readout: { fontFamily: F.uiSemi, fontSize: 12.5, color: T.champagne, marginTop: 6, minHeight: 18 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginTop: 10 },
  rule: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: T.line },
  barCol: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { borderRadius: 4, backgroundColor: T.gold },
  barEmpty: { backgroundColor: T.raised },
  barOn: { backgroundColor: T.champagne },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  axisText: { fontFamily: F.ui, fontSize: 11, color: T.faint },

  band: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', marginTop: 12, marginBottom: 6 },
  bandEmpty: { backgroundColor: T.raised },
  level: { flexDirection: 'row', gap: 10, marginTop: 12 },
  swatch: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  levelTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  levelName: { flexShrink: 1, fontFamily: F.uiBold, fontSize: 14, color: T.ivory },
  levelMoney: { fontFamily: F.uiHeavy, fontSize: 14, color: T.champagne },
  levelTrack: { height: 5, borderRadius: 3, backgroundColor: T.raised, overflow: 'hidden', marginTop: 6 },
  levelFill: { height: 5, borderRadius: 3, backgroundColor: T.goldDeep },
  levelMeta: { fontFamily: F.ui, fontSize: 12, color: T.muted, marginTop: 4 },

  ringBox: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 20, backgroundColor: T.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.line },
  dot: { position: 'absolute', width: 6, height: 6, borderRadius: 3 },
  ringCentre: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  ringPct: { fontFamily: F.display, fontSize: 28, color: T.ivory },
  ringLabel: { fontFamily: F.uiBold, fontSize: 13, color: T.ivory, marginTop: 10 },
  ringSub: { fontFamily: F.ui, fontSize: 12, color: T.muted, marginTop: 2 },

  spark: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  sparkBar: { flex: 1, borderRadius: 2, backgroundColor: T.gold },
});

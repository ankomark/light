// The Pulse dashboard's charts, drawn with plain Views so they work the same
// on phones and the web without a native chart or SVG module: a ring of ticks
// (a share, or several parts of a whole), a trend line, hour bars and
// horizontal bars.
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';

export const PULSE = {
  bg: '#0B1016',
  card: '#121A24',
  line: '#1C2733',
  lineStrong: '#243242',
  text: '#E6EDF3',
  sub: '#C3CFDC',
  muted: '#8EA0B4',
  faint: '#5E7187',
  teal: '#2EC4B6',
  tealDim: '#1F4A50',
  tealSoft: '#16303A',
  coral: '#FF7A59',
  yellow: '#FFC857',
  violet: '#9B8CFF',
};

// A circle of ticks; `colorAt(i)` colours each one.
const Ticks = ({ size, ticks, thickness, colorAt }) => {
  const w = Math.max(2, Math.round((Math.PI * size) / ticks / 2));
  const reach = size / 2 - thickness / 2;
  return Array.from({ length: ticks }, (_, i) => (
    <View
      key={i}
      style={{
        position: 'absolute', width: w, height: thickness, borderRadius: w / 2,
        left: size / 2 - w / 2, top: size / 2 - thickness / 2,
        backgroundColor: colorAt(i),
        transform: [{ rotate: `${(i * 360) / ticks}deg` }, { translateY: -reach }],
      }}
    />
  ));
};

// A share as a ring: `pct` of the ticks lit, the label in the middle.
export const TickRing = ({ pct = 0, size = 84, color = PULSE.teal, label, testID }) => {
  const ticks = 48;
  const lit = Math.round((Math.max(0, Math.min(100, pct)) / 100) * ticks);
  return (
    <View style={{ width: size, height: size }} testID={testID} accessibilityLabel={`${Math.round(pct)}%`}>
      <Ticks size={size} ticks={ticks} thickness={Math.round(size * 0.13)}
        colorAt={(i) => (i < lit ? color : PULSE.line)} />
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Text style={[styles.ringLabel, { fontSize: Math.round(size * 0.2) }]}>{label ?? `${Math.round(pct)}%`}</Text>
      </View>
    </View>
  );
};

// Parts of a whole as one ring: [{ value, color }].
export const PartsRing = ({ parts = [], size = 150, children }) => {
  const ticks = 72;
  const total = parts.reduce((s, p) => s + (p.value || 0), 0);
  const colorAt = (i) => {
    if (!total) return PULSE.line;
    const at = ((i + 0.5) / ticks) * total;
    let sum = 0;
    for (const p of parts) {
      sum += p.value || 0;
      if (at <= sum) return p.color;
    }
    return PULSE.line;
  };
  return (
    <View style={{ width: size, height: size }}>
      <Ticks size={size} ticks={ticks} thickness={Math.round(size * 0.12)} colorAt={colorAt} />
      <View style={[StyleSheet.absoluteFill, styles.center]}>{children}</View>
    </View>
  );
};

// One straight piece of a line between two points.
const Segment = ({ x1, y1, x2, y2, color, thickness }) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  return (
    <View
      style={{
        position: 'absolute', width: len, height: thickness, borderRadius: thickness / 2,
        left: (x1 + x2) / 2 - len / 2, top: (y1 + y2) / 2 - thickness / 2,
        backgroundColor: color, transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
      }}
    />
  );
};

// Lines over days: series = [{ data: [n…], color, fill? }]; the first with
// `fill` gets soft columns under it.
export const TrendChart = ({ series = [], dates = [], height = 180 }) => {
  const [w, setW] = useState(0);
  const n = Math.max(...series.map((s) => s.data.length), 0);
  const max = Math.max(1, ...series.flatMap((s) => s.data));
  const xAt = (i) => (n > 1 ? (i * w) / (n - 1) : w / 2);
  const yAt = (v) => height - 6 - (v / max) * (height - 12);
  const mid = dates[Math.floor((dates.length - 1) / 2)];
  const short = (d) => (d ? d.slice(5).replace('-', '/') : '');
  return (
    <View>
      <View style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)} testID="pulse-trend">
        {[0, 1, 2, 3].map((g) => (
          <View key={g} style={[styles.grid, { top: (g * (height - 1)) / 3 }]} />
        ))}
        {w > 0 && series.map((s, si) => (
          <React.Fragment key={si}>
            {s.fill && s.data.map((v, i) => (
              <View key={`f${i}`} style={{
                position: 'absolute', left: xAt(i) - w / Math.max(1, n - 1) / 2, width: w / Math.max(1, n - 1),
                top: yAt(v), bottom: 0, backgroundColor: s.color, opacity: 0.1,
              }} />
            ))}
            {s.data.slice(1).map((v, i) => (
              <Segment key={i} x1={xAt(i)} y1={yAt(s.data[i])} x2={xAt(i + 1)} y2={yAt(v)}
                color={s.color} thickness={s.fill ? 2.5 : 2} />
            ))}
            {s.data.length > 0 && (
              <View style={[styles.endDot, {
                left: xAt(s.data.length - 1) - 4, top: yAt(s.data[s.data.length - 1]) - 4, backgroundColor: s.color,
              }]} />
            )}
          </React.Fragment>
        ))}
      </View>
      <View style={styles.axis}>
        <Text style={styles.axisText}>{short(dates[0])}</Text>
        <Text style={styles.axisText}>{short(mid)}</Text>
        <Text style={styles.axisText}>{short(dates[dates.length - 1])}</Text>
      </View>
    </View>
  );
};

// 24 bars, one per hour; the busiest lit.
export const HourBars = ({ hours = [], height = 140 }) => {
  const max = Math.max(1, ...hours);
  return (
    <View>
      <View style={[styles.hours, { height }]} testID="pulse-hours">
        {hours.map((v, i) => (
          <View key={i} style={[styles.hour, {
            height: `${Math.max(3, (v / max) * 100)}%`,
            backgroundColor: v >= max * 0.8 ? PULSE.teal : PULSE.tealDim,
          }]} />
        ))}
      </View>
      <View style={styles.axis}>
        {['00', '06', '12', '18', '23'].map((h) => <Text key={h} style={styles.axisText}>{h}</Text>)}
      </View>
    </View>
  );
};

// Labelled horizontal bars: [{ label, value, color }].
export const BarList = ({ rows = [] }) => {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <View style={{ gap: 12 }}>
      {rows.map((r) => (
        <View key={r.label} style={{ gap: 6 }}>
          <View style={styles.barHead}>
            <Text style={styles.barLabel}>{r.label}</Text>
            <Text style={styles.barValue}>{r.value}</Text>
          </View>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${(r.value / max) * 100}%`, backgroundColor: r.color }]} />
          </View>
        </View>
      ))}
    </View>
  );
};

export const Legend = ({ items = [] }) => (
  <View style={styles.legend}>
    {items.map((it) => (
      <View key={it.label} style={styles.legendItem}>
        <View style={[styles.legendDot, { backgroundColor: it.color }]} />
        <Text style={styles.legendLabel} numberOfLines={1}>{it.label}</Text>
        {it.value != null && <Text style={styles.legendValue}>{it.value}</Text>}
      </View>
    ))}
  </View>
);

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  ringLabel: { color: PULSE.text, fontWeight: '700' },
  grid: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: PULSE.line },
  endDot: { position: 'absolute', width: 8, height: 8, borderRadius: 4 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  axisText: { color: PULSE.faint, fontSize: 11, fontVariant: ['tabular-nums'] },
  hours: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  hour: { flex: 1, borderRadius: 3 },
  barHead: { flexDirection: 'row' },
  barLabel: { flex: 1, color: PULSE.sub, fontSize: 13 },
  barValue: { color: PULSE.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: PULSE.line, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8, columnGap: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: '40%' },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendLabel: { color: PULSE.sub, fontSize: 12, flexShrink: 1 },
  legendValue: { color: PULSE.text, fontSize: 12, fontWeight: '700', marginLeft: 'auto' },
});

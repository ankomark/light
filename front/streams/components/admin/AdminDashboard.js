// Pulse: the admin dashboard. Rings for how the app is doing (who is active,
// how fast reports and appeals are handled, admins with two-step sign-in), the
// sign-up and report trend, why people report, the busiest hours, what people
// shared and who is most followed, then what needs an admin now. The charts
// need the analytics power; without it an admin sees the counts and the queue.
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, useWindowDimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchAdminDashboard, fetchAdminPulse } from '../../services/api';
import { useAuth } from '../../context/useAuth';
import { peekCache, writeCache, userKey } from '../../utils/screenCache';
import { useAdminMe } from './AdminKit';
import { WIDE } from './AdminTabs';
import {
  PULSE, TickRing, PartsRing, TrendChart, HourBars, BarList, Legend,
} from './PulseCharts';
import { useI18n } from '../../context/I18nContext';

const PERIODS = [7, 14, 30, 90];
const REASON_COLOR = { spam: PULSE.coral, hate: PULSE.coral, violence: PULSE.coral, copyright: PULSE.yellow };
const MIX = [['posts', PULSE.teal], ['tracks', PULSE.violet], ['products', PULSE.yellow], ['stories', PULSE.coral]];
const fmt = (n) => (n ?? 0).toLocaleString();

const Card = ({ title, sub, children, style, testID }) => (
  <View style={[styles.card, style]} testID={testID}>
    {(title || sub) && (
      <View style={styles.cardHead}>
        {!!title && <Text style={styles.cardTitle}>{title}</Text>}
        {!!sub && <Text style={styles.cardSub}>{sub}</Text>}
      </View>
    )}
    {children}
  </View>
);

const Ring = ({ label, pct, value, sub, color, wide }) => (
  <View style={[styles.card, wide ? styles.ringWide : styles.ringPhone]}>
    <TickRing pct={pct} color={color} size={wide ? 84 : 76} />
    <View style={wide ? styles.ringTextWide : styles.ringTextPhone}>
      <Text style={styles.ringLabel}>{label}</Text>
      <Text style={styles.ringValue}>{value}</Text>
      {!!sub && <Text style={styles.ringSub}>{sub}</Text>}
    </View>
  </View>
);

const Kpi = ({ label, value }) => (
  <View style={[styles.card, styles.kpi]}>
    <Text style={styles.ringLabel}>{label}</Text>
    <Text style={styles.kpiValue}>{fmt(value)}</Text>
  </View>
);

export default function AdminDashboard({ navigation }) {
  const { t } = useI18n();
  const { currentUser } = useAuth();
  const { can } = useAdminMe();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const canCharts = can('view_analytics');
  const canReports = can('handle_reports');

  // Opens on the last copy (this admin's own), refreshed behind it.
  const dashKey = userKey(currentUser?.id, 'admin:dashboard');
  const [days, setDays] = useState(14);
  const pulseKey = userKey(currentUser?.id, `admin:pulse:${days}`);
  const [dash, setDash] = useState(() => peekCache(dashKey));
  const [pulseState, setPulse] = useState(() => peekCache(pulseKey));
  // Charts only while the server says this admin may see them (a cached copy
  // outlives a power taken away).
  const pulse = canCharts ? pulseState : null;
  const [loading, setLoading] = useState(!dash);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, p] = await Promise.all([
        fetchAdminDashboard(),
        canCharts ? fetchAdminPulse(days) : Promise.resolve(null),
      ]);
      setDash(d);
      writeCache(dashKey, d, { persist: false });
      if (p) {
        setPulse(p);
        writeCache(pulseKey, p, { persist: false });
      }
      setErr(null);
    } catch (e) {
      const status = e?.response?.status || e?.status;
      setErr(status ? t('admin.dashboardLoadFailedStatus', { status }) : t('adminPulse.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t, canCharts, days, dashKey, pulseKey]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading && !dash && !pulse) {
    return <View style={styles.centered}><ActivityIndicator size="large" color={PULSE.teal} /></View>;
  }

  const rings = pulse?.rings;
  const mixTotal = MIX.reduce((s, [k]) => s + (pulse?.mix?.[k] || 0), 0);
  const waiting = (dash?.recent_reports || []).filter((r) => r.status === 'pending').slice(0, 5);
  const row = wide ? styles.row : styles.col;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, wide && styles.contentWide]}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={PULSE.teal} />}
    >
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.title}>{t('adminPulse.title')}</Text>
          {pulse && (
            <View style={styles.online}>
              <View style={styles.liveDot} />
              <Text style={styles.onlineText} testID="pulse-online">{t('adminPulse.online', { n: fmt(pulse.online_now) })}</Text>
            </View>
          )}
        </View>
        {canCharts && (
          <View style={styles.periods}>
            {PERIODS.map((d) => (
              <TouchableOpacity key={d} onPress={() => setDays(d)} testID={`pulse-days-${d}`}
                accessibilityRole="button" accessibilityState={{ selected: d === days }}
                style={[styles.period, d === days && styles.periodOn]}>
                <Text style={[styles.periodText, d === days && styles.periodTextOn]}>{t('adminPulse.days', { n: d })}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {!!err && <View style={styles.err}><Text style={styles.errText}>{err}</Text></View>}

      {rings ? (
        <View style={styles.rings} testID="pulse-rings">
          <Ring wide={wide} color={PULSE.teal} pct={rings.active.pct} label={t('adminPulse.active')}
            value={fmt(rings.active.value)} sub={t('adminPulse.activeSub', { total: fmt(rings.active.of) })} />
          <Ring wide={wide} color={PULSE.yellow} pct={rings.reports.pct} label={t('adminPulse.fast')}
            value={fmt(rings.reports.value)} sub={t('adminPulse.fastSub', { n: fmt(rings.reports.open) })} />
          <Ring wide={wide} color={PULSE.violet} pct={rings.appeals.pct} label={t('adminPulse.appeals')}
            value={fmt(rings.appeals.value)} sub={t('adminPulse.appealsSub', { n: fmt(rings.appeals.waiting) })} />
          <Ring wide={wide} color={rings.two_factor.pct === 100 ? PULSE.teal : PULSE.coral} pct={rings.two_factor.pct}
            label={t('adminPulse.twoFactor')} value={`${rings.two_factor.value} / ${rings.two_factor.of}`}
            sub={rings.two_factor.pct === 100 ? t('adminPulse.allProtected')
              : t('adminPulse.unprotected', { n: rings.two_factor.of - rings.two_factor.value })} />
        </View>
      ) : (
        <View style={styles.rings}>
          <Kpi label={t('adminPulse.members')} value={dash?.totals?.users} />
          <Kpi label={t('adminPulse.new24h')} value={dash?.signups?.last_24h} />
          <Kpi label={t('adminPulse.reportsOpen')} value={dash?.reports?.pending} />
          <Kpi label={t('adminPulse.appealsWaiting')} value={dash?.appeals?.pending} />
        </View>
      )}

      {pulse && (
        <>
          <View style={row}>
            <Card style={wide && { flex: 2 }} title={t('adminPulse.trend')}>
              <Legend items={[
                { label: t('adminPulse.signups'), color: PULSE.teal },
                { label: t('adminPulse.reports'), color: PULSE.coral },
              ]} />
              <TrendChart dates={pulse.dates} height={wide ? 210 : 150} series={[
                { data: pulse.trend.signups, color: PULSE.teal, fill: true },
                { data: pulse.trend.reports, color: PULSE.coral },
              ]} />
            </Card>
            <Card style={wide && { flex: 1 }} title={t('adminPulse.reasons')} testID="pulse-reasons">
              {pulse.reasons.length ? (
                <BarList rows={pulse.reasons.slice(0, 6).map((r) => ({
                  label: t(`report.reason.${r.reason}`), value: r.count, color: REASON_COLOR[r.reason] || PULSE.yellow,
                }))} />
              ) : <Text style={styles.none}>{t('adminPulse.noReports')}</Text>}
            </Card>
          </View>

          <View style={row}>
            <Card style={wide && { flex: 1.4 }} title={t('adminPulse.hours')} sub={t('adminPulse.hoursSub')}>
              <HourBars hours={pulse.hours} height={wide ? 140 : 100} />
            </Card>
            <Card style={wide && { flex: 1 }} title={t('adminPulse.mix')} testID="pulse-mix">
              <View style={{ alignItems: 'center' }}>
                <PartsRing size={150} parts={MIX.map(([k, color]) => ({ value: pulse.mix[k] || 0, color }))}>
                  <Text style={styles.mixTotal}>{fmt(mixTotal)}</Text>
                  <Text style={styles.ringSub}>{t('adminPulse.items')}</Text>
                </PartsRing>
              </View>
              <Legend items={MIX.map(([k, color]) => ({
                label: t(`adminPulse.mix.${k}`), color,
                value: mixTotal ? `${Math.round((100 * (pulse.mix[k] || 0)) / mixTotal)}%` : '0%',
              }))} />
            </Card>
            <Card style={wide && { flex: 1 }} title={t('adminPulse.top')}>
              {pulse.top.length ? pulse.top.map((u) => (
                <View key={u.id} style={styles.topRow}>
                  <View style={styles.avatar}><Text style={styles.avatarText}>{(u.name || '?')[0].toUpperCase()}</Text></View>
                  <Text style={styles.topName} numberOfLines={1}>{u.name}</Text>
                  <Text style={styles.topCount}>{fmt(u.followers)}</Text>
                </View>
              )) : <Text style={styles.none}>{t('adminPulse.noTop')}</Text>}
            </Card>
          </View>
        </>
      )}

      {canReports && (
        <Card title={t('adminPulse.needs')} testID="pulse-needs">
          {waiting.length ? waiting.map((r) => (
            <TouchableOpacity key={r.id} style={styles.needRow} onPress={() => navigation.replace('AdminReports')}>
              <Text style={styles.needPill}>{r.dup_count > 1 ? t('adminPulse.reportsN', { n: r.dup_count }) : t(`report.reason.${r.reason}`)}</Text>
              <Text style={styles.needText} numberOfLines={1}>
                {r.target?.title || r.target?.caption || r.target?.content || r.target?.name || `${r.content_type} #${r.object_id}`}
              </Text>
            </TouchableOpacity>
          )) : <Text style={styles.none}>{t('adminPulse.nothing')}</Text>}
          {waiting.length > 0 && (
            <TouchableOpacity onPress={() => navigation.replace('AdminReports')} style={styles.allLink}>
              <Text style={styles.allLinkText}>{t('adminPulse.allReports')} →</Text>
            </TouchableOpacity>
          )}
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 18, paddingBottom: 48, gap: 14 },
  contentWide: { paddingHorizontal: 36, paddingTop: 28, gap: 18, maxWidth: 1400, width: '100%', alignSelf: 'center' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  title: { color: PULSE.text, fontSize: 26, fontWeight: '700' },
  online: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: PULSE.teal, borderWidth: 3, borderColor: 'rgba(46,196,182,0.25)' },
  onlineText: { color: PULSE.muted, fontSize: 13 },
  periods: { flexDirection: 'row', gap: 4, backgroundColor: PULSE.card, borderRadius: 12, padding: 4, borderWidth: 1, borderColor: PULSE.line },
  period: { paddingHorizontal: 10, minHeight: 36, justifyContent: 'center', borderRadius: 9 },
  periodOn: { backgroundColor: PULSE.tealSoft },
  periodText: { color: PULSE.muted, fontSize: 12, fontWeight: '600' },
  periodTextOn: { color: PULSE.teal },
  err: { backgroundColor: 'rgba(255,122,89,0.12)', borderWidth: 1, borderColor: 'rgba(255,122,89,0.45)', borderRadius: 12, padding: 10 },
  errText: { color: PULSE.coral, fontSize: 13 },
  rings: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: { backgroundColor: PULSE.card, borderWidth: 1, borderColor: PULSE.line, borderRadius: 18, padding: 18, gap: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
  cardTitle: { color: PULSE.text, fontSize: 16, fontWeight: '600', flex: 1 },
  cardSub: { color: PULSE.muted, fontSize: 12 },
  ringPhone: { flexBasis: '46%', flexGrow: 1, alignItems: 'center', padding: 14, gap: 8 },
  ringWide: { flexBasis: '22%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 16 },
  ringTextPhone: { alignItems: 'center', gap: 2 },
  ringTextWide: { flex: 1, gap: 3, minWidth: 0 },
  ringLabel: { color: PULSE.muted, fontSize: 12, textAlign: 'center' },
  ringValue: { color: PULSE.text, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  ringSub: { color: PULSE.muted, fontSize: 11 },
  kpi: { flexBasis: '46%', flexGrow: 1, gap: 6 },
  kpiValue: { color: PULSE.text, fontSize: 26, fontWeight: '700', fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', gap: 16, alignItems: 'stretch' },
  col: { gap: 14 },
  none: { color: PULSE.muted, fontSize: 13 },
  mixTotal: { color: PULSE.text, fontSize: 22, fontWeight: '700' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: PULSE.line, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: PULSE.muted, fontSize: 12, fontWeight: '700' },
  topName: { flex: 1, color: PULSE.text, fontSize: 14 },
  topCount: { color: PULSE.teal, fontSize: 12, fontVariant: ['tabular-nums'] },
  needRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, borderTopWidth: 1, borderTopColor: PULSE.line },
  needPill: {
    color: PULSE.coral, backgroundColor: 'rgba(255,122,89,0.14)', fontSize: 11, fontWeight: '700',
    paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, overflow: 'hidden',
  },
  needText: { flex: 1, color: PULSE.text, fontSize: 14 },
  allLink: { alignSelf: 'flex-end', paddingVertical: 6 },
  allLinkText: { color: PULSE.teal, fontSize: 13, fontWeight: '600' },
});

// The Monitor (admin phase 7): how the server is doing right now — the last
// hour minute by minute (requests and server errors), how fast it answers,
// the slowest and the failing endpoints, and the checks: database, cache,
// background jobs, notifications, storage. Refreshes itself every 30 seconds
// while open.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../context/I18nContext';
import { fetchAdminMonitor } from '../../services/api';
import { adminMemo } from '../../utils/adminSession';
import { ADMIN, ErrorState, StaleNote } from './AdminKit';
import { TrendChart, Legend, PULSE } from './PulseCharts';

const MEMO = 'monitor';
const EVERY_MS = 30000;

const Check = ({ ok, label, detail, warn }) => (
  <View style={styles.check}>
    <Ionicons name={ok ? (warn ? 'alert-circle' : 'checkmark-circle') : 'close-circle'} size={20}
      color={ok ? (warn ? '#FFB547' : ADMIN.ok) : ADMIN.danger} />
    <Text style={styles.checkLabel}>{label}</Text>
    {!!detail && <Text style={styles.checkDetail} numberOfLines={2}>{detail}</Text>}
  </View>
);

export default function AdminMonitor() {
  const { t } = useI18n();
  const [data, setData] = useState(() => adminMemo.get(MEMO) || null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchAdminMonitor();
      setData(res);
      setFailed(false);
      adminMemo.set(MEMO, res);
    } catch {
      setFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Live while on screen, quiet when not.
  useFocusEffect(useCallback(() => {
    load();
    timer.current = setInterval(load, EVERY_MS);
    return () => clearInterval(timer.current);
  }, [load]));
  useEffect(() => () => clearInterval(timer.current), []);

  if (!data && failed) return <ErrorState onRetry={load} />;
  if (!data) return <ActivityIndicator color={ADMIN.gold} style={{ marginTop: 60 }} />;
  const { hour, minutes, health } = data;
  const jobs = health.jobs || {};
  const dates = minutes.map((m) => `0000-${m.at}`);

  return (
    <ScrollView contentContainerStyle={styles.page}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}
        tintColor={ADMIN.gold} />} testID="admin-monitor">
      <Text style={styles.title}>{t('adminMon.title')}</Text>
      {failed && <StaleNote onRetry={load} />}

      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={styles.statNum}>{hour.requests}</Text>
          <Text style={styles.statLabel}>{t('adminMon.requests')}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statNum, hour.error_rate >= 1 && { color: ADMIN.danger }]}>{hour.error_rate}%</Text>
          <Text style={styles.statLabel}>{t('adminMon.errorRate', { n: hour.errors })}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statNum, hour.avg_ms >= 800 && { color: '#FFB547' }]}>{hour.avg_ms} ms</Text>
          <Text style={styles.statLabel}>{t('adminMon.avg')}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('adminMon.lastHour')}</Text>
        <TrendChart dates={dates} height={150} series={[
          { data: minutes.map((m) => m.requests), color: PULSE.teal, fill: true },
          { data: minutes.map((m) => m.errors), color: ADMIN.danger },
        ]} />
        <Legend items={[{ label: t('adminMon.requests'), color: PULSE.teal }, { label: t('adminMon.errors'), color: ADMIN.danger }]} />
      </View>

      <Text style={styles.section}>{t('adminMon.checks')}</Text>
      <View style={styles.card}>
        <Check ok={health.database.ok} label={t('adminMon.database')}
          detail={health.database.ok ? `${health.database.ms} ms · ${health.database.engine}` : t('adminMon.down')}
          warn={health.database.ms > 200} />
        <Check ok={health.cache.ok} label={t('adminMon.cache')} warn={!health.cache.shared}
          detail={health.cache.shared ? t('adminMon.cacheShared') : t('adminMon.cacheLocal')} />
        <Check ok={!jobs.stuck && (jobs.oldest_waiting_minutes ?? 0) < 30} warn={jobs.failed_day > 0}
          label={t('adminMon.jobs')}
          detail={t('adminMon.jobsDetail', {
            queued: jobs.queued, running: jobs.running, failed: jobs.failed_day,
            oldest: jobs.oldest_waiting_minutes ?? 0,
          })} />
        <Check ok={!health.push.sent || health.push.failed / health.push.sent < 0.2} warn={health.push.failed > 0}
          label={t('adminMon.push')} detail={t('adminMon.pushDetail', { sent: health.push.sent, failed: health.push.failed })} />
        <Check ok={health.storage.configured} label={t('adminMon.storage')}
          detail={health.storage.configured ? t('adminMon.storageOn') : t('adminMon.storageOff')} />
        <Check ok={!health.server.debug} label={t('adminMon.server')}
          detail={t('adminMon.serverDetail', { up: health.server.uptime_minutes })
            + (health.server.debug ? ` · ${t('adminMon.debugOn')}` : '')} />
      </View>

      {!!data.slowest?.length && (
        <>
          <Text style={styles.section}>{t('adminMon.slowest')}</Text>
          <View style={styles.card}>
            {data.slowest.map((r) => (
              <View key={r.endpoint} style={styles.epRow}>
                <Text style={styles.ep} numberOfLines={1}>{r.endpoint}</Text>
                <Text style={[styles.epMs, r.avg_ms >= 1000 && { color: ADMIN.danger }]}>{r.avg_ms} ms</Text>
                <Text style={styles.epN}>×{r.requests}</Text>
              </View>
            ))}
          </View>
        </>
      )}
      {!!data.failing?.length && (
        <>
          <Text style={styles.section}>{t('adminMon.failing')}</Text>
          <View style={styles.card}>
            {data.failing.map((r) => (
              <View key={r.endpoint} style={styles.epRow}>
                <Text style={styles.ep} numberOfLines={1}>{r.endpoint}</Text>
                <Text style={[styles.epMs, { color: ADMIN.danger }]}>{t('adminMon.errorsN', { n: r.errors })}</Text>
                <Text style={styles.epN}>×{r.requests}</Text>
              </View>
            ))}
          </View>
        </>
      )}
      <Text style={styles.note}>{t('adminMon.note')}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 48, gap: 10 },
  title: { color: ADMIN.text, fontSize: 26, fontWeight: '800' },
  section: { color: ADMIN.gold, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginTop: 10 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: {
    flexGrow: 1, flexBasis: '30%', minWidth: 110, padding: 12, borderRadius: 14, gap: 4,
    backgroundColor: ADMIN.card, borderWidth: StyleSheet.hairlineWidth, borderColor: ADMIN.border,
  },
  statNum: { color: ADMIN.text, fontSize: 22, fontWeight: '800' },
  statLabel: { color: ADMIN.muted, fontSize: 12 },
  card: { backgroundColor: ADMIN.card, borderRadius: 16, padding: 14, gap: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: ADMIN.border },
  cardTitle: { color: ADMIN.text, fontSize: 15, fontWeight: '800' },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  checkLabel: { color: ADMIN.text, fontSize: 15, fontWeight: '700', minWidth: 120 },
  checkDetail: { color: ADMIN.muted, fontSize: 12.5, flex: 1, minWidth: 140 },
  epRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ep: { flex: 1, color: ADMIN.text, fontSize: 13, fontFamily: 'monospace' },
  epMs: { color: ADMIN.gold, fontSize: 13, fontWeight: '800', minWidth: 64, textAlign: 'right' },
  epN: { color: ADMIN.muted, fontSize: 12, minWidth: 40, textAlign: 'right' },
  note: { color: '#7D8FA8', fontSize: 12.5, lineHeight: 18, marginTop: 6 },
});

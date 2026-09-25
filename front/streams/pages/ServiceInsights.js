// A service's numbers, for its owner: how it's found (page views, per day)
// and reached (calls, WhatsApp, messages, directions, shares), the requests
// it had and accepted, and how quickly they answer — over 7, 30 or 90
// days. Totals only, never who. Kept for offline; faded while refreshing.
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fetchServiceInsights } from '../services/api';
import { StatTile, DailyColumns, compact } from '../components/BookCharts';
import { RangeRow } from './AuthorStudio';
import { respondsLabel } from './ServiceDetail';
import useCachedData from '../utils/useCachedData';
import { userKey } from '../utils/screenCache';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';

const REACH = ['call', 'whatsapp', 'message', 'directions', 'share'];

const ServiceInsights = ({ route, navigation }) => {
  const { t } = useI18n();
  const { currentUser } = useAuth();
  const { id, name = '' } = route.params || {};
  const [days, setDays] = useState(30);
  const { data, failed, refreshing, reload } = useCachedData(userKey(currentUser?.id, `service-insights:${id}:${days}`),
    () => fetchServiceInsights(id, days));
  const reached = data ? REACH.reduce((n, k) => n + (data.totals?.[k] || 0), 0) : 0;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}
          accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.flex}>
          <Text style={styles.topTitle}>{t('services.insights')}</Text>
          {name ? <Text style={styles.topSub} numberOfLines={1}>{name}</Text> : null}
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <RangeRow days={days} onChange={setDays} t={t} />
        {!data ? (
          <View style={styles.centered}>
            {failed ? (
              <TouchableOpacity style={styles.retry} onPress={reload} testID="insights-retry">
                <Text style={styles.retryText}>{t('common.retry')}</Text>
              </TouchableOpacity>
            ) : <ActivityIndicator color={colors.primary} />}
          </View>
        ) : (
          <View style={refreshing && styles.fading} testID="service-insights">
            <View style={styles.kpis}>
              <StatTile label={t('insights.views')} value={compact(data.totals.view || 0)} testID="kpi-views" />
              <StatTile label={t('insights.reached')} value={compact(reached)} note={t('insights.reachedNote')} testID="kpi-reached" />
              <StatTile label={t('insights.requests')} value={compact(data.requests)}
                note={t('insights.accepted', { n: data.accepted })} testID="kpi-requests" />
              <StatTile label={t('insights.respond')} value={data.responds_in_hours != null ? respondsLabel(data.responds_in_hours, t) : '—'} />
            </View>
            {data.waiting ? (
              <TouchableOpacity style={styles.waiting} onPress={() => navigation.navigate('ServiceBookings', { role: 'incoming' })}
                testID="insights-waiting">
                <Ionicons name="time-outline" size={18} color={colors.accent} />
                <Text style={styles.waitingText}>{t('insights.waiting', { n: data.waiting })}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            ) : null}
            <DailyColumns data={data.daily} title={t('insights.viewsPerDay')} t={t}
              onLabel={t('insights.viewsOn')} totalKey="insights.totalViews" />
            <Text style={styles.section}>{t('insights.howReached')}</Text>
            <View style={styles.kpis}>
              {REACH.map((k) => (
                <StatTile key={k} label={t(`insights.kind.${k}`)} value={compact(data.totals[k] || 0)} testID={`kpi-${k}`} />
              ))}
            </View>
            <Text style={styles.privacy}>{t('insights.privacy')}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topTitle: { ...typography.h3, color: colors.textPrimary },
  topSub: { ...typography.caption, color: colors.textSecondary },
  body: { padding: spacing.md, paddingBottom: spacing.xxl, width: '100%', maxWidth: 820, alignSelf: 'center' },
  centered: { alignItems: 'center', paddingVertical: spacing.xl },
  retry: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryText: { ...typography.label, color: colors.white, fontWeight: '700' },
  fading: { opacity: 0.6 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  waiting: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.md,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.accent,
  },
  waitingText: { ...typography.label, color: colors.textPrimary, flex: 1 },
  section: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.sm },
  privacy: { ...typography.caption, color: colors.textMuted, marginTop: spacing.md },
});

export default ServiceInsights;

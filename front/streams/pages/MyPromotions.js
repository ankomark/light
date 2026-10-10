/**
 * My promotions: each one's state (waiting to pay, with the admins, running,
 * finished, declined), how far it has got (views of the views paid for), taps
 * and follows, and any refund owed. An unpaid one can be paid or cancelled.
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { fetchMyPromotions, cancelPromotion } from '../services/api';
import { useI18n } from '../context/I18nContext';
import { confirmAction } from '../utils/adminConfirm';
import { colors, spacing, radius } from '../constants/theme';
import { formatViews } from './Promote';

const STATUS_COLOR = {
  unpaid: '#FFC857', paying: '#FFC857', review: '#9B8CFF', active: '#2EC4B6',
  done: '#8EA0B4', rejected: '#FF7A59', cancelled: '#5E7187',
};

export const targetName = (p, t) => {
  const x = p.target || {};
  return x.title || x.name || x.caption || (x.username ? `@${x.username}` : '') || t(`promote.kind.${p.kind}`);
};

const Row = ({ p, t, onPay, onCancel }) => {
  const share = p.views_target ? Math.min(1, p.views / p.views_target) : 0;
  return (
    <View style={styles.card} testID={`promotion-${p.id}`}>
      <View style={styles.top}>
        <Text style={styles.kind}>{t(`promote.kind.${p.kind}`)}</Text>
        <View style={[styles.badge, { borderColor: STATUS_COLOR[p.status] }]}>
          <Text style={[styles.badgeText, { color: STATUS_COLOR[p.status] }]}>{t(`promote.status.${p.status}`)}</Text>
        </View>
      </View>
      <Text style={styles.name} numberOfLines={2}>{targetName(p, t)}</Text>
      <Text style={styles.sub}>
        {`${p.package?.name} · KES ${formatViews(p.price)} · ${p.counties?.length ? p.counties.join(', ') : t('promote.everyone')}`}
      </Text>
      {['active', 'done'].includes(p.status) && (
        <>
          <View style={styles.track}><View style={[styles.fill, { width: `${share * 100}%` }]} /></View>
          <View style={styles.stats}>
            <Text style={styles.stat}>{t('promote.viewsOf', { views: formatViews(p.views), target: formatViews(p.views_target) })}</Text>
            <Text style={styles.stat}>{t('promote.taps', { n: formatViews(p.clicks) })}</Text>
            {p.kind === 'profile' ? <Text style={styles.stat}>{t('promote.follows', { n: formatViews(p.follows) })}</Text> : null}
          </View>
        </>
      )}
      {p.status === 'review' ? <Text style={styles.note}>{t('promote.reviewWait')}</Text> : null}
      {p.status === 'rejected' && p.review_note ? <Text style={styles.note}>{t('promote.declinedBecause', { why: p.review_note })}</Text> : null}
      {p.refund_due ? <Text style={styles.refund}>{t('promote.refundOwed', { amount: formatViews(p.refund_owed) })}</Text> : null}
      {p.status === 'unpaid' && (
        <View style={styles.actions}>
          <TouchableOpacity style={styles.payBtn} onPress={() => onPay(p)} testID={`promotion-pay-${p.id}`}>
            <Text style={styles.payText}>{t('promote.payNow')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => onCancel(p)} testID={`promotion-cancel-${p.id}`}>
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const MyPromotions = ({ navigation }) => {
  const { t } = useI18n();
  const [rows, setRows] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await fetchMyPromotions());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const cancel = (p) => confirmAction(t('promote.cancelTitle'), t('promote.cancelBody'), async () => {
    try { await cancelPromotion(p.id); } catch { /* the list says how it stands */ }
    load();
  });

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} accessibilityRole="button"
                          accessibilityLabel={t('common.back')}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('promote.mine')}</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Promote')} hitSlop={10} accessibilityRole="button"
                          accessibilityLabel={t('promote.new')} testID="promotions-new">
          <Ionicons name="add-circle" size={28} color={colors.primary} />
        </TouchableOpacity>
      </View>
      {rows === null && !failed ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> : (
        <FlatList
          data={rows || []}
          keyExtractor={(p) => String(p.id)}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
          renderItem={({ item }) => (
            <Row p={item} t={t} onCancel={cancel}
                 onPay={(p) => navigation.navigate('Promote', { promotionId: p.id })} />
          )}
          ListEmptyComponent={(
            <View style={styles.empty}>
              <Ionicons name="megaphone-outline" size={44} color={colors.textMuted} />
              <Text style={styles.emptyText}>{failed ? t('promote.loadFailed') : t('promote.none')}</Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md },
  title: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  list: { padding: spacing.md, paddingBottom: 48, gap: spacing.sm, width: '100%', maxWidth: 680, alignSelf: 'center' },
  card: {
    padding: spacing.md, borderRadius: radius.md, gap: 6,
    backgroundColor: 'rgba(10,22,40,0.88)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kind: { color: colors.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.full, borderWidth: 1 },
  badgeText: { fontSize: 12, fontWeight: '800' },
  name: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  sub: { color: colors.textSecondary, fontSize: 13 },
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden', marginTop: 6 },
  fill: { height: 6, backgroundColor: '#2EC4B6' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  stat: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  note: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  refund: { color: '#FFC857', fontSize: 13, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: 6 },
  payBtn: { flex: 1, minHeight: 42, borderRadius: radius.full, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  payText: { color: colors.white, fontWeight: '800' },
  cancelBtn: { paddingHorizontal: spacing.lg, minHeight: 42, borderRadius: radius.full, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: colors.textSecondary, fontWeight: '700' },
  empty: { alignItems: 'center', gap: spacing.sm, marginTop: 60 },
  emptyText: { color: colors.textSecondary, fontSize: 15, textAlign: 'center' },
});

export default MyPromotions;

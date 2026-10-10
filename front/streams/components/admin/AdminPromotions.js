/**
 * Paid promotions, for admins with manage_promotions: approve or decline the
 * paid ones waiting (nothing runs before this), watch the running ones, mark
 * refunds as paid back, and set the packages' prices.
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  fetchAdminPromotions, adminPromotionAction, fetchAdminPromotionPackages, updateAdminPromotionPackage,
} from '../../services/api';
import { useI18n } from '../../context/I18nContext';
import { notify } from '../../utils/adminConfirm';
import { PULSE } from './PulseCharts';
import { useReasonSheet, ErrorState } from './AdminKit';
import { targetName } from '../../pages/MyPromotions';
import { formatViews } from '../../pages/Promote';

const TABS = ['review', 'active', 'refunds', 'prices'];

const Card = ({ p, t, onAct, busy }) => (
  <View style={styles.card} testID={`admin-promotion-${p.id}`}>
    <View style={styles.row}>
      <Text style={styles.kind}>{t(`promote.kind.${p.kind}`)}</Text>
      <Text style={styles.price}>KES {formatViews(p.price)}</Text>
    </View>
    <Text style={styles.name} numberOfLines={2}>{targetName(p, t)}</Text>
    <Text style={styles.sub}>
      {`@${p.owner?.username} · ${p.package?.name} · ${p.counties?.length ? p.counties.join(', ') : t('promote.everyone')}`}
    </Text>
    {p.mpesa_receipt ? <Text style={styles.sub}>{`M-Pesa ${p.mpesa_receipt}`}</Text> : null}
    {p.status === 'active' || p.status === 'done' ? (
      <Text style={styles.sub}>
        {t('promote.viewsOf', { views: formatViews(p.views), target: formatViews(p.views_target) })}
        {` · ${t('promote.taps', { n: formatViews(p.clicks) })}`}
      </Text>
    ) : null}
    {p.review_note ? <Text style={styles.note}>{p.review_note}</Text> : null}
    {p.status === 'review' && (
      <View style={styles.actions}>
        <TouchableOpacity style={[styles.btn, styles.approve]} disabled={busy} onPress={() => onAct(p, 'approve')}
                          testID={`admin-promotion-approve-${p.id}`}>
          <Text style={styles.btnText}>{t('adminPromo.approve')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.decline]} disabled={busy} onPress={() => onAct(p, 'reject')}
                          testID={`admin-promotion-reject-${p.id}`}>
          <Text style={styles.btnText}>{t('adminPromo.decline')}</Text>
        </TouchableOpacity>
      </View>
    )}
    {p.refund_due && (
      <View style={styles.actions}>
        <Text style={styles.owed}>{t('promote.refundOwed', { amount: formatViews(p.refund_owed) })}</Text>
        <TouchableOpacity style={[styles.btn, styles.approve]} disabled={busy} onPress={() => onAct(p, 'refunded')}
                          testID={`admin-promotion-refunded-${p.id}`}>
          <Text style={styles.btnText}>{t('adminPromo.markRefunded')}</Text>
        </TouchableOpacity>
      </View>
    )}
  </View>
);

const Prices = ({ t }) => {
  const [rows, setRows] = useState(null);
  const [edits, setEdits] = useState({});
  const load = useCallback(() => { fetchAdminPromotionPackages().then(setRows).catch(() => setRows([])); }, []);
  useFocusEffect(load);
  const save = async (key) => {
    const e = edits[key] || {};
    try {
      await updateAdminPromotionPackage(key, Object.fromEntries(
        Object.entries(e).map(([k, v]) => [k, Number(String(v).replace(/[^\d]/g, ''))])));
      setEdits((x) => ({ ...x, [key]: undefined }));
      load();
    } catch (err) {
      notify(t('common.error'), err?.response?.data?.error || t('adminPromo.saveFailed'));
    }
  };
  if (!rows) return <ActivityIndicator color={PULSE.teal} style={{ marginTop: 30 }} />;
  return rows.map((p) => (
    <View key={p.key} style={styles.card} testID={`admin-package-${p.key}`}>
      <Text style={styles.name}>{p.name}</Text>
      {[['price', 'adminPromo.priceKes'], ['views', 'adminPromo.views'], ['days', 'adminPromo.days']].map(([field, label]) => (
        <View key={field} style={styles.field}>
          <Text style={styles.sub}>{t(label)}</Text>
          <TextInput style={styles.input} keyboardType="number-pad" testID={`admin-package-${p.key}-${field}`}
                     value={String(edits[p.key]?.[field] ?? p[field])}
                     onChangeText={(v) => setEdits((x) => ({ ...x, [p.key]: { ...(x[p.key] || {}), [field]: v } }))} />
        </View>
      ))}
      {edits[p.key] ? (
        <TouchableOpacity style={[styles.btn, styles.approve]} onPress={() => save(p.key)} testID={`admin-package-${p.key}-save`}>
          <Text style={styles.btnText}>{t('common.save')}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  ));
};

export default function AdminPromotions() {
  const { t } = useI18n();
  const [tab, setTab] = useState('review');
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reasonSheet, askReason] = useReasonSheet();

  const load = useCallback(async (which = tab) => {
    if (which === 'prices') return;
    try {
      setRows(await fetchAdminPromotions(which));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [tab]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pick = (next) => { setTab(next); setRows(null); load(next); };

  const act = async (p, action) => {
    let note = '';
    if (action === 'reject' || action === 'refunded') {
      note = await askReason({
        title: action === 'reject' ? t('adminPromo.declineTitle') : t('adminPromo.refundTitle'),
        message: action === 'reject' ? t('adminPromo.declineBody') : t('adminPromo.refundBody'),
      });
      if (!note) return;
    }
    setBusy(true);
    try {
      await adminPromotionAction(p.id, action, note);
      await load();
    } catch (e) {
      notify(t('common.error'), e?.response?.data?.error || t('adminPromo.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={PULSE.teal}
        onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Text style={styles.title}>{t('adminPromo.title')}</Text>
      <View style={styles.tabs}>
        {TABS.map((k) => (
          <TouchableOpacity key={k} style={[styles.tab, tab === k && styles.tabOn]} onPress={() => pick(k)}
                            testID={`admin-promotions-tab-${k}`}>
            <Text style={[styles.tabText, tab === k && styles.tabTextOn]}>{t(`adminPromo.tab.${k}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {tab === 'prices' ? <Prices t={t} /> : failed ? <ErrorState onRetry={() => load()} /> : rows === null ? (
        <ActivityIndicator color={PULSE.teal} style={{ marginTop: 30 }} />
      ) : rows.length === 0 ? (
        <View style={styles.empty}>
          <MaterialCommunityIcons name="bullhorn-outline" size={36} color={PULSE.faint} />
          <Text style={styles.sub}>{t(`adminPromo.empty.${tab}`)}</Text>
        </View>
      ) : rows.map((p) => <Card key={p.id} p={p} t={t} onAct={act} busy={busy} />)}
      {reasonSheet}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 18, paddingBottom: 48, gap: 10, width: '100%', maxWidth: 760, alignSelf: 'center' },
  title: { color: PULSE.text, fontSize: 24, fontWeight: '700', marginBottom: 6 },
  tabs: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: PULSE.line },
  tabOn: { backgroundColor: PULSE.tealSoft, borderColor: PULSE.teal },
  tabText: { color: PULSE.muted, fontWeight: '700' },
  tabTextOn: { color: PULSE.text },
  card: { padding: 14, gap: 6, backgroundColor: PULSE.card, borderRadius: 16, borderWidth: 1, borderColor: PULSE.line },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kind: { color: PULSE.muted, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  price: { color: PULSE.yellow, fontWeight: '900' },
  name: { color: PULSE.text, fontSize: 16, fontWeight: '700' },
  sub: { color: PULSE.sub, fontSize: 13 },
  note: { color: PULSE.muted, fontSize: 13, fontStyle: 'italic' },
  owed: { flex: 1, color: PULSE.yellow, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6, alignItems: 'center' },
  btn: { flex: 1, minHeight: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  approve: { backgroundColor: PULSE.teal },
  decline: { backgroundColor: PULSE.coral },
  btnText: { color: '#06131A', fontWeight: '800' },
  field: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  input: {
    minWidth: 120, minHeight: 40, borderRadius: 10, paddingHorizontal: 10, color: PULSE.text, textAlign: 'right',
    backgroundColor: PULSE.bg, borderWidth: 1, borderColor: PULSE.lineStrong,
  },
  empty: { alignItems: 'center', gap: 8, marginTop: 30 },
});

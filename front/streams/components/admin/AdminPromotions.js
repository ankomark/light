/**
 * Paid promotions, for admins with manage_promotions:
 *  - review: approve or decline the paid ones waiting (nothing runs before)
 *  - running / paused: pause, resume or stop one early (the rest refunded)
 *  - refunds: mark money paid back
 *  - plans: add, change, hide or delete what promotions can be bought as
 *  - till: where promotion money goes — a new till is tested with KES 1 to
 *    the admin's phone, and saved only once that test was paid.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, RefreshControl, Switch,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  fetchAdminPromotions, adminPromotionAction, fetchAdminPromotionPackages, updateAdminPromotionPackage,
  createAdminPromotionPackage, deleteAdminPromotionPackage, fetchPromotionTill, savePromotionTill,
  testPromotionTill, fetchPromotionTillTest,
} from '../../services/api';
import { useI18n } from '../../context/I18nContext';
import { notify, confirmAction } from '../../utils/adminConfirm';
import { PULSE } from './PulseCharts';
import { useReasonSheet, ErrorState } from './AdminKit';
import { targetName } from '../../pages/MyPromotions';
import { formatViews } from '../../pages/Promote';

const TABS = ['review', 'active', 'paused', 'refunds', 'plans', 'till'];
const errorOf = (e, fallback) => e?.response?.data?.error || e?.response?.data?.detail || fallback;

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
    {['active', 'paused', 'done'].includes(p.status) ? (
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
    {(p.status === 'active' || p.status === 'paused') && (
      <View style={styles.actions}>
        <TouchableOpacity style={[styles.btn, styles.quiet]} disabled={busy}
                          onPress={() => onAct(p, p.status === 'active' ? 'pause' : 'resume')}
                          testID={`admin-promotion-${p.status === 'active' ? 'pause' : 'resume'}-${p.id}`}>
          <Text style={styles.quietText}>{p.status === 'active' ? t('adminPromo.pause') : t('adminPromo.resume')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.decline]} disabled={busy} onPress={() => onAct(p, 'stop')}
                          testID={`admin-promotion-stop-${p.id}`}>
          <Text style={styles.btnText}>{t('adminPromo.stop')}</Text>
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

const FIELDS = [['price', 'adminPromo.priceKes'], ['views', 'adminPromo.views'], ['days', 'adminPromo.days']];
const BLANK = { name: '', description: '', price: '', views: '', days: '' };

const Plans = ({ t }) => {
  const [rows, setRows] = useState(null);
  const [edits, setEdits] = useState({});
  const [draft, setDraft] = useState(null);       // a new plan being written
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { fetchAdminPromotionPackages().then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);

  const numbers = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => (
    ['price', 'views', 'days'].includes(k) ? [k, Number(String(v).replace(/[^\d]/g, ''))] : [k, v])));

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); load(); } catch (e) { notify(t('common.error'), errorOf(e, t('adminPromo.saveFailed'))); }
    finally { setBusy(false); }
  };
  const save = (key) => run(async () => {
    await updateAdminPromotionPackage(key, numbers(edits[key] || {}));
    setEdits((x) => ({ ...x, [key]: undefined }));
  });
  const toggle = (p) => run(() => updateAdminPromotionPackage(p.key, { is_active: !p.is_active }));
  const remove = (p) => confirmAction(t('adminPromo.deletePlanTitle'), t('adminPromo.deletePlanBody', { name: p.name }),
    () => run(() => deleteAdminPromotionPackage(p.key)));
  const add = () => run(async () => {
    await createAdminPromotionPackage(numbers(draft));
    setDraft(null);
  });

  if (!rows) return <ActivityIndicator color={PULSE.teal} style={{ marginTop: 30 }} />;
  return (
    <>
      {rows.map((p) => {
        const e = edits[p.key] || {};
        const val = (f) => String(e[f] ?? p[f] ?? '');
        const set = (f, v) => setEdits((x) => ({ ...x, [p.key]: { ...(x[p.key] || {}), [f]: v } }));
        return (
          <View key={p.key} style={[styles.card, !p.is_active && styles.hidden]} testID={`admin-package-${p.key}`}>
            <View style={styles.row}>
              <TextInput style={[styles.input, styles.nameInput]} value={val('name')} onChangeText={(v) => set('name', v)}
                         testID={`admin-package-${p.key}-name`} />
              <Switch value={p.is_active} onValueChange={() => toggle(p)} disabled={busy}
                      testID={`admin-package-${p.key}-active`} />
            </View>
            <TextInput style={[styles.input, styles.wide]} value={val('description')} placeholder={t('adminPromo.planDescription')}
                       placeholderTextColor={PULSE.faint} onChangeText={(v) => set('description', v)} />
            {FIELDS.map(([f, label]) => (
              <View key={f} style={styles.field}>
                <Text style={styles.sub}>{t(label)}</Text>
                <TextInput style={styles.input} keyboardType="number-pad" value={val(f)}
                           onChangeText={(v) => set(f, v)} testID={`admin-package-${p.key}-${f}`} />
              </View>
            ))}
            <View style={styles.actions}>
              {edits[p.key] ? (
                <TouchableOpacity style={[styles.btn, styles.approve]} disabled={busy} onPress={() => save(p.key)}
                                  testID={`admin-package-${p.key}-save`}>
                  <Text style={styles.btnText}>{t('common.save')}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={[styles.btn, styles.quiet]} disabled={busy} onPress={() => remove(p)}
                                testID={`admin-package-${p.key}-delete`}>
                <Text style={styles.quietText}>{t('adminPromo.deletePlan')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
      {draft ? (
        <View style={styles.card} testID="admin-package-new">
          <TextInput style={[styles.input, styles.wide]} value={draft.name} placeholder={t('adminPromo.planName')}
                     placeholderTextColor={PULSE.faint} onChangeText={(v) => setDraft((d) => ({ ...d, name: v }))}
                     testID="admin-package-new-name" />
          <TextInput style={[styles.input, styles.wide]} value={draft.description} placeholder={t('adminPromo.planDescription')}
                     placeholderTextColor={PULSE.faint} onChangeText={(v) => setDraft((d) => ({ ...d, description: v }))} />
          {FIELDS.map(([f, label]) => (
            <View key={f} style={styles.field}>
              <Text style={styles.sub}>{t(label)}</Text>
              <TextInput style={styles.input} keyboardType="number-pad" value={draft[f]}
                         onChangeText={(v) => setDraft((d) => ({ ...d, [f]: v }))} testID={`admin-package-new-${f}`} />
            </View>
          ))}
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.btn, styles.approve]} disabled={busy} onPress={add} testID="admin-package-new-save">
              <Text style={styles.btnText}>{t('adminPromo.addPlan')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.quiet]} onPress={() => setDraft(null)}>
              <Text style={styles.quietText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={[styles.btn, styles.approve, styles.addBtn]} onPress={() => setDraft(BLANK)}
                          testID="admin-package-add">
          <Text style={styles.btnText}>{`+ ${t('adminPromo.newPlan')}`}</Text>
        </TouchableOpacity>
      )}
    </>
  );
};

const TEST_POLL_MS = 3000;

const Till = ({ t }) => {
  const [info, setInfo] = useState(null);
  const [failed, setFailed] = useState('');
  const [till, setTill] = useState('');
  const [phone, setPhone] = useState('');
  const [test, setTest] = useState(null);          // the latest test of `till`
  const [busy, setBusy] = useState(false);
  const polling = useRef(null);

  const load = useCallback(async () => {
    try {
      const i = await fetchPromotionTill();
      setInfo(i);
      setFailed('');
    } catch (e) {
      setFailed(errorOf(e, t('adminPromo.tillLoadFailed')));
    }
  }, [t]);
  useEffect(() => { load(); return () => clearInterval(polling.current); }, [load]);

  const watch = (number) => {
    clearInterval(polling.current);
    const started = Date.now();
    polling.current = setInterval(async () => {
      if (Date.now() - started > 120000) { clearInterval(polling.current); return; }
      try {
        const r = await fetchPromotionTillTest(number);
        setTest(r);
        if (r.status !== 'pending') clearInterval(polling.current);
      } catch { /* next tick */ }
    }, TEST_POLL_MS);
  };

  const sendTest = async () => {
    setBusy(true);
    try {
      const r = await testPromotionTill(till.trim(), phone.trim());
      setTest(r);
      watch(till.trim());
    } catch (e) {
      notify(t('common.error'), errorOf(e, t('adminPromo.saveFailed')));
    } finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true);
    try {
      setInfo(await savePromotionTill(till.trim()));
      setTill('');
      setTest(null);
      notify(t('adminPromo.tillSavedTitle'), t('adminPromo.tillSavedBody'));
    } catch (e) {
      notify(t('common.error'), errorOf(e, t('adminPromo.saveFailed')));
    } finally { setBusy(false); }
  };

  if (failed) return <ErrorState message={failed} onRetry={load} />;
  if (!info) return <ActivityIndicator color={PULSE.teal} style={{ marginTop: 30 }} />;
  const passed = test?.status === 'paid' && test?.till === till.trim();
  return (
    <>
      <View style={styles.card} testID="admin-till-current">
        <Text style={styles.kind}>{t('adminPromo.tillNow')}</Text>
        <Text style={styles.tillNumber}>{info.till || t('adminPromo.tillNone')}</Text>
        {info.set_by ? <Text style={styles.sub}>{t('adminPromo.tillSetBy', { who: info.set_by })}</Text>
          : info.source === 'settings' ? <Text style={styles.sub}>{t('adminPromo.tillFromSettings')}</Text> : null}
      </View>
      <View style={styles.card}>
        <Text style={styles.name}>{t('adminPromo.tillChange')}</Text>
        <Text style={styles.sub}>{t('adminPromo.tillHow')}</Text>
        <TextInput style={[styles.input, styles.wide]} value={till} onChangeText={(v) => { setTill(v.replace(/[^\d]/g, '')); setTest(null); }}
                   keyboardType="number-pad" maxLength={8} placeholder={t('adminPromo.tillNumber')}
                   placeholderTextColor={PULSE.faint} testID="admin-till-number" />
        <TextInput style={[styles.input, styles.wide]} value={phone} onChangeText={setPhone} keyboardType="phone-pad"
                   placeholder={t('adminPromo.tillPhone')} placeholderTextColor={PULSE.faint} testID="admin-till-phone" />
        {test ? (
          <Text style={[styles.sub, passed ? styles.ok : test.status === 'pending' ? null : styles.bad]} testID="admin-till-test">
            {test.status === 'pending' ? t('adminPromo.tillTestWaiting')
              : passed ? t('adminPromo.tillTestPassed')
                : t('adminPromo.tillTestFailed', { why: test.result_desc || test.status })}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.btn, styles.quiet]} disabled={busy || till.length < 5 || !phone.trim()}
                            onPress={sendTest} testID="admin-till-send-test">
            <Text style={styles.quietText}>{t('adminPromo.tillSendTest')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.approve, !passed && styles.off]} disabled={busy || !passed}
                            onPress={save} testID="admin-till-save">
            <Text style={styles.btnText}>{t('adminPromo.tillSave')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </>
  );
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
    if (['plans', 'till'].includes(which)) return;
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
    if (['reject', 'refunded', 'stop'].includes(action)) {
      note = await askReason({
        title: t(`adminPromo.${action}Title`),
        message: t(`adminPromo.${action}Body`),
      });
      if (!note) return;
    }
    setBusy(true);
    try {
      await adminPromotionAction(p.id, action, note);
      await load();
    } catch (e) {
      notify(t('common.error'), errorOf(e, t('adminPromo.saveFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
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
      {tab === 'plans' ? <Plans t={t} /> : tab === 'till' ? <Till t={t} />
        : failed ? <ErrorState onRetry={() => load()} /> : rows === null ? (
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
  hidden: { opacity: 0.55 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  kind: { color: PULSE.muted, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  price: { color: PULSE.yellow, fontWeight: '900' },
  name: { color: PULSE.text, fontSize: 16, fontWeight: '700' },
  sub: { color: PULSE.sub, fontSize: 13 },
  ok: { color: PULSE.teal, fontWeight: '700' },
  bad: { color: PULSE.coral, fontWeight: '700' },
  note: { color: PULSE.muted, fontSize: 13, fontStyle: 'italic' },
  owed: { flex: 1, color: PULSE.yellow, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6, alignItems: 'center' },
  btn: { flex: 1, minHeight: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  approve: { backgroundColor: PULSE.teal },
  decline: { backgroundColor: PULSE.coral },
  quiet: { borderWidth: 1, borderColor: PULSE.lineStrong },
  off: { opacity: 0.4 },
  addBtn: { flex: 0, marginTop: 4 },
  btnText: { color: '#06131A', fontWeight: '800' },
  quietText: { color: PULSE.text, fontWeight: '700' },
  field: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  input: {
    minWidth: 120, minHeight: 40, borderRadius: 10, paddingHorizontal: 10, color: PULSE.text,
    backgroundColor: PULSE.bg, borderWidth: 1, borderColor: PULSE.lineStrong,
  },
  nameInput: { flex: 1, fontWeight: '700' },
  wide: { alignSelf: 'stretch' },
  tillNumber: { color: PULSE.text, fontSize: 28, fontWeight: '800', letterSpacing: 2 },
  empty: { alignItems: 'center', gap: 8, marginTop: 30 },
});

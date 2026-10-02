// Single & Searching review: every profile is checked before anyone sees it,
// and every new photo of an approved one. Approve (photos can be refused one
// by one), ask for a change (with the reason they will read), or ban from
// Single & Searching only. Each decision is in the audit log.
import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';
import { useI18n } from '../../context/I18nContext';
import {
  fetchSinglesQueue, fetchAdminByUrl, reviewSinglesProfile, banFromSingles, unbanFromSingles,
} from '../../services/api';
import { confirmAction, notify } from '../../utils/adminConfirm';
import { ADMIN, ErrorState, useReasonSheet } from './AdminKit';

const STATES = ['waiting', 'approved', 'rejected', 'banned'];

export default function AdminSingles() {
  const { t } = useI18n();
  const [state, setState] = useState('waiting');
  const [rows, setRows] = useState([]);
  const [next, setNext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [refused, setRefused] = useState({});          // photo id -> true
  const [reasonSheet, askReason] = useReasonSheet();
  const latest = useRef(0);

  const load = useCallback(async (st) => {
    const mine = ++latest.current;
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetchSinglesQueue(st);
      if (mine !== latest.current) return;
      setRows(res?.results || []);
      setNext(res?.next || null);
    } catch {
      if (mine === latest.current) setFailed(true);
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(state); }, [load]));  // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (st) => { setState(st); load(st); };
  const more = async () => {
    if (!next) return;
    try {
      const res = await fetchAdminByUrl(next);
      setRows((prev) => [...prev, ...(res?.results || []).filter((r) => !prev.some((p) => p.id === r.id))]);
      setNext(res?.next || null);
    } catch { /* pull to refresh */ }
  };

  const act = async (row, fn) => {
    setBusyId(row.id);
    try {
      const updated = await fn();
      setRows((prev) => (state === 'waiting' || updated?.status !== state
        ? prev.filter((r) => r.id !== row.id) : prev.map((r) => (r.id === row.id ? updated : r))));
    } catch (e) {
      notify(t('common.error'), e?.data?.error || t('admin.actionFailedShort'));
    } finally {
      setBusyId(null);
    }
  };

  const approve = async (row) => {
    const photos = Object.fromEntries(row.photos.filter((p) => p.status === 'pending')
      .map((p) => [String(p.id), refused[p.id] ? 'reject' : 'approve']));
    if (!(await confirmAction({ title: t('adminSingles.approveTitle', { name: row.first_name }),
      message: t('adminSingles.approveBody'), confirmLabel: t('adminSingles.approve'), cancelLabel: t('common.cancel') }))) return;
    act(row, () => reviewSinglesProfile(row.id, 'approve', '', photos));
  };
  const reject = async (row) => {
    const reason = await askReason({ title: t('adminSingles.rejectTitle', { name: row.first_name }),
      message: t('adminSingles.rejectBody'), confirmLabel: t('adminSingles.reject') });
    if (reason) act(row, () => reviewSinglesProfile(row.id, 'reject', reason));
  };
  const ban = async (row) => {
    const reason = await askReason({ title: t('adminSingles.banTitle', { name: row.first_name }),
      message: t('adminSingles.banBody'), confirmLabel: t('adminSingles.ban'), destructive: true });
    if (reason) act(row, () => banFromSingles(row.id, reason));
  };
  const unban = async (row) => {
    const reason = await askReason({ title: t('adminSingles.unbanTitle'), message: t('adminSingles.unbanBody'),
      confirmLabel: t('adminSingles.unban') });
    if (reason) act(row, () => unbanFromSingles(row.id, reason));
  };

  const renderItem = ({ item }) => (
    <View style={styles.card} testID={`singles-review-${item.id}`}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {item.photos.map((p) => (
          <TouchableOpacity key={p.id} disabled={p.status !== 'pending'} accessibilityRole="button"
            accessibilityLabel={t('adminSingles.togglePhoto')} accessibilityState={{ selected: !refused[p.id] }}
            onPress={() => setRefused((r) => ({ ...r, [p.id]: !r[p.id] }))}>
            <Image source={{ uri: p.url }} style={[styles.photo, refused[p.id] && styles.photoRefused]} contentFit="cover" />
            <Text style={[styles.photoTag, p.status === 'pending' && styles.photoTagNew]}>
              {refused[p.id] ? t('adminSingles.photoRefuse') : t(`adminSingles.photo.${p.status}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <Text style={styles.name}>{item.first_name}, {item.age} · {t(`singles.gender.${item.gender}`)}</Text>
      <Text style={styles.sub}>
        {[`@${item.user.username}`, [item.town, item.country].filter(Boolean).join(', '), item.church].filter(Boolean).join('  ·  ')}
      </Text>
      {!!item.review_note && <Text style={styles.note}>{item.review_note}</Text>}
      {!!item.about && <Text style={styles.body}>{item.about}</Text>}
      {(item.prompts || []).map((p) => (
        <Text key={p.key} style={styles.body}><Text style={styles.q}>{t(`singles.prompt.${p.key}`)}  </Text>{p.answer}</Text>
      ))}
      <Text style={styles.sub}>{t('adminSingles.joined', { date: (item.user.joined || '').slice(0, 10), strikes: item.user.strikes })}</Text>
      <View style={styles.actions}>
        {busyId === item.id ? <ActivityIndicator color={ADMIN.gold} /> : item.status === 'banned' ? (
          <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={() => unban(item)}>
            <Text style={styles.btnTextOutline}>{t('adminSingles.unban')}</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity style={[styles.btn, styles.btnGold]} onPress={() => approve(item)} testID={`singles-approve-${item.id}`}>
              <Text style={styles.btnText}>{t('adminSingles.approve')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={() => reject(item)}>
              <Text style={styles.btnTextOutline}>{t('adminSingles.reject')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnDanger]} onPress={() => ban(item)}>
              <Text style={styles.btnTextDanger}>{t('adminSingles.ban')}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('adminSingles.title')}</Text>
      <View style={styles.chips}>
        {STATES.map((st) => (
          <TouchableOpacity key={st} style={[styles.chip, state === st && styles.chipOn]} onPress={() => pick(st)}
            testID={`singles-state-${st}`}>
            <Text style={[styles.chipText, state === st && styles.chipTextOn]}>{t(`adminSingles.state.${st}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {loading && !rows.length ? <ActivityIndicator color={ADMIN.gold} style={{ marginTop: 40 }} />
        : failed ? <ErrorState onRetry={() => load(state)} /> : (
          <FlatList data={rows} keyExtractor={(item) => String(item.id)} renderItem={renderItem}
            contentContainerStyle={styles.list} onEndReached={more} onEndReachedThreshold={0.5}
            onRefresh={() => load(state)} refreshing={loading}
            ListEmptyComponent={<Text style={styles.empty}>{t('adminSingles.none')}</Text>} />
        )}
      {reasonSheet}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { color: ADMIN.text, fontSize: 26, fontWeight: '800', paddingHorizontal: 16, paddingTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, marginTop: 10 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: ADMIN.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: ADMIN.border,
  },
  chipOn: { backgroundColor: ADMIN.gold, borderColor: ADMIN.gold },
  chipText: { color: ADMIN.muted, fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: ADMIN.onGold },
  list: { padding: 16, paddingBottom: 48, gap: 12 },
  card: { padding: 14, borderRadius: 16, gap: 8, backgroundColor: ADMIN.card, borderWidth: StyleSheet.hairlineWidth, borderColor: ADMIN.border },
  photo: { width: 120, height: 120, borderRadius: 12 },
  photoRefused: { opacity: 0.35 },
  photoTag: { color: ADMIN.muted, fontSize: 11, fontWeight: '700', marginTop: 4, textAlign: 'center' },
  photoTagNew: { color: ADMIN.gold },
  name: { color: ADMIN.text, fontSize: 17, fontWeight: '800' },
  sub: { color: ADMIN.muted, fontSize: 12.5 },
  note: { color: ADMIN.danger, fontSize: 13, fontWeight: '700' },
  body: { color: ADMIN.text, fontSize: 14, lineHeight: 20 },
  q: { color: ADMIN.gold, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  btn: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  btnGold: { backgroundColor: ADMIN.gold },
  btnOutline: { borderWidth: 1, borderColor: ADMIN.border },
  btnDanger: { borderWidth: 1, borderColor: 'rgba(255,122,107,0.5)' },
  btnText: { color: ADMIN.onGold, fontWeight: '800' },
  btnTextOutline: { color: ADMIN.text, fontWeight: '800' },
  btnTextDanger: { color: ADMIN.danger, fontWeight: '800' },
  empty: { color: ADMIN.muted, textAlign: 'center', marginTop: 40 },
});

// The verified tick, given and taken from the app (it was only in Django's
// admin): artists, sellers, services and organizations. Giving it is one tap
// and a confirmation; taking it asks why, and the owner is told.
import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useI18n } from '../../context/I18nContext';
import { fetchVerifyList, fetchAdminByUrl, setVerified } from '../../services/api';
import { confirmAction, notify } from '../../utils/adminConfirm';
import { ADMIN, ErrorState, useReasonSheet } from './AdminKit';

const KINDS = ['artist', 'seller', 'service', 'organization'];
const STATES = ['', 'unverified', 'verified'];

export default function AdminVerify() {
  const { t } = useI18n();
  const [kind, setKind] = useState('artist');
  const [state, setState] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [next, setNext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [reasonSheet, askReason] = useReasonSheet();
  const latest = useRef(0);
  const debounce = useRef(null);

  const load = useCallback(async (k, st, q) => {
    const mine = ++latest.current;
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetchVerifyList(k, { state: st, q });
      if (mine !== latest.current) return;
      setRows(res?.results || []);
      setNext(res?.next || null);
    } catch {
      if (mine === latest.current) setFailed(true);
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(kind, state, query.trim()); }, [load]));  // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (k, st) => { setKind(k); setState(st); load(k, st, query.trim()); };
  const onQuery = (text) => {
    setQuery(text);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => load(kind, state, text.trim()), 400);
  };
  const more = async () => {
    if (!next) return;
    try {
      const res = await fetchAdminByUrl(next);
      setRows((prev) => [...prev, ...(res?.results || []).filter((r) => !prev.some((p) => p.id === r.id))]);
      setNext(res?.next || null);
    } catch { /* pull to refresh */ }
  };

  const toggle = async (row) => {
    let reason = '';
    if (row.verified) {
      reason = await askReason({
        title: t('adminVerify.takeTitle', { name: row.name }),
        message: t('adminVerify.takeBody'),
        confirmLabel: t('adminVerify.take'),
        destructive: true,
      });
      if (!reason) return;
    } else if (!(await confirmAction({
      title: t('adminVerify.giveTitle', { name: row.name }),
      message: t('adminVerify.giveBody'),
      confirmLabel: t('adminVerify.give'),
    }))) return;
    setBusyId(row.id);
    try {
      await setVerified(row.kind, row.id, !row.verified, reason);
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, verified: !row.verified } : r)));
    } catch (e) {
      notify(t('common.error'), e?.data?.error || t('admin.actionFailedShort'));
    } finally {
      setBusyId(null);
    }
  };

  const renderItem = ({ item }) => (
    <View style={styles.row} testID={`verify-${item.id}`}>
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          {item.verified && <MaterialCommunityIcons name="check-decagram" size={16} color="#4FA3FF" />}
        </View>
        <Text style={styles.sub} numberOfLines={1}>
          {[item.owner && `@${item.owner}`, item.detail].filter(Boolean).join('  ·  ')}
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.btn, item.verified ? styles.btnTake : styles.btnGive]}
        onPress={() => toggle(item)}
        disabled={busyId === item.id}
        testID={`verify-toggle-${item.id}`}
      >
        {busyId === item.id ? <ActivityIndicator size="small" color={ADMIN.onGold} /> : (
          <Text style={[styles.btnText, item.verified && styles.btnTextTake]}>
            {item.verified ? t('adminVerify.take') : t('adminVerify.give')}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('adminVerify.title')}</Text>
      <View style={styles.chips}>
        {KINDS.map((k) => (
          <TouchableOpacity key={k} style={[styles.chip, kind === k && styles.chipOn]} onPress={() => pick(k, state)}
                            testID={`verify-kind-${k}`}>
            <Text style={[styles.chipText, kind === k && styles.chipTextOn]}>{t(`adminVerify.kind.${k}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.chips}>
        {STATES.map((st) => (
          <TouchableOpacity key={st || 'all'} style={[styles.chipSmall, state === st && styles.chipOn]}
                            onPress={() => pick(kind, st)} testID={`verify-state-${st || 'all'}`}>
            <Text style={[styles.chipText, state === st && styles.chipTextOn]}>{t(`adminVerify.state.${st || 'all'}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.search}>
        <Ionicons name="search" size={16} color={ADMIN.muted} />
        <TextInput style={styles.searchInput} value={query} onChangeText={onQuery} placeholder={t('adminVerify.search')}
                   placeholderTextColor="#5E7290" autoCapitalize="none" testID="verify-search" />
      </View>
      {loading && !rows.length ? (
        <ActivityIndicator color={ADMIN.gold} style={{ marginTop: 40 }} />
      ) : failed ? (
        <ErrorState onRetry={() => load(kind, state, query.trim())} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => `${item.kind}-${item.id}`}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          onEndReached={more}
          onEndReachedThreshold={0.5}
          onRefresh={() => load(kind, state, query.trim())}
          refreshing={loading}
          ListEmptyComponent={<Text style={styles.empty}>{t('adminVerify.none')}</Text>}
        />
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
  chipSmall: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: ADMIN.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: ADMIN.border,
  },
  chipOn: { backgroundColor: ADMIN.gold, borderColor: ADMIN.gold },
  chipText: { color: ADMIN.muted, fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: ADMIN.onGold },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 10, height: 42,
    borderRadius: 21, paddingHorizontal: 14, backgroundColor: ADMIN.card, borderWidth: StyleSheet.hairlineWidth,
    borderColor: ADMIN.border,
  },
  searchInput: { flex: 1, color: ADMIN.text, fontSize: 14.5 },
  list: { padding: 16, paddingBottom: 48 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, marginBottom: 8,
    backgroundColor: ADMIN.card, borderWidth: StyleSheet.hairlineWidth, borderColor: ADMIN.border,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: ADMIN.text, fontSize: 15, fontWeight: '800', flexShrink: 1 },
  sub: { color: ADMIN.muted, fontSize: 12.5, marginTop: 2 },
  btn: { minWidth: 92, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  btnGive: { backgroundColor: ADMIN.gold },
  btnTake: { borderWidth: 1, borderColor: 'rgba(255,122,107,0.5)' },
  btnText: { color: ADMIN.onGold, fontWeight: '800', fontSize: 13 },
  btnTextTake: { color: ADMIN.danger },
  empty: { color: ADMIN.muted, textAlign: 'center', marginTop: 40 },
});

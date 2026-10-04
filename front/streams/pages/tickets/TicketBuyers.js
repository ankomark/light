/**
 * Who paid for an event, newest first: name, masked phone, level, amount,
 * M-Pesa receipt, time. Search finds a name, a receipt or an order code — the
 * two things a buyer at the gate can show. Export sends every payment as a
 * CSV to the phone's share sheet.
 *
 * Phones are masked by the server (0712***678): a list of buyers' full
 * numbers is not the organiser's to keep, and this screen never has them.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../../context/I18nContext';
import { fetchPayments, exportPaymentsCsv } from '../../services/ticketsOrganiser';
import { formatKes, formatWhen } from '../../services/tickets';
import { T, F, tap, Kicker, Notice } from '../../components/tickets/TicketKit';
import { nextPage } from './TicketsHome';
import { ticketErrorText } from './ticketText';

const SEARCH_WAIT_MS = 350;

const TicketBuyers = ({ navigation, route }) => {
  const { t } = useI18n();
  const months = t('tix.months').split(',');
  const weekdays = t('tix.weekdays').split(',');
  const { id, title } = route.params;

  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), SEARCH_WAIT_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  const [rows, setRows] = useState(null);
  const [count, setCount] = useState(0);
  const [next, setNext] = useState(null);
  const [error, setError] = useState(null);
  const [more, setMore] = useState(false);
  const run = useRef(0);

  const load = useCallback(async () => {
    const mine = ++run.current;
    setError(null);
    try {
      const page = await fetchPayments(id, { search });
      if (mine !== run.current) return;
      setRows(page.results || []);
      setCount(page.count || 0);
      setNext(page.next);
    } catch (err) {
      if (mine !== run.current) return;
      if (err?.code === 'signed_out') { navigation.replace('TicketHost', { next: 'TicketMyEvents' }); return; }
      setError(err);
    }
  }, [id, search, navigation]);
  useEffect(() => { load(); }, [load]);

  const loadMore = async () => {
    const page = nextPage(next);
    if (!page || more) return;
    const mine = run.current;
    setMore(true);
    try {
      const res = await fetchPayments(id, { search, page });
      if (mine === run.current) {
        setRows((r) => [...r, ...(res.results || []).filter((x) => !r.some((y) => y.code === x.code))]);
        setNext(res.next);
      }
    } catch { /* the list stays as it is */ } finally {
      setMore(false);
    }
  };

  const [pulling, setPulling] = useState(false);
  const pull = async () => {
    setPulling(true);
    try { await load(); } finally { setPulling(false); }
  };

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const exportCsv = async () => {
    tap();
    setExporting(true);
    setExportError('');
    try {
      const csv = await exportPaymentsCsv(id);
      const uri = `${FileSystem.cacheDirectory}buyers-${id}-${new Date().toISOString().slice(0, 10)}.csv`;
      await FileSystem.writeAsStringAsync(uri, typeof csv === 'string' ? csv : String(csv || ''));
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'text/csv' });
    } catch (err) {
      setExportError(ticketErrorText(err, t, 'tix.buyers.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const header = (
    <View>
      <Kicker style={styles.kickerTop}>{title}</Kicker>
      <View style={styles.top}>
        <Text style={styles.heading} accessibilityRole="header">{t('tix.mine.buyers')}</Text>
        <TouchableOpacity onPress={exportCsv} disabled={exporting || !count} style={[styles.export, (!count) && styles.off]}
                          accessibilityRole="button" testID="buyers-export">
          {exporting ? <ActivityIndicator size="small" color={T.champagne} />
            : <Ionicons name="download-outline" size={16} color={T.champagne} />}
          <Text style={styles.exportText}>{t('tix.buyers.export')}</Text>
        </TouchableOpacity>
      </View>
      {!!exportError && <Text style={styles.error}>{exportError}</Text>}
      <View style={styles.search}>
        <Ionicons name="search" size={17} color={T.faint} />
        <TextInput value={typed} onChangeText={setTyped} placeholder={t('tix.buyers.search')} placeholderTextColor={T.faint}
                   style={styles.searchInput} autoCorrect={false} autoCapitalize="none"
                   accessibilityLabel={t('tix.buyers.search')} testID="buyers-search" />
      </View>
      {rows !== null && <Text style={styles.count}>{t('tix.buyers.count', { n: count })}</Text>}
    </View>
  );

  const renderRow = ({ item: p }) => (
    <View style={styles.row}>
      <View style={styles.flex}>
        <Text style={styles.name} numberOfLines={1}>{p.buyer_name || t('tix.buyers.noName')}</Text>
        <Text style={styles.meta}>{p.phone}  ·  {p.quantity} × {p.ticket_type}</Text>
        <Text style={styles.meta}>{formatWhen(p.paid_at, { months, weekdays })}  ·  {p.mpesa_receipt || p.code}</Text>
      </View>
      <Text style={styles.amount}>{formatKes(p.amount)}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <FlatList
        data={rows || []}
        keyExtractor={(p) => p.code}
        renderItem={renderRow}
        ListHeaderComponent={header}
        ListEmptyComponent={rows === null
          ? (error ? <Notice title={ticketErrorText(error, t)} action={t('common.retry')} onAction={load} />
            : <ActivityIndicator style={styles.loading} color={T.gold} />)
          : <Notice title={search ? t('tix.noResults', { q: search }) : t('tix.buyers.none')} />}
        ListFooterComponent={more ? <ActivityIndicator style={styles.loading} color={T.gold} /> : null}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={pull} tintColor={T.gold} colors={[T.gold]} />}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  flex: { flex: 1 },
  list: { paddingHorizontal: 16, paddingBottom: 36, width: '100%', maxWidth: 720, alignSelf: 'center' },
  kickerTop: { marginTop: 20 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 6 },
  heading: { fontFamily: F.display, fontSize: 32, lineHeight: 36, color: T.ivory },
  export: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.lineStrong,
  },
  exportText: { fontFamily: F.uiBold, fontSize: 12.5, color: T.champagne },
  off: { opacity: 0.4 },
  error: { fontFamily: F.uiSemi, fontSize: 13, color: T.danger, marginTop: 8 },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, height: 48, borderRadius: 24, paddingHorizontal: 16,
    backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.line,
  },
  searchInput: { flex: 1, fontFamily: F.ui, fontSize: 15, color: T.ivory, paddingVertical: 0 },
  count: { fontFamily: F.uiBold, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: T.faint, marginTop: 16, marginBottom: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.line,
  },
  name: { fontFamily: F.uiBold, fontSize: 15, color: T.ivory },
  meta: { fontFamily: F.ui, fontSize: 12.5, color: T.muted, marginTop: 3 },
  amount: { fontFamily: F.uiHeavy, fontSize: 14.5, color: T.champagne },
  loading: { marginTop: 30 },
});

export default TicketBuyers;

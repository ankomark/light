// Events & Tickets, as Skylink's staff: the events waiting for review and the
// organisers' M-Pesa tills waiting to be linked. Streams admins with
// manage_tickets work here; the server passes everything to the ticketing
// server as them (songs/views/admin_tickets.py), and both servers log it.
//
// An event sells only once it is approved AND its till is active, so the two
// queues sit side by side.
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';
import { useI18n } from '../../context/I18nContext';
import {
  fetchAdminTicketStats, fetchAdminTicketEvents, fetchAdminTills, fetchAdminByUrl, fetchAdminTicketOrganisers,
} from '../../services/api';
import { formatKes, formatWhen } from '../../services/tickets';
import { ADMIN, ErrorState } from './AdminKit';

// One tab per state, so every event is somewhere: one never sent for review
// used to fit none of the tabs and looked missing (the ticketing server's
// staff/views.py EVENT_VIEWS).
const EVENT_FILTERS = ['review', 'live', 'approved', 'drafts', 'paused', 'rejected', 'removed', 'all'];
const FIRST_FILTER = { events: 'review', tills: 'pending', organisers: '' };
const TILL_FILTERS = ['pending', 'submitted', 'active', 'rejected'];

export const TILL_COLOR = { pending: ADMIN.gold, submitted: '#7CB8FF', active: ADMIN.ok, rejected: ADMIN.danger };
export const REVIEW_COLOR = { pending: ADMIN.gold, approved: ADMIN.ok, rejected: ADMIN.danger, unsubmitted: ADMIN.muted };

/** What an event is doing, for its badge: removed and paused before anything else. */
export const adminState = (e) => (e.removed_at ? 'removed'
  : e.paused_by_staff ? 'paused'
  : e.status === 'published' ? 'live'
  : e.review_status);
export const STATE_COLOR = { ...REVIEW_COLOR, live: ADMIN.ok, paused: ADMIN.gold, removed: ADMIN.danger };
export const stateLabel = (t, e) => {
  const s = adminState(e);
  return ['live', 'paused', 'removed'].includes(s) ? t(`adminTix.state.${s}`) : t(`adminTix.review.${s}`);
};

export const Badge = ({ color, label }) => (
  <View style={[styles.badge, { borderColor: color }]}>
    <Text style={[styles.badgeText, { color }]} numberOfLines={1}>{label}</Text>
  </View>
);

export default function AdminTickets({ navigation, route }) {
  const { t } = useI18n();
  const months = t('tix.months').split(',');
  const weekdays = t('tix.weekdays').split(',');
  const [tab, setTab] = useState(route?.params?.tab || 'events');
  const [filter, setFilter] = useState(FIRST_FILTER[route?.params?.tab || 'events']);
  const [rows, setRows] = useState([]);
  const [next, setNext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const latest = useRef(0);

  const load = useCallback(async (which, f) => {
    const mine = ++latest.current;
    setLoading(true);
    setError(null);
    fetchAdminTicketStats().then((s) => { if (mine === latest.current) setStats(s); }).catch(() => {});
    try {
      const res = which === 'events'
        ? await fetchAdminTicketEvents(f === 'all' ? {} : { view: f })
        : which === 'organisers'
          ? await fetchAdminTicketOrganisers(f.trim() ? { search: f.trim() } : {})
          : await fetchAdminTills({ status: f });
      if (mine !== latest.current) return;
      setRows(res?.results || []);
      setNext(res?.next || null);
    } catch (e) {
      if (mine === latest.current) setError(e);
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, []);
  // Back from a decision: the queue is read again, so it no longer shows.
  // A search waits for typing to pause.
  const typing = useRef(null);
  useFocusEffect(useCallback(() => {
    if (tab !== 'organisers') { load(tab, filter); return undefined; }
    typing.current = setTimeout(() => load(tab, filter), 350);
    return () => clearTimeout(typing.current);
  }, [load, tab, filter]));

  const pickTab = (which) => {
    if (which === tab) return;
    setTab(which);
    setFilter(FIRST_FILTER[which]);
    setRows([]);
  };

  const more = async () => {
    if (!next) return;
    try {
      const res = await fetchAdminByUrl(next);
      setRows((prev) => [...prev, ...(res?.results || []).filter((r) => !prev.some((p) => p.id === r.id))]);
      setNext(res?.next || null);
    } catch { /* the list stays as it is */ }
  };

  const tillsWaiting = stats ? (stats.tills?.pending || 0) + (stats.tills?.submitted || 0) : null;

  const header = (
    <View>
      <Text style={styles.title}>{t('adminTix.title')}</Text>
      <Text style={styles.sub}>{t('adminTix.sub')}</Text>

      {!!stats && (
        <View style={styles.stats}>
          <Stat value={stats.events_to_review} label={t('adminTix.statReview')} warn={stats.events_to_review > 0} />
          <Stat value={tillsWaiting} label={t('adminTix.statTills')} warn={tillsWaiting > 0} />
          <Stat value={stats.events_on_sale} label={t('adminTix.statOnSale')} />
          <Stat value={formatKes(stats.collected)} label={t('adminTix.statCollected')} small />
        </View>
      )}

      <View style={styles.tabs}>
        {['events', 'tills', 'organisers'].map((which) => (
          <TouchableOpacity key={which} style={[styles.tab, tab === which && styles.tabOn]} onPress={() => pickTab(which)}
                            testID={`admin-tix-tab-${which}`}>
            <Text style={[styles.tabText, tab === which && styles.tabTextOn]}>{t(`adminTix.tab.${which}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {tab === 'organisers' ? (
        <>
          <TextInput value={filter} onChangeText={setFilter} style={styles.search} autoCapitalize="none"
                     autoCorrect={false} placeholder={t('adminTix.org.search')} placeholderTextColor={ADMIN.muted}
                     accessibilityLabel={t('adminTix.org.search')} testID="admin-tix-org-search" />
          <Text style={styles.sub}>{t('adminTix.org.searchHint')}</Text>
        </>
      ) : (
        <View style={styles.chips}>
          {(tab === 'events' ? EVENT_FILTERS : TILL_FILTERS).map((f) => (
            <TouchableOpacity key={f} style={[styles.chip, filter === f && styles.chipOn]} onPress={() => setFilter(f)}
                              testID={`admin-tix-filter-${f}`}>
              <Text style={[styles.chipText, filter === f && styles.chipTextOn]}>{t(`adminTix.filter.${f}`)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );

  const renderEvent = ({ item: e }) => (
    <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('AdminTicketEvent', { id: e.id })}
                      testID={`admin-tix-event-${e.id}`}>
      {e.poster
        ? <Image source={{ uri: e.poster }} style={styles.thumb} contentFit="cover" />
        : <View style={[styles.thumb, styles.thumbBlank]}><Text style={styles.thumbLetter}>{(e.title || '?')[0]}</Text></View>}
      <View style={styles.rowBody}>
        {e.kind === 'fundraiser' && <Text style={styles.rowKind}>{t('tix.kind.fundraiser')}</Text>}
        <Text style={styles.rowTitle} numberOfLines={2}>{e.title}</Text>
        <Text style={styles.rowMeta} numberOfLines={1}>{e.organiser?.display_name || e.organiser?.email}</Text>
        <Text style={styles.rowMeta} numberOfLines={1}>{formatWhen(e.starts_at, { months, weekdays })} · {e.venue}</Text>
        <View style={styles.badges}>
          <Badge color={STATE_COLOR[adminState(e)] || ADMIN.muted} label={stateLabel(t, e)} />
          {!!e.warning_note && <Badge color={ADMIN.gold} label={t('adminTix.warned')} />}
          <Badge color={TILL_COLOR[e.till?.status] || ADMIN.muted} label={t('adminTix.tillShort', { status: t(`adminTix.till.${e.till?.status}`) })} />
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderOrganiser = ({ item: o }) => (
    <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('AdminTicketOrganiser', { id: o.id })}
                      testID={`admin-tix-org-${o.id}`}>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>{o.display_name || o.email}</Text>
        <Text style={styles.rowMeta} numberOfLines={1}>{o.email}{o.phone ? ` · ${o.phone}` : ''}</Text>
        <Text style={styles.rowMeta}>{t('adminTix.eventsCount', { n: o.events })}</Text>
      </View>
    </TouchableOpacity>
  );

  const renderTill = ({ item: x }) => (
    <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('AdminTicketTill', { id: x.id })}
                      testID={`admin-tix-till-${x.id}`}>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>{x.business_name}</Text>
        <Text style={styles.rowMeta}>{t('adminTix.tillNo', { n: x.till_number })} · {x.organiser?.email}</Text>
        <Text style={styles.rowMeta}>{t('adminTix.eventsCount', { n: x.events })}</Text>
        <View style={styles.badges}>
          <Badge color={TILL_COLOR[x.status] || ADMIN.muted} label={t(`adminTix.till.${x.status}`)} />
          {!!x.last_test && <Badge color={x.last_test.result === 'ok' ? ADMIN.ok : ADMIN.muted}
                                   label={t(`adminTix.test.${x.last_test.result}`)} />}
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={loading || error ? [] : rows}
      keyExtractor={(r) => `${tab}-${r.id}`}
      renderItem={tab === 'events' ? renderEvent : tab === 'organisers' ? renderOrganiser : renderTill}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header}
      ListEmptyComponent={
        loading ? <ActivityIndicator color={ADMIN.gold} style={styles.loading} />
          : error ? <ErrorState message={error.message} onRetry={() => load(tab, filter)} />
          : <Text style={styles.empty}>{t(`adminTix.empty.${tab}`)}</Text>
      }
      onEndReached={more}
      onEndReachedThreshold={0.5}
      showsVerticalScrollIndicator={false}
    />
  );
}

const Stat = ({ value, label, warn, small }) => (
  <View style={styles.stat}>
    <Text style={[styles.statValue, small && styles.statSmall, warn && { color: ADMIN.gold }]} numberOfLines={1}>
      {value ?? '–'}
    </Text>
    <Text style={styles.statLabel} numberOfLines={2}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 18, paddingBottom: 48, width: '100%', maxWidth: 760, alignSelf: 'center' },
  title: { color: ADMIN.text, fontSize: 24, fontWeight: '700' },
  sub: { color: ADMIN.muted, fontSize: 13, marginTop: 4, lineHeight: 19 },

  stats: { flexDirection: 'row', gap: 8, marginTop: 16 },
  stat: {
    flex: 1, padding: 12, borderRadius: 14, backgroundColor: ADMIN.card, borderWidth: 1, borderColor: ADMIN.border,
  },
  statValue: { color: ADMIN.text, fontSize: 22, fontWeight: '800' },
  statSmall: { fontSize: 14, marginTop: 6 },
  statLabel: { color: ADMIN.muted, fontSize: 11, marginTop: 2 },

  tabs: { flexDirection: 'row', marginTop: 18, padding: 4, borderRadius: 14, backgroundColor: ADMIN.field },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center' },
  tabOn: { backgroundColor: ADMIN.gold },
  tabText: { color: ADMIN.muted, fontWeight: '700', fontSize: 14 },
  tabTextOn: { color: ADMIN.onGold },
  search: {
    marginTop: 12, marginBottom: 4, height: 46, paddingHorizontal: 14, borderRadius: 12, color: ADMIN.text,
    backgroundColor: ADMIN.field, borderWidth: 1, borderColor: ADMIN.border, fontSize: 15,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 6 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: ADMIN.border },
  chipOn: { borderColor: ADMIN.gold, backgroundColor: 'rgba(255,196,107,0.12)' },
  chipText: { color: ADMIN.muted, fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: ADMIN.gold },

  row: {
    flexDirection: 'row', gap: 12, padding: 12, marginTop: 10, borderRadius: 16,
    backgroundColor: ADMIN.card, borderWidth: 1, borderColor: ADMIN.border,
  },
  thumb: { width: 64, height: 80, borderRadius: 10 },
  thumbBlank: { backgroundColor: ADMIN.field, alignItems: 'center', justifyContent: 'center' },
  thumbLetter: { color: ADMIN.gold, fontSize: 26, fontWeight: '700' },
  rowBody: { flex: 1 },
  rowKind: { color: ADMIN.gold, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 },
  rowTitle: { color: ADMIN.text, fontSize: 15.5, fontWeight: '700' },
  rowMeta: { color: ADMIN.muted, fontSize: 12.5, marginTop: 3 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  badge: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1 },
  badgeText: { fontSize: 11, fontWeight: '700' },

  loading: { marginTop: 40 },
  empty: { color: ADMIN.muted, textAlign: 'center', marginTop: 40, fontSize: 14 },
});

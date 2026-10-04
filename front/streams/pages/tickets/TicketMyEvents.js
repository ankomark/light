/**
 * My events: everything this organiser has opened, grouped by what it needs —
 * attention first (a rejection to fix), then what's on sale, what's waiting
 * (for review, or for the till), drafts, and what's over.
 *
 * Each card says where the event stands in a few words, with Skylink's note
 * when it was rejected. Totals across all events sit on top; the organiser's
 * payout tills, with Skylink's note on any refused, at the foot.
 *
 * Signed out (the session ended): to the sign-in, which comes back here.
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SectionList, RefreshControl, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../../context/I18nContext';
import { fetchMyEvents, fetchOverview, fetchTills } from '../../services/ticketsOrganiser';
import { formatKes, formatWhen } from '../../services/tickets';
import { T, F, tap, Kicker, Pill, Notice, GoldButton } from '../../components/tickets/TicketKit';
import { eventState, groupEvents, soldOf, staffNote } from './eventState';
import { ticketErrorText } from './ticketText';

const TILL_TONE = { active: 'paid', pending: 'pending', submitted: 'pending', rejected: 'failed' };

const TicketMyEvents = ({ navigation }) => {
  const { t } = useI18n();
  const months = t('tix.months').split(',');
  const weekdays = t('tix.weekdays').split(',');

  const [events, setEvents] = useState(null);
  const [overview, setOverview] = useState(null);
  const [tills, setTills] = useState([]);
  const [error, setError] = useState(null);
  const [pulling, setPulling] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, totals, myTills] = await Promise.all([
        fetchMyEvents(), fetchOverview().catch(() => null), fetchTills().catch(() => []),
      ]);
      setEvents(list);
      setOverview(totals);
      setTills(myTills);
    } catch (err) {
      if (err?.code === 'signed_out') { navigation.replace('TicketHost', { next: 'TicketMyEvents' }); return; }
      setError(err);
    }
  }, [navigation]);
  // Back from managing one: read again, so its new state shows.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pull = async () => {
    setPulling(true);
    try { await load(); } finally { setPulling(false); }
  };

  const open = (e) => { tap(); navigation.push('TicketManageEvent', { id: e.id }); };
  const create = () => { tap(); navigation.push('TicketCreateEvent'); };

  if (!events) {
    return (
      <View style={[styles.root, styles.centre]}>
        {error ? <Notice title={ticketErrorText(error, t)} action={t('common.retry')} onAction={load} />
          : <ActivityIndicator color={T.gold} size="large" />}
      </View>
    );
  }

  const sections = groupEvents(events);

  const header = (
    <View>
      <View style={styles.top}>
        <View style={styles.flex}>
          <Kicker>{t('tix.host.kicker')}</Kicker>
          <Text style={styles.heading} accessibilityRole="header">{t('tix.mine.title')}</Text>
        </View>
        <TouchableOpacity onPress={create} style={styles.newBtn} accessibilityRole="button" testID="mine-new">
          <Ionicons name="add" size={16} color={T.paperInk} />
          <Text style={styles.newText}>{t('tix.openEvent')}</Text>
        </TouchableOpacity>
      </View>
      {!!overview && (
        <View style={styles.totals}>
          <Total value={formatKes(overview.collected)} label={t('tix.mine.collected')} wide />
          <Total value={String(overview.tickets_sold)} label={t('tix.mine.ticketsSold')} />
          <Total value={String(overview.upcoming_live_events)} label={t('tix.mine.live')} />
        </View>
      )}
    </View>
  );

  const renderEvent = ({ item: e }) => {
    const state = eventState(e);
    const { sold, quantity } = soldOf(e);
    return (
      <TouchableOpacity style={styles.card} onPress={() => open(e)} activeOpacity={0.85}
                        accessibilityRole="button" accessibilityLabel={`${e.title}, ${t(`tix.mine.state.${state.key}`)}`}
                        testID={`mine-event-${e.id}`}>
        {e.poster ? (
          <Image source={{ uri: e.poster }} style={styles.thumb} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          <LinearGradient colors={['#2A2418', '#141210']} style={[styles.thumb, styles.thumbBlank]}>
            <Text style={styles.thumbLetter}>{(e.title || '?').trim().charAt(0).toUpperCase()}</Text>
          </LinearGradient>
        )}
        <View style={styles.flex}>
          <Text style={styles.when} numberOfLines={1}>
            {e.kind === 'fundraiser'
              ? [t('tix.kind.fundraiser'), e.category ? t(`tix.cat.${e.category}`) : ''].filter(Boolean).join(' · ')
              : formatWhen(e.starts_at, { months, weekdays })}
          </Text>
          <Text style={styles.title} numberOfLines={2}>{e.title}</Text>
          <Pill kind={state.tone} label={t(`tix.mine.state.${state.key}`)} style={styles.pill} />
          {!!staffNote(e, state.key) && (
            <Text style={styles.note} numberOfLines={2}>{staffNote(e, state.key)}</Text>
          )}
          {!!e.warning_note && !e.removed_at && (
            <Text style={styles.warning} numberOfLines={2}>{t('tix.mine.warning')}: {e.warning_note}</Text>
          )}
          {quantity > 0 && (state.key === 'onSale' || state.key === 'ended') && (
            <View style={styles.soldRow}>
              <View style={styles.track}><View style={[styles.fill, { width: `${Math.min(100, (sold / quantity) * 100)}%` }]} /></View>
              <Text style={styles.soldText}>{t('tix.mine.sold', { sold, total: quantity })}</Text>
            </View>
          )}
        </View>
        <Ionicons name="chevron-forward" size={18} color={T.faint} />
      </TouchableOpacity>
    );
  };

  const footer = (
    <View>
      {tills.length > 0 && (
        <>
          <Kicker style={styles.kicker}>{t('tix.mine.tills')}</Kicker>
          {tills.map((x) => (
            <View key={x.id} style={styles.till}>
              <View style={styles.flex}>
                <Text style={styles.tillName}>{x.business_name}</Text>
                <Text style={styles.tillNo}>{t('tix.host.tillNo', { n: x.till_number })}</Text>
                {!!x.note && <Text style={styles.note}>{x.note}</Text>}
                {(x.status === 'pending' || x.status === 'submitted') && (
                  <Text style={styles.tillHint}>{t('tix.mine.tillWaiting')}</Text>
                )}
              </View>
              <Pill kind={TILL_TONE[x.status] || 'closed'} label={x.status_label || x.status} />
            </View>
          ))}
        </>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <SectionList
        sections={sections}
        keyExtractor={(e) => String(e.id)}
        renderItem={renderEvent}
        renderSectionHeader={({ section }) => <Kicker style={styles.kicker}>{t(`tix.mine.group.${section.key}`)}</Kicker>}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Notice title={t('tix.mine.emptyTitle')} body={t('tix.mine.emptyBody')} />
            <GoldButton label={t('tix.openEvent')} onPress={create} style={styles.emptyBtn} />
          </View>
        )}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={pull} tintColor={T.gold} colors={[T.gold]} />}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
};

const Total = ({ value, label, wide }) => (
  <View style={[styles.total, wide && styles.totalWide]}>
    <Text style={styles.totalValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    <Text style={styles.totalLabel} numberOfLines={1}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  centre: { alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  list: { paddingHorizontal: 16, paddingBottom: 36, width: '100%', maxWidth: 720, alignSelf: 'center' },

  top: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingTop: 20 },
  heading: { fontFamily: F.display, fontSize: 34, lineHeight: 38, color: T.ivory, marginTop: 6 },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 18,
    backgroundColor: T.champagne, marginBottom: 4,
  },
  newText: { fontFamily: F.uiHeavy, fontSize: 13, color: T.paperInk },

  totals: { flexDirection: 'row', gap: 10, marginTop: 18 },
  total: {
    flex: 1, padding: 14, borderRadius: 18, backgroundColor: T.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.line,
  },
  totalWide: { flex: 1.6 },
  totalValue: { fontFamily: F.display, fontSize: 24, color: T.ivory },
  totalLabel: { fontFamily: F.uiBold, fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase', color: T.faint, marginTop: 2 },

  kicker: { marginTop: 26, marginBottom: 12, marginLeft: 4 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, marginBottom: 10, borderRadius: 20,
    backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.line,
  },
  thumb: { width: 72, height: 90, borderRadius: 12, overflow: 'hidden' },
  thumbBlank: { alignItems: 'center', justifyContent: 'center' },
  thumbLetter: { fontFamily: F.display, fontSize: 34, color: 'rgba(232,212,170,0.55)' },
  when: { fontFamily: F.uiBold, fontSize: 11, letterSpacing: 1.1, textTransform: 'uppercase', color: T.gold },
  title: { fontFamily: F.display, fontSize: 21, lineHeight: 24, color: T.ivory, marginTop: 3 },
  pill: { marginTop: 8 },
  note: { fontFamily: F.ui, fontSize: 12.5, lineHeight: 18, color: T.danger, marginTop: 6 },
  warning: { fontFamily: F.ui, fontSize: 12.5, lineHeight: 18, color: T.champagne, marginTop: 6 },
  soldRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: T.line, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: T.gold },
  soldText: { fontFamily: F.uiSemi, fontSize: 11.5, color: T.muted },

  till: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, marginBottom: 10, borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.line,
  },
  tillName: { fontFamily: F.uiBold, fontSize: 14.5, color: T.ivory },
  tillNo: { fontFamily: F.uiSemi, fontSize: 12.5, color: T.muted, marginTop: 2 },
  tillHint: { fontFamily: F.ui, fontSize: 12.5, lineHeight: 18, color: T.faint, marginTop: 6 },

  empty: { alignItems: 'center' },
  emptyBtn: { alignSelf: 'stretch', marginHorizontal: 24 },
});

export default TicketMyEvents;

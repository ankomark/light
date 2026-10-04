/**
 * My tickets: every order kept on this phone, upcoming first.
 *
 * Read from secure storage, so it opens instantly and with no network, then
 * asked about again behind it — a payment that was still pending may have
 * settled, a ticket may have been scanned at the gate.
 *
 * Failed and expired orders hold no tickets and are left out: a retried
 * payment would otherwise show the same event twice.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SectionList, RefreshControl, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../../context/I18nContext';
import { useSavedOrders, refreshSavedOrders, formatWhen, dateTile, isPast } from '../../services/tickets';
import { T, F, tap, Kicker, DateTile, Pill, Notice } from '../../components/tickets/TicketKit';

const SHOWN = ['paid', 'pending'];

/** `[{ key, data }]`: upcoming soonest first, past most recent first. */
export const groupOrders = (saved, now = Date.now()) => {
  const orders = (saved || []).map((s) => s.order).filter((o) => o && SHOWN.includes(o.status));
  const time = (o) => new Date(o.starts_at).getTime() || 0;
  const upcoming = orders.filter((o) => !isPast(o.starts_at, now)).sort((a, b) => time(a) - time(b));
  const past = orders.filter((o) => isPast(o.starts_at, now)).sort((a, b) => time(b) - time(a));
  return [
    ...(upcoming.length ? [{ key: 'tix.upcoming', data: upcoming }] : []),
    ...(past.length ? [{ key: 'tix.past', data: past }] : []),
  ];
};

const MyTickets = ({ navigation }) => {
  const { t } = useI18n();
  const months = t('tix.months').split(',');
  const weekdays = t('tix.weekdays').split(',');
  const saved = useSavedOrders();

  const [pulling, setPulling] = useState(false);
  useEffect(() => { refreshSavedOrders(); }, []);
  const pull = useCallback(async () => {
    setPulling(true);
    try { await refreshSavedOrders(); } finally { setPulling(false); }
  }, []);

  const sections = groupOrders(saved);
  const open = (order) => { tap(); navigation.push('TicketOrder', { reference: order.reference }); };

  const recover = (
    <TouchableOpacity
      onPress={() => { tap(); navigation.push('TicketRecover'); }}
      style={styles.recover}
      accessibilityRole="button"
      testID="recover-tickets"
    >
      <Ionicons name="phone-portrait-outline" size={20} color={T.champagne} />
      <View style={styles.flex}>
        <Text style={styles.recoverTitle}>{t('tix.recover')}</Text>
        <Text style={styles.recoverHint}>{t('tix.recoverHint')}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={T.faint} />
    </TouchableOpacity>
  );

  if (saved === null) {
    return <View style={[styles.root, styles.centre]}><ActivityIndicator color={T.gold} size="large" /></View>;
  }

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <SectionList
        sections={sections}
        keyExtractor={(o) => o.reference}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={pull} tintColor={T.gold} colors={[T.gold]} />}
        ListHeaderComponent={(
          <Text style={styles.heading} accessibilityRole="header">{t('tix.myTickets')}</Text>
        )}
        renderSectionHeader={({ section }) => <Kicker style={styles.kicker}>{t(section.key)}</Kicker>}
        renderItem={({ item: o }) => {
          const past = isPast(o.starts_at);
          return (
            <TouchableOpacity
              onPress={() => open(o)}
              style={[styles.card, past && styles.cardPast]}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`${o.event}, ${formatWhen(o.starts_at, { months, weekdays })}`}
            >
              <DateTile {...dateTile(o.starts_at, months)} />
              <View style={styles.flex}>
                <Text style={styles.event} numberOfLines={2}>{o.event}</Text>
                <Text style={styles.meta} numberOfLines={1}>{o.quantity} × {o.ticket_type}  ·  {o.venue}</Text>
                <Pill
                  kind={o.status}
                  label={o.status === 'paid' ? t('tix.paid') : t('tix.pending')}
                  style={styles.pill}
                />
              </View>
              <Ionicons name="qr-code-outline" size={22} color={o.status === 'paid' ? T.champagne : T.faint} />
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={(
          <Notice
            title={t('tix.noTicketsTitle')}
            body={t('tix.noTicketsBody')}
            action={t('tix.browse')}
            onAction={() => navigation.navigate('TicketsHome')}
          />
        )}
        ListFooterComponent={recover}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  centre: { alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  list: { paddingHorizontal: 16, paddingBottom: 32, width: '100%', maxWidth: 720, alignSelf: 'center' },
  heading: { fontFamily: F.display, fontSize: 34, lineHeight: 38, color: T.ivory, marginTop: 20 },
  kicker: { marginTop: 24, marginBottom: 12, marginLeft: 4 },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, marginBottom: 10, borderRadius: 20,
    backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.line,
  },
  cardPast: { opacity: 0.6 },
  event: { fontFamily: F.display, fontSize: 21, lineHeight: 24, color: T.ivory },
  meta: { fontFamily: F.uiSemi, fontSize: 12.5, color: T.muted, marginTop: 4 },
  pill: { marginTop: 8 },

  recover: {
    flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 28, padding: 16, borderRadius: 20,
    borderWidth: 1, borderStyle: 'dashed', borderColor: T.lineStrong,
  },
  recoverTitle: { fontFamily: F.uiBold, fontSize: 15, color: T.ivory },
  recoverHint: { fontFamily: F.ui, fontSize: 13, color: T.muted, marginTop: 2 },
});

export default MyTickets;

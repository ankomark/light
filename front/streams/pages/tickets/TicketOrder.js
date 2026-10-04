/**
 * One order: waiting for M-Pesa, then the tickets.
 *
 * While the order is `pending` the screen asks about it every 3 s, for up to
 * 2 minutes (services/tickets.js), pausing while the app is in the
 * background and asking at once when it comes back. Past 2 minutes it stops
 * and says so, with a Check again — the order is already saved, and the
 * server settles any paid order on its own, so nothing is lost by stopping.
 *
 * `paid` shows the tickets: one stub per ticket, swiped through, each with
 * its QR. The QR holds the ticket's `code` and nothing else, black on white,
 * large, for a gate scanning in sunlight. Every answer is kept on the phone,
 * so the tickets open with no network at the gate.
 *
 * `failed` and `expired` say why, and Try again goes back to the event with
 * the same ticket still chosen.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, FlatList, Animated, Easing, AppState, ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../../context/I18nContext';
import useReducedMotion from '../../utils/useReducedMotion';
import {
  fetchOrder, cacheOrder, readCachedOrder, formatKes, formatWhen, POLL_MS, POLL_LIMIT_MS,
} from '../../services/tickets';
import { T, F, Kicker, Pill, GoldButton, GhostButton, Notice } from '../../components/tickets/TicketKit';
import QRCode from '../../components/tickets/QRCode';
import { ticketErrorText } from './ticketText';

/** Poll an order while it is pending. */
const useOrder = (reference) => {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [timedOut, setTimedOut] = useState(false);
  const started = useRef(Date.now());
  const timer = useRef(null);
  const live = useRef(true);
  const active = useRef(AppState.currentState !== 'background');
  const statusRef = useRef(null);

  const check = useCallback(async () => {
    clearTimeout(timer.current);
    try {
      const next = await fetchOrder(reference);
      if (!live.current) return;
      setOrder(next);
      setError(null);
      statusRef.current = next.status;
      cacheOrder(next);
    } catch (err) {
      if (!live.current) return;
      setError(err);
    }
    // Settled: nothing more to ask. Still unknown (no answer yet, say a
    // dropped connection): keep asking, within the same 2 minutes.
    const settled = statusRef.current !== 'pending' && statusRef.current !== null;
    if (!live.current || settled) return;
    if (Date.now() - started.current >= POLL_LIMIT_MS) { setTimedOut(true); return; }
    if (active.current) timer.current = setTimeout(check, POLL_MS);
  }, [reference]);

  useEffect(() => {
    live.current = true;
    // The kept copy first: tickets open at once, and with no network at all.
    readCachedOrder(reference).then((kept) => {
      if (live.current && kept) {
        setOrder((cur) => cur || kept);
        if (statusRef.current === null) statusRef.current = kept.status;
      }
    });
    check();
    const sub = AppState.addEventListener('change', (state) => {
      const was = active.current;
      active.current = state === 'active';
      if (active.current && !was && (statusRef.current === 'pending' || statusRef.current === null)) check();
      if (!active.current) clearTimeout(timer.current);
    });
    return () => { live.current = false; clearTimeout(timer.current); sub.remove(); };
  }, [reference, check]);

  const again = useCallback(() => {
    started.current = Date.now();
    setTimedOut(false);
    check();
  }, [check]);

  return { order, error, timedOut, again };
};

/** Two rings breathing out from the phone, while M-Pesa is asked. */
const Pulse = () => {
  const reduce = useReducedMotion();
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) return undefined;
    const loop = Animated.loop(Animated.timing(a, {
      toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: true,
    }));
    loop.start();
    return () => loop.stop();
  }, [a, reduce]);
  const ring = (offset) => {
    const v = Animated.modulo(Animated.add(a, offset), 1);
    return {
      opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
      transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 2.1] }) }],
    };
  };
  return (
    <View style={styles.pulse}>
      {!reduce && <Animated.View style={[styles.ring, ring(0)]} />}
      {!reduce && <Animated.View style={[styles.ring, ring(0.5)]} />}
      <View style={styles.pulseCore}><Ionicons name="phone-portrait-outline" size={34} color={T.paperInk} /></View>
    </View>
  );
};

const TicketStub = ({ order, ticket, index, count, width, t, months, weekdays }) => {
  const qrSize = Math.min(width - 64, 260);
  return (
    <View style={[styles.stub, { width }]}>
      <View style={styles.stubHead}>
        <View style={styles.flex}>
          <Text style={styles.stubType} numberOfLines={1}>{order.ticket_type}</Text>
          <Text style={styles.stubOf}>{t('tix.ticketOf', { i: index + 1, n: count })}</Text>
        </View>
        {ticket.checked_in && <Pill kind="closed" label={t('tix.used')} />}
      </View>
      <View style={[styles.qrWrap, ticket.checked_in && styles.qrUsed]}>
        <QRCode value={ticket.code} size={qrSize} accessibilityLabel={t('tix.qrLabel')} />
      </View>
      <Text style={styles.code} selectable={false}>{ticket.code}</Text>
      <View style={styles.perf}>
        <View style={[styles.notch, styles.notchLeft]} />
        <View style={styles.dashes} />
        <View style={[styles.notch, styles.notchRight]} />
      </View>
      <Text style={styles.stubEvent} numberOfLines={2}>{order.event}</Text>
      <Text style={styles.stubMeta}>{formatWhen(order.starts_at, { months, weekdays })}</Text>
      <Text style={[styles.stubMeta, styles.stubLast]} numberOfLines={1}>{order.venue}</Text>
    </View>
  );
};

const TicketOrder = ({ navigation, route }) => {
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const months = t('tix.months').split(',');
  const weekdays = t('tix.weekdays').split(',');
  const { reference } = route.params;
  const { order, error, timedOut, again } = useOrder(reference);

  // A small celebration the moment it is paid — not on reopening paid tickets.
  const lastStatus = useRef(null);
  useEffect(() => {
    if (lastStatus.current === 'pending' && order?.status === 'paid') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    lastStatus.current = order?.status || lastStatus.current;
  }, [order?.status]);

  const tryAgain = useCallback(() => {
    // Back to the event, the chosen ticket still selected; or to it afresh
    // when this screen was opened from My tickets.
    const routes = navigation.getState?.()?.routes || [];
    const prev = routes[routes.length - 2];
    if (prev?.name === 'TicketEvent') navigation.goBack();
    else navigation.replace('TicketEvent', { slug: order?.event_slug });
  }, [navigation, order?.event_slug]);

  const [page, setPage] = useState(0);
  const stubWidth = Math.min(width, 520) - 48;

  if (!order) {
    return (
      <View style={[styles.root, styles.centre]}>
        {error ? (
          <Notice title={ticketErrorText(error, t, 'tix.orderFailed')} action={t('common.retry')} onAction={again} />
        ) : (
          <ActivityIndicator color={T.gold} size="large" />
        )}
      </View>
    );
  }

  if (order.status === 'paid') {
    const tickets = order.tickets || [];
    return (
      <SafeAreaView style={styles.root} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.paidScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.paidHead}>
            <Kicker>{t('tix.youreGoing')}</Kicker>
            <Text style={styles.paidTitle} accessibilityRole="header" numberOfLines={3}>{order.event}</Text>
          </View>

          <FlatList
            horizontal
            data={tickets}
            keyExtractor={(tk) => tk.code}
            renderItem={({ item, index }) => (
              <TicketStub order={order} ticket={item} index={index} count={tickets.length}
                          width={stubWidth} t={t} months={months} weekdays={weekdays} />
            )}
            showsHorizontalScrollIndicator={false}
            snapToInterval={stubWidth + 12}
            decelerationRate="fast"
            contentContainerStyle={styles.pager}
            ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
            onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / (stubWidth + 12)))}
          />
          {tickets.length > 1 && (
            <View style={styles.dots}>
              {tickets.map((tk, i) => <View key={tk.code} style={[styles.dot, i === page && styles.dotOn]} />)}
            </View>
          )}
          <Text style={styles.gate}>{t('tix.showAtGate')}</Text>

          <View style={styles.details}>
            <Row label={t('tix.orderCode')} value={order.code} />
            {!!order.mpesa_receipt && <Row label={t('tix.receipt')} value={order.mpesa_receipt} />}
            <Row label={t('tix.total')} value={formatKes(order.amount)} last />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const failed = order.status === 'failed' || order.status === 'expired';
  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.waitScroll}>
        {failed ? (
          <View style={styles.failIcon}>
            <Ionicons name={order.status === 'expired' ? 'time-outline' : 'close'} size={36} color={T.danger} />
          </View>
        ) : timedOut ? (
          <View style={styles.failIcon}><Ionicons name="hourglass-outline" size={34} color={T.champagne} /></View>
        ) : (
          <Pulse />
        )}

        <Text style={styles.waitTitle} accessibilityRole="header" accessibilityLiveRegion="polite">
          {order.status === 'failed' ? t('tix.failedTitle')
            : order.status === 'expired' ? t('tix.expiredTitle')
            : timedOut ? t('tix.stillWaiting')
            : t('tix.checkPhone')}
        </Text>
        <Text style={styles.waitBody}>
          {order.status === 'failed' ? (order.message || t('tix.genericError'))
            : order.status === 'expired' ? t('tix.expiredBody')
            : timedOut ? t('tix.stillWaitingBody')
            : t('tix.enterPin', { amount: formatKes(order.amount) })}
        </Text>
        {!failed && !timedOut && <Text style={styles.waiting}>{t('tix.waiting')}</Text>}

        <View style={styles.summary}>
          <Text style={styles.summaryEvent} numberOfLines={2}>{order.event}</Text>
          <Text style={styles.summaryLine}>{order.quantity} × {order.ticket_type}  ·  {formatKes(order.amount)}</Text>
          <Text style={styles.summaryCode}>{t('tix.orderCode')} {order.code}</Text>
        </View>
      </ScrollView>

      {(failed || timedOut) && (
        <View style={styles.bar}>
          {failed ? (
            <GoldButton label={t('tix.tryAgain')} onPress={tryAgain} testID="order-try-again" />
          ) : (
            <GhostButton label={t('tix.checkAgain')} onPress={again} testID="order-check-again" />
          )}
        </View>
      )}
    </SafeAreaView>
  );
};

const Row = ({ label, value, last }) => (
  <View style={[styles.detail, !last && styles.detailLine]}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue}>{value}</Text>
  </View>
);

const NOTCH = 24;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  centre: { alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },

  // Waiting
  waitScroll: { alignItems: 'center', paddingHorizontal: 28, paddingTop: 56, paddingBottom: 28 },
  pulse: { width: 170, height: 170, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: T.gold },
  pulseCore: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: T.champagne,
    alignItems: 'center', justifyContent: 'center',
  },
  failIcon: {
    width: 96, height: 96, borderRadius: 48, marginVertical: 37, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: T.lineStrong, backgroundColor: T.surface,
  },
  waitTitle: { fontFamily: F.display, fontSize: 34, lineHeight: 38, color: T.ivory, textAlign: 'center', marginTop: 8 },
  waitBody: { fontFamily: F.ui, fontSize: 15.5, lineHeight: 24, color: T.muted, textAlign: 'center', marginTop: 12, maxWidth: 360 },
  waiting: { fontFamily: F.uiBold, fontSize: 12, letterSpacing: 1.6, textTransform: 'uppercase', color: T.gold, marginTop: 22 },
  summary: {
    alignSelf: 'stretch', marginTop: 36, padding: 18, borderRadius: 20, maxWidth: 520, width: '100%',
    backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.line,
  },
  summaryEvent: { fontFamily: F.display, fontSize: 21, lineHeight: 24, color: T.ivory },
  summaryLine: { fontFamily: F.uiSemi, fontSize: 13.5, color: T.muted, marginTop: 6 },
  summaryCode: { fontFamily: F.uiBold, fontSize: 12, letterSpacing: 1, color: T.faint, marginTop: 10 },
  bar: {
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10,
    backgroundColor: T.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.lineStrong,
  },

  // Paid
  paidScroll: { paddingBottom: 32 },
  paidHead: { paddingHorizontal: 24, paddingTop: 22, paddingBottom: 18 },
  paidTitle: { fontFamily: F.display, fontSize: 32, lineHeight: 36, color: T.ivory, marginTop: 6 },
  pager: { paddingHorizontal: 24 },
  stub: { backgroundColor: T.paper, borderRadius: 26, overflow: 'hidden', alignItems: 'center' },
  stubHead: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', paddingHorizontal: 20, paddingTop: 18, gap: 10 },
  stubType: { fontFamily: F.uiHeavy, fontSize: 15, color: T.paperInk },
  stubOf: { fontFamily: F.uiSemi, fontSize: 12, color: 'rgba(22,19,14,0.5)', marginTop: 2 },
  qrWrap: { marginTop: 14, borderRadius: 14, overflow: 'hidden' },
  qrUsed: { opacity: 0.35 },
  code: { fontFamily: F.uiBold, fontSize: 13, letterSpacing: 2, color: 'rgba(22,19,14,0.6)', marginTop: 10 },
  perf: { height: NOTCH, justifyContent: 'center', alignSelf: 'stretch', marginTop: 14 },
  dashes: { marginHorizontal: NOTCH, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(22,19,14,0.22)' },
  notch: { position: 'absolute', width: NOTCH, height: NOTCH, borderRadius: NOTCH / 2, backgroundColor: T.ink },
  notchLeft: { left: -NOTCH / 2 },
  notchRight: { right: -NOTCH / 2 },
  stubEvent: { fontFamily: F.display, fontSize: 22, lineHeight: 25, color: T.paperInk, textAlign: 'center', paddingHorizontal: 20, marginTop: 6 },
  stubMeta: { fontFamily: F.uiSemi, fontSize: 12.5, color: 'rgba(22,19,14,0.6)', marginTop: 4, paddingHorizontal: 20 },
  stubLast: { marginBottom: 20 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 14 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.lineStrong },
  dotOn: { width: 18, backgroundColor: T.gold },
  gate: { fontFamily: F.ui, fontSize: 13, color: T.muted, textAlign: 'center', marginTop: 14, paddingHorizontal: 32 },
  details: {
    marginHorizontal: 24, marginTop: 24, borderRadius: 20, paddingHorizontal: 16,
    backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.line,
  },
  detail: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14 },
  detailLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.line },
  detailLabel: { fontFamily: F.uiSemi, fontSize: 13.5, color: T.muted },
  detailValue: { fontFamily: F.uiBold, fontSize: 14, color: T.ivory, letterSpacing: 0.5 },
});

export default TicketOrder;

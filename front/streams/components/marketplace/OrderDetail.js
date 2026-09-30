// One order. Opens at once on the copy the list already had (route param or
// the phone's cache) and refreshes behind it. Lines show what was bought as
// it was bought — the product may since have been edited or deleted.
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import {
  fetchOrderById, confirmOrderPayment, shipOrderPart, markOrderReceived, cancelOrderPart,
} from '../../services/api';
import { addProductToCart } from '../../utils/cartStore';
import { useAuth } from '../../context/useAuth';
import { useI18n } from '../../context/I18nContext';
import { peekCache, writeCache, userKey } from '../../utils/screenCache';
import {
  formatTotals, orderTotals, groupBySeller, marketError,
} from '../../utils/market';
import SellerPayCard from './SellerPayCard';
import { STATUS_COLORS, formatDate } from './OrderHistory';
import useMarketToast from './MarketToast';

// Placed → paid → shipped → delivered, as the server reads it off the lines.
const Timeline = ({ steps, t }) => (
  <View style={styles.timeline} testID="order-timeline">
    {steps.map((s, i) => {
      const done = !!s.at;
      return (
        <View key={s.step} style={styles.step}>
          <View style={[styles.dot, done && styles.dotDone, s.step === 'cancelled' && styles.dotCancelled]}>
            {done && <Icon name={s.step === 'cancelled' ? 'times' : 'check'} size={10} color="#fff" />}
          </View>
          {i < steps.length - 1 && <View style={[styles.stepLine, done && styles.stepLineDone]} />}
          <Text style={[styles.stepText, done && styles.stepTextDone]}>{t(`market.step.${s.step}`)}</Text>
          {done && <Text style={styles.stepDate}>{formatDate(s.at)}</Text>}
        </View>
      );
    })}
  </View>
);

const OrderDetail = () => {
  const navigation = useNavigation();
  const params = useRoute().params ?? {};
  const { orderId } = params;
  const { currentUser } = useAuth();
  const { t } = useI18n();
  const key = userKey(currentUser?.id, `market:order:${orderId}`);
  const [order, setOrder] = useState(() => params.order || peekCache(key));
  const [error, setError] = useState(null);
  const [confirmingSeller, setConfirmingSeller] = useState(null);
  const [actingSeller, setActingSeller] = useState(null);
  const [toast, showToast] = useMarketToast();

  const keep = useCallback((data) => {
    setOrder(data);
    if (data) writeCache(key, data, { persist: false });
  }, [key]);

  const loadOrder = useCallback(async () => {
    setError(null);
    try {
      keep(await fetchOrderById(orderId));
    } catch (err) {
      setError(err.response?.status === 404
        ? t('market.checkout.notFound')
        : t('market.order.loadFailed'));
    }
  }, [orderId, t, keep]);

  useEffect(() => { loadOrder(); }, [loadOrder]);

  const handleConfirm = useCallback((sellerId) => {
    Alert.alert(
      t('market.order.confirmTitle'),
      t('market.order.confirmWarning'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('market.order.confirmYes'),
          onPress: async () => {
            try {
              setConfirmingSeller(sellerId);
              keep(await confirmOrderPayment(orderId));
              showToast(t('market.order.confirmed'));
            } catch (err) {
              showToast(marketError(err, t('market.order.confirmFailed')), { error: true });
            } finally {
              setConfirmingSeller(null);
            }
          },
        },
      ]
    );
  }, [orderId, t, keep, showToast]);

  // One seller's part: sent, received, or cancelled. Each answers with the
  // whole order, which replaces the one shown.
  const act = useCallback(async (sellerId, run, done) => {
    try {
      setActingSeller(sellerId);
      keep(await run());
      showToast(done);
    } catch (err) {
      showToast(marketError(err, t('market.order.actionFailed')), { error: true });
    } finally {
      setActingSeller(null);
    }
  }, [keep, showToast, t]);

  const cancelPart = useCallback((sellerId, mine) => {
    Alert.alert(
      t('market.part.cancelTitle'),
      mine ? t('market.part.cancelMineBody') : t('market.part.cancelThisBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('market.part.cancelYes'),
          style: 'destructive',
          onPress: () => act(sellerId, () => cancelOrderPart(orderId, mine ? undefined : sellerId),
            t('market.part.cancelled')),
        },
      ],
    );
  }, [act, orderId, t]);

  // A finished order's things, back in the cart — those still for sale.
  const buyAgain = useCallback(async () => {
    const products = (order?.items || []).map((i) => i.product)
      .filter((p) => p && p.is_available !== false && p.quantity > 0);
    if (!products.length) { showToast(t('market.order.nothingToRebuy'), { error: true }); return; }
    let added = 0;
    for (const p of products) {
      try { await addProductToCart(p, 1); added += 1; } catch { /* sold out since */ }
    }
    showToast(t('market.order.addedAgain', { n: added }));
    if (added) navigation.navigate('Cart');
  }, [order, navigation, showToast, t]);

  if (!order) {
    return (
      <View style={styles.centered}>
        {error ? (
          <>
            <Icon name="exclamation-circle" size={50} color="#888" />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={loadOrder}>
              <Text style={styles.retryText}>{t('common.retry')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <Text style={styles.retryText}>{t('market.goBack')}</Text>
            </TouchableOpacity>
          </>
        ) : <ActivityIndicator size="large" color="#FFC46B" />}
      </View>
    );
  }

  const sellerGroups = groupBySeller(order.items);
  const status = (order.status || 'pending').toLowerCase();
  const isBuyer = !!currentUser?.id && (order.buyer?.id ?? order.buyer) === currentUser.id;

  return (
    <View style={styles.flex}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.orderId}>{t('market.order.number', { id: order.id })}</Text>
            <Text style={styles.orderDate}>{formatDate(order.created_at)}</Text>
          </View>
          <View style={styles.badgeRow}>
            <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[status] || '#888' }]}>
              <Text style={styles.statusText}>{t(`market.status.${status}`)}</Text>
            </View>
            {order.payment_status ? (
              <Text style={styles.paymentStatus}>
                {t('market.order.paymentIs', { status: t(`market.payment.${order.payment_status.toLowerCase()}`) })}
              </Text>
            ) : null}
          </View>
        </View>

        {!!order.timeline?.length && <Timeline steps={order.timeline} t={t} />}

        <Text style={styles.sectionTitle}>{t('market.order.items')}</Text>
        {sellerGroups.map((group) => {
          const mine = !!currentUser?.id && group.sellerId === currentUser.id;
          return (
            <SellerPayCard
              key={String(group.sellerId)}
              group={group}
              orderId={order.id}
              isMySale={mine}
              isBuyer={isBuyer}
              orderOpen={!['cancelled', 'refunded'].includes(status)}
              confirming={confirmingSeller === group.sellerId}
              onConfirm={() => handleConfirm(group.sellerId)}
              onToast={showToast}
              acting={actingSeller === group.sellerId}
              onShip={(note) => act(group.sellerId, () => shipOrderPart(orderId, note), t('market.part.sentDone'))}
              onReceived={() => act(group.sellerId, () => markOrderReceived(orderId, group.sellerId),
                t('market.part.receivedDone'))}
              onCancelPart={() => cancelPart(group.sellerId, mine)}
            />
          );
        })}

        {isBuyer && status === 'delivered' && (
          <TouchableOpacity style={styles.buyAgain} onPress={buyAgain} testID="order-buy-again">
            <Icon name="repeat" size={15} color="#fff" />
            <Text style={styles.buyAgainText}>{t('market.order.buyAgain')}</Text>
          </TouchableOpacity>
        )}

        <View style={[styles.card, styles.totalCard]}>
          <Text style={styles.totalLabel}>{t('market.checkout.orderTotal')}</Text>
          {/* Per currency: each seller prices in their own. */}
          <Text style={styles.totalAmount} testID="order-total">{formatTotals(orderTotals(order))}</Text>
        </View>

        {order.shipping_address ? (
          <>
            <Text style={styles.sectionTitle}>{t('market.checkout.deliveryNote')}</Text>
            <View style={styles.card}>
              <Text style={styles.addressText} selectable>{order.shipping_address}</Text>
            </View>
          </>
        ) : null}

        <View style={{ height: 32 }} />
      </ScrollView>
      {toast}
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  timeline: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12,
  },
  step: { flex: 1, alignItems: 'center' },
  dot: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: '#ddd',
    alignItems: 'center', justifyContent: 'center', zIndex: 1,
  },
  dotDone: { backgroundColor: '#2E8B57' },
  dotCancelled: { backgroundColor: '#FF6347' },
  stepLine: { position: 'absolute', top: 9, left: '50%', right: '-50%', height: 2, backgroundColor: '#ddd' },
  stepLineDone: { backgroundColor: '#2E8B57' },
  stepText: { marginTop: 6, fontSize: 11, color: '#999', textAlign: 'center' },
  stepTextDone: { color: '#333', fontWeight: '600' },
  stepDate: { fontSize: 10, color: '#888', marginTop: 2 },
  buyAgain: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#1D478B', borderRadius: 10, paddingVertical: 14, marginBottom: 12,
  },
  buyAgainText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    padding: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  errorText: {
    fontSize: 18,
    color: '#cdd9e5',
    marginTop: 16,
    textAlign: 'center',
  },
  retryText: {
    color: '#1D478B',
    marginTop: 8,
    fontWeight: '500',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  orderId: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  orderDate: {
    fontSize: 14,
    color: '#888',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusBadge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'capitalize',
  },
  paymentStatus: {
    fontSize: 13,
    color: '#777',
    textTransform: 'capitalize',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  sellerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  sellerName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
    marginLeft: 8,
    flex: 1,
  },
  paidPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2E8B57',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  paidPillText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
    marginLeft: 4,
  },
  confirmBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    height: 46,
    borderRadius: 8,
    backgroundColor: '#2E8B57',
    marginTop: 12,
  },
  confirmBtnDisabled: {
    backgroundColor: '#9ec7ae',
  },
  confirmBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
    marginLeft: 8,
  },
  awaitingNote: {
    fontSize: 12,
    color: '#888',
    fontStyle: 'italic',
    marginTop: 12,
    textAlign: 'center',
  },
  lineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  lineImage: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  lineTextWrap: {
    flex: 1,
    marginLeft: 12,
  },
  lineTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: '#333',
  },
  lineMeta: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  lineTotal: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginLeft: 8,
  },
  subtotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderColor: '#eee',
    paddingTop: 12,
    marginTop: 4,
  },
  subtotalLabel: {
    fontSize: 14,
    color: '#555',
    fontWeight: '500',
  },
  subtotalValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1D478B',
  },
  payBox: {
    backgroundColor: '#f5fbf7',
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
  },
  payRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  payIcon: {
    marginRight: 12,
    marginTop: 2,
    width: 20,
    textAlign: 'center',
  },
  payTextWrap: {
    flex: 1,
  },
  payLabel: {
    fontSize: 12,
    color: '#888',
    marginBottom: 2,
  },
  payValue: {
    fontSize: 15,
    color: '#222',
    fontWeight: '600',
  },
  noPayNote: {
    fontSize: 13,
    color: '#888',
    fontStyle: 'italic',
    marginTop: 12,
  },
  contactRow: {
    flexDirection: 'row',
    marginTop: 12,
  },
  contactBtn: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    height: 44,
    borderRadius: 8,
  },
  whatsappBtn: {
    backgroundColor: '#25D366',
    marginRight: 8,
  },
  callBtn: {
    backgroundColor: '#1D478B',
  },
  contactBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
    marginLeft: 8,
  },
  totalCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  totalAmount: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1D478B',
  },
  totalNote: {
    fontSize: 13,
    color: '#888',
    fontStyle: 'italic',
  },
  addressText: {
    fontSize: 15,
    color: '#555',
    lineHeight: 22,
  },
});

export default OrderDetail;

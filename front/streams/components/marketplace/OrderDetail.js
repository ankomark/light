import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { fetchOrderById, confirmOrderPayment } from '../../services/api';
import { useAuth } from '../../context/useAuth';
import { useI18n } from '../../context/I18nContext';

const PLACEHOLDER_IMAGE = require('../../assets/default-image.png');

const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', KES: 'Ksh', NGN: '₦' };

// Money arrives as strings (DRF serializes DecimalField that way) — always parse.
const formatPrice = (price, currency = 'USD') => {
  const symbol = CURRENCY_SYMBOLS[currency] || currency;
  return `${symbol}${(parseFloat(price) || 0).toFixed(2)}`;
};

const formatDate = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
};

const STATUS_COLORS = {
  delivered: '#2E8B57',
  shipped: '#1D478B',
  processing: '#FFA500',
  cancelled: '#FF6347',
  refunded: '#FF6347',
  default: '#888',
};

// Same open-air-market grouping the checkout uses: the buyer pays each seller
// directly, so the payment/contact details live on the product.
const groupBySeller = (items = []) => {
  const groups = new Map();
  for (const item of items) {
    const seller = item.product?.seller;
    const key = seller?.id ?? item.seller ?? 'unknown';
    if (!groups.has(key)) {
      groups.set(key, {
        sellerId: seller?.id ?? item.seller ?? null,
        sellerName: seller?.username || 'Seller',
        product: item.product || {},
        items: [],
        subtotal: 0,
      });
    }
    const group = groups.get(key);
    group.items.push(item);
    const unit = parseFloat(item.price_at_purchase ?? item.product?.price ?? 0) || 0;
    group.subtotal += unit * item.quantity;
  }
  return Array.from(groups.values());
};

const hasPaymentInfo = (p) =>
  !!(p?.mpesa_number || p?.till_number || p?.bank_details || p?.payment_instructions);

const PaymentLine = ({ icon, label, value }) => (
  <View style={styles.payRow}>
    <Icon name={icon} size={16} color="#2E8B57" style={styles.payIcon} />
    <View style={styles.payTextWrap}>
      <Text style={styles.payLabel}>{label}</Text>
      <Text style={styles.payValue} selectable>{value}</Text>
    </View>
  </View>
);

const SellerGroup = ({ group, fallbackCurrency, isMySale, orderOpen, onConfirm, confirming }) => {
  const { t } = useI18n();
  const { product } = group;
  // Each seller prices in their own currency; never assume the order's first.
  const currency = product?.currency || fallbackCurrency;
  // Buyers pay off-platform, so this seller's own confirmation is the record.
  const confirmed = group.items.length > 0 && group.items.every((i) => i.payment_confirmed_at);

  const openWhatsApp = () => {
    const num = (product.whatsapp_number || '').replace(/[^\d]/g, '');
    if (!num) return Alert.alert(t('market.unavailable'), t('market.checkout.noWhatsapp'));
    Linking.openURL(`https://wa.me/${num}`).catch(() =>
      Alert.alert(t('common.error'), t('market.checkout.whatsappFailed')));
  };

  const callSeller = () => {
    const num = product.contact_number || product.whatsapp_number;
    if (!num) return Alert.alert(t('market.unavailable'), t('market.checkout.noPhone'));
    Linking.openURL(`tel:${num}`).catch(() =>
      Alert.alert(t('common.error'), t('market.checkout.callFailed')));
  };

  return (
    <View style={styles.card}>
      <View style={styles.sellerHeader}>
        <Icon name="shopping-bag" size={16} color="#1D478B" />
        <Text style={styles.sellerName}>{group.sellerName}</Text>
        {confirmed ? (
          <View style={styles.paidPill}>
            <Icon name="check" size={11} color="#fff" />
            <Text style={styles.paidPillText}>{t('market.order.paid')}</Text>
          </View>
        ) : null}
      </View>

      {group.items.map((item) => (
        <View key={item.id} style={styles.lineItem}>
          <Image
            source={item.product?.images?.[0]?.image_url
              ? { uri: item.product.images[0].image_url }
              : PLACEHOLDER_IMAGE}
            placeholder={PLACEHOLDER_IMAGE}
            contentFit="cover"
            transition={150}
            style={styles.lineImage}
          />
          <View style={styles.lineTextWrap}>
            <Text style={styles.lineTitle} numberOfLines={2}>
              {item.product?.title || t('market.unavailableProduct')}
            </Text>
            <Text style={styles.lineMeta}>
              {formatPrice(item.price_at_purchase ?? item.product?.price, currency)} × {item.quantity}
            </Text>
          </View>
          <Text style={styles.lineTotal}>
            {formatPrice(
              (parseFloat(item.price_at_purchase ?? item.product?.price ?? 0) || 0) * item.quantity,
              currency
            )}
          </Text>
        </View>
      ))}

      <View style={styles.subtotalRow}>
        <Text style={styles.subtotalLabel}>{t('market.checkout.payThisSeller')}</Text>
        <Text style={styles.subtotalValue}>{formatPrice(group.subtotal, currency)}</Text>
      </View>

      {hasPaymentInfo(product) ? (
        <View style={styles.payBox}>
          {product.mpesa_number ? <PaymentLine icon="mobile" label="M-Pesa" value={product.mpesa_number} /> : null}
          {product.till_number ? <PaymentLine icon="credit-card" label="Till / Paybill" value={product.till_number} /> : null}
          {product.bank_details ? <PaymentLine icon="bank" label="Bank" value={product.bank_details} /> : null}
          {product.payment_instructions ? <PaymentLine icon="info-circle" label="Instructions" value={product.payment_instructions} /> : null}
        </View>
      ) : (
        <Text style={styles.noPayNote}>
          This seller hasn’t listed payment details — contact them to arrange payment.
        </Text>
      )}

      <View style={styles.contactRow}>
        <TouchableOpacity style={[styles.contactBtn, styles.whatsappBtn]} onPress={openWhatsApp} activeOpacity={0.85}>
          <Icon name="whatsapp" size={16} color="#fff" />
          <Text style={styles.contactBtnText}>{t('market.checkout.whatsapp')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.contactBtn, styles.callBtn]} onPress={callSeller} activeOpacity={0.85}>
          <Icon name="phone" size={16} color="#fff" />
          <Text style={styles.contactBtnText}>{t('market.checkout.call')}</Text>
        </TouchableOpacity>
      </View>

      {/* Only this seller can confirm their own lines — that's what releases
          the stock, since no payment processor tells us the money landed. */}
      {isMySale && !confirmed && orderOpen ? (
        <TouchableOpacity
          style={[styles.confirmBtn, confirming && styles.confirmBtnDisabled]}
          onPress={onConfirm}
          disabled={confirming}
          activeOpacity={0.85}
        >
          {confirming ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Icon name="check-circle" size={16} color="#fff" />
              <Text style={styles.confirmBtnText}>{t('market.order.confirmPayment')}</Text>
            </>
          )}
        </TouchableOpacity>
      ) : null}

      {!isMySale && !confirmed ? (
        <Text style={styles.awaitingNote}>{t('market.order.awaitingSeller')}</Text>
      ) : null}
    </View>
  );
};

const OrderDetail = () => {
  const navigation = useNavigation();
  const { orderId } = useRoute().params ?? {};
  const { currentUser } = useAuth();
  const { t } = useI18n();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirmingSeller, setConfirmingSeller] = useState(null);

  const loadOrder = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOrder(await fetchOrderById(orderId));
    } catch (err) {
      console.error('Error loading order:', err);
      setError(err.response?.status === 404
        ? t('market.checkout.notFound')
        : t('market.order.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [orderId, t]);

  useEffect(() => { loadOrder(); }, [loadOrder]);

  const handleConfirm = useCallback((sellerId) => {
    Alert.alert(
      'Confirm payment',
      t('market.order.confirmWarning'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: 'I received payment',
          onPress: async () => {
            try {
              setConfirmingSeller(sellerId);
              setOrder(await confirmOrderPayment(orderId));
            } catch (err) {
              console.error('Error confirming payment:', err);
              Alert.alert(
                'Error',
                err.response?.data?.error || t('market.order.confirmFailed')
              );
            } finally {
              setConfirmingSeller(null);
            }
          },
        },
      ]
    );
  }, [orderId, t]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#FFC46B" />
      </View>
    );
  }

  if (error || !order) {
    return (
      <View style={styles.centered}>
        <Icon name="exclamation-circle" size={50} color="#888" />
        <Text style={styles.errorText}>{error || t('market.checkout.notFound')}</Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.retryText}>{t('market.goBack')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const sellerGroups = groupBySeller(order.items);
  const fallbackCurrency = order.items?.[0]?.product?.currency || 'USD';
  // A single summed total only makes sense when every seller uses one currency.
  const currencies = [...new Set(sellerGroups.map((g) => g.product?.currency).filter(Boolean))];
  const mixedCurrency = currencies.length > 1;
  const statusColor = STATUS_COLORS[order.status?.toLowerCase()] || STATUS_COLORS.default;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.orderId}>Order #{order.id}</Text>
          <Text style={styles.orderDate}>{formatDate(order.created_at)}</Text>
        </View>
        <View style={styles.badgeRow}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
            <Text style={styles.statusText}>{order.status || 'Unknown'}</Text>
          </View>
          {order.payment_status ? (
            <Text style={styles.paymentStatus}>Payment: {order.payment_status}</Text>
          ) : null}
        </View>
      </View>

      <Text style={styles.sectionTitle}>{t('market.order.items')}</Text>
      {sellerGroups.map((group, i) => (
        <SellerGroup
          key={i}
          group={group}
          fallbackCurrency={fallbackCurrency}
          isMySale={!!currentUser?.id && group.sellerId === currentUser.id}
          orderOpen={!['cancelled', 'refunded'].includes((order.status || '').toLowerCase())}
          confirming={confirmingSeller === group.sellerId}
          onConfirm={() => handleConfirm(group.sellerId)}
        />
      ))}

      <View style={[styles.card, styles.totalCard]}>
        <Text style={styles.totalLabel}>{t('market.checkout.orderTotal')}</Text>
        {mixedCurrency ? (
          <Text style={styles.totalNote}>{t('market.checkout.seeEachSeller')}</Text>
        ) : (
          <Text style={styles.totalAmount}>
            {formatPrice(order.total_amount, fallbackCurrency)}
          </Text>
        )}
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
  );
};

const styles = StyleSheet.create({
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

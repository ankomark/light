import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { StripeProvider, usePaymentSheet } from '@stripe/stripe-react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiRequest } from '../../services/api';
import { colors, typography, spacing, radius, shadows } from '../../constants/theme';

const formatPrice = (price, currency = 'USD') => {
  const symbols = { USD: '$', EUR: '€', GBP: '£', KES: 'Ksh', NGN: '₦' };
  const symbol = symbols[currency] ?? currency;
  return `${symbol}${(parseFloat(price) || 0).toFixed(2)}`;
};

// ── Stripe-powered payment sheet ─────────────────────────────────────────────
const StripeCheckout = ({ order, onSuccess }) => {
  const { initPaymentSheet, presentPaymentSheet } = usePaymentSheet();
  const [publishableKey, setPublishableKey] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [paymentReady, setPaymentReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(false);
  const currency = order.items[0]?.product?.currency ?? 'USD';

  const initStripe = useCallback(async () => {
    setInitLoading(true);
    try {
      const res = await apiRequest('post', '/marketplace/create-payment-intent/', {
        order_id: order.id,
        currency: currency.toLowerCase(),
      });

      setPublishableKey(res.publishable_key);

      const { error } = await initPaymentSheet({
        merchantDisplayName: 'Advent Light',
        paymentIntentClientSecret: res.client_secret,
        defaultBillingDetails: { name: '' },
        allowsDelayedPaymentMethods: false,
        style: 'alwaysDark',
      });

      if (!error) setPaymentReady(true);
    } catch (err) {
      Alert.alert('Setup Error', err.message ?? 'Could not initialise payment. Please try again.');
    } finally {
      setInitLoading(false);
    }
  }, [order.id, currency, initPaymentSheet]);

  useEffect(() => { initStripe(); }, [initStripe]);

  const handlePay = async () => {
    if (!shippingAddress.trim()) {
      Alert.alert('Required', 'Please enter your shipping address.');
      return;
    }
    if (!paymentReady) {
      Alert.alert('Not ready', 'Payment is still loading. Please wait.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await presentPaymentSheet();
      if (error) {
        if (error.code !== 'Canceled') {
          Alert.alert('Payment Failed', error.message);
        }
      } else {
        // Payment succeeded on the client. Persist the shipping address; the
        // order's paid/processing state is set server-side by the Stripe webhook.
        await apiRequest('post', `/marketplace/orders/${order.id}/set-shipping/`, {
          shipping_address: shippingAddress,
        });
        onSuccess(order.id);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View>
      {/* Shipping address */}
      <Text style={styles.sectionTitle}>Shipping Address</Text>
      <TextInput
        style={styles.input}
        placeholder="Street, city, country..."
        placeholderTextColor={colors.placeholder}
        value={shippingAddress}
        onChangeText={setShippingAddress}
        multiline
      />

      {/* Payment info notice */}
      <View style={styles.stripeNotice}>
        <Ionicons name="shield-checkmark-outline" size={18} color={colors.success ?? '#43A047'} />
        <Text style={styles.stripeNoticeText}>
          Payment secured by Stripe — your card details are never stored on our servers.
        </Text>
      </View>

      {/* Pay button */}
      <TouchableOpacity
        style={[styles.payButton, (loading || initLoading || !paymentReady) && styles.payButtonDisabled]}
        onPress={handlePay}
        disabled={loading || initLoading || !paymentReady}
        activeOpacity={0.8}
      >
        {loading || initLoading
          ? <ActivityIndicator color={colors.white} />
          : <>
              <Ionicons name="card-outline" size={20} color={colors.white} />
              <Text style={styles.payButtonText}>
                Pay {formatPrice(order.total_amount, currency)}
              </Text>
            </>
        }
      </TouchableOpacity>
    </View>
  );
};

// ── Main screen ───────────────────────────────────────────────────────────────
const Checkout = () => {
  const navigation = useNavigation();
  const { orderId } = useRoute().params;
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stripeKey, setStripeKey] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await apiRequest('get', `/marketplace/orders/${orderId}/`);
        setOrder(data);
      } catch {
        Alert.alert('Error', 'Could not load order details.');
      } finally {
        setLoading(false);
      }
    })();
  }, [orderId]);

  const handleSuccess = useCallback((oid) => {
    navigation.replace('OrderHistory', { success: true, orderId: oid });
  }, [navigation]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
        <Text style={styles.emptyText}>Order not found</Text>
      </View>
    );
  }

  const currency = order.items?.[0]?.product?.currency ?? 'USD';

  return (
    <StripeProvider publishableKey={process.env.EXPO_PUBLIC_STRIPE_KEY ?? ''}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>

        {/* Order summary */}
        <Text style={styles.sectionTitle}>Order Summary</Text>
        <View style={styles.card}>
          {order.items?.map((item, i) => (
            <View key={i} style={styles.lineItem}>
              <Text style={styles.lineItemName} numberOfLines={1}>{item.product?.title ?? 'Product'}</Text>
              <Text style={styles.lineItemQty}>×{item.quantity}</Text>
              <Text style={styles.lineItemTotal}>
                {formatPrice(item.quantity * (item.price_at_purchase ?? item.product?.price ?? 0), currency)}
              </Text>
            </View>
          ))}
          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalAmount}>{formatPrice(order.total_amount, currency)}</Text>
          </View>
        </View>

        {/* Stripe payment */}
        <StripeCheckout order={order} onSuccess={handleSuccess} />

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </StripeProvider>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textMuted },
  sectionTitle: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.sm },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.sm,
    marginBottom: spacing.md,
  },
  lineItem: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.xs },
  lineItemName: { ...typography.body, color: colors.textPrimary, flex: 1 },
  lineItemQty: { ...typography.caption, color: colors.textMuted, width: 28, textAlign: 'center' },
  lineItemTotal: { ...typography.label, color: colors.textPrimary, width: 72, textAlign: 'right' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { ...typography.h3, color: colors.textPrimary },
  totalAmount: { ...typography.h2, color: colors.primary },
  input: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.textPrimary,
    fontSize: 15,
    marginBottom: spacing.md,
    minHeight: 60,
  },
  stripeNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  stripeNoticeText: { ...typography.caption, color: colors.textSecondary, flex: 1, lineHeight: 18 },
  payButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    height: 56,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.md,
  },
  payButtonDisabled: { opacity: 0.5 },
  payButtonText: { ...typography.button, color: colors.white, fontSize: 17 },
});

export default Checkout;

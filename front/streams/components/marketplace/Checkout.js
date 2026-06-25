import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Linking,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { apiRequest } from '../../services/api';
import { colors, typography, spacing, radius, shadows } from '../../constants/theme';

const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', KES: 'Ksh', NGN: '₦' };
const formatPrice = (price, currency = 'USD') => {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
  return `${symbol}${(parseFloat(price) || 0).toFixed(2)}`;
};

// Group order items by their seller so the buyer can pay each seller directly.
const groupBySeller = (items = []) => {
  const groups = new Map();
  for (const item of items) {
    const seller = item.product?.seller;
    const key = seller?.id ?? item.seller ?? 'unknown';
    if (!groups.has(key)) {
      groups.set(key, {
        sellerName: seller?.username || 'Seller',
        // Payment + contact details live on the product (open-air market).
        product: item.product || {},
        items: [],
        subtotal: 0,
      });
    }
    const g = groups.get(key);
    g.items.push(item);
    const unit = parseFloat(item.price_at_purchase ?? item.product?.price ?? 0) || 0;
    g.subtotal += unit * item.quantity;
  }
  return Array.from(groups.values());
};

const hasPaymentInfo = (p) =>
  !!(p?.mpesa_number || p?.till_number || p?.bank_details || p?.payment_instructions);

const PaymentLine = ({ icon, label, value }) => (
  <View style={styles.payLine}>
    <Ionicons name={icon} size={18} color={colors.success ?? '#2E8B57'} style={styles.payIcon} />
    <View style={{ flex: 1 }}>
      <Text style={styles.payLabel}>{label}</Text>
      <Text style={styles.payValue} selectable>{value}</Text>
    </View>
  </View>
);

const SellerGroup = ({ group, currency }) => {
  const { product } = group;
  // Each seller sets their own product currency; never assume the order's first.
  const gCurrency = product?.currency || currency;

  const openWhatsApp = () => {
    const num = (product.whatsapp_number || '').replace(/[^\d]/g, '');
    if (!num) return Alert.alert('Unavailable', 'This seller has no WhatsApp number.');
    Linking.openURL(`https://wa.me/${num}`).catch(() =>
      Alert.alert('Error', 'Could not open WhatsApp.'));
  };

  const callSeller = () => {
    const num = product.contact_number || product.whatsapp_number;
    if (!num) return Alert.alert('Unavailable', 'This seller has no phone number.');
    Linking.openURL(`tel:${num}`).catch(() =>
      Alert.alert('Error', 'Could not start the call.'));
  };

  return (
    <View style={styles.card}>
      <View style={styles.sellerHeader}>
        <Ionicons name="storefront-outline" size={18} color={colors.primary} />
        <Text style={styles.sellerName}>{group.sellerName}</Text>
      </View>

      {group.items.map((item, i) => (
        <View key={i} style={styles.lineItem}>
          <Text style={styles.lineItemName} numberOfLines={1}>{item.product?.title ?? 'Product'}</Text>
          <Text style={styles.lineItemQty}>×{item.quantity}</Text>
          <Text style={styles.lineItemTotal}>
            {formatPrice(item.quantity * (item.price_at_purchase ?? item.product?.price ?? 0), gCurrency)}
          </Text>
        </View>
      ))}

      <View style={styles.sellerSubtotalRow}>
        <Text style={styles.sellerSubtotalLabel}>Pay this seller</Text>
        <Text style={styles.sellerSubtotalValue}>{formatPrice(group.subtotal, gCurrency)}</Text>
      </View>

      {hasPaymentInfo(product) ? (
        <View style={styles.payBox}>
          {product.mpesa_number ? <PaymentLine icon="phone-portrait-outline" label="M-Pesa" value={product.mpesa_number} /> : null}
          {product.till_number ? <PaymentLine icon="card-outline" label="Till / Paybill" value={product.till_number} /> : null}
          {product.bank_details ? <PaymentLine icon="business-outline" label="Bank" value={product.bank_details} /> : null}
          {product.payment_instructions ? <PaymentLine icon="information-circle-outline" label="Instructions" value={product.payment_instructions} /> : null}
        </View>
      ) : (
        <Text style={styles.noPayNote}>
          This seller hasn’t listed payment details — contact them to arrange payment.
        </Text>
      )}

      <View style={styles.contactRow}>
        <TouchableOpacity style={[styles.contactBtn, styles.whatsappBtn]} onPress={openWhatsApp} activeOpacity={0.85}>
          <Ionicons name="logo-whatsapp" size={18} color="#fff" />
          <Text style={styles.contactBtnText}>WhatsApp</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.contactBtn, styles.callBtn]} onPress={callSeller} activeOpacity={0.85}>
          <Ionicons name="call-outline" size={18} color="#fff" />
          <Text style={styles.contactBtnText}>Call</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const Checkout = () => {
  const navigation = useNavigation();
  const { orderId } = useRoute().params;
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [address, setAddress] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiRequest('get', `/marketplace/orders/${orderId}/`);
        setOrder(data);
        setAddress(data?.shipping_address || '');
      } catch {
        Alert.alert('Error', 'Could not load order details.');
      } finally {
        setLoading(false);
      }
    })();
  }, [orderId]);

  const handleDone = useCallback(async () => {
    // Optionally save a delivery note/address for the seller's reference.
    if (address.trim()) {
      try {
        setSavingAddress(true);
        await apiRequest('post', `/marketplace/orders/${orderId}/set-shipping/`, {
          shipping_address: address.trim(),
        });
      } catch {
        // Non-fatal: the order still exists; the buyer has the seller's contact.
      } finally {
        setSavingAddress(false);
      }
    }
    navigation.replace('OrderHistory', { orderId });
  }, [address, orderId, navigation]);

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
  const sellerGroups = groupBySeller(order.items);
  // A single summed total only makes sense when every seller uses one currency.
  const currencies = [...new Set(sellerGroups.map((g) => g.product?.currency).filter(Boolean))];
  const mixedCurrency = currencies.length > 1;

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.banner}>
        <Ionicons name="hand-right-outline" size={20} color={colors.primary} />
        <Text style={styles.bannerText}>
          Pay each seller directly using their details below, then arrange delivery with them.
        </Text>
      </View>

      {sellerGroups.map((group, i) => (
        <SellerGroup key={i} group={group} currency={currency} />
      ))}

      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>Order total</Text>
        {mixedCurrency ? (
          <Text style={styles.totalNote}>See each seller above</Text>
        ) : (
          <Text style={styles.totalAmount}>{formatPrice(order.total_amount, currency)}</Text>
        )}
      </View>

      <Text style={styles.sectionTitle}>Delivery note (optional)</Text>
      <TextInput
        style={styles.input}
        placeholder="Address or delivery instructions to share with sellers..."
        placeholderTextColor={colors.placeholder}
        value={address}
        onChangeText={setAddress}
        multiline
      />

      <TouchableOpacity style={styles.doneButton} onPress={handleDone} disabled={savingAddress} activeOpacity={0.85}>
        {savingAddress
          ? <ActivityIndicator color={colors.white} />
          : <>
              <Ionicons name="checkmark-circle-outline" size={20} color={colors.white} />
              <Text style={styles.doneButtonText}>I’ve contacted the seller(s)</Text>
            </>}
      </TouchableOpacity>

      <View style={{ height: spacing.xxl }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', padding: spacing.md },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent', gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textMuted },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md,
    marginTop: spacing.md, marginBottom: spacing.sm,
  },
  bannerText: { ...typography.caption, color: colors.textSecondary, flex: 1, lineHeight: 18 },
  sectionTitle: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.sm },
  card: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md,
    ...shadows.sm, marginBottom: spacing.md,
  },
  sellerHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  sellerName: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  lineItem: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs, gap: spacing.xs },
  lineItemName: { ...typography.body, color: colors.textPrimary, flex: 1 },
  lineItemQty: { ...typography.caption, color: colors.textMuted, width: 28, textAlign: 'center' },
  lineItemTotal: { ...typography.label, color: colors.textPrimary, width: 72, textAlign: 'right' },
  sellerSubtotalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border,
  },
  sellerSubtotalLabel: { ...typography.label, color: colors.textSecondary },
  sellerSubtotalValue: { ...typography.h3, color: colors.primary },
  payBox: {
    backgroundColor: colors.inputBg ?? '#f5fbf7',
    borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.sm,
  },
  payLine: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.xs },
  payIcon: { marginRight: spacing.sm, marginTop: 2 },
  payLabel: { ...typography.caption, color: colors.textMuted },
  payValue: { ...typography.label, color: colors.textPrimary, fontWeight: '600' },
  noPayNote: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm, fontStyle: 'italic' },
  contactRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  contactBtn: {
    flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    gap: spacing.xs, height: 44, borderRadius: radius.md,
  },
  whatsappBtn: { backgroundColor: '#25D366' },
  callBtn: { backgroundColor: colors.primary },
  contactBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  totalCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md, ...shadows.sm,
  },
  totalLabel: { ...typography.h3, color: colors.textPrimary },
  totalAmount: { ...typography.h2, color: colors.primary },
  totalNote: { ...typography.caption, color: colors.textMuted, fontStyle: 'italic' },
  input: {
    backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md, color: colors.textPrimary,
    fontSize: 15, marginBottom: spacing.md, minHeight: 60, textAlignVertical: 'top',
  },
  doneButton: {
    backgroundColor: colors.primary, borderRadius: radius.md, height: 56,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    gap: spacing.sm, ...shadows.md,
  },
  doneButtonText: { ...typography.button, color: colors.white, fontSize: 17 },
});

export default Checkout;

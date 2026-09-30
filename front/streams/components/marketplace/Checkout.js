// After checkout: pay each seller directly. The order arrives with the cart's
// answer, so this opens at once; it is read again behind that. One card per
// seller (SellerPayCard) — what to pay them, in their currency, how, and a
// WhatsApp message already written to say it has been paid.
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { fetchOrderById, apiRequest } from '../../services/api';
import { useI18n } from '../../context/I18nContext';
import { colors, typography, spacing, radius, shadows } from '../../constants/theme';
import { formatTotals, orderTotals, groupBySeller } from '../../utils/market';
import SellerPayCard from './SellerPayCard';
import useMarketToast from './MarketToast';

const Checkout = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { orderId, order: given } = useRoute().params ?? {};
  const [order, setOrder] = useState(given || null);
  const [failed, setFailed] = useState(false);
  const [address, setAddress] = useState(given?.shipping_address || '');
  const [savingAddress, setSavingAddress] = useState(false);
  const [toast, showToast] = useMarketToast();

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const data = await fetchOrderById(orderId);
      setOrder(data);
      setAddress((a) => a || data?.shipping_address || '');
    } catch {
      setFailed(true);
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

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
    navigation.replace('OrderDetail', { orderId, order });
  }, [address, orderId, order, navigation]);

  if (!order) {
    return (
      <View style={styles.centered}>
        {failed ? (
          <>
            <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>{t('market.checkout.loadFailed')}</Text>
            <TouchableOpacity onPress={load}><Text style={styles.retry}>{t('common.retry')}</Text></TouchableOpacity>
          </>
        ) : <ActivityIndicator size="large" color={colors.primary} />}
      </View>
    );
  }

  const sellerGroups = groupBySeller(order.items);

  return (
    <View style={styles.flex}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.banner}>
          <Ionicons name="hand-right-outline" size={20} color={colors.primary} />
          <Text style={styles.bannerText}>
            {sellerGroups.length > 1
              ? t('market.checkout.payEachOf', { n: sellerGroups.length })
              : t('market.checkout.payTheSeller')}
          </Text>
        </View>

        {sellerGroups.map((group) => (
          <SellerPayCard key={String(group.sellerId)} group={group} orderId={order.id} onToast={showToast} />
        ))}

        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>{t('market.checkout.orderTotal')}</Text>
          <Text style={styles.totalAmount} testID="checkout-total">{formatTotals(orderTotals(order))}</Text>
        </View>

        <Text style={styles.sectionTitle}>{t('market.checkout.deliveryNoteOptional')}</Text>
        <TextInput
          style={styles.input}
          placeholder={t('market.checkout.addressPlaceholder')}
          placeholderTextColor={colors.placeholder}
          value={address}
          onChangeText={setAddress}
          multiline
        />

        <TouchableOpacity style={styles.doneButton} onPress={handleDone} disabled={savingAddress} activeOpacity={0.85} testID="checkout-done">
          {savingAddress
            ? <ActivityIndicator color={colors.white} />
            : <>
                <Ionicons name="checkmark-circle-outline" size={20} color={colors.white} />
                <Text style={styles.doneButtonText}>{t('market.checkout.done')}</Text>
              </>}
        </TouchableOpacity>

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
      {toast}
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  retry: { color: colors.primary, fontWeight: '700', marginTop: spacing.sm },
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

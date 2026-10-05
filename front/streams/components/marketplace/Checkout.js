// After checkout: pay each seller directly. The order arrives with the cart's
// answer, so this opens at once; it is read again behind that. One card per
// seller (SellerPayCard) — what to pay them, in their currency, how, and a
// WhatsApp message already written to say it has been paid.
//
// The delivery note goes to the sellers still to send (the server tells
// them). If it cannot be saved the buyer is told and stays here, rather than
// leaving believing the sellers have their address.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator,
} from 'react-native';
import KeyboardLift from '../tickets/KeyboardLift';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { fetchOrderById, apiRequest, getOrCreateConversation } from '../../services/api';
import { useI18n } from '../../context/I18nContext';
import { colors, typography, spacing, radius, shadows } from '../../constants/theme';
import {
  formatTotals, orderTotals, groupBySeller, marketError, chatAboutOrder,
} from '../../utils/market';
import SellerPayCard from './SellerPayCard';
import useMarketToast from './MarketToast';

const NOTE_MAX = 500;

const Checkout = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { orderId: paramId, order: given } = useRoute().params ?? {};
  const orderId = paramId ?? given?.id;
  const [order, setOrder] = useState(given || null);
  const [failed, setFailed] = useState(false);
  const [address, setAddress] = useState(given?.shipping_address || '');
  const [savingAddress, setSavingAddress] = useState(false);
  const [toast, showToast] = useMarketToast();
  const leaving = useRef(false);
  // The field being typed in stays above the keyboard (KeyboardLift).
  const kbScroll = useRef(null);

  const load = useCallback(async () => {
    setFailed(false);
    if (orderId == null) { setFailed(true); return; }
    try {
      const data = await fetchOrderById(orderId);
      setOrder(data);
      setAddress((a) => a || data?.shipping_address || '');
    } catch {
      setFailed(true);
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  const goToOrder = useCallback((latest) => {
    navigation.replace('OrderDetail', { orderId, order: latest });
  }, [navigation, orderId]);

  const handleDone = useCallback(async () => {
    // One tap, one save: a second before the first re-renders does nothing.
    if (leaving.current) return;
    leaving.current = true;
    const note = address.trim();
    // A delivery note, for the sellers: saved only when there is a new one.
    if (!note || note === (order?.shipping_address || '').trim()) {
      goToOrder(order);
      return;
    }
    setSavingAddress(true);
    try {
      const saved = await apiRequest('post', `/marketplace/orders/${orderId}/set-shipping/`, {
        shipping_address: note,
      });
      goToOrder(saved?.id ? saved : { ...order, shipping_address: note });
    } catch (e) {
      leaving.current = false;
      // Said, not swallowed: the sellers do not have it yet.
      showToast(marketError(e, t('market.checkout.noteFailed')), {
        error: true,
        action: { label: t('market.checkout.skipNote'), onPress: () => goToOrder(order) },
      });
    } finally {
      setSavingAddress(false);
    }
  }, [address, orderId, order, goToOrder, showToast, t]);

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
<KeyboardLift scrollRef={kbScroll}>
      <ScrollView ref={kbScroll} style={styles.container} showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Text style={styles.orderNumber} selectable testID="checkout-number">
          {t('market.order.number', { id: order.id ?? orderId })}
        </Text>
        <View style={styles.banner}>
          <Ionicons name="hand-right-outline" size={20} color={colors.primary} />
          <Text style={styles.bannerText}>
            {sellerGroups.length > 1
              ? t('market.checkout.payEachOf', { n: sellerGroups.length })
              : t('market.checkout.payTheSeller')}
          </Text>
        </View>

        {sellerGroups.map((group) => (
          <SellerPayCard
            key={String(group.sellerId)}
            group={group}
            orderId={order.id}
            onToast={showToast}
            onMessage={group.sellerId ? async () => {
              const ok = await chatAboutOrder(navigation, getOrCreateConversation,
                { id: group.sellerId, username: group.sellerName }, order.id,
                t('market.order.chatDraft', { id: order.id }));
              if (!ok) showToast(t('market.order.chatFailed'), { error: true });
            } : undefined}
          />
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
          maxLength={NOTE_MAX}
          multiline
          testID="checkout-note"
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
    </KeyboardLift>
      {toast}
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  retry: { color: colors.primary, fontWeight: '700', marginTop: spacing.sm },
  orderNumber: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.sm },
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

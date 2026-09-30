// One seller's part of an order, and how to pay them: the buyer pays each
// seller directly (M-Pesa, till, bank) and arranges delivery with them.
// Each number can be copied, and WhatsApp opens with a message already
// written — the order number, what was bought and what it comes to — so the
// seller knows at once which payment is which. The seller confirms payment
// for their own lines here too (that is what commits the stock).
import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Linking, TextInput,
} from 'react-native';
import { Image } from 'expo-image';
import Icon from 'react-native-vector-icons/FontAwesome';
import { useI18n } from '../../context/I18nContext';
import { clipboard } from '../../utils/optionalNative';
import {
  formatPrice, formatTotals, hasPaymentInfo, lineTitle, lineImage, lineCurrency, lineUnit,
} from '../../utils/market';

const PLACEHOLDER_IMAGE = require('../../assets/default-image.png');

/** The message a buyer sends a seller after paying them. */
export const paidMessage = (t, orderId, group) => t('market.pay.whatsappMessage', {
  id: orderId,
  items: group.items.filter((i) => !i.cancelled_at).map((i) => `${i.quantity}× ${lineTitle(i)}`).join(', '),
  amount: formatTotals(group.totals),
});

const PaymentLine = ({ icon, label, value, onCopy }) => (
  <View style={styles.payRow}>
    <Icon name={icon} size={16} color="#2E8B57" style={styles.payIcon} />
    <View style={styles.payTextWrap}>
      <Text style={styles.payLabel}>{label}</Text>
      <Text style={styles.payValue} selectable>{value}</Text>
    </View>
    {!!onCopy && (
      <TouchableOpacity
        onPress={() => onCopy(value, label)}
        style={styles.copyBtn}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
        testID={`copy-${label}`}
      >
        <Icon name="copy" size={14} color="#1D478B" />
      </TouchableOpacity>
    )}
  </View>
);

/** Where this seller's part has got to: 'cancelled' | 'delivered' | 'shipped'
 *  | 'paid' | 'waiting', with the seller's note when it was sent. */
export const partState = (group) => {
  const live = group.items.filter((i) => !i.cancelled_at);
  if (!live.length) return { state: 'cancelled' };
  const note = live.find((i) => i.tracking_note)?.tracking_note || '';
  if (live.every((i) => i.delivered_at)) return { state: 'delivered', note };
  if (live.every((i) => i.shipped_at || i.delivered_at)) return { state: 'shipped', note };
  if (live.every((i) => i.payment_confirmed_at)) return { state: 'paid' };
  return { state: 'waiting' };
};

export default function SellerPayCard({
  group, orderId, isMySale = false, isBuyer = false, orderOpen = true, onConfirm, confirming = false,
  onToast, onShip, onReceived, onCancelPart, acting = false,
}) {
  const { t } = useI18n();
  const { product } = group;
  const tell = (text, error = false) => onToast?.(text, { error });
  // Buyers pay off-platform, so this seller's own confirmation is the record.
  const confirmed = group.items.length > 0 && group.items.every((i) => i.payment_confirmed_at || i.cancelled_at);
  const { state, note } = partState(group);
  const [shipping, setShipping] = React.useState(false);
  const [shipNote, setShipNote] = React.useState('');
  const clip = clipboard();

  const copy = async (value, label) => {
    try {
      await clip.setStringAsync(String(value));
      tell(t('market.pay.copied', { what: label }));
    } catch {
      tell(t('common.error'), true);
    }
  };

  const openWhatsApp = () => {
    const num = (product.whatsapp_number || '').replace(/[^\d]/g, '');
    if (!num) return tell(t('market.checkout.noWhatsapp'), true);
    const text = encodeURIComponent(paidMessage(t, orderId, group));
    return Linking.openURL(`https://wa.me/${num}?text=${text}`)
      .catch(() => tell(t('market.checkout.whatsappFailed'), true));
  };

  const callSeller = () => {
    const num = product.contact_number || product.whatsapp_number;
    if (!num) return tell(t('market.checkout.noPhone'), true);
    return Linking.openURL(`tel:${num}`).catch(() => tell(t('market.checkout.callFailed'), true));
  };

  const onCopy = clip ? copy : null;

  return (
    <View style={styles.card} testID={`seller-${group.sellerId}`}>
      <View style={styles.sellerHeader}>
        <Icon name="shopping-bag" size={16} color="#1D478B" />
        <Text style={styles.sellerName}>{group.sellerName || t('market.seller.label')}</Text>
        {confirmed && state !== 'cancelled' ? (
          <View style={styles.paidPill}>
            <Icon name="check" size={11} color="#fff" />
            <Text style={styles.paidPillText}>{t('market.order.paid')}</Text>
          </View>
        ) : null}
      </View>

      {group.items.map((item) => {
        const image = lineImage(item);
        const currency = lineCurrency(item);
        return (
          <View key={item.id} style={styles.lineItem}>
            <Image
              source={image ? { uri: image } : PLACEHOLDER_IMAGE}
              placeholder={PLACEHOLDER_IMAGE}
              contentFit="cover"
              transition={150}
              style={styles.lineImage}
            />
            <View style={styles.lineTextWrap}>
              <Text style={[styles.lineTitle, !!item.cancelled_at && styles.lineOff]} numberOfLines={2}>
                {lineTitle(item) || t('market.unavailableProduct')}
              </Text>
              <Text style={styles.lineMeta}>
                {formatPrice(lineUnit(item), currency)} × {item.quantity}
              </Text>
            </View>
            <Text style={[styles.lineTotal, !!item.cancelled_at && styles.lineOff]}>
              {formatPrice(lineUnit(item) * item.quantity, currency)}
            </Text>
          </View>
        );
      })}

      {state !== 'cancelled' && (
      <View style={styles.subtotalRow}>
        <Text style={styles.subtotalLabel}>{t('market.checkout.payThisSeller')}</Text>
        <Text style={styles.subtotalValue} testID={`seller-total-${group.sellerId}`}>{formatTotals(group.totals)}</Text>
      </View>
      )}

      {/* Called off: nothing to pay, and no "I've paid" message to send. */}
      {state === 'cancelled' ? null : hasPaymentInfo(product) ? (
        <View style={styles.payBox}>
          {product.mpesa_number ? <PaymentLine icon="mobile" label={t('market.pay.mpesa')} value={product.mpesa_number} onCopy={onCopy} /> : null}
          {product.till_number ? <PaymentLine icon="credit-card" label={t('market.pay.till')} value={product.till_number} onCopy={onCopy} /> : null}
          {product.bank_details ? <PaymentLine icon="bank" label={t('market.pay.bank')} value={product.bank_details} onCopy={onCopy} /> : null}
          {product.payment_instructions ? <PaymentLine icon="info-circle" label={t('market.pay.instructions')} value={product.payment_instructions} /> : null}
        </View>
      ) : (
        <Text style={styles.noPayNote}>{t('market.pay.none')}</Text>
      )}

      {state !== 'cancelled' && (
      <View style={styles.contactRow}>
        <TouchableOpacity style={[styles.contactBtn, styles.whatsappBtn]} onPress={openWhatsApp} activeOpacity={0.85} testID="seller-whatsapp">
          <Icon name="whatsapp" size={16} color="#fff" />
          <Text style={styles.contactBtnText}>{t('market.checkout.whatsapp')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.contactBtn, styles.callBtn]} onPress={callSeller} activeOpacity={0.85}>
          <Icon name="phone" size={16} color="#fff" />
          <Text style={styles.contactBtnText}>{t('market.checkout.call')}</Text>
        </TouchableOpacity>
      </View>
      )}

      {/* Only this seller can confirm their own lines — that's what releases
          the stock, since no payment processor tells us the money landed. */}
      {isMySale && !confirmed && orderOpen && onConfirm ? (
        <TouchableOpacity
          style={[styles.confirmBtn, confirming && styles.confirmBtnDisabled]}
          onPress={onConfirm}
          disabled={confirming}
          activeOpacity={0.85}
          testID="order-confirm"
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

      {!isMySale && !confirmed && onConfirm && state !== 'cancelled' ? (
        <Text style={styles.awaitingNote}>{t('market.order.awaitingSeller')}</Text>
      ) : null}

      {/* Where this seller's part is, and what can be done with it now. */}
      {state !== 'waiting' && state !== 'paid' ? (
        <View style={styles.partState} testID={`part-${group.sellerId}-${state}`}>
          <Icon
            name={state === 'cancelled' ? 'times-circle' : state === 'delivered' ? 'check-circle' : 'truck'}
            size={14}
            color={state === 'cancelled' ? '#FF6347' : '#2E8B57'}
          />
          <Text style={styles.partStateText}>
            {t(`market.part.${state}`)}{note ? ` · ${note}` : ''}
          </Text>
        </View>
      ) : null}

      {isMySale && orderOpen && state === 'paid' && onShip ? (
        shipping ? (
          <View style={styles.shipBox}>
            <TextInput
              style={styles.shipInput}
              placeholder={t('market.part.notePlaceholder')}
              placeholderTextColor="#888"
              value={shipNote}
              onChangeText={setShipNote}
              maxLength={200}
              testID="ship-note"
            />
            <TouchableOpacity
              style={[styles.confirmBtn, acting && styles.confirmBtnDisabled]}
              onPress={() => onShip(shipNote.trim())}
              disabled={acting}
              testID="ship-send"
            >
              {acting ? <ActivityIndicator size="small" color="#fff" /> : (
                <Text style={styles.confirmBtnText}>{t('market.part.send')}</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.confirmBtn} onPress={() => setShipping(true)} testID="ship-open">
            <Icon name="truck" size={16} color="#fff" />
            <Text style={styles.confirmBtnText}>{t('market.part.markSent')}</Text>
          </TouchableOpacity>
        )
      ) : null}

      {isBuyer && state === 'shipped' && onReceived ? (
        <TouchableOpacity
          style={[styles.confirmBtn, acting && styles.confirmBtnDisabled]}
          onPress={onReceived}
          disabled={acting}
          testID="part-received"
        >
          <Icon name="check" size={16} color="#fff" />
          <Text style={styles.confirmBtnText}>{t('market.part.received')}</Text>
        </TouchableOpacity>
      ) : null}

      {/* The buyer, until the seller confirms payment; the seller, until sent. */}
      {onCancelPart && orderOpen && (
        (isBuyer && state === 'waiting') || (isMySale && (state === 'waiting' || state === 'paid'))
      ) ? (
        <TouchableOpacity onPress={onCancelPart} disabled={acting} style={styles.cancelLink} testID="part-cancel">
          <Text style={styles.cancelLinkText}>
            {isMySale ? t('market.part.cancelMine') : t('market.part.cancelThis')}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  copyBtn: { padding: 6, marginLeft: 6 },
  lineOff: { textDecorationLine: 'line-through', color: '#999' },
  partState: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10,
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#f2f7f4',
  },
  partStateText: { flex: 1, fontSize: 13, color: '#333' },
  shipBox: { marginTop: 10, gap: 8 },
  shipInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 14, color: '#333',
  },
  cancelLink: { alignSelf: 'center', paddingVertical: 10 },
  cancelLinkText: { color: '#FF6347', fontSize: 13, fontWeight: '600' },
  flex: { flex: 1 },
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


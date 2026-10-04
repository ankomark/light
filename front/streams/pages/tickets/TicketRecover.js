/**
 * Recover tickets on a new phone: the number that paid, and the receipt code
 * from the M-Pesa confirmation SMS. Both must match the same paid order on
 * the server. The order found is kept like any other and opened.
 */
import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import KeyboardLift from '../../components/tickets/KeyboardLift';
import { useI18n } from '../../context/I18nContext';
import { lookupOrder, cacheOrder, normalizeKePhone } from '../../services/tickets';
import { T, F, Kicker, GoldButton } from '../../components/tickets/TicketKit';
import { ticketErrorText } from './ticketText';

// M-Pesa receipt codes are ten letters and digits, e.g. SJK3H2L9QX.
export const isReceipt = (s) => /^[A-Z0-9]{10}$/.test(String(s || '').trim().toUpperCase());

const TicketRecover = ({ navigation }) => {
  const kbScroll = useRef(null);
  const { t } = useI18n();
  const [phone, setPhone] = useState('');
  const [receipt, setReceipt] = useState('');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const phoneOk = !!normalizeKePhone(phone);
  const receiptOk = isReceipt(receipt);

  const find = async () => {
    setChecked(true);
    if (!phoneOk || !receiptOk || busy) return;
    setBusy(true);
    setError('');
    try {
      const order = await lookupOrder({ phone, receipt });
      await cacheOrder(order);
      navigation.replace('TicketOrder', { reference: order.reference });
    } catch (err) {
      setError(err?.code === 'not_found' ? t('tix.notFound') : ticketErrorText(err, t));
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <KeyboardLift scrollRef={kbScroll}>
        <ScrollView ref={kbScroll} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Kicker>{t('tix.recover')}</Kicker>
          <Text style={styles.heading} accessibilityRole="header">{t('tix.recoverTitle')}</Text>
          <Text style={styles.body}>{t('tix.recoverBody')}</Text>

          <Text style={styles.label}>{t('tix.mpesaNumber')}</Text>
          <View style={[styles.field, checked && !phoneOk && styles.fieldBad]}>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="0712 345 678"
              placeholderTextColor={T.faint}
              keyboardType="phone-pad"
              autoComplete="tel"
              style={styles.input}
              maxLength={20}
              accessibilityLabel={t('tix.mpesaNumber')}
              testID="recover-phone"
            />
          </View>
          {checked && !phoneOk && <Text style={styles.bad}>{t('tix.phoneInvalid')}</Text>}

          <Text style={styles.label}>{t('tix.receiptLabel')}</Text>
          <View style={[styles.field, checked && !receiptOk && styles.fieldBad]}>
            <TextInput
              value={receipt}
              onChangeText={(v) => setReceipt(v.toUpperCase())}
              placeholder={t('tix.receiptPlaceholder')}
              placeholderTextColor={T.faint}
              autoCapitalize="characters"
              autoCorrect={false}
              style={[styles.input, styles.mono]}
              maxLength={12}
              accessibilityLabel={t('tix.receiptLabel')}
              testID="recover-receipt"
            />
          </View>
          {checked && !receiptOk && <Text style={styles.bad}>{t('tix.receiptInvalid')}</Text>}

          {!!error && (
            <View style={styles.error} accessibilityLiveRegion="polite">
              <Ionicons name="alert-circle" size={18} color={T.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </ScrollView>
        <View style={styles.bar}>
          <GoldButton label={t('tix.find')} onPress={find} busy={busy} testID="recover-find" />
        </View>
      </KeyboardLift>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  flex: { flex: 1 },
  scroll: { padding: 20, paddingTop: 22, width: '100%', maxWidth: 620, alignSelf: 'center' },
  heading: { fontFamily: F.display, fontSize: 32, lineHeight: 36, color: T.ivory, marginTop: 6 },
  body: { fontFamily: F.ui, fontSize: 15, lineHeight: 23, color: T.muted, marginTop: 10 },
  label: { fontFamily: F.uiBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: T.muted, marginTop: 26, marginBottom: 8 },
  field: {
    height: 54, borderRadius: 16, paddingHorizontal: 16, justifyContent: 'center',
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.line,
  },
  fieldBad: { borderColor: T.danger },
  input: { fontFamily: F.uiSemi, fontSize: 17, color: T.ivory, paddingVertical: 0 },
  mono: { letterSpacing: 2.5 },
  bad: { fontFamily: F.ui, fontSize: 13, color: T.danger, marginTop: 8, marginLeft: 4 },
  error: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 22, padding: 14, borderRadius: 14,
    backgroundColor: 'rgba(240,144,127,0.10)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(240,144,127,0.4)',
  },
  errorText: { flex: 1, fontFamily: F.uiSemi, fontSize: 14, lineHeight: 20, color: T.ivory },
  bar: {
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10,
    backgroundColor: T.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.lineStrong,
  },
});

export default TicketRecover;

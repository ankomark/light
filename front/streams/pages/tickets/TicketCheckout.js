/**
 * Checkout: the order as a ticket stub, the M-Pesa number, and Pay.
 *
 * Pay creates the order, which sends the M-Pesa prompt to that phone. The
 * order's `reference` is saved to the phone the moment it comes back — before
 * anything else — because it is the only key to the tickets; then the
 * waiting screen takes over (replacing this one, so Back from there returns to
 * the event with the same ticket still chosen).
 *
 * The number and name are remembered on the phone for next time.
 *
 * A gift to a fundraiser comes here too (`donation: { amount }` instead of a
 * ticket type): the same stub and prompt, a receipt instead of tickets.
 *
 * When the organiser shows supporters publicly, the buyer chooses whether
 * they appear by name (phone partly hidden). Off unless they turn it on:
 * nobody is listed by name without saying so.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView, Switch,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import KeyboardLift from '../../components/tickets/KeyboardLift';
import { useI18n } from '../../context/I18nContext';
import {
  createOrder, createDonation, saveReference, cacheOrder, normalizeKePhone, formatKes, formatWhen, readBuyer, saveBuyer,
} from '../../services/tickets';
import { T, F, Kicker, GoldButton } from '../../components/tickets/TicketKit';
import { ticketErrorText } from './ticketText';

const TicketCheckout = ({ navigation, route }) => {
  const kbScroll = useRef(null);
  const { t } = useI18n();
  const months = t('tix.months').split(',');
  const weekdays = t('tix.weekdays').split(',');
  const { event, ticketType, quantity, donation } = route.params;
  const total = donation ? donation.amount : ticketType.price * quantity;
  const [showName, setShowName] = useState(false);

  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const touched = useRef(false);
  useEffect(() => {
    readBuyer().then((b) => {
      // Never over what the buyer has started typing.
      if (touched.current) return;
      if (b.phone) setPhone(b.phone);
      if (b.name) setName(b.name);
    });
  }, []);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [showPhoneError, setShowPhoneError] = useState(false);
  const phoneOk = !!normalizeKePhone(phone);
  const phoneError = fieldErrors.phone || (showPhoneError && !phoneOk ? t('tix.phoneInvalid') : '');

  const pay = async () => {
    if (busy) return;
    if (!phoneOk) { setShowPhoneError(true); return; }
    setBusy(true);
    setError('');
    setFieldErrors({});
    try {
      const order = donation
        ? await createDonation({ slug: event.slug, amount: donation.amount, phone, name, showName })
        : await createOrder({ ticketType: ticketType.id, quantity, phone, name, showName });
      // The key to the tickets, kept before anything else can go wrong.
      await saveReference(order.reference);
      cacheOrder(order);
      saveBuyer({ phone, name });
      navigation.replace('TicketOrder', { reference: order.reference, fresh: true });
    } catch (err) {
      const fields = err?.fields || {};
      setFieldErrors(fields);
      // A problem with one field is shown under that field, not twice.
      // (Only the fields on this screen; a quantity or ticket-type problem
      // has nowhere else to show.)
      const shownBelow = !!err?.message && [fields.phone, fields.name].includes(err.message);
      setError(shownBelow ? '' : ticketErrorText(err, t));
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <KeyboardLift scrollRef={kbScroll}>
        <ScrollView ref={kbScroll} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Kicker>{t('tix.checkout')}</Kicker>
          <Text style={styles.heading} accessibilityRole="header">{t('tix.summary')}</Text>

          {/* The order as a stub: the event above the perforation, the sum below. */}
          <View style={styles.stub}>
            <View style={styles.stubTop}>
              {event.poster ? (
                <Image source={{ uri: event.poster }} style={styles.stubPoster} contentFit="cover"
                       cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
              ) : null}
              <View style={styles.flex}>
                <Text style={styles.stubTitle} numberOfLines={2}>{event.title}</Text>
                <Text style={styles.stubMeta}>{formatWhen(event.starts_at, { months, weekdays })}</Text>
                <Text style={styles.stubMeta} numberOfLines={1}>{[event.venue, event.city].filter(Boolean).join(', ')}</Text>
              </View>
            </View>
            <View style={styles.perf}>
              <View style={[styles.notch, styles.notchLeft]} />
              <View style={styles.dashes} />
              <View style={[styles.notch, styles.notchRight]} />
            </View>
            <View style={styles.stubLine}>
              <Text style={styles.stubItem}>{donation ? t('tix.fund.contribution') : `${quantity} × ${ticketType.name}`}</Text>
              <Text style={styles.stubItem}>{formatKes(donation ? donation.amount : ticketType.price)}</Text>
            </View>
            <View style={[styles.stubLine, styles.stubTotal]}>
              <Text style={styles.totalLabel}>{t('tix.total')}</Text>
              <Text style={styles.totalValue}>{formatKes(total)}</Text>
            </View>
          </View>

          <Text style={styles.label}>{t('tix.mpesaNumber')}</Text>
          <View style={[styles.field, !!phoneError && styles.fieldBad]}>
            <Text style={styles.prefix}>🇰🇪</Text>
            <TextInput
              value={phone}
              onChangeText={(v) => { touched.current = true; setPhone(v); setFieldErrors((f) => ({ ...f, phone: undefined })); }}
              onBlur={() => phone && setShowPhoneError(true)}
              placeholder="0712 345 678"
              placeholderTextColor={T.faint}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              style={styles.input}
              maxLength={20}
              accessibilityLabel={t('tix.mpesaNumber')}
              testID="checkout-phone"
            />
            {phoneOk && <Ionicons name="checkmark-circle" size={18} color={T.success} />}
          </View>
          <Text style={[styles.hint, !!phoneError && styles.bad]}>{phoneError || t('tix.mpesaHint')}</Text>

          <Text style={styles.label}>{t('tix.nameOnTicket')}</Text>
          <View style={styles.field}>
            <TextInput
              value={name}
              onChangeText={(v) => { touched.current = true; setName(v); }}
              placeholder={t('tix.namePlaceholder')}
              placeholderTextColor={T.faint}
              textContentType="name"
              autoComplete="name"
              autoCapitalize="words"
              style={styles.input}
              maxLength={120}
              accessibilityLabel={t('tix.nameOnTicket')}
              testID="checkout-name"
            />
          </View>
          {!!fieldErrors.name && <Text style={[styles.hint, styles.bad]}>{fieldErrors.name}</Text>}

          {/* Consent to appear on the public list: off until they say so. */}
          {!!event.show_supporters && (
            <View style={styles.consent}>
              <View style={styles.consentText}>
                <Text style={styles.consentTitle}>{t('tix.sup.consent')}</Text>
                <Text style={styles.consentHint}>{showName ? t('tix.sup.consentOn') : t('tix.sup.consentOff')}</Text>
              </View>
              <Switch value={showName} onValueChange={setShowName} trackColor={{ true: T.gold, false: T.raised }}
                      thumbColor={T.ivory} accessibilityLabel={t('tix.sup.consent')} testID="checkout-show-name" />
            </View>
          )}

          {!!error && (
            <View style={styles.error} accessibilityLiveRegion="polite">
              <Ionicons name="alert-circle" size={18} color={T.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </ScrollView>

        <View style={styles.bar}>
          <GoldButton
            label={t('tix.pay', { amount: formatKes(total) })}
            onPress={pay}
            busy={busy}
            testID="checkout-pay"
          />
          <View style={styles.secure}>
            <Ionicons name="lock-closed" size={12} color={T.faint} />
            <Text style={styles.secureText}>{t('tix.secure')}</Text>
          </View>
        </View>
      </KeyboardLift>
    </SafeAreaView>
  );
};

const NOTCH = 22;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  flex: { flex: 1 },
  scroll: { padding: 20, paddingTop: 22, width: '100%', maxWidth: 620, alignSelf: 'center' },
  heading: { fontFamily: F.display, fontSize: 32, lineHeight: 36, color: T.ivory, marginTop: 6, marginBottom: 18 },

  stub: { backgroundColor: T.paper, borderRadius: 22, overflow: 'hidden' },
  stubTop: { flexDirection: 'row', gap: 14, padding: 18 },
  stubPoster: { width: 64, height: 80, borderRadius: 10 },
  stubTitle: { fontFamily: F.display, fontSize: 23, lineHeight: 26, color: T.paperInk },
  stubMeta: { fontFamily: F.uiSemi, fontSize: 12.5, color: 'rgba(22,19,14,0.62)', marginTop: 4 },
  perf: { height: NOTCH, justifyContent: 'center' },
  dashes: {
    marginHorizontal: NOTCH, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(22,19,14,0.22)',
  },
  // Half-circles of the page's own colour, as if punched out of the stub.
  notch: { position: 'absolute', width: NOTCH, height: NOTCH, borderRadius: NOTCH / 2, backgroundColor: T.ink },
  notchLeft: { left: -NOTCH / 2 },
  notchRight: { right: -NOTCH / 2 },
  stubLine: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 6 },
  stubItem: { fontFamily: F.uiSemi, fontSize: 14, color: 'rgba(22,19,14,0.75)' },
  stubTotal: { paddingTop: 8, paddingBottom: 18 },
  totalLabel: { fontFamily: F.uiBold, fontSize: 12, letterSpacing: 1.6, textTransform: 'uppercase', color: 'rgba(22,19,14,0.55)', alignSelf: 'center' },
  totalValue: { fontFamily: F.display, fontSize: 30, lineHeight: 33, color: T.paperInk },

  consent: {
    flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 22, padding: 16, borderRadius: 16,
    backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.line,
  },
  consentText: { flex: 1 },
  consentTitle: { fontFamily: F.uiBold, fontSize: 14.5, color: T.ivory },
  consentHint: { fontFamily: F.ui, fontSize: 12.5, lineHeight: 18, color: T.muted, marginTop: 3 },
  label: { fontFamily: F.uiBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: T.muted, marginTop: 26, marginBottom: 8 },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10, height: 54, borderRadius: 16, paddingHorizontal: 16,
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.line,
  },
  fieldBad: { borderColor: T.danger },
  prefix: { fontSize: 18 },
  input: { flex: 1, fontFamily: F.uiSemi, fontSize: 17, color: T.ivory, paddingVertical: 0, letterSpacing: 0.4 },
  hint: { fontFamily: F.ui, fontSize: 13, color: T.faint, marginTop: 8, marginLeft: 4 },
  bad: { color: T.danger },

  error: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 22, padding: 14, borderRadius: 14,
    backgroundColor: 'rgba(240,144,127,0.10)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(240,144,127,0.4)',
  },
  errorText: { flex: 1, fontFamily: F.uiSemi, fontSize: 14, lineHeight: 20, color: T.ivory },

  bar: {
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10, gap: 10,
    backgroundColor: T.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.lineStrong,
  },
  secure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  secureText: { fontFamily: F.ui, fontSize: 12, color: T.faint },
});

export default TicketCheckout;

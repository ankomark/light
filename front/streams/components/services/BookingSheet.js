// Ask a service for a booking (a day, and a time if it matters) or a quote
// (say what for). The provider accepts or declines; both sides are told.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from '../BottomSheet';
import useKeyboardHeight from '../../hooks/useKeyboardHeight';
import { requestServiceBooking } from '../../services/api';
import { DAYS } from '../../services/servicesCatalog';
import { notify } from '../../utils/adminConfirm';
import { colors, typography, spacing, radius } from '../../constants/theme';

const DAYS_AHEAD = 14;
export const TIMES = ['', '09:00', '12:00', '15:00', '18:00'];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The next two weeks, as { iso, day: 'mon', date: 29, today?, tomorrow? }. */
export const nextDays = (from = new Date()) => Array.from({ length: DAYS_AHEAD }, (_, i) => {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
  return { iso: iso(d), day: DAYS[(d.getDay() + 6) % 7], date: d.getDate(), today: i === 0, tomorrow: i === 1 };
});

const BookingSheet = ({ visible, onClose, service, t, onSent, initialKind = 'booking' }) => {
  const kb = useKeyboardHeight();
  const days = useMemo(() => nextDays(), [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const [kind, setKind] = useState(initialKind);
  const [date, setDate] = useState(null);
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (visible) { setKind(initialKind); setDate(null); setTime(''); setNote(''); }
  }, [visible, initialKind]);

  const hours = service?.opening_hours || {};
  const ready = kind === 'booking' ? !!date : note.trim().length > 0;
  const send = async () => {
    setSending(true);
    try {
      const b = await requestServiceBooking(service.id, {
        kind, date: kind === 'booking' ? date : null, time: kind === 'booking' ? time : '', note: note.trim(),
      });
      onClose();
      notify(t('bookings.sentTitle'), t('bookings.sentBody', { name: service.name }));
      onSent?.(b);
    } catch (err) {
      const d = err?.data || {};
      notify(t('common.error'), d.error || Object.values(d).flat().find((v) => typeof v === 'string') || t('bookings.failed'));
    } finally {
      setSending(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} keyboardHeight={kb} heightRatio={0.8}
      header={(
        <View style={styles.head}>
          <TouchableOpacity onPress={onClose} hitSlop={8}><Text style={styles.cancel}>{t('common.cancel')}</Text></TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>{service?.name}</Text>
          <View style={{ width: 50 }} />
        </View>
      )}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" testID="booking-sheet">
        <View style={styles.kinds}>
          {['booking', 'quote'].map((k) => (
            <TouchableOpacity key={k} style={[styles.kind, kind === k && styles.kindOn]} onPress={() => setKind(k)}
              accessibilityRole="radio" accessibilityState={{ checked: kind === k }} testID={`booking-kind-${k}`}>
              <Ionicons name={k === 'booking' ? 'calendar' : 'pricetag'} size={16} color={kind === k ? colors.white : colors.textSecondary} />
              <Text style={[styles.kindText, kind === k && styles.kindTextOn]}>{t(`bookings.kind.${k}`)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {kind === 'booking' ? (
          <>
            <Text style={styles.label}>{t('bookings.day')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
              {days.map((d) => {
                const on = date === d.iso;
                const closed = Object.keys(hours).length > 0 && !hours[d.day];
                return (
                  <TouchableOpacity key={d.iso} style={[styles.day, on && styles.dayOn, closed && styles.dayClosed]}
                    onPress={() => setDate(d.iso)} testID={`booking-day-${d.iso}`} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                    <Text style={[styles.dayName, on && styles.dayTextOn]}>
                      {d.today ? t('bookings.today') : d.tomorrow ? t('bookings.tomorrow') : t(`services.dayShort.${d.day}`)}
                    </Text>
                    <Text style={[styles.dayDate, on && styles.dayTextOn]}>{d.date}</Text>
                    {closed ? <Text style={styles.closed}>{t('services.closed')}</Text> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <Text style={styles.label}>{t('bookings.time')}</Text>
            <View style={styles.times}>
              {TIMES.map((tm) => (
                <TouchableOpacity key={tm || 'any'} style={[styles.time, time === tm && styles.dayOn]} onPress={() => setTime(tm)}
                  testID={`booking-time-${tm || 'any'}`}>
                  <Text style={[styles.timeText, time === tm && styles.dayTextOn]}>{tm || t('bookings.anyTime')}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.label}>{kind === 'quote' ? t('bookings.quoteWhat') : t('bookings.note')}</Text>
        <TextInput style={styles.input} value={note} onChangeText={setNote} multiline maxLength={1000} textAlignVertical="top"
          placeholder={kind === 'quote' ? t('bookings.quotePlaceholder') : t('bookings.notePlaceholder')}
          placeholderTextColor={colors.placeholder} testID="booking-note" />

        <TouchableOpacity style={[styles.send, !ready && styles.sendOff]} onPress={send} disabled={!ready || sending} testID="booking-send">
          {sending ? <ActivityIndicator color={colors.white} /> : (
            <Text style={styles.sendText}>{kind === 'quote' ? t('bookings.sendQuote') : t('bookings.sendBooking')}</Text>
          )}
        </TouchableOpacity>
        <Text style={styles.hint}>{t('bookings.hint')}</Text>
      </ScrollView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  title: { ...typography.h3, color: colors.textPrimary, flex: 1, textAlign: 'center' },
  cancel: { ...typography.label, color: colors.textSecondary, width: 50 },
  body: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, gap: spacing.xs },
  kinds: { flexDirection: 'row', gap: spacing.sm },
  kind: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: spacing.sm + 2,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
  },
  kindOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  kindText: { ...typography.label, color: colors.textSecondary, fontWeight: '700' },
  kindTextOn: { color: colors.white },
  label: { ...typography.caption, color: colors.textSecondary, fontWeight: '800', textTransform: 'uppercase', marginTop: spacing.md },
  days: { gap: spacing.sm, paddingVertical: spacing.xs },
  day: {
    width: 64, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
  },
  dayOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayClosed: { opacity: 0.5 },
  dayName: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  dayDate: { ...typography.h3, color: colors.textPrimary },
  dayTextOn: { color: colors.white },
  closed: { ...typography.caption, color: colors.textMuted, fontSize: 9 },
  times: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  time: {
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
  },
  timeText: { ...typography.label, color: colors.textPrimary },
  input: {
    minHeight: 90, color: colors.textPrimary, fontSize: 15, backgroundColor: colors.inputBg, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border, marginTop: spacing.xs,
  },
  send: { backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.md },
  sendOff: { opacity: 0.45 },
  sendText: { ...typography.button, color: colors.white },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs },
});

export default BookingSheet;

/**
 * One event: its poster full-bleed, when and where, who hosts it, and the
 * ticket types to choose from. The total and the way on sit in a bar at the
 * foot that never scrolls away.
 *
 * The list's copy of the event (`preview`) paints the poster and title at
 * once; the full event, with ticket types and what is left of each, replaces
 * it a moment later.
 *
 * What is left is shown as the server last said. If it has changed by the
 * time of paying, checkout says so in the server's words ("Not enough
 * tickets left") — the server is the only judge of that.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../../context/I18nContext';
import useCachedData from '../../utils/useCachedData';
import { fetchEvent, formatKes, formatWhen, MAX_QUANTITY } from '../../services/tickets';
import { T, F, tap, Kicker, Pill, GoldButton, Notice } from '../../components/tickets/TicketKit';
import Supporters, { Progress, useLive } from '../../components/tickets/Supporters';
import { ticketErrorText } from './ticketText';

// "12 left" only once it is worth knowing; above this a count reads as noise.
const SCARCE = 25;

/** Why an event cannot be bought, as a strings key, or null when it can. */
export const closedReason = (event) => {
  if (!event) return null;
  if (event.status === 'cancelled') return 'tix.cancelled';
  if (event.on_sale) return null;
  const types = event.ticket_types || [];
  return types.length && types.every((tt) => tt.remaining <= 0) ? 'tix.soldOut' : 'tix.salesClosed';
};

const InfoLine = ({ icon, children }) => (
  <View style={styles.info}>
    <View style={styles.infoIcon}><Ionicons name={icon} size={16} color={T.champagne} /></View>
    <Text style={styles.infoText}>{children}</Text>
  </View>
);

const TicketEvent = ({ navigation, route }) => {
  const { t } = useI18n();
  const { width, height } = useWindowDimensions();
  const months = t('tix.months').split(',');
  const weekdays = t('tix.weekdays').split(',');
  const { slug, preview } = route.params;

  const full = useCachedData(`tix:event:${slug}`, () => fetchEvent(slug));
  // A link to a fundraiser (streams://events/<slug>) lands here first.
  useEffect(() => {
    if (full.data?.kind === 'fundraiser') navigation.replace('TicketFundraiser', { slug, preview: full.data });
  }, [full.data?.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  // A public total climbs while the page is open.
  useLive(() => full.reload(), undefined, !!full.data?.show_total);
  const event = full.data || preview || null;
  const types = full.data?.ticket_types || [];
  const reason = full.data ? closedReason(full.data) : null;
  const buyable = !!full.data && !reason;

  // The first type that can still be bought, until the buyer picks.
  const [pickedId, setPickedId] = useState(null);
  const firstOpen = types.find((tt) => tt.remaining > 0)?.id ?? null;
  const selected = types.find((tt) => tt.id === (pickedId ?? firstOpen)) || null;
  const most = selected ? Math.max(1, Math.min(MAX_QUANTITY, selected.remaining)) : 1;
  const [quantity, setQuantity] = useState(1);
  // A refresh can leave fewer than were chosen.
  useEffect(() => { if (quantity > most) setQuantity(most); }, [most, quantity]);

  const [aboutOpen, setAboutOpen] = useState(false);
  const total = selected ? selected.price * quantity : 0;
  const heroHeight = Math.min(width * 1.08, height * 0.58, 560);

  const go = () => {
    if (!selected || !event) return;
    navigation.push('TicketCheckout', {
      event: { slug, title: event.title, starts_at: event.starts_at, venue: event.venue, city: event.city, poster: event.poster },
      ticketType: { id: selected.id, name: selected.name, price: selected.price },
      quantity,
    });
  };

  const step = (by) => {
    const next = Math.max(1, Math.min(most, quantity + by));
    if (next !== quantity) { tap(); setQuantity(next); }
  };

  if (!event) {
    return (
      <View style={[styles.root, styles.centre]}>
        {full.failed ? (
          <Notice title={t('tix.eventFailed')} action={t('common.retry')} onAction={full.reload} />
        ) : (
          <ActivityIndicator color={T.gold} size="large" />
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={[styles.hero, { height: heroHeight }]}>
          {event.poster ? (
            <Image source={{ uri: event.poster }} style={StyleSheet.absoluteFill} contentFit="cover"
                   cachePolicy="memory-disk" transition={200} accessibilityIgnoresInvertColors />
          ) : (
            <LinearGradient colors={['#2A2418', T.ink]} style={StyleSheet.absoluteFill} />
          )}
          <LinearGradient
            colors={['rgba(10,10,13,0)', 'rgba(10,10,13,0.55)', T.ink]}
            locations={[0.35, 0.72, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroText}>
            {!!event.city && <Kicker>{event.city}</Kicker>}
            <Text style={styles.title} accessibilityRole="header">{event.title}</Text>
            {!!event.organiser && <Text style={styles.host}>{t('tix.hostedBy', { name: event.organiser })}</Text>}
          </View>
        </View>

        <View style={styles.body}>
          {!!reason && <Pill kind={reason === 'tix.cancelled' ? 'failed' : 'closed'} label={t(reason)} style={styles.reason} />}

          <View style={styles.card}>
            <InfoLine icon="calendar-outline">{formatWhen(event.starts_at, { months, weekdays })}</InfoLine>
            <View style={styles.divider} />
            <InfoLine icon="location-outline">{[event.venue, event.city].filter(Boolean).join(', ')}</InfoLine>
            {!!full.data?.sales_end_at && buyable && (
              <>
                <View style={styles.divider} />
                <InfoLine icon="time-outline">
                  {t('tix.salesEnd', { when: formatWhen(full.data.sales_end_at, { months, weekdays }) })}
                </InfoLine>
              </>
            )}
          </View>

          {!!full.data?.description && (
            <>
              <Kicker style={styles.kicker}>{t('tix.about')}</Kicker>
              <Text style={styles.about} numberOfLines={aboutOpen ? undefined : 5}>{full.data.description}</Text>
              {full.data.description.length > 260 && (
                <TouchableOpacity onPress={() => { tap(); setAboutOpen((o) => !o); }} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.more}>{aboutOpen ? t('tix.readLess') : t('tix.readMore')}</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {types.length > 0 && (
            <>
              <Kicker style={styles.kicker}>{t('tix.chooseTicket')}</Kicker>
              {types.map((tt) => {
                const gone = tt.remaining <= 0;
                const on = selected?.id === tt.id && buyable;
                return (
                  <TouchableOpacity
                    key={tt.id}
                    disabled={gone || !buyable}
                    onPress={() => { tap(); setPickedId(tt.id); setQuantity(1); }}
                    style={[styles.type, on && styles.typeOn, (gone || !buyable) && styles.typeOff]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on, disabled: gone || !buyable }}
                    accessibilityLabel={`${tt.name}, ${formatKes(tt.price)}${gone ? `, ${t('tix.soldOut')}` : ''}`}
                    testID={`ticket-type-${tt.id}`}
                  >
                    <View style={[styles.radio, on && styles.radioOn]}>{on && <View style={styles.radioDot} />}</View>
                    <View style={styles.flex}>
                      <Text style={styles.typeName}>{tt.name}</Text>
                      {gone ? (
                        <Text style={styles.typeNote}>{t('tix.soldOut')}</Text>
                      ) : tt.remaining <= SCARCE ? (
                        <Text style={[styles.typeNote, styles.scarce]}>{t('tix.left', { n: tt.remaining })}</Text>
                      ) : null}
                    </View>
                    <Text style={[styles.typePrice, gone && styles.strike]}>{formatKes(tt.price)}</Text>
                  </TouchableOpacity>
                );
              })}

              {buyable && !!selected && (
                <View style={styles.qtyRow}>
                  <Text style={styles.qtyLabel}>{t('tix.quantity')}</Text>
                  <View style={styles.stepper}>
                    <TouchableOpacity onPress={() => step(-1)} disabled={quantity <= 1} hitSlop={8}
                                      style={[styles.stepBtn, quantity <= 1 && styles.typeOff]}
                                      accessibilityRole="button" accessibilityLabel={t('tix.decrease')}>
                      <Ionicons name="remove" size={18} color={T.ivory} />
                    </TouchableOpacity>
                    <Text style={styles.qty} accessibilityLiveRegion="polite">{quantity}</Text>
                    <TouchableOpacity onPress={() => step(1)} disabled={quantity >= most} hitSlop={8}
                                      style={[styles.stepBtn, quantity >= most && styles.typeOff]}
                                      accessibilityRole="button" accessibilityLabel={t('tix.increase')}>
                      <Ionicons name="add" size={18} color={T.ivory} />
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </>
          )}

          {full.data?.raised != null && (
            <Progress raised={full.data.raised} supporters={full.data.supporters} style={styles.total} />
          )}
          {!!full.data?.show_supporters && (
            <Supporters slug={slug} count={full.data.supporters} style={styles.kicker}
                        onSeeAll={() => navigation.push('TicketSupporters', { slug, title: event.title })} />
          )}

          {!full.data && !full.failed && <ActivityIndicator style={styles.loading} color={T.gold} />}
          {!full.data && full.failed && (
            <Notice title={ticketErrorText(null, t, 'tix.eventFailed')} action={t('common.retry')} onAction={full.reload} />
          )}
        </View>
      </ScrollView>

      {buyable && (
        <View style={styles.bar}>
          <View>
            <Text style={styles.barLabel}>{t('tix.total')}</Text>
            <Text style={styles.barTotal}>{formatKes(total)}</Text>
          </View>
          <GoldButton label={t('tix.continue')} onPress={go} disabled={!selected} style={styles.barBtn} testID="ticket-continue" />
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  centre: { alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  scroll: { paddingBottom: 28 },

  hero: { width: '100%', justifyContent: 'flex-end', backgroundColor: T.surface },
  heroText: { paddingHorizontal: 20, paddingBottom: 6, width: '100%', maxWidth: 720, alignSelf: 'center' },
  title: { fontFamily: F.display, fontSize: 38, lineHeight: 41, color: T.ivory, marginTop: 6 },
  host: { fontFamily: F.uiSemi, fontSize: 13.5, color: T.muted, marginTop: 8 },

  body: { paddingHorizontal: 16, width: '100%', maxWidth: 720, alignSelf: 'center' },
  reason: { marginTop: 14, marginLeft: 4 },
  card: {
    marginTop: 18, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 4,
    backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.line,
  },
  info: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  infoIcon: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(232,212,170,0.08)',
  },
  infoText: { flex: 1, fontFamily: F.uiSemi, fontSize: 14.5, lineHeight: 20, color: T.ivory },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: T.line, marginLeft: 44 },

  kicker: { marginTop: 28, marginBottom: 12, marginLeft: 4 },
  about: { fontFamily: F.ui, fontSize: 15, lineHeight: 24, color: T.muted, paddingHorizontal: 4 },
  more: { fontFamily: F.uiBold, fontSize: 13.5, color: T.champagne, marginTop: 8, marginLeft: 4 },

  type: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, marginBottom: 10, borderRadius: 18,
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.line,
  },
  typeOn: { borderColor: T.gold, backgroundColor: 'rgba(201,164,92,0.08)' },
  typeOff: { opacity: 0.45 },
  radio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: T.lineStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOn: { borderColor: T.gold },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: T.gold },
  typeName: { fontFamily: F.uiBold, fontSize: 15.5, color: T.ivory },
  typeNote: { fontFamily: F.uiSemi, fontSize: 12.5, color: T.faint, marginTop: 3 },
  scarce: { color: T.champagne },
  typePrice: { fontFamily: F.uiHeavy, fontSize: 15.5, color: T.champagne },
  strike: { textDecorationLine: 'line-through', color: T.faint },

  qtyRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 8, paddingHorizontal: 4,
  },
  qtyLabel: { fontFamily: F.uiSemi, fontSize: 14.5, color: T.muted },
  stepper: {
    flexDirection: 'row', alignItems: 'center', gap: 6, padding: 4, borderRadius: 24,
    backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.line,
  },
  stepBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: T.raised },
  qty: { fontFamily: F.uiHeavy, fontSize: 17, color: T.ivory, minWidth: 34, textAlign: 'center' },

  loading: { marginTop: 30 },
  total: { marginTop: 24 },

  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16,
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 12,
    backgroundColor: T.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.lineStrong,
  },
  barLabel: { fontFamily: F.uiBold, fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase', color: T.faint },
  barTotal: { fontFamily: F.display, fontSize: 28, lineHeight: 32, color: T.ivory },
  barBtn: { flex: 1, maxWidth: 240 },
});

export default TicketEvent;

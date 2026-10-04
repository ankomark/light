/**
 * A fundraiser: the story, how far it has come, and Give.
 *
 * Any whole-shilling amount, typed or one of the suggested ones, paid with
 * the same M-Pesa prompt as a ticket; the giver gets a receipt, not a ticket.
 * The total (and the supporters list) shows only when the organiser made it
 * public, and climbs while the page is open — re-read every 10 s.
 */
import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import KeyboardLift from '../../components/tickets/KeyboardLift';
import { useI18n } from '../../context/I18nContext';
import { fetchEvent, formatKes, formatWhen, DEFAULT_SUGGESTED, MIN_GIFT, MAX_GIFT } from '../../services/tickets';
import { T, F, tap, Kicker, Pill, GoldButton, Notice } from '../../components/tickets/TicketKit';
import Supporters, { Progress, useLive } from '../../components/tickets/Supporters';
import { wholeNumber } from './eventDraft';
import { ticketErrorText } from './ticketText';

export const CATEGORY_ICON = {
  education: 'school-outline', medical: 'medkit-outline', wedding: 'heart-outline', funeral: 'flower-outline',
  church: 'home-outline', community: 'people-outline', business: 'briefcase-outline', other: 'sparkles-outline',
};
export const CATEGORIES = Object.keys(CATEGORY_ICON);

const TicketFundraiser = ({ navigation, route }) => {
  const kbScroll = useRef(null);
  const { t } = useI18n();
  const { width, height } = useWindowDimensions();
  const months = t('tix.months').split(',');
  const weekdays = t('tix.weekdays').split(',');
  const { slug, preview } = route.params;

  const [event, setEvent] = useState(preview || null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  useLive(async () => {
    try {
      setEvent(await fetchEvent(slug));
      setLoaded(true);
      setError(null);
    } catch (err) {
      if (!loaded) setError(err);
    }
  });

  const [amount, setAmount] = useState('');
  const [picked, setPicked] = useState(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const value = picked ?? wholeNumber(amount);
  const valid = value >= MIN_GIFT && value <= MAX_GIFT;
  const typedBad = !!amount && !valid && picked == null;

  if (!event) {
    return (
      <View style={[styles.root, styles.centre]}>
        {error ? <Notice title={ticketErrorText(error, t)} action={t('common.retry')} onAction={() => setError(null)} />
          : <ActivityIndicator color={T.gold} size="large" />}
      </View>
    );
  }

  const suggested = (event.suggested_amounts?.length ? event.suggested_amounts : DEFAULT_SUGGESTED).slice(0, 6);
  const open = loaded && event.on_sale;
  const heroHeight = Math.min(width * 1.0, height * 0.5, 520);

  const give = () => {
    if (!valid) return;
    navigation.push('TicketCheckout', {
      event: {
        slug, title: event.title, starts_at: event.starts_at, venue: event.venue, city: event.city,
        poster: event.poster, kind: 'fundraiser', show_supporters: event.show_supporters,
      },
      donation: { amount: value },
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <KeyboardLift scrollRef={kbScroll}>
      <ScrollView ref={kbScroll} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={[styles.hero, { height: heroHeight }]}>
          {event.poster ? (
            <Image source={{ uri: event.poster }} style={StyleSheet.absoluteFill} contentFit="cover"
                   cachePolicy="memory-disk" transition={200} accessibilityIgnoresInvertColors />
          ) : (
            <LinearGradient colors={['#2A2418', T.ink]} style={StyleSheet.absoluteFill} />
          )}
          <LinearGradient colors={['rgba(10,10,13,0)', 'rgba(10,10,13,0.55)', T.ink]} locations={[0.35, 0.72, 1]}
                          style={StyleSheet.absoluteFill} />
          <View style={styles.heroText}>
            {!!event.category && (
              <View style={styles.cause}>
                <Ionicons name={CATEGORY_ICON[event.category] || 'sparkles-outline'} size={14} color={T.champagne} />
                <Kicker>{t(`tix.cat.${event.category}`)}</Kicker>
              </View>
            )}
            <Text style={styles.title} accessibilityRole="header">{event.title}</Text>
            {!!event.organiser && <Text style={styles.host}>{t('tix.fund.by', { name: event.organiser })}</Text>}
          </View>
        </View>

        <View style={styles.body}>
          {loaded && !event.on_sale && <Pill kind="closed" label={t('tix.fund.closed')} style={styles.closed} />}

          <Progress raised={event.raised} goal={event.goal_amount} supporters={event.supporters} style={styles.progress} />
          {!!event.ends_at && (
            <Text style={styles.ends}>{t('tix.fund.ends', { when: formatWhen(event.ends_at, { months, weekdays }) })}</Text>
          )}

          {!!event.description && (
            <>
              <Kicker style={styles.kicker}>{t('tix.fund.story')}</Kicker>
              <Text style={styles.story} numberOfLines={aboutOpen ? undefined : 8}>{event.description}</Text>
              {event.description.length > 400 && (
                <TouchableOpacity onPress={() => { tap(); setAboutOpen((o) => !o); }} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.more}>{aboutOpen ? t('tix.readLess') : t('tix.readMore')}</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {open && (
            <>
              <Kicker style={styles.kicker}>{t('tix.fund.give')}</Kicker>
              <View style={styles.amounts}>
                {suggested.map((n) => {
                  const on = picked === n;
                  return (
                    <TouchableOpacity key={n} onPress={() => { tap(); setPicked(on ? null : n); setAmount(''); }}
                                      style={[styles.amount, on && styles.amountOn]} accessibilityRole="radio"
                                      accessibilityState={{ checked: on }} testID={`give-${n}`}>
                      <Text style={[styles.amountText, on && styles.amountTextOn]}>{formatKes(n)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={[styles.field, typedBad && styles.fieldBad]}>
                <Text style={styles.prefix}>KES</Text>
                <TextInput value={amount} onChangeText={(v) => { setAmount(v.replace(/[^\d]/g, '')); setPicked(null); }}
                           placeholder={t('tix.fund.other')} placeholderTextColor={T.faint} keyboardType="number-pad"
                           maxLength={6} style={styles.input} accessibilityLabel={t('tix.fund.other')} testID="give-amount" />
              </View>
              {typedBad && (
                <Text style={styles.bad}>{t('tix.fund.range', { min: formatKes(MIN_GIFT), max: formatKes(MAX_GIFT) })}</Text>
              )}
            </>
          )}

          <Supporters slug={slug} count={event.supporters} style={styles.kicker}
                      onSeeAll={() => navigation.push('TicketSupporters', { slug, title: event.title })} />
        </View>
      </ScrollView>

      {open && (
        <View style={styles.bar}>
          <GoldButton label={valid ? t('tix.fund.giveAmount', { amount: formatKes(value) }) : t('tix.fund.choose')}
                      onPress={give} disabled={!valid} testID="give-continue" />
        </View>
      )}
      </KeyboardLift>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  centre: { alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: 30 },
  hero: { width: '100%', justifyContent: 'flex-end', backgroundColor: T.surface },
  heroText: { paddingHorizontal: 20, paddingBottom: 6, width: '100%', maxWidth: 720, alignSelf: 'center' },
  cause: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontFamily: F.display, fontSize: 36, lineHeight: 39, color: T.ivory, marginTop: 6 },
  host: { fontFamily: F.uiSemi, fontSize: 13.5, color: T.muted, marginTop: 8 },
  body: { paddingHorizontal: 16, width: '100%', maxWidth: 720, alignSelf: 'center' },
  closed: { marginTop: 14, marginLeft: 4 },
  progress: { marginTop: 18 },
  ends: { fontFamily: F.uiSemi, fontSize: 13, color: T.muted, marginTop: 10, marginLeft: 4 },
  kicker: { marginTop: 28, marginBottom: 12, marginLeft: 4 },
  story: { fontFamily: F.ui, fontSize: 15, lineHeight: 24, color: T.muted, paddingHorizontal: 4 },
  more: { fontFamily: F.uiBold, fontSize: 13.5, color: T.champagne, marginTop: 8, marginLeft: 4 },
  amounts: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  amount: {
    flexGrow: 1, minWidth: '30%', paddingVertical: 14, borderRadius: 16, alignItems: 'center',
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.line,
  },
  amountOn: { backgroundColor: T.champagne, borderColor: T.champagne },
  amountText: { fontFamily: F.uiHeavy, fontSize: 15, color: T.ivory },
  amountTextOn: { color: T.paperInk },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, height: 54, borderRadius: 16, paddingHorizontal: 16,
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.line,
  },
  fieldBad: { borderColor: T.danger },
  prefix: { fontFamily: F.uiBold, fontSize: 14, color: T.faint },
  input: { flex: 1, fontFamily: F.uiSemi, fontSize: 17, color: T.ivory, paddingVertical: 0 },
  bad: { fontFamily: F.ui, fontSize: 13, color: T.danger, marginTop: 8, marginLeft: 4 },
  bar: {
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10,
    backgroundColor: T.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.lineStrong,
  },
});

export default TicketFundraiser;

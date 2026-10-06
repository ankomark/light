/**
 * Events: what is on sale, soonest first, from the ticketing server.
 *
 * The soonest event leads as a full poster; the rest follow as rows. Search
 * and the city chips ask the server (`?search=`, `?city=`); more pages load as
 * the list nears its end (`next`).
 *
 * The unfiltered first page is kept on the phone and painted at once on the
 * next open, then refreshed behind it — the app's usual pattern.
 *
 * Opening this screen also asks again about any order left waiting for
 * M-Pesa (the app may have closed mid-payment), so a paid ticket turns up in
 * My tickets without the buyer having to do anything.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, RefreshControl, ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../../context/I18nContext';
import { peekCache, readCache, writeCache } from '../../utils/screenCache';
import {
  fetchEvents, formatKes, formatWhen, dateTile, refreshSavedOrders, useSavedOrders,
} from '../../services/tickets';
import { hasSession } from '../../services/ticketsOrganiser';
import {
  T, F, tap, Kicker, DateTile, Pill, Notice, bannerRatio, bannerHeight, isWideBanner, BANNER_FALLBACK,
} from '../../components/tickets/TicketKit';
import { ticketErrorText } from './ticketText';

const CACHE_KEY = 'tix:events';
const KEEP_MS = 3 * 24 * 60 * 60 * 1000;
const SEARCH_WAIT_MS = 350;

/** The page number in a `next` link, or null at the end. */
export const nextPage = (next) => {
  if (!next) return null;
  const m = /[?&]page=(\d+)/.exec(next);
  return m ? Number(m[1]) : null;
};

const mergeBySlug = (a, b) => {
  const seen = new Set(a.map((e) => e.slug));
  return a.concat(b.filter((e) => !seen.has(e.slug)));
};

/** Events or fundraisers for a search and city, a page at a time. */
const useEvents = (search, city, kind) => {
  const plain = !search && !city;
  const cacheKey = `${CACHE_KEY}:${kind}`;
  const fromCache = (key) => {
    const kept = peekCache(key);
    return { items: kept?.results || [], next: kept?.next || null, loading: !kept, failed: false, more: false };
  };
  const [state, setState] = useState(() => (plain ? fromCache(cacheKey) : fromCache(null)));
  const run = useRef(0);

  const load = useCallback(async () => {
    const id = ++run.current;
    setState((s) => ({ ...s, failed: false, loading: !s.items.length || !plain }));
    if (plain && !peekCache(cacheKey)) {
      const kept = await readCache(cacheKey, KEEP_MS);
      if (id === run.current && kept) setState((s) => ({ ...s, items: kept.results, next: kept.next, loading: false }));
    }
    try {
      const page = await fetchEvents({ search, city, kind });
      if (id !== run.current) return;
      setState({ items: page.results || [], next: page.next, loading: false, failed: false, more: false });
      if (plain) writeCache(cacheKey, { results: page.results || [], next: page.next });
    } catch (err) {
      if (id === run.current) setState((s) => ({ ...s, loading: false, failed: true, error: err }));
    }
  }, [search, city, kind, plain, cacheKey]);

  useEffect(() => {
    // A new search, or the other tab, starts from its own rows (kept, for the
    // plain list) rather than the last one's.
    setState(plain ? fromCache(cacheKey) : { items: [], next: null, loading: true, failed: false, more: false });
    load();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(async () => {
    const page = nextPage(state.next);
    if (!page || state.more || state.loading) return;
    const id = run.current;
    setState((s) => ({ ...s, more: true }));
    try {
      const res = await fetchEvents({ search, city, kind, page });
      if (id !== run.current) return;
      setState((s) => ({ ...s, items: mergeBySlug(s.items, res.results || []), next: res.next, more: false }));
    } catch {
      if (id === run.current) setState((s) => ({ ...s, more: false }));
    }
  }, [state.next, state.more, state.loading, search, city, kind]);

  return { ...state, reload: load, loadMore };
};

const Poster = ({ uri, title, style }) => (uri ? (
  <Image source={{ uri }} style={style} contentFit="cover" cachePolicy="memory-disk" transition={180}
         recyclingKey={uri} accessibilityIgnoresInvertColors />
) : (
  // No poster: the event's initial, engraved on a dark card.
  <LinearGradient colors={['#2A2418', '#141210']} style={[style, styles.posterBlank]}>
    <Text style={styles.posterInitial}>{(title || '?').trim().charAt(0).toUpperCase()}</Text>
  </LinearGradient>
));

const TicketsHome = ({ navigation }) => {
  const { t } = useI18n();
  const { width, height } = useWindowDimensions();
  const months = t('tix.months').split(',');
  const weekdays = t('tix.weekdays').split(',');

  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setSearch(typed.trim()), SEARCH_WAIT_MS);
    return () => clearTimeout(id);
  }, [typed]);
  const [city, setCity] = useState(null);
  // Events (tickets) or fundraisers (gifts): the same list, a tab apart.
  const [kind, setKind] = useState('event');
  const fund = kind === 'fundraiser';

  const events = useEvents(search, city, kind);
  const saved = useSavedOrders();
  useEffect(() => { refreshSavedOrders(); }, []);
  // Whether My events can open straight away, or must ask for a sign-in first.
  const [organiser, setOrganiser] = useState(false);
  // Asked again whenever this screen is back in front: signing in happens on
  // a screen pushed over this one, which stays mounted underneath.
  useEffect(() => {
    const check = () => { hasSession().then(setOrganiser).catch(() => {}); };
    check();
    return navigation.addListener?.('focus', check);
  }, [navigation]);

  // Cities seen in the unfiltered list, so choosing one does not hide the rest.
  const cities = useRef([]);
  if (!search && !city && events.items.length) {
    cities.current = [...new Set(events.items.map((e) => e.city).filter(Boolean))].sort();
  }

  const [pulling, setPulling] = useState(false);
  const pull = useCallback(async () => {
    setPulling(true);
    try { await events.reload(); } finally { setPulling(false); }
  }, [events]);

  const open = useCallback((event) => {
    tap();
    navigation.push(event.kind === 'fundraiser' ? 'TicketFundraiser' : 'TicketEvent', { slug: event.slug, preview: event });
  }, [navigation]);
  // A fundraiser's line: how far it has come when the total is public, else
  // an invitation to give.
  const fundLine = (e) => (e.raised != null
    ? (e.goal_amount ? t('tix.fund.raisedOf', { raised: formatKes(e.raised), goal: formatKes(e.goal_amount) })
      : t('tix.fund.raisedOnly', { raised: formatKes(e.raised) }))
    : t('tix.fund.giveMpesa'));
  const pctOf = (e) => (e.raised != null && e.goal_amount ? Math.min(100, (e.raised / e.goal_amount) * 100) : null);
  // Said in words, not left to the poster: not everyone knows a card opens
  // the page where tickets are bought or a gift is given.
  const cta = (e, big = false) => (e.on_sale ? (
    <TouchableOpacity onPress={() => open(e)} style={[styles.cta, big && styles.ctaBig]} accessibilityRole="button"
                      accessibilityLabel={`${e.kind === 'fundraiser' ? t('tix.cta.give') : t('tix.cta.tickets')}: ${e.title}`}
                      testID={`cta-${e.slug}`}>
      <Ionicons name={e.kind === 'fundraiser' ? 'heart' : 'ticket'} size={big ? 15 : 13} color={T.paperInk} />
      <Text style={[styles.ctaText, big && styles.ctaTextBig]}>
        {e.kind === 'fundraiser' ? t('tix.cta.give') : t('tix.cta.tickets')}
      </Text>
    </TouchableOpacity>
  ) : null);
  const kindOf = (e) => (e.kind === 'fundraiser'
    ? [e.category ? t(`tix.cat.${e.category}`) : '', e.organiser].filter(Boolean).join(' · ')
    : formatWhen(e.starts_at, { months, weekdays }));

  const featured = !search && !city ? events.items[0] : null;
  const rows = featured ? events.items.slice(1) : events.items;
  const priceLine = (e) => (e.on_sale && e.min_price != null ? t('tix.from', { price: formatKes(e.min_price) }) : null);
  // The list does not say why an event is off sale (it carries no `remaining`
  // or sales end), and "Sales closed" is true either way; the event page,
  // which has both, says which.
  const closedLabel = (e) => (e.on_sale ? null : t('tix.salesClosed'));

  const heroWidth = Math.min(width, 720) - 32;
  // The lead banner at its own shape. Portrait: text over it, as before (and
  // tall enough to hold that text). Landscape: the whole picture, then the
  // words beneath it on the card - over a short wide picture they covered it.
  const heroRatio = featured?.poster ? bannerRatio(featured) : BANNER_FALLBACK;
  const heroWide = !!featured?.poster && isWideBanner(heroRatio);
  const heroImageH = heroWide
    ? bannerHeight(heroWidth, heroRatio, { maxHeight: height * 0.5 })
    : bannerHeight(heroWidth, heroRatio, { minHeight: heroWidth * 1.05, maxHeight: Math.min(heroWidth * 1.6, height * 0.72) });

  const header = (
    <View>
      <View style={styles.top}>
        <View style={styles.flex}>
          <Kicker>{t('tix.title')}</Kicker>
          <Text style={styles.heading} accessibilityRole="header">{t('tix.heading')}</Text>
        </View>
        <TouchableOpacity
          onPress={() => { tap(); navigation.push('MyTickets'); }}
          style={styles.myBtn}
          accessibilityRole="button"
          accessibilityLabel={t('tix.myTickets')}
          testID="my-tickets"
        >
          <Ionicons name="ticket-outline" size={17} color={T.champagne} />
          <Text style={styles.myText}>{t('tix.myTickets')}</Text>
          {!!saved?.length && <View style={styles.myCount}><Text style={styles.myCountText}>{saved.length}</Text></View>}
        </TouchableOpacity>
      </View>

      <View style={styles.search}>
        <Ionicons name="search" size={17} color={T.faint} />
        <TextInput
          value={typed}
          onChangeText={setTyped}
          placeholder={t('tix.searchPlaceholder')}
          placeholderTextColor={T.faint}
          style={styles.searchInput}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel={t('tix.searchPlaceholder')}
        />
        {!!typed && (
          <TouchableOpacity onPress={() => setTyped('')} hitSlop={10} accessibilityRole="button">
            <Ionicons name="close-circle" size={17} color={T.faint} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.kinds} accessibilityRole="tablist">
        {['event', 'fundraiser'].map((k) => (
          <TouchableOpacity key={k} onPress={() => { if (k !== kind) { tap(); setKind(k); setCity(null); } }}
                            style={[styles.kind, kind === k && styles.kindOn]} accessibilityRole="tab"
                            accessibilityState={{ selected: kind === k }} testID={`kind-${k}`}>
            <Ionicons name={k === 'event' ? 'ticket-outline' : 'heart-outline'} size={15}
                      color={kind === k ? T.paperInk : T.muted} />
            <Text style={[styles.kindText, kind === k && styles.kindTextOn]}>{t(`tix.kind.${k}s`)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* The organiser's way in. TicketHost checks for an account first. */}
      <View style={styles.host}>
        <Text style={styles.hostText} numberOfLines={2}>{t('tix.hostPrompt')}</Text>
        {/* Always there, so an organiser can find their events; signed out,
            it asks them to sign in first and then goes on to them. */}
        <TouchableOpacity
          onPress={() => {
            tap();
            if (organiser) navigation.push('TicketMyEvents');
            else navigation.push('TicketHost', { next: 'TicketMyEvents' });
          }}
          style={styles.mineBtn}
          accessibilityRole="button"
          testID="my-events"
        >
          <Text style={styles.mineBtnText}>{t('tix.mine.title')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => { tap(); navigation.push('TicketHost'); }}
          style={styles.hostBtn}
          accessibilityRole="button"
          testID="open-event"
        >
          <Ionicons name="add" size={16} color={T.paperInk} />
          <Text style={styles.hostBtnText}>{t('tix.openEvent')}</Text>
        </TouchableOpacity>
      </View>

      {cities.current.length > 1 && (
        <FlatList
          horizontal
          data={[null, ...cities.current]}
          keyExtractor={(c) => c || '*'}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          renderItem={({ item: c }) => {
            const on = c === city;
            return (
              <TouchableOpacity
                onPress={() => { tap(); setCity(c); }}
                style={[styles.chip, on && styles.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{c || t('tix.allCities')}</Text>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {!!featured && (
        <>
          <Kicker style={styles.sectionKicker}>{t('tix.featured')}</Kicker>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => open(featured)}
            style={[styles.hero, { width: heroWidth }, !heroWide && { height: heroImageH }]}
            accessibilityRole="button"
            accessibilityLabel={`${featured.title}, ${kindOf(featured)}`}
            testID={heroWide ? 'hero-wide' : 'hero-tall'}
          >
            <View style={heroWide ? { height: heroImageH } : StyleSheet.absoluteFill}>
              <Poster uri={featured.poster} title={featured.title} style={StyleSheet.absoluteFill} />
              {!heroWide && (
                <LinearGradient
                  colors={['rgba(10,10,13,0)', 'rgba(10,10,13,0.35)', 'rgba(10,10,13,0.96)']}
                  locations={[0.25, 0.55, 1]}
                  style={StyleSheet.absoluteFill}
                />
              )}
              <View style={styles.heroTop}>
                {fund ? <View /> : <DateTile {...dateTile(featured.starts_at, months)} />}
                {!!closedLabel(featured) && <Pill label={closedLabel(featured)} />}
              </View>
            </View>
            <View style={heroWide ? styles.heroBelow : styles.heroText}>
              {fund ? (!!featured.category && <Kicker>{t(`tix.cat.${featured.category}`)}</Kicker>)
                : (!!featured.city && <Kicker>{featured.city}</Kicker>)}
              <Text style={styles.heroTitle} numberOfLines={3}>{featured.title}</Text>
              <Text style={styles.heroMeta} numberOfLines={1}>
                {fund ? featured.organiser : `${formatWhen(featured.starts_at, { months, weekdays })}  ·  ${featured.venue}`}
              </Text>
              {fund ? (
                <>
                  <Text style={styles.heroPrice}>{fundLine(featured)}</Text>
                  {pctOf(featured) != null && (
                    <View style={styles.heroTrack}><View style={[styles.heroFill, { width: `${pctOf(featured)}%` }]} /></View>
                  )}
                </>
              ) : (!!priceLine(featured) && <Text style={styles.heroPrice}>{priceLine(featured)}</Text>)}
              <View style={styles.heroCta}>{cta(featured, true)}</View>
            </View>
          </TouchableOpacity>
        </>
      )}

      {rows.length > 0 && !!featured && <Kicker style={styles.sectionKicker}>{t('tix.more')}</Kicker>}
    </View>
  );

  const renderRow = ({ item: e }) => (
    <TouchableOpacity
      onPress={() => open(e)}
      style={styles.row}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${e.title}, ${kindOf(e)}`}
    >
      <Poster uri={e.poster} title={e.title}
              style={e.poster && isWideBanner(bannerRatio(e)) ? styles.thumbWide : styles.thumb} />
      <View style={styles.rowBody}>
        <Text style={styles.rowWhen} numberOfLines={1}>
          {e.kind === 'fundraiser' ? (e.category ? t(`tix.cat.${e.category}`) : '') : formatWhen(e.starts_at, { months, weekdays })}
        </Text>
        <Text style={styles.rowTitle} numberOfLines={2}>{e.title}</Text>
        <Text style={styles.rowVenue} numberOfLines={1}>
          {e.kind === 'fundraiser' ? e.organiser : [e.venue, e.city].filter(Boolean).join(' · ')}
        </Text>
        <View style={styles.rowFoot}>
          {e.kind === 'fundraiser' ? (
            e.on_sale ? (
              <>
                <Text style={styles.rowPrice}>{fundLine(e)}</Text>
                {pctOf(e) != null && <View style={styles.rowTrack}><View style={[styles.heroFill, { width: `${pctOf(e)}%` }]} /></View>}
              </>
            ) : <Pill label={t('tix.fund.closed')} />
          ) : priceLine(e) ? <Text style={styles.rowPrice}>{priceLine(e)}</Text> : <Pill label={closedLabel(e)} />}
          <View style={styles.rowCta}>{cta(e)}</View>
        </View>
      </View>
    </TouchableOpacity>
  );

  const empty = events.loading ? (
    <ActivityIndicator style={styles.spinner} color={T.gold} size="large" />
  ) : events.failed ? (
    <Notice title={ticketErrorText(events.error, t, 'tix.loadFailed')} action={t('common.retry')} onAction={events.reload} />
  ) : search || city ? (
    <Notice title={t('tix.noResults', { q: search || city })} />
  ) : (
    <Notice title={fund ? t('tix.fund.emptyTitle') : t('tix.emptyTitle')} body={fund ? t('tix.fund.emptyBody') : t('tix.emptyBody')} />
  );

  return (
    <SafeAreaView style={styles.root} edges={['bottom', 'left', 'right']}>
      <FlatList
        data={rows}
        keyExtractor={(e) => e.slug}
        renderItem={renderRow}
        ListHeaderComponent={header}
        ListEmptyComponent={featured ? null : empty}
        ListFooterComponent={events.more ? <ActivityIndicator style={styles.more} color={T.gold} /> : null}
        onEndReached={events.loadMore}
        onEndReachedThreshold={0.6}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.list}
        style={styles.listOuter}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={pull} tintColor={T.gold} colors={[T.gold]} />}
        showsVerticalScrollIndicator={false}
        initialNumToRender={6}
        windowSize={7}
        removeClippedSubviews
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  flex: { flex: 1 },
  listOuter: { flex: 1 },
  list: { paddingHorizontal: 16, paddingBottom: 32, width: '100%', maxWidth: 720, alignSelf: 'center' },

  top: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingTop: 18 },
  heading: { fontFamily: F.display, fontSize: 32, lineHeight: 36, color: T.ivory, marginTop: 6 },
  myBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: T.lineStrong, backgroundColor: T.surface,
    marginBottom: 4,
  },
  myText: { fontFamily: F.uiBold, fontSize: 12.5, color: T.champagne },
  myCount: {
    minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: T.gold,
    alignItems: 'center', justifyContent: 'center',
  },
  myCountText: { fontFamily: F.uiHeavy, fontSize: 10.5, color: T.paperInk },

  search: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18,
    height: 48, borderRadius: 24, paddingHorizontal: 16,
    backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.line,
  },
  searchInput: { flex: 1, fontFamily: F.ui, fontSize: 15, color: T.ivory, paddingVertical: 0 },

  host: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, paddingVertical: 10, paddingLeft: 16, paddingRight: 10,
    borderRadius: 22, backgroundColor: 'rgba(201,164,92,0.08)', borderWidth: StyleSheet.hairlineWidth, borderColor: T.lineStrong,
  },
  hostText: { flex: 1, fontFamily: F.uiSemi, fontSize: 13, lineHeight: 18, color: T.muted },
  hostBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 18,
    backgroundColor: T.champagne,
  },
  hostBtnText: { fontFamily: F.uiHeavy, fontSize: 13, color: T.paperInk },
  mineBtn: {
    paddingVertical: 9, paddingHorizontal: 12, borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.lineStrong,
  },
  mineBtnText: { fontFamily: F.uiBold, fontSize: 13, color: T.champagne },
  chips: { gap: 8, paddingTop: 14 },
  chip: {
    paddingVertical: 7, paddingHorizontal: 14, borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.line,
  },
  chipOn: { backgroundColor: T.champagne, borderColor: T.champagne },
  chipText: { fontFamily: F.uiSemi, fontSize: 13, color: T.muted },
  chipTextOn: { color: T.paperInk },

  sectionKicker: { marginTop: 26, marginBottom: 12 },

  hero: {
    borderRadius: 26, overflow: 'hidden', backgroundColor: T.surface, alignSelf: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.line,
  },
  heroTop: {
    position: 'absolute', top: 14, left: 14, right: 14,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
  },
  heroText: { position: 'absolute', left: 20, right: 20, bottom: 20 },
  // A landscape banner's words: on the card beneath the picture.
  heroBelow: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 20 },
  heroTitle: { fontFamily: F.display, fontSize: 34, lineHeight: 37, color: T.ivory, marginTop: 6 },
  heroMeta: { fontFamily: F.uiSemi, fontSize: 13, color: T.muted, marginTop: 8 },
  kinds: { flexDirection: 'row', gap: 8, marginTop: 14 },
  kind: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10,
    borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: T.lineStrong,
  },
  kindOn: { backgroundColor: T.champagne, borderColor: T.champagne },
  kindText: { fontFamily: F.uiBold, fontSize: 13.5, color: T.muted },
  kindTextOn: { color: T.paperInk },
  heroTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(246,241,231,0.18)', overflow: 'hidden', marginTop: 10 },
  heroFill: { height: '100%', borderRadius: 3, backgroundColor: T.gold },
  rowTrack: { height: 4, borderRadius: 2, backgroundColor: T.line, overflow: 'hidden', marginTop: 6 },
  heroPrice: { fontFamily: F.uiHeavy, fontSize: 15, color: T.champagne, marginTop: 10, letterSpacing: 0.3 },

  posterBlank: { alignItems: 'center', justifyContent: 'center' },
  posterInitial: { fontFamily: F.display, fontSize: 56, color: 'rgba(232,212,170,0.55)' },

  row: {
    flexDirection: 'row', gap: 14, padding: 10, marginBottom: 12, borderRadius: 20,
    backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.line,
  },
  thumb: { width: 92, height: 116, borderRadius: 14, overflow: 'hidden' },
  // A landscape banner in a row: wide, not a centre-cropped sliver of it.
  thumbWide: { width: 132, height: 88, borderRadius: 14, overflow: 'hidden', alignSelf: 'center' },
  rowBody: { flex: 1, paddingVertical: 2 },
  rowWhen: { fontFamily: F.uiBold, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: T.gold },
  rowTitle: { fontFamily: F.display, fontSize: 22, lineHeight: 25, color: T.ivory, marginTop: 4 },
  rowVenue: { fontFamily: F.ui, fontSize: 13, color: T.muted, marginTop: 4 },
  rowFoot: { marginTop: 'auto', paddingTop: 8 },
  rowCta: { flexDirection: 'row', marginTop: 8 },
  heroCta: { flexDirection: 'row', marginTop: 14 },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 12,
    borderRadius: 14, backgroundColor: T.champagne,
  },
  ctaBig: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 20 },
  ctaText: { fontFamily: F.uiHeavy, fontSize: 12, color: T.paperInk },
  ctaTextBig: { fontSize: 14 },
  rowPrice: { fontFamily: F.uiHeavy, fontSize: 13.5, color: T.champagne },

  spinner: { marginTop: 60 },
  more: { marginVertical: 18 },
});

export default TicketsHome;

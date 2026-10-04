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
import { T, F, tap, Kicker, DateTile, Pill, Notice } from '../../components/tickets/TicketKit';
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

/** Events for a search and city, a page at a time. */
const useEvents = (search, city) => {
  const plain = !search && !city;
  const [state, setState] = useState(() => {
    const kept = plain ? peekCache(CACHE_KEY) : null;
    return { items: kept?.results || [], next: kept?.next || null, loading: !kept, failed: false, more: false };
  });
  const run = useRef(0);

  const load = useCallback(async () => {
    const id = ++run.current;
    setState((s) => ({ ...s, failed: false, loading: !s.items.length || !plain }));
    if (plain && !peekCache(CACHE_KEY)) {
      const kept = await readCache(CACHE_KEY, KEEP_MS);
      if (id === run.current && kept) setState((s) => ({ ...s, items: kept.results, next: kept.next, loading: false }));
    }
    try {
      const page = await fetchEvents({ search, city });
      if (id !== run.current) return;
      setState({ items: page.results || [], next: page.next, loading: false, failed: false, more: false });
      if (plain) writeCache(CACHE_KEY, { results: page.results || [], next: page.next });
    } catch (err) {
      if (id === run.current) setState((s) => ({ ...s, loading: false, failed: true, error: err }));
    }
  }, [search, city, plain]);

  useEffect(() => {
    // A new search starts from nothing rather than the last search's rows.
    if (!plain) setState({ items: [], next: null, loading: true, failed: false, more: false });
    load();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(async () => {
    const page = nextPage(state.next);
    if (!page || state.more || state.loading) return;
    const id = run.current;
    setState((s) => ({ ...s, more: true }));
    try {
      const res = await fetchEvents({ search, city, page });
      if (id !== run.current) return;
      setState((s) => ({ ...s, items: mergeBySlug(s.items, res.results || []), next: res.next, more: false }));
    } catch {
      if (id === run.current) setState((s) => ({ ...s, more: false }));
    }
  }, [state.next, state.more, state.loading, search, city]);

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
  const { width } = useWindowDimensions();
  const months = t('tix.months').split(',');
  const weekdays = t('tix.weekdays').split(',');

  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setSearch(typed.trim()), SEARCH_WAIT_MS);
    return () => clearTimeout(id);
  }, [typed]);
  const [city, setCity] = useState(null);

  const events = useEvents(search, city);
  const saved = useSavedOrders();
  useEffect(() => { refreshSavedOrders(); }, []);
  // An organiser signed in on this phone gets their events beside Open event.
  const [organiser, setOrganiser] = useState(false);
  useEffect(() => { hasSession().then(setOrganiser).catch(() => {}); }, []);

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
    navigation.push('TicketEvent', { slug: event.slug, preview: event });
  }, [navigation]);

  const featured = !search && !city ? events.items[0] : null;
  const rows = featured ? events.items.slice(1) : events.items;
  const priceLine = (e) => (e.on_sale && e.min_price != null ? t('tix.from', { price: formatKes(e.min_price) }) : null);
  // The list does not say why an event is off sale (it carries no `remaining`
  // or sales end), and "Sales closed" is true either way; the event page,
  // which has both, says which.
  const closedLabel = (e) => (e.on_sale ? null : t('tix.salesClosed'));

  const heroWidth = Math.min(width, 720) - 32;

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

      {/* The organiser's way in. TicketHost checks for an account first. */}
      <View style={styles.host}>
        <Text style={styles.hostText} numberOfLines={2}>{t('tix.hostPrompt')}</Text>
        {organiser && (
          <TouchableOpacity
            onPress={() => { tap(); navigation.push('TicketMyEvents'); }}
            style={styles.mineBtn}
            accessibilityRole="button"
            testID="my-events"
          >
            <Text style={styles.mineBtnText}>{t('tix.mine.title')}</Text>
          </TouchableOpacity>
        )}
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
            style={[styles.hero, { width: heroWidth, height: heroWidth * 1.18 }]}
            accessibilityRole="button"
            accessibilityLabel={`${featured.title}, ${formatWhen(featured.starts_at, { months, weekdays })}, ${featured.venue}`}
          >
            <Poster uri={featured.poster} title={featured.title} style={StyleSheet.absoluteFill} />
            <LinearGradient
              colors={['rgba(10,10,13,0)', 'rgba(10,10,13,0.35)', 'rgba(10,10,13,0.96)']}
              locations={[0.25, 0.55, 1]}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.heroTop}>
              <DateTile {...dateTile(featured.starts_at, months)} />
              {!!closedLabel(featured) && <Pill label={closedLabel(featured)} />}
            </View>
            <View style={styles.heroText}>
              {!!featured.city && <Kicker>{featured.city}</Kicker>}
              <Text style={styles.heroTitle} numberOfLines={3}>{featured.title}</Text>
              <Text style={styles.heroMeta} numberOfLines={1}>
                {formatWhen(featured.starts_at, { months, weekdays })}  ·  {featured.venue}
              </Text>
              {!!priceLine(featured) && <Text style={styles.heroPrice}>{priceLine(featured)}</Text>}
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
      accessibilityLabel={`${e.title}, ${formatWhen(e.starts_at, { months, weekdays })}, ${e.venue}`}
    >
      <Poster uri={e.poster} title={e.title} style={styles.thumb} />
      <View style={styles.rowBody}>
        <Text style={styles.rowWhen} numberOfLines={1}>{formatWhen(e.starts_at, { months, weekdays })}</Text>
        <Text style={styles.rowTitle} numberOfLines={2}>{e.title}</Text>
        <Text style={styles.rowVenue} numberOfLines={1}>{[e.venue, e.city].filter(Boolean).join(' · ')}</Text>
        <View style={styles.rowFoot}>
          {priceLine(e) ? <Text style={styles.rowPrice}>{priceLine(e)}</Text> : <Pill label={closedLabel(e)} />}
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
    <Notice title={t('tix.emptyTitle')} body={t('tix.emptyBody')} />
  );

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
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
  heroTitle: { fontFamily: F.display, fontSize: 34, lineHeight: 37, color: T.ivory, marginTop: 6 },
  heroMeta: { fontFamily: F.uiSemi, fontSize: 13, color: T.muted, marginTop: 8 },
  heroPrice: { fontFamily: F.uiHeavy, fontSize: 15, color: T.champagne, marginTop: 10, letterSpacing: 0.3 },

  posterBlank: { alignItems: 'center', justifyContent: 'center' },
  posterInitial: { fontFamily: F.display, fontSize: 56, color: 'rgba(232,212,170,0.55)' },

  row: {
    flexDirection: 'row', gap: 14, padding: 10, marginBottom: 12, borderRadius: 20,
    backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.line,
  },
  thumb: { width: 92, height: 116, borderRadius: 14, overflow: 'hidden' },
  rowBody: { flex: 1, paddingVertical: 2 },
  rowWhen: { fontFamily: F.uiBold, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: T.gold },
  rowTitle: { fontFamily: F.display, fontSize: 22, lineHeight: 25, color: T.ivory, marginTop: 4 },
  rowVenue: { fontFamily: F.ui, fontSize: 13, color: T.muted, marginTop: 4 },
  rowFoot: { marginTop: 'auto', paddingTop: 8 },
  rowPrice: { fontFamily: F.uiHeavy, fontSize: 13.5, color: T.champagne },

  spinner: { marginTop: 60 },
  more: { marginVertical: 18 },
});

export default TicketsHome;

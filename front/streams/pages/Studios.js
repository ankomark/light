// Services: a directory of what people in the community offer — media
// studios, hospitality, health, professional, home & trades.
//
// Opens at once on the last list it showed (kept per category, offline
// too), then refreshes behind it. Search runs on the server — by name,
// place, description and service (in the reader's language) — so every
// listing can be found, not only the first page; more load as you scroll.
// Listing, editing and reporting are a tap away; the form is its own page.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView,
} from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchServicesPage, fetchServicesByUrl, deleteVideoStudio, saveService } from '../services/api';
import { CATEGORIES, tagsMatching, servicesChangedSince, noteServicesChanged } from '../services/servicesCatalog';
import ServiceCard, { ServiceCardSkeleton } from '../components/services/ServiceCard';
import ServicesHome from '../components/services/ServicesHome';
import ServiceFilters, { NO_FILTERS, activeCount, filterParams } from '../components/services/ServiceFilters';
import PlaceSheet from '../components/services/PlaceSheet';
import { keptPlace, keepPlace, peekPlace, pointParam } from '../services/serviceLocation';
import ReportModal from '../components/ReportModal';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import useGridColumns from '../utils/useGridColumns';
import { confirmAction, notify } from '../utils/adminConfirm';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';

const MAX_W = 1200;
const REFRESH_AFTER_MS = 60 * 1000;
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const rowsOf = (res) => (Array.isArray(res) ? res : res?.results || [])
  .map((s) => ({ ...s, service_types: Array.isArray(s.service_types) ? s.service_types : [] }));

const Studios = ({ navigation }) => {
  const { t, resolvedLanguage } = useI18n();
  const { currentUser, isAuthenticated } = useAuth();
  const uid = currentUser?.id;
  // Filters and sort, and where the viewer is (for near me).
  const [filters, setFilters] = useState(NO_FILTERS);
  const [place, setPlace] = useState(() => peekPlace());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [placeOpen, setPlaceOpen] = useState(false);
  useEffect(() => { keptPlace().then((p) => { if (p) setPlace((cur) => cur || p); }); }, []);
  const narrowed = activeCount(filters) > 0 || !!filters.sort;
  const insets = useSafeAreaInsets();
  const side = { left: insets.left || 0, right: insets.right || 0, bottom: insets.bottom || 0 };
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const searching = !!query.trim();
  // One kept list per view (category, filters, place); a typed search isn't kept.
  const sig = narrowed || place ? `:${JSON.stringify({ ...filters, at: pointParam(place) })}` : '';
  const cacheKey = searching ? null : userKey(uid, `services:${category}${sig}`);

  const [items, setItems] = useState(() => peekCache(cacheKey)?.items || null);   // null: nothing yet
  const [next, setNext] = useState(() => peekCache(cacheKey)?.next || null);
  const [failed, setFailed] = useState(false);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);            // a search on its way (rows stay)
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reporting, setReporting] = useState(null);
  const request = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const lastLoad = useRef(0);

  const { cols } = useGridColumns({
    target: 380, min: 1, max: 3, horizontalPadding: spacing.md * 2 + side.left + side.right, gap: spacing.md,
  });

  const load = useCallback(async ({ refresh = false } = {}) => {
    const mine = ++request.current;
    setFailed(false);
    let kept = null;
    if (cacheKey && !refresh) {
      kept = peekCache(cacheKey) ?? await readCache(cacheKey, KEEP_MS);
      if (mine !== request.current) return;
      if (kept?.items) { setItems(kept.items); setNext(kept.next || null); }
    }
    if (refresh) setRefreshing(true);
    else if (searching && itemsRef.current?.length) setBusy(true);
    else if (!kept?.items) setItems(null);
    try {
      const params = { ...filterParams(filters, place) };
      if (category !== 'all') params.category = category;
      if (searching) {
        params.search = query.trim();
        const tags = tagsMatching(query, t);
        if (tags.length) params.tags = tags.join(',');
      }
      const res = await fetchServicesPage(params);
      if (mine !== request.current) return;
      const rows = rowsOf(res);
      setItems(rows);
      setNext(res?.next || null);
      setOffline(false);
      if (cacheKey) writeCache(cacheKey, { items: rows, next: res?.next || null });
    } catch {
      if (mine !== request.current) return;
      if (itemsRef.current?.length) setOffline(true);        // keep what's on screen
      else { setItems([]); setFailed(true); }
    } finally {
      if (mine === request.current) {
        setBusy(false);
        setRefreshing(false);
        lastLoad.current = Date.now();
      }
    }
  }, [cacheKey, category, query, searching, t, filters, place]);
  const loadRef = useRef(load);
  loadRef.current = load;
  const keyRef = useRef(cacheKey);
  keyRef.current = cacheKey;

  // A category or the account: at once. Typing: once it pauses.
  useEffect(() => {
    if (searching) {
      const h = setTimeout(() => loadRef.current(), 350);
      return () => clearTimeout(h);
    }
    if (cacheKey) { const kept = peekCache(cacheKey); if (kept?.items) { setItems(kept.items); setNext(kept.next || null); } }
    loadRef.current();
    return undefined;
  }, [category, query, uid, filters, place]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back from the form (or anywhere): a listing saved or deleted shows at
  // once; an old list is refreshed.
  const mounted = useRef(false);
  useFocusEffect(useCallback(() => {
    if (!mounted.current) { mounted.current = true; return; }
    const change = servicesChangedSince(lastLoad.current);
    if (change?.item || change?.deletedId) {
      // Into the list AND its kept copy — the refresh paints the kept copy
      // first, and must not take the new listing away again.
      const list = itemsRef.current || [];
      const id = change.item?.id ?? change.deletedId;
      const had = list.some((s) => s.id === id);
      const merged = change.deletedId ? list.filter((s) => s.id !== id)
        : had ? list.map((s) => (s.id === id ? { ...s, ...change.item } : s))
          : change.created ? [change.item, ...list] : list;           // a new listing joins; others only update
      setItems(merged);
      const key = keyRef.current;
      if (key) writeCache(key, { items: merged, next: peekCache(key)?.next || null });
    }
    if (change || Date.now() - lastLoad.current > REFRESH_AFTER_MS) loadRef.current();
  }, []));

  const loadMore = useCallback(async () => {
    if (loadingMore || !next) return;
    const mine = request.current;
    setLoadingMore(true);
    try {
      const res = await fetchServicesByUrl(next);
      if (mine !== request.current) return;
      setItems((prev) => {
        const seen = new Set((prev || []).map((s) => s.id));
        return [...(prev || []), ...rowsOf(res).filter((s) => !seen.has(s.id))];
      });
      setNext(res?.next || null);
    } catch {
      // pull to refresh recovers
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, next]);

  const create = () => (isAuthenticated
    ? navigation.navigate('ServiceForm', { category: category !== 'all' ? category : 'media' })
    : navigation.navigate('Login'));
  const edit = useCallback((s) => navigation.navigate('ServiceForm', { service: s }), [navigation]);
  // The row carries what the page needs to draw its top at once.
  const openService = useCallback((s) => navigation.navigate('ServiceDetail', { id: s.id, preview: s }), [navigation]);
  const remove = useCallback(async (s) => {
    const ok = await confirmAction({
      title: t('studios.deleteTitle'), message: t('common.deleteConfirm', { name: s.name }),
      confirmLabel: t('common.delete'), cancelLabel: t('common.cancel'), destructive: true,
    });
    if (!ok) return;
    const before = itemsRef.current;
    const after = (before || []).filter((x) => x.id !== s.id);
    setItems(after);
    try {
      await deleteVideoStudio(s.id);
      noteServicesChanged({ deletedId: s.id });
      if (cacheKey) writeCache(cacheKey, { items: after, next });
    } catch {
      setItems(before);
      notify(t('common.error'), t('studios.deleteFailed'));
    }
  }, [t, cacheKey, next]);
  const report = useCallback((s) => (isAuthenticated ? setReporting(s) : navigation.navigate('Login')), [isAuthenticated, navigation]);
  // Keep a service to come back to: at once on the card, then the server.
  const toggleSave = useCallback(async (s) => {
    if (!isAuthenticated) { navigation.navigate('Login'); return; }
    const flip = (on) => {
      const list = (itemsRef.current || []).map((x) => (x.id === s.id ? { ...x, is_saved: on } : x));
      setItems(list);
      const key = keyRef.current;                               // and in its kept copy
      if (key) writeCache(key, { items: list, next: peekCache(key)?.next || null });
    };
    flip(!s.is_saved);
    try { await saveService(s.id, !s.is_saved); } catch { flip(!!s.is_saved); notify(t('common.error'), t('services.saveFailed')); }
  }, [isAuthenticated, navigation, t]);
  const pickPlace = useCallback(async (p) => {
    setPlaceOpen(false);
    await keepPlace(p);
    setPlace(p);
    setFilters((f) => ({ ...f, sort: 'near' }));
  }, []);
  const nearMe = () => (place && filters.sort === 'near'
    ? setFilters((f) => ({ ...f, sort: '' }))            // tapped again: back to recommended
    : place ? setFilters((f) => ({ ...f, sort: 'near' })) : setPlaceOpen(true));

  const renderItem = useCallback(({ item }) => (
    <ServiceCard item={item} t={t} onOpen={openService} onEdit={edit} onDelete={remove} onReport={report} onSave={toggleSave}
      style={cols > 1 ? styles.inGrid : null} />
  ), [t, openService, edit, remove, report, toggleSave, cols]);

  const empty = () => {
    if (items == null) {
      return (
        <View style={cols > 1 ? styles.skeletonGrid : null}>
          {Array.from({ length: cols > 1 ? cols * 2 : 3 }, (_, i) => (
            <ServiceCardSkeleton key={i} style={cols > 1 ? { width: `${Math.floor(100 / cols) - 2}%` } : null} />
          ))}
        </View>
      );
    }
    if (failed) {
      return (
        <View style={styles.empty} testID="services-failed">
          <Ionicons name="cloud-offline-outline" size={44} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('studios.loadFailed')}</Text>
          <TouchableOpacity style={styles.btn} onPress={() => load()} testID="services-retry">
            <Text style={styles.btnText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.empty}>
        <MaterialIcons name={searching ? 'search-off' : 'storefront'} size={46} color={colors.textMuted} />
        <Text style={styles.emptyText}>{searching ? t('services.noMatch') : t('studios.none')}</Text>
        {!searching ? (
          <TouchableOpacity style={styles.btn} onPress={create}><Text style={styles.btnText}>{t('studios.create')}</Text></TouchableOpacity>
        ) : null}
      </View>
    );
  };

  return (
    <View style={[styles.screen, { paddingLeft: side.left, paddingRight: side.right }]}>
      <View style={styles.controls}>
        <View style={[styles.header, styles.headerRow]}>
          <View style={styles.flex}>
            <Text style={styles.title}>{t('studios.title')}</Text>
            <Text style={styles.subtitle}>{t('studios.subtitle')}</Text>
          </View>
          {isAuthenticated ? (
            <TouchableOpacity style={styles.headerBtn} onPress={() => navigation.navigate('ServiceBookings')}
              accessibilityRole="button" accessibilityLabel={t('bookings.title')} testID="services-requests">
              <Ionicons name="calendar-outline" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          ) : null}
        </View>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.placeholder} />
          <TextInput style={styles.searchInput} placeholder={t('studios.searchPlaceholder')} placeholderTextColor={colors.placeholder}
            value={query} onChangeText={setQuery} returnKeyType="search" autoCorrect={false} testID="services-search" />
          {busy ? <ActivityIndicator size="small" color={colors.primary} /> : null}
          {query ? (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={8} accessibilityLabel={t('common.clear')}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chips}>
          {[{ key: 'all', labelKey: 'services.cat.all' }, ...CATEGORIES].map((c) => {
            const on = c.key === category;
            return (
              <TouchableOpacity key={c.key} style={[styles.chip, on && styles.chipOn]} onPress={() => setCategory(c.key)}
                accessibilityRole="tab" accessibilityState={{ selected: on }} testID={`services-cat-${c.key}`}>
                {c.icon ? <MaterialIcons name={c.icon} size={14} color={on ? colors.white : colors.textSecondary} /> : null}
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(c.labelKey)}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.quick}>
          <TouchableOpacity style={[styles.qChip, filters.sort === 'near' && place && styles.qChipOn]} onPress={nearMe}
            onLongPress={() => setPlaceOpen(true)} testID="services-near">
            <Ionicons name="navigate" size={13} color={filters.sort === 'near' && place ? colors.white : colors.primary} />
            <Text style={[styles.qText, filters.sort === 'near' && place && styles.qTextOn]} numberOfLines={1}>
              {place && filters.sort === 'near' ? (place.mine ? t('services.nearMe') : place.label?.split(',')[0]) : t('services.nearMe')}
            </Text>
          </TouchableOpacity>
          {place && filters.sort === 'near' ? (
            <TouchableOpacity style={styles.qChip} onPress={() => setPlaceOpen(true)} testID="services-change-place">
              <Text style={styles.qText}>{t('services.changePlace')}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={[styles.qChip, filters.openNow && styles.qChipOn]} testID="services-open-now"
            onPress={() => setFilters((f) => ({ ...f, openNow: !f.openNow }))}>
            <Text style={[styles.qText, filters.openNow && styles.qTextOn]}>{t('services.filters.openNow')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.qChip, filters.verified && styles.qChipOn]} testID="services-verified-only"
            onPress={() => setFilters((f) => ({ ...f, verified: !f.verified }))}>
            <Text style={[styles.qText, filters.verified && styles.qTextOn]}>{t('services.filters.verified')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.qChip, activeCount(filters) > 0 && styles.qChipOn]} onPress={() => setFiltersOpen(true)}
            testID="services-filters">
            <Ionicons name="options-outline" size={14} color={activeCount(filters) > 0 ? colors.white : colors.textSecondary} />
            <Text style={[styles.qText, activeCount(filters) > 0 && styles.qTextOn]}>
              {activeCount(filters) ? t('services.filters.withCount', { n: activeCount(filters) }) : t('services.filters.title')}
            </Text>
          </TouchableOpacity>
        </ScrollView>
        {offline ? (
          <View style={styles.offlineBar} testID="services-offline">
            <Ionicons name="cloud-offline-outline" size={14} color={colors.textSecondary} />
            <Text style={styles.offlineText}>{t('articles.offline')}</Text>
          </View>
        ) : null}
      </View>

      <FlatList
        key={`cols-${cols}`}
        data={items || []}
        keyExtractor={(s) => String(s.id)}
        renderItem={renderItem}
        numColumns={cols}
        columnWrapperStyle={cols > 1 ? styles.row : undefined}
        contentContainerStyle={[styles.list, { paddingBottom: 96 + side.bottom }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshing={refreshing}
        onRefresh={() => load({ refresh: true })}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        initialNumToRender={4}
        windowSize={7}
        ListHeaderComponent={category === 'all' && !searching && !narrowed ? (
          <ServicesHome uid={uid} t={t} onCategory={setCategory} onOpen={openService} />
        ) : null}
        ListEmptyComponent={empty()}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} /> : null}
      />

      <TouchableOpacity style={[styles.fab, { bottom: spacing.lg + side.bottom, right: spacing.md + side.right }]}
        onPress={create} activeOpacity={0.9} accessibilityRole="button" testID="services-create">
        <Ionicons name="add" size={20} color={colors.white} />
        <Text style={styles.fabText}>{t('studios.create')}</Text>
      </TouchableOpacity>

      {reporting ? (
        <ReportModal visible onClose={() => setReporting(null)} contentType="videostudio" objectId={reporting.id} />
      ) : null}
      <ServiceFilters visible={filtersOpen} onClose={() => setFiltersOpen(false)} value={filters} onApply={setFilters}
        hasPlace={!!place} t={t} />
      <PlaceSheet visible={placeOpen} onClose={() => setPlaceOpen(false)} onPick={pickPlace} t={t}
        title={t('services.whereAreYou')} lang={resolvedLanguage === 'sw' ? 'sw' : 'en'} />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  controls: { width: '100%', maxWidth: MAX_W, alignSelf: 'center' },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  flex: { flex: 1 },
  headerBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  quick: { gap: spacing.xs, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, flexDirection: 'row' },
  qChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.sm + 2, paddingVertical: 6, maxWidth: 200,
    borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  qChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  qText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', flexShrink: 1 },
  qTextOn: { color: colors.white },
  title: { ...typography.h1, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.card, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, marginHorizontal: spacing.md, paddingHorizontal: spacing.md, height: 44,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 15 },
  chipScroll: { flexGrow: 0 },
  chips: { gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, flexDirection: 'row' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
    borderRadius: radius.full, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  chipTextOn: { color: colors.white },
  offlineBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginHorizontal: spacing.md,
    marginBottom: spacing.xs, paddingVertical: 6, borderRadius: radius.full, backgroundColor: 'rgba(255,255,255,0.06)',
  },
  offlineText: { ...typography.caption, color: colors.textSecondary },
  list: { paddingHorizontal: spacing.md, paddingTop: spacing.xs, width: '100%', maxWidth: MAX_W, alignSelf: 'center' },
  row: { gap: spacing.md },
  inGrid: { flex: 1 },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  btn: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, marginTop: spacing.xs },
  btnText: { ...typography.label, color: colors.white, fontWeight: '700' },
  fab: {
    position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2, borderRadius: radius.full, ...shadows.lg,
  },
  fabText: { ...typography.button, color: colors.white },
});

export default Studios;

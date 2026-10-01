// The marketplace's front, to browse by hand as much as by search:
//
//   a slim search bar and the cart;           shortcuts as small pills;
//   categories as small named chips, dark like the shortcuts above them;
//   a spotlight of what people look at most — swipes by itself, with dots;
//   rows that scroll sideways: just listed, each of the fullest categories
//   (with "see all"), recently viewed;
//   then everything, newest first, as a grid that goes on as it is scrolled.
//
// Opens at once on the phone's copy, which the app fills in the background
// soon after it starts (utils/marketFeed.js warmMarket), then refreshes behind
// it. Pull down to refresh by hand.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator,
  RefreshControl, useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import Icon from 'react-native-vector-icons/FontAwesome';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useI18n } from '../../context/I18nContext';
import { fetchProducts } from '../../services/api';
import useCachedData from '../../utils/useCachedData';
import useGridColumns from '../../utils/useGridColumns';
import { peekCache } from '../../utils/screenCache';
import { useAuth } from '../../context/useAuth';
import { useMarket, useMarketUser } from '../../utils/cartStore';
import { formatPrice } from '../../utils/market';
import { categoryIcon } from '../../utils/categoryIcons';
import {
  MARKET_HOME_KEY, HOME_PAGE_SIZE, loadMarketHome, mergeHome, prefetchPhotos,
} from '../../utils/marketFeed';
import CartButton from './CartButton';

const PLACEHOLDER_IMAGE = require('../../assets/default-image.png');
// The coloured artwork these had in the menu, kept in their own colours.
const ORDERS_ART = require('../../assets/orders-icon.png');
const SELL_ART = require('../../assets/sell-icon.png');
const GAP = 10;
const PAD = 16;
const SPOTLIGHT_MS = 4500;
const SPOTLIGHT_REST_MS = 10000;   // after a swipe, left alone this long
const SPOTLIGHT_MAX_W = 520;
const NEW_STRIP = 10;
const photoOf = (p) => (p?.images?.[0]?.image_url ? { uri: p.images[0].image_url } : PLACEHOLDER_IMAGE);

// A refresh that half-failed keeps the half it did not get from the copy.
const loadHome = async () => {
  const merged = mergeHome(await loadMarketHome(), peekCache(MARKET_HOME_KEY));
  prefetchPhotos([...(merged.popular || []).slice(0, 4), ...merged.products]);
  return merged;
};

/** A section's title, with "see all" when there is more of it. */
const RowTitle = ({ title, icon, onAll, t }) => (
  <View style={styles.rowTitle}>
    <View style={styles.rowTitleLeft}>
      {!!icon && <MaterialCommunityIcons name={icon.icon} size={16} color={icon.color} />}
      <Text style={styles.sectionTitle} numberOfLines={1}>{title}</Text>
    </View>
    {!!onAll && (
      <TouchableOpacity onPress={onAll} hitSlop={8} accessibilityRole="button">
        <Text style={styles.seeAll}>{t('market.home.seeAll')}</Text>
      </TouchableOpacity>
    )}
  </View>
);

const priceLabel = (p) => `${p.title}, ${formatPrice(p.price, p.currency)}`;

/** A row of products that scrolls sideways. */
const Strip = React.memo(({ products, onOpen, testID }) => (
  <FlatList
    horizontal
    data={products}
    keyExtractor={(item) => String(item.id)}
    renderItem={({ item }) => (
      <TouchableOpacity style={styles.stripCard} onPress={() => onOpen(item)} activeOpacity={0.85}
                        accessibilityRole="button" accessibilityLabel={priceLabel(item)}
                        testID={`${testID}-${item.id}`}>
        <Image source={photoOf(item)} placeholder={PLACEHOLDER_IMAGE} contentFit="cover"
               transition={120} recyclingKey={String(item.id)} style={styles.stripImage} />
        <Text style={styles.stripTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.stripPrice}>{formatPrice(item.price, item.currency)}</Text>
      </TouchableOpacity>
    )}
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.stripList}
    initialNumToRender={4}
    testID={testID}
  />
));

/** What people look at most, a card at a time. Moves on by itself (not
 *  while the screen is out of sight, and not for a while after a swipe),
 *  with dots to say where it is. */
const Spotlight = React.memo(({ products, width, onOpen, t }) => {
  const navigation = useNavigation();
  const listRef = useRef(null);
  const [index, setIndex] = useState(0);
  const at = useRef(0);
  const touchedAt = useRef(0);
  const [shown, setShown] = useState(true);
  // No wider than a big phone, so a tablet does not get a thin stripe.
  const cardW = Math.min(width - PAD * 2, SPOTLIGHT_MAX_W);
  const step = cardW + GAP;
  const count = products.length;

  const goTo = (i) => {
    at.current = i;
    setIndex(i);
  };

  // A refresh with fewer cards: back to the first.
  useEffect(() => {
    if (at.current >= count) {
      goTo(0);
      listRef.current?.scrollToOffset?.({ offset: 0, animated: false });
    }
  }, [count]);

  useEffect(() => {
    const offs = [
      navigation.addListener?.('focus', () => setShown(true)),
      navigation.addListener?.('blur', () => setShown(false)),
    ];
    return () => offs.forEach((off) => typeof off === 'function' && off());
  }, [navigation]);

  useEffect(() => {
    if (count < 2 || !shown) return undefined;
    const timer = setInterval(() => {
      if (Date.now() - touchedAt.current < SPOTLIGHT_REST_MS) return;
      const next = (at.current + 1) % count;
      goTo(next);
      listRef.current?.scrollToOffset?.({ offset: next * step, animated: true });
    }, SPOTLIGHT_MS);
    return () => clearInterval(timer);
  }, [count, step, shown]);

  // The dots follow the finger (onScroll, which the web fires too).
  const onScroll = (e) => {
    const i = Math.max(0, Math.min(count - 1, Math.round(e.nativeEvent.contentOffset.x / step)));
    if (i !== at.current) goTo(i);
  };

  return (
    <View style={styles.spotlightWrap} testID="spotlight">
      <FlatList
        ref={listRef}
        horizontal
        data={products}
        keyExtractor={(item) => String(item.id)}
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        onScrollBeginDrag={() => { touchedAt.current = Date.now(); }}
        onScroll={onScroll}
        scrollEventThrottle={32}
        getItemLayout={(_, i) => ({ length: step, offset: step * i, index: i })}
        renderItem={({ item }) => (
          <TouchableOpacity style={[styles.spotCard, { width: cardW }]} onPress={() => onOpen(item)}
                            activeOpacity={0.9} accessibilityRole="button"
                            accessibilityLabel={priceLabel(item)} testID={`spot-${item.id}`}>
            <Image source={photoOf(item)} placeholder={PLACEHOLDER_IMAGE} contentFit="cover"
                   transition={150} style={StyleSheet.absoluteFill} />
            <View style={styles.spotShade} />
            <View style={styles.spotText}>
              <Text style={styles.spotTag}>{t('market.home.popular')}</Text>
              <Text style={styles.spotTitle} numberOfLines={2}>{item.title}</Text>
              <Text style={styles.spotPrice}>{formatPrice(item.price, item.currency)}</Text>
            </View>
          </TouchableOpacity>
        )}
      />
      {count > 1 && (
        <View style={styles.dots}>
          {products.map((p, i) => <View key={p.id} style={[styles.dot, i === index && styles.dotOn]} />)}
        </View>
      )}
    </View>
  );
});

const Tile = React.memo(({ item, width, onOpen, t }) => (
  <TouchableOpacity style={[styles.tile, { width }]} onPress={() => onOpen(item)} activeOpacity={0.85}
                    accessibilityRole="button" accessibilityLabel={priceLabel(item)}
                    testID={`home-product-${item.id}`}>
    <Image source={photoOf(item)} placeholder={PLACEHOLDER_IMAGE} contentFit="cover"
           transition={120} recyclingKey={String(item.id)} style={[styles.tileImage, { height: width }]} />
    <View style={styles.tileBody}>
      <Text style={styles.tileTitle} numberOfLines={2}>{item.title}</Text>
      <Text style={styles.tilePrice}>{formatPrice(item.price, item.currency)}</Text>
      <Text style={styles.tileMeta} numberOfLines={1}>
        {[item.seller?.username, item.location].filter(Boolean).join(' · ')
          || t('market.inStock', { n: item.quantity })}
      </Text>
    </View>
  </TouchableOpacity>
));

const MarketplaceHome = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const { currentUser } = useAuth();
  useMarketUser(currentUser?.id);
  const { recent } = useMarket();
  const [query, setQuery] = useState('');
  const { cols, tileSize } = useGridColumns({ target: 170, min: 2, max: 5, horizontalPadding: PAD * 2, gap: GAP });
  const { data, failed, refreshing, reload } = useCachedData(MARKET_HOME_KEY, loadHome);
  const categories = data?.categories || [];
  const rows = data?.rows || [];
  // The spotlight is for what people have looked at; with nothing looked at
  // yet it would only repeat "just listed".
  const popular = useMemo(() => (data?.popular || [])
    .filter((p) => p.views == null || p.views > 0).slice(0, 6), [data?.popular]);

  // Pages past the first, as the grid is scrolled.
  const [more, setMore] = useState({ items: [], page: 1, next: null, loading: false });
  const firstPage = useMemo(() => data?.products || [], [data?.products]);
  const firstId = firstPage[0]?.id;
  const lastFirst = useRef(firstId);
  useEffect(() => {
    // A new first page (a refresh): what was loaded after it starts again.
    if (lastFirst.current !== firstId) {
      lastFirst.current = firstId;
      setMore({ items: [], page: 1, next: null, loading: false });
    }
  }, [firstId]);
  // "Just listed" takes the newest when there are plenty; the grid then goes
  // on from after them, so nothing shows twice one above the other.
  const newest = useMemo(() => (firstPage.length > NEW_STRIP + 1 ? firstPage.slice(0, NEW_STRIP) : []),
    [firstPage]);
  const products = useMemo(() => {
    const skip = new Set(newest.map((p) => p.id));
    const seen = new Set(firstPage.map((p) => p.id));
    return [...firstPage.filter((p) => !skip.has(p.id)), ...more.items.filter((p) => !seen.has(p.id))];
  }, [firstPage, newest, more.items]);
  const hasMore = more.page === 1 ? !!data?.next : !!more.next;

  const loadMore = useCallback(async () => {
    if (!hasMore || more.loading) return;
    setMore((m) => ({ ...m, loading: true }));
    try {
      const res = await fetchProducts(more.page + 1, { page_size: HOME_PAGE_SIZE });
      prefetchPhotos(res?.results);
      setMore((m) => ({
        items: [...m.items, ...(res?.results || [])], page: m.page + 1, next: !!res?.next, loading: false,
      }));
    } catch {
      setMore((m) => ({ ...m, loading: false }));
    }
  }, [hasMore, more.loading, more.page]);

  const open = useCallback((product) => navigation.navigate('ProductDetail', { slug: product.slug, preview: product }),
    [navigation]);
  const openCategory = (c) => navigation.navigate('ProductList', { categoryId: c.id, categoryName: c.name });
  const search = () => {
    if (query.trim()) navigation.navigate('ProductList', { q: query.trim() });
  };

  const shortcuts = [
    { key: 'Wishlist', icon: 'heart-o', label: t('market.home.wishlist') },
    { key: 'OrderHistory', art: ORDERS_ART, label: t('market.home.orders') },
    { key: 'SellerDashboard', art: SELL_ART, label: t('market.home.sellShort') },
  ];

  const header = (
    <View>
      <View style={styles.topRow}>
        <View style={styles.searchBox}>
          <Icon name="search" size={13} color="#888" />
          <TextInput
            style={styles.searchInput}
            placeholder={t('market.list.searchPlaceholder')}
            placeholderTextColor="#888"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={search}
            returnKeyType="search"
            testID="home-search"
          />
        </View>
        <CartButton size={16} labelled />
      </View>

      <View style={styles.shortcuts}>
        {shortcuts.map((s) => (
          <TouchableOpacity key={s.key} style={styles.shortcut} onPress={() => navigation.navigate(s.key)}
                            accessibilityRole="button" testID={`home-${s.key}`}>
            {s.art
              ? <Image source={s.art} style={styles.shortcutArt} contentFit="contain" testID={`home-${s.key}-art`} />
              : <Icon name={s.icon} size={13} color="#FFC46B" />}
            <Text style={styles.shortcutText} numberOfLines={1}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {categories.length > 0 && (
        <FlatList
          horizontal
          data={categories}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.chip} onPress={() => openCategory(item)}
                              accessibilityRole="button" testID={`home-category-${item.id}`}>
              <Text style={styles.chipText} numberOfLines={1}>{item.name}</Text>
            </TouchableOpacity>
          )}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          style={styles.chipsRow}
        />
      )}

      {popular.length > 0 && <Spotlight products={popular} width={width} onOpen={open} t={t} />}

      {newest.length > 0 && (
        <View style={styles.section}>
          <RowTitle title={t('market.home.justListed')} t={t} onAll={() => navigation.navigate('ProductList')} />
          <Strip products={newest} onOpen={open} testID="strip-new" />
        </View>
      )}

      {rows.map((row) => (
        <View style={styles.section} key={row.category.id}>
          <RowTitle title={row.category.name} icon={categoryIcon(row.category.name)} t={t}
                    onAll={() => openCategory(row.category)} />
          <Strip products={row.products} onOpen={open} testID={`strip-cat-${row.category.id}`} />
        </View>
      ))}

      {recent.length > 0 && (
        <View style={styles.section}>
          <RowTitle title={t('market.home.recent')} t={t} />
          <Strip products={recent} onOpen={open} testID="home-recent" />
        </View>
      )}

      <RowTitle title={t('market.home.explore')} t={t} />
    </View>
  );

  const empty = !data ? (
    <View style={styles.loadingContainer}>
      {failed ? (
        <TouchableOpacity onPress={reload}>
          <Text style={styles.loadingText}>{t('market.home.loadFailed')}</Text>
        </TouchableOpacity>
      ) : <ActivityIndicator color="#FFC46B" />}
    </View>
  ) : (
    <View style={styles.loadingContainer}>
      <Text style={styles.loadingText}>{t('market.list.none')}</Text>
    </View>
  );

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={products}
      key={`home-${cols}`}
      numColumns={cols}
      columnWrapperStyle={cols > 1 ? styles.columns : undefined}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => <Tile item={item} width={tileSize} onOpen={open} t={t} />}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      ListFooterComponent={more.loading ? <ActivityIndicator color="#FFC46B" style={styles.footer} /> : null}
      onEndReached={loadMore}
      onEndReachedThreshold={0.6}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={6}
      windowSize={7}
      removeClippedSubviews
      refreshControl={(
        <RefreshControl refreshing={!!(refreshing && data)} onRefresh={reload} tintColor="#FFC46B" />
      )}
      testID="market-home"
    />
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: PAD, paddingBottom: 32 },
  loadingContainer: { paddingVertical: 32, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#cdd9e5', fontSize: 15 },

  // A slim search bar (it was 44 high and took much of the first screen).
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fff', borderRadius: 18, paddingHorizontal: 12, height: 36,
  },
  searchInput: { flex: 1, fontSize: 14, color: '#333', paddingVertical: 0 },

  shortcuts: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  shortcut: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 32, borderRadius: 16, backgroundColor: 'rgba(10,22,40,0.7)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,196,107,0.35)',
  },
  shortcutText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  shortcutArt: { width: 18, height: 18 },

  // Categories: named chips, dark like the shortcuts (Wishlist, My orders, Sell).
  chipsRow: { flexGrow: 0, marginBottom: 14 },
  chips: { gap: 8, paddingRight: PAD },
  chip: {
    height: 32, paddingHorizontal: 14, borderRadius: 16, justifyContent: 'center',
    backgroundColor: 'rgba(10,22,40,0.7)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,196,107,0.35)',
  },
  chipText: { fontSize: 12, fontWeight: '600', color: '#FFFFFF', maxWidth: 140 },

  spotlightWrap: { marginBottom: 16 },
  spotCard: { height: 170, borderRadius: 16, overflow: 'hidden', marginRight: GAP, backgroundColor: '#1D2B40' },
  spotShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.28)' },
  spotText: { position: 'absolute', left: 14, right: 14, bottom: 12 },
  spotTag: {
    alignSelf: 'flex-start', color: '#0A1628', backgroundColor: '#FFC46B', fontSize: 10, fontWeight: '800',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden', marginBottom: 6,
  },
  spotTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  spotPrice: { color: '#FFC46B', fontSize: 16, fontWeight: '800', marginTop: 2 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 5, marginTop: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotOn: { width: 16, backgroundColor: '#FFC46B' },

  section: { marginBottom: 16 },
  rowTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  rowTitleLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  seeAll: { color: '#FFC46B', fontSize: 12.5, fontWeight: '600' },

  stripList: { gap: GAP, paddingRight: PAD },
  stripCard: { width: 128, backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden' },
  stripImage: { width: 128, height: 118, backgroundColor: '#eef1f5' },
  stripTitle: { fontSize: 12.5, color: '#222', fontWeight: '500', paddingHorizontal: 8, paddingTop: 6 },
  stripPrice: { fontSize: 13.5, color: '#1D478B', fontWeight: '800', paddingHorizontal: 8, paddingBottom: 8 },

  columns: { gap: GAP },
  footer: { marginVertical: 16 },
  tile: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', marginBottom: GAP },
  tileImage: { width: '100%', backgroundColor: '#eef1f5' },
  tileBody: { padding: 8 },
  tileTitle: { fontSize: 13, color: '#222', fontWeight: '500', minHeight: 34 },
  tilePrice: { fontSize: 15, color: '#1D478B', fontWeight: '800', marginTop: 2 },
  tileMeta: { fontSize: 11, color: '#888', marginTop: 2 },
});

export default MarketplaceHome;

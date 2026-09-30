// The marketplace's front: what people are selling, straight away — newest
// first, a grid that goes on as it is scrolled — with search, the way to the
// cart, wishlist, orders and selling, the categories that have something in
// them, and what was looked at lately above it.
//
// Opens at once on the phone's copy, which the app fills in the background
// soon after it starts (utils/marketFeed.js warmMarket), then refreshes
// behind it. Pull down to refresh by hand.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../context/I18nContext';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator, RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import Icon from 'react-native-vector-icons/FontAwesome';
import { useNavigation } from '@react-navigation/native';
import { fetchProducts } from '../../services/api';
import useCachedData from '../../utils/useCachedData';
import useGridColumns from '../../utils/useGridColumns';
import { peekCache } from '../../utils/screenCache';
import { useAuth } from '../../context/useAuth';
import { useMarket, useMarketUser } from '../../utils/cartStore';
import { formatPrice } from '../../utils/market';
import {
  MARKET_HOME_KEY, HOME_PAGE_SIZE, loadMarketHome, prefetchPhotos,
} from '../../utils/marketFeed';
import CartButton from './CartButton';

const PLACEHOLDER_IMAGE = require('../../assets/default-image.png');
const GAP = 10;

// A refresh that half-failed keeps the half it did not get from the copy.
const loadHome = async () => {
  const fresh = await loadMarketHome();
  const kept = peekCache(MARKET_HOME_KEY);
  const merged = {
    ...fresh,
    products: fresh.products ?? kept?.products ?? [],
    categories: fresh.categories ?? kept?.categories ?? [],
  };
  prefetchPhotos(merged.products);
  return merged;
};

const ProductStrip = ({ products, onOpen }) => (
  <FlatList
    horizontal
    data={products}
    keyExtractor={(item) => String(item.id)}
    renderItem={({ item }) => (
      <TouchableOpacity style={styles.productCard} onPress={() => onOpen(item)} testID={`home-recent-${item.id}`}>
        <Image
          source={item.images?.[0]?.image_url ? { uri: item.images[0].image_url } : PLACEHOLDER_IMAGE}
          placeholder={PLACEHOLDER_IMAGE}
          contentFit="cover"
          transition={150}
          style={styles.productImage}
        />
        <Text style={styles.productTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.productPrice}>{formatPrice(item.price, item.currency)}</Text>
      </TouchableOpacity>
    )}
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.productList}
  />
);

const Tile = React.memo(({ item, width, onOpen, t }) => (
  <TouchableOpacity style={[styles.tile, { width }]} onPress={() => onOpen(item)} activeOpacity={0.85}
                    testID={`home-product-${item.id}`}>
    <Image
      source={item.images?.[0]?.image_url ? { uri: item.images[0].image_url } : PLACEHOLDER_IMAGE}
      placeholder={PLACEHOLDER_IMAGE}
      contentFit="cover"
      transition={120}
      recyclingKey={String(item.id)}
      style={[styles.tileImage, { height: width }]}
    />
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
  const { currentUser } = useAuth();
  useMarketUser(currentUser?.id);
  const { recent } = useMarket();
  const [query, setQuery] = useState('');
  const { cols, tileSize } = useGridColumns({ target: 170, min: 2, max: 5, horizontalPadding: 32, gap: GAP });
  const { data, failed, refreshing, reload } = useCachedData(MARKET_HOME_KEY, loadHome);
  const categories = data?.categories || [];

  // Pages past the first, as the grid is scrolled.
  const [more, setMore] = useState({ items: [], page: 1, next: null, loading: false });
  const firstPage = data?.products || [];
  const firstId = firstPage[0]?.id;
  const lastFirst = useRef(firstId);
  useEffect(() => {
    // A new first page (a refresh): what was loaded after it starts again.
    if (lastFirst.current !== firstId) {
      lastFirst.current = firstId;
      setMore({ items: [], page: 1, next: null, loading: false });
    }
  }, [firstId]);
  const seen = new Set(firstPage.map((p) => p.id));
  const products = [...firstPage, ...more.items.filter((p) => !seen.has(p.id))];
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
  const search = () => {
    if (query.trim()) navigation.navigate('ProductList', { q: query.trim() });
  };

  const shortcuts = [
    { key: 'Wishlist', icon: 'heart-o', label: t('market.home.wishlist') },
    { key: 'OrderHistory', icon: 'archive', label: t('market.home.orders') },
    { key: 'SellerDashboard', icon: 'tag', label: t('market.home.sellShort') },
  ];

  const header = (
    <View>
      <View style={styles.topRow}>
        <View style={styles.searchBox}>
          <Icon name="search" size={16} color="#888" />
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
        <CartButton />
      </View>

      <View style={styles.shortcuts}>
        {shortcuts.map((s) => (
          <TouchableOpacity key={s.key} style={styles.shortcut} onPress={() => navigation.navigate(s.key)}
                            accessibilityRole="button" testID={`home-${s.key}`}>
            <Icon name={s.icon} size={18} color="#FFC46B" />
            <Text style={styles.shortcutText}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {categories.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('market.home.shopByCategory')}</Text>
          <FlatList
            horizontal
            data={categories}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.categoryCard}
                onPress={() => navigation.navigate('ProductList', { categoryId: item.id, categoryName: item.name })}
                testID={`home-category-${item.id}`}
              >
                <View style={[styles.categoryIcon, { backgroundColor: '#f0f0f0' }]}>
                  <Text style={styles.categoryEmoji}>🛍️</Text>
                </View>
                <Text style={styles.categoryName} numberOfLines={2}>{item.name}</Text>
              </TouchableOpacity>
            )}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryList}
          />
        </View>
      )}

      {recent.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('market.home.recent')}</Text>
          <ProductStrip products={recent} onOpen={open} />
        </View>
      )}

      <Text style={styles.sectionTitle}>{t('market.home.justListed')}</Text>
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
      initialNumToRender={8}
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
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: { padding: 16, paddingBottom: 32 },
  columns: { gap: GAP },
  footer: { marginVertical: 16 },
  tile: {
    backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', marginBottom: GAP,
  },
  tileImage: { width: '100%', backgroundColor: '#eef1f5' },
  tileBody: { padding: 8 },
  tileTitle: { fontSize: 13, color: '#222', fontWeight: '500', minHeight: 34 },
  tilePrice: { fontSize: 15, color: '#1D478B', fontWeight: '800', marginTop: 2 },
  tileMeta: { fontSize: 11, color: '#888', marginTop: 2 },
  loadingContainer: {
    paddingVertical: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', borderRadius: 22, paddingHorizontal: 14, height: 44,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#333' },
  shortcuts: { flexDirection: 'row', gap: 10, marginBottom: 22 },
  shortcut: {
    flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 12,
    backgroundColor: 'rgba(10,22,40,0.7)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,196,107,0.35)',
  },
  shortcutText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  loadingText: {
    color: '#cdd9e5',
    fontSize: 15,
  },
  heroContainer: {
    backgroundColor: '#1D478B',
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
  },
  heroText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  heroSubtext: {
    fontSize: 16,
    color: '#fff',
    opacity: 0.9,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#FFFFFF',
  },
  categoryList: {
    paddingRight: 16,
  },
  categoryCard: {
    width: 100,
    marginRight: 12,
    alignItems: 'center',
  },
  categoryIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  categoryEmoji: {
    fontSize: 24,
  },
  categoryName: {
    fontSize: 14,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.85)',
  },
  productList: {
    paddingRight: 16,
  },
  productCard: {
    width: 150,
    marginRight: 12,
  },
  productImage: {
    width: 150,
    height: 150,
    borderRadius: 8,
    marginBottom: 8,
  },
  productTitle: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
    color: '#FFFFFF',
  },
  productPrice: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFC46B',
  },
  buttonContainer: {
    marginTop: 16,
    marginBottom: 32,
  },
  primaryButton: {
    backgroundColor: '#1D478B',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  secondaryButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#1D478B',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#1D478B',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default MarketplaceHome;
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { fetchProducts } from '../../services/api';
import { peekCache, writeCache } from '../../utils/screenCache';
import { MARKET_HOME_KEY } from '../../utils/marketFeed';
import { formatPrice } from '../../utils/market';
import CartButton from './CartButton';
import { getPreference, PREF_KEYS } from '../../utils/preferences';
import useGridColumns from '../../utils/useGridColumns';
import { useI18n } from '../../context/I18nContext';

const PLACEHOLDER_IMAGE = require('../../assets/default-image.png');

// =====================
// Helper Functions
// =====================
// =====================
// Style Constants
// =====================
const COLORS = {
  primary: '#FF6B00', // Jumia orange
  white: '#FFFFFF',
  background: '#F5F5F5',
  text: '#333333',
  gray: '#888888',
  lightGray: '#E0E0E0',
  error: '#DC3545',
  star: '#FFD700',
  shadow: '#000000',
  discount: '#F44336',
  inStock: '#4CAF50',
  outOfStock: '#F44336',
};

const FONTS = {
  regular: 'System',
  medium: 'System',
  bold: 'System',
};

const SIZES = {
  small: 12,
  medium: 14,
  large: 16,
  xLarge: 18,
};

const SPACING = {
  tiny: 4,
  small: 8,
  medium: 12,
  large: 16,
  xLarge: 20,
};

const ITEM_MARGIN = SPACING.small;

// =====================
// Main Component
// =====================
// Search, category and sort are the server's work, across every product —
// the search box used to filter only the twenty already on the phone. The
// first page of each search is kept, so going back to one is instant.
const SORTS = ['new', 'price_low', 'price_high', 'popular'];
const SEARCH_WAIT_MS = 350;

const ProductList = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const route = useRoute();
  // Responsive grid: 2 columns on a phone, more on tablets / landscape.
  const { cols, tileSize } = useGridColumns({
    target: 180, min: 2, max: 5, horizontalPadding: ITEM_MARGIN * 2, gap: ITEM_MARGIN,
  });

  const categoryId = route.params?.categoryId;
  const [searchQuery, setSearchQuery] = useState(route.params?.q || '');
  const [query, setQuery] = useState(route.params?.q || '');
  const [sort, setSort] = useState('new');
  // "Near <town>": the town the weather screen knows, matched against where
  // sellers said they are.
  const [town, setTown] = useState(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.resolve(getPreference(PREF_KEYS.weatherPlace))
      .then((place) => {
        const name = (place?.name || '').split(',')[0].trim();
        if (live && name) setTown(name);
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  const params = useMemo(() => ({
    ...(categoryId ? { category: categoryId } : {}),
    ...(query ? { q: query } : {}),
    ...(sort !== 'new' ? { sort } : {}),
    ...(near && town ? { near: town } : {}),
  }), [categoryId, query, sort, near, town]);
  const key = `market:list:${JSON.stringify(params)}`;

  // Unfiltered and unsorted, "browse all" is the marketplace page's own
  // list: start from that copy rather than a spinner.
  const plain = !Object.keys(params).length;
  const startFrom = () => peekCache(key)?.results
    || (plain ? peekCache(MARKET_HOME_KEY)?.products : null) || null;
  const [products, setProducts] = useState(startFrom);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(() => !!peekCache(key)?.next);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const wanted = useRef(key);
  wanted.current = key;

  // Wait for the typing to stop before asking.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(searchQuery.trim()), SEARCH_WAIT_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadProducts = useCallback(async () => {
    setError(null);
    const kept = peekCache(key);
    const shown = startFrom();
    setProducts(shown);
    setHasMore(!!kept?.next);
    try {
      const data = await fetchProducts(1, params);
      writeCache(key, data, { persist: false });
      if (wanted.current !== key) return;       // a newer search meanwhile
      setProducts(data.results ?? []);
      setPage(1);
      setHasMore(!!data.next);
    } catch (err) {
      // In words, never the raw "Network Error".
      if (wanted.current === key && !shown) setError(t('market.list.loadFailed'));
    }
  }, [key, params, t]);

  const loadMoreProducts = useCallback(async () => {
    if (loadingMore || !hasMore || !products) return;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const data = await fetchProducts(nextPage, params);
      if (wanted.current !== key) return;
      setProducts((prev) => [...(prev || []), ...(data.results ?? [])]);
      setPage(nextPage);
      setHasMore(!!data.next);
    } catch {
      // silent — user can pull-to-refresh
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, page, params, key, products]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const handleProductPress = (product) => navigation.navigate('ProductDetail', {
    slug: product.slug, preview: product,
  });

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <View style={[styles.searchContainer, styles.grow]}>
          <Icon name="search" size={20} color={COLORS.gray} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder={route.params?.categoryName
              ? t('market.list.searchIn', { name: route.params.categoryName })
              : t('market.list.searchPlaceholder')}
            placeholderTextColor={COLORS.gray}
            value={searchQuery}
            onChangeText={setSearchQuery}
            clearButtonMode="while-editing"
            returnKeyType="search"
            onSubmitEditing={() => setQuery(searchQuery.trim())}
            testID="list-search"
          />
        </View>
        <CartButton />
      </View>

      <View style={styles.sorts}>
        {SORTS.map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.sortChip, sort === s && styles.sortChipOn]}
            onPress={() => setSort(s)}
            accessibilityRole="button"
            accessibilityState={{ selected: sort === s }}
            testID={`sort-${s}`}
          >
            <Text style={[styles.sortText, sort === s && styles.sortTextOn]}>{t(`market.sort.${s}`)}</Text>
          </TouchableOpacity>
        ))}
        {!!town && (
          <TouchableOpacity
            style={[styles.sortChip, near && styles.sortChipOn]}
            onPress={() => setNear((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ selected: near }}
            testID="near-me"
          >
            <Text style={[styles.sortText, near && styles.sortTextOn]}>
              {t('market.list.near', { town })}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {products == null ? (
        <View style={styles.centerContainer}>
          {error ? (
            <>
              <Icon name="exclamation-circle" size={50} color={COLORS.error} />
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity onPress={loadProducts}>
                <Text style={styles.retryText}>{t('feed.retry')}</Text>
              </TouchableOpacity>
            </>
          ) : <ActivityIndicator size="large" color={COLORS.primary} />}
        </View>
      ) : products.length > 0 ? (
        <FlatList
          data={products}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <ProductCard
              product={item}
              onPress={() => handleProductPress(item)}
              style={{ width: tileSize }}
            />
          )}
          key={`products-${cols}`}
          numColumns={cols}
          columnWrapperStyle={cols > 1 ? styles.columnWrapper : undefined}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onEndReached={loadMoreProducts}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore
              ? <ActivityIndicator size="small" color={COLORS.primary} style={{ marginVertical: 12 }} />
              : null
          }
        />
      ) : (
        <EmptyState query={searchQuery} onClear={() => { setSearchQuery(''); setQuery(''); }} />
      )}
    </View>
  );
};

// =====================
// Product Card Component
// =====================
const ProductCard = ({ product, onPress, style }) => {
  const { t } = useI18n();
  const hasDiscount = product.original_price && (product.original_price > product.price);
  const inStock = product.quantity > 0;
  
  return (
    <TouchableOpacity 
      style={[styles.card, style]} 
      onPress={onPress}
      activeOpacity={0.8}
    >
      {/* Product Image */}
      <View style={styles.imageContainer}>
        <Image
          source={product.images?.[0]?.image_url ? { uri: product.images[0].image_url } : PLACEHOLDER_IMAGE}
          placeholder={PLACEHOLDER_IMAGE}
          contentFit="contain"
          transition={150}
          style={styles.cardImage}
        />
        {hasDiscount && (
          <View style={styles.discountBadge}>
            <Text style={styles.discountText}>
              {Math.round(((product.original_price - product.price) / product.original_price) * 100)}%
            </Text>
          </View>
        )}
      </View>

      {/* Product Details */}
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {product.title || t('market.untitled')}
        </Text>
        
        {/* Price Section */}
        <View style={styles.priceContainer}>
          <Text style={styles.cardPrice}>
            {formatPrice(product.price, product.currency)}
          </Text>
          {hasDiscount && (
            <Text style={styles.originalPrice}>
              {formatPrice(product.original_price, product.currency)}
            </Text>
          )}
        </View>
        
        {/* Stock Status */}
        <View style={styles.stockContainer}>
          <Text style={[
            styles.stockText,
            inStock ? styles.inStockText : styles.outOfStockText
          ]}>
            {inStock ? t('market.inStock', { n: product.quantity }) : t('market.outOfStock')}
          </Text>
        </View>
        
        {/* Rating — real aggregate from the API; absent until someone reviews. */}
        <View style={styles.ratingContainer}>
          {product.average_rating != null ? (
            <>
              <Icon name="star" size={14} color={COLORS.star} />
              <Text style={styles.ratingText}>
                {product.average_rating} ({product.review_count})
              </Text>
            </>
          ) : (
            <Text style={styles.ratingText}>{t('market.list.noReviews')}</Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
};

// =====================
// Empty State Component
// =====================
const EmptyState = ({ query, onClear }) => {
  const { t } = useI18n();
  return (
  <View style={styles.centerContainer}>
    <Icon name="exclamation-circle" size={50} color={COLORS.gray} />
    <Text style={styles.emptyText}>
      {query.trim() ? t('market.list.noMatches') : t('market.list.none')}
    </Text>
    {query.trim() && (
      <TouchableOpacity onPress={onClear}>
        <Text style={styles.actionText}>{t('market.list.clearSearch')}</Text>
      </TouchableOpacity>
    )}
  </View>
  );
};

// =====================
// Styles
// =====================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingHorizontal: ITEM_MARGIN,
    paddingTop: SPACING.small,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.large,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
  sorts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  sortChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  sortChipOn: { backgroundColor: COLORS.primary },
  sortText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  sortTextOn: { color: '#FFFFFF' },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 4,
    paddingHorizontal: SPACING.medium,
    marginBottom: SPACING.medium,
    height: 48,
    elevation: 2,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  searchIcon: {
    marginRight: SPACING.small,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    fontFamily: FONTS.regular,
    fontSize: SIZES.medium,
    color: COLORS.text,
  },
  columnWrapper: {
    gap: ITEM_MARGIN,
    marginBottom: ITEM_MARGIN,
  },
  listContent: {
    paddingHorizontal: ITEM_MARGIN,
    paddingBottom: SPACING.large,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 6,
    marginBottom: ITEM_MARGIN,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  imageContainer: {
    width: '100%',
    aspectRatio: 1, // Square image, scales with the responsive card width
    backgroundColor: COLORS.lightGray,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardImage: {
    width: '80%',
    height: '80%',
  },
  discountBadge: {
    position: 'absolute',
    top: SPACING.small,
    right: SPACING.small,
    backgroundColor: COLORS.discount,
    borderRadius: 10,
    paddingHorizontal: SPACING.small,
    paddingVertical: SPACING.tiny,
  },
  discountText: {
    color: COLORS.white,
    fontSize: SIZES.small,
    fontFamily: FONTS.bold,
  },
  cardContent: {
    padding: SPACING.small,
  },
  cardTitle: {
    fontFamily: FONTS.regular,
    fontSize: SIZES.medium,
    color: COLORS.text,
    marginBottom: SPACING.tiny,
    height: 40, // Fixed height for consistent two-line display
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.tiny,
  },
  cardPrice: {
    fontFamily: FONTS.bold,
    fontSize: SIZES.large,
    color: COLORS.primary,
    marginRight: SPACING.small,
  },
  originalPrice: {
    fontFamily: FONTS.regular,
    fontSize: SIZES.small,
    color: COLORS.gray,
    textDecorationLine: 'line-through',
  },
  stockContainer: {
    marginBottom: SPACING.tiny,
  },
  stockText: {
    fontFamily: FONTS.regular,
    fontSize: SIZES.small,
  },
  inStockText: {
    color: COLORS.inStock,
  },
  outOfStockText: {
    color: COLORS.outOfStock,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingText: {
    fontFamily: FONTS.regular,
    fontSize: SIZES.small,
    color: COLORS.gray,
    marginLeft: SPACING.tiny,
  },
  errorText: {
    fontFamily: FONTS.medium,
    fontSize: SIZES.large,
    color: COLORS.error,
    marginTop: SPACING.medium,
    textAlign: 'center',
  },
  emptyText: {
    fontFamily: FONTS.medium,
    fontSize: SIZES.large,
    color: '#cdd9e5',
    marginTop: SPACING.medium,
    textAlign: 'center',
  },
  retryText: {
    fontFamily: FONTS.medium,
    color: COLORS.primary,
    marginTop: SPACING.small,
  },
  actionText: {
    fontFamily: FONTS.medium,
    color: COLORS.primary,
    marginTop: SPACING.small,
  },
});

export default ProductList;